# Milestone 1 AHP Host Connection Review

> **Historical review.** This report evaluates candidate `ff95b99`; its
> "open" findings are not a statement about current `develop`. The findings
> were carried into
> [`ProvidersPlan-Milestone1-FIX-TASKPLAN.md`](../plans/ProvidersPlan-Milestone1-FIX-TASKPLAN.md)
> and subsequent commits. See [`ProvidersPlan.md`](../plans/ProvidersPlan.md)
> for current milestone status.

## Scope and evidence

- Mode: implementation review of the unstaged Milestone 1 candidate.
- Reviewer: self-review; no independent reviewer was used.
- Candidate: base commit `34f7cd43775691a8b4c2d7a87d84dfa56a2d4535` plus the
  websocket AHP handlers, sessions factory, composition root, and module
  documentation changes present in the reviewed worktree. This report was
  written after that review.
- Scope: `src/websocket/helpers/ahp.ts`, its connection context, sessions
  factory/action reducer, the host composition root, and Milestone 1 of
  [`ProvidersPlan.md`](../plans/ProvidersPlan.md).
- Protocol authority: pinned `@microsoft/agent-host-protocol@1.0.0`.
- Runtime evidence: temporary tests used the actual `AhpClient` and
  `WebSocketTransport` against a live local WebSocket server; test harnesses
  were removed after the review and are not part of the candidate.
- Validation: `pnpm validate` passed on the implementation and approved
  documentation changes: lint, typecheck, 111 tests, documentation coverage,
  and production build. `git diff --check` passed.
- Limits: no fix was applied; findings remain open. The runtime probes are not
  retained as regression tests. There was no independent review or multi-host
  deployment test.

## Verdict

**CHANGES REQUIRED**

The candidate composes the pinned AHP SDK client with the server sufficiently
to complete initialization, subscription, session creation, and one action
round trip. However, live SDK probes reproduced duplicate action delivery and
missing catalogue fan-out, and confirmed that initialization ordering and
unsupported-version closure are not enforced. The full repository validation
passes but does not cover these protocol acceptance failures.

## Findings

### R1 — Subscribed clients miss broadcasts

- Priority/status: P1; open.
- Location: [`ahp.ts`](../../src/websocket/helpers/ahp.ts), connection
  tracking around `createAHPHandlers`.
- Contract: subscribed connections must remain registered for catalogue and
  session fan-out for their lifetime.
- Observed: the handler wrapper captures a context only for the duration of a
  single method invocation and releases it in `finally`.
- Trigger: initialize and subscribe two SDK clients to `ahp-root://`, then
  create a session after the requests complete.
- Evidence: the SDK probe received `root/sessionAdded` on the creating client
  but the second subscribed client timed out without an event.
- Impact: later broadcasts, including session actions from other connections,
  cannot reach those clients.
- Suggested correction: make connection registration persistent and release
  it on socket close, while retaining connection-scoped subscription state.
- Verification needed: a retained real-SDK test that receives one catalogue
  notification and one session action on a different subscribed client.

### R2 — Dispatching client receives duplicate action envelopes

- Priority/status: P1; open.
- Location: [`ahp.ts`](../../src/websocket/helpers/ahp.ts), `dispatchAction`
  and the session-envelope listener.
- Contract: one accepted action produces one `action` notification for each
  subscribed connection, including the origin connection.
- Observed: the factory envelope listener sends to the active connection,
  then `dispatchAction` sends the same envelope directly.
- Trigger: an initialized SDK client subscribes to a session and dispatches a
  title change.
- Evidence: the SDK probe read two envelopes with the same channel, action,
  origin, and `serverSeq`.
- Impact: SDK consumers may apply the mutation twice and observe duplicate
  events.
- Suggested correction: publish through one fan-out path only.
- Verification needed: assert exactly one event for the sender and exactly one
  for each other session subscriber.

### R3 — Initialization order and unsupported-version connection closure are
not enforced

- Priority/status: P1; open.
- Location: [`ahp.ts`](../../src/websocket/helpers/ahp.ts), `initialize`,
  `ping`, and method dispatch; [`types.ts`](../../src/websocket/types.ts),
  `WebSocketConnectionContext`.
- Contract: `initialize` must be the first request; a rejected protocol
  negotiation must return `UnsupportedProtocolVersion` with supported versions
  and close that connection.
- Observed: handlers do not check the connection's `initialized` state, and
  the transport context has no close operation. The state is marked
  initialized but does not gate later method handling.
- Trigger/evidence: an SDK client successfully called `ping()` before
  `initialize`; after an unsupported-version initialization error it remained
  open and successfully pinged again.
- Impact: the connection can execute protocol operations without a negotiated
  version and remains usable after failed negotiation.
- Suggested correction: enforce request ordering at the per-connection
  boundary and provide an explicit close path after the error response.
- Verification needed: retained SDK or raw-frame tests for pre-initialize
  rejection and unsupported-version error followed by connection closure.

### R4 — Dispatch action payloads are not fully validated

- Priority/status: P1; open; source-inferred risk, not separately reproduced.
- Location: [`ahp.ts`](../../src/websocket/helpers/ahp.ts),
  `dispatchAction`.
- Contract: the AHP boundary must validate `DispatchActionParams` and the
  selected action payload before reducer application.
- Observed: the code checks that `action.type` is allowlisted and then casts
  the remaining unknown object to `SessionAction`. `clientSeq` is coerced
  using `Number(...)` instead of requiring a JSON number.
- Trigger: send a malformed payload with an allowed action type, such as
  `session/titleChanged` with a non-string or missing `title`, or a numeric
  string as `clientSeq`.
- Impact: invalid client data can reach the authoritative reducer or be
  accepted despite violating the protocol schema.
- Suggested correction: use runtime schemas for the dispatch envelope and
  supported action variants; reject invalid types without coercion.
- Verification needed: negative protocol tests for malformed fields and
  positive tests for every allowlisted action shape.

### R5 — Missing-session action dispatch maps to Internal Error

- Priority/status: P2; open; source-inferred risk, not separately reproduced.
- Location: [`helpers.ts`](../../src/sessions/helpers/factory/helpers.ts),
  `dispatchAction`.
- Contract: an unknown target session should return the AHP session-not-found
  error, not JSON-RPC Internal Error.
- Observed: the factory throws a generic `Error` when the session record is
  absent; the transport maps generic errors to `-32603`.
- Trigger: dispatch an otherwise valid action to an unregistered session URI.
- Impact: clients receive the wrong public error classification and cannot
  handle the missing-session case reliably.
- Suggested correction: throw the owned AHP/session error at the capability
  boundary.
- Verification needed: a request test asserting the protocol's session-not-found
  code and public message.

## Acceptance coverage

| Criterion | Evidence inspected/run | Status | Gap |
| --- | --- | --- | --- |
| SDK initializes and negotiates | Live `AhpClient` + `WebSocketTransport` local probe | Partial | Initialization can be skipped; failed negotiation does not close |
| Root subscription and catalogue delivery | Live SDK subscription and session creation | Fail | Other subscribed client misses notification |
| Session creation | Live SDK request using mock provider | Pass for this path | Does not prove other lifecycle/error cases |
| Dispatch action and observe echo | Live SDK title-change dispatch | Fail | Origin gets duplicate envelopes |
| Raw-frame error paths | Existing repository tests plus source inspection | Not verified for Milestone 1 | Missing-initialize, bad params, and unknown-channel cases are not implemented/tested as planned |
| Repository quality gate | `pnpm validate` | Pass | This gate does not cover the reproduced protocol failures |

## Documentation Drift

Scoped documentation was updated with approval during the review:

- [`ProvidersPlan.md`](../plans/ProvidersPlan.md) now says Milestone 1 is
  partially implemented but acceptance-incomplete, and records the reproduced
  SDK behavior instead of describing the old ping-only wiring.
- [`src/sessions/README.md`](../../src/sessions/README.md) now includes the
  new snapshot, sequence-cursor, and action-dispatch APIs.

## Required next action

Address R1–R4 before treating Milestone 1 as accepted; correct R5's AHP error
mapping. Add permanent SDK-backed acceptance tests and raw-frame error-path
tests, then rerun `pnpm validate` and review the resulting candidate.

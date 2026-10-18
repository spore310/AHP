# Agent Hosting Protocol — Milestone 1 repair and reusable baseline

Status: **IMPLEMENTED — repository gate passed on the integrated worktree. Not the full AHP specification. Snapshot/action race (T19) and failed-startup cleanup (T24) do not yet have dedicated tests.**

Repository: `spore310/AHP`  
Reviewed branch: `develop`  
Reviewed candidate: `ff95b99c4a6ed61767e962c3470e5723e8a0c477`  
Review input: `docs/reviews/ProvidersPlan-Milestone1-review.md`  
Parent target plan: `docs/plans/ProvidersPlan.md`  
Suggested repository destination for this document: `docs/plans/ProvidersPlan-Milestone1-FIX-TASKPLAN.md`

## 0. Assignment, permissions, and completion contract

Repair the first native AHP client-to-server milestone and establish a reusable public composition surface. This is not a disposable demo, a new agent runtime, or a generic distributed framework.

The user clarified the target:

> A functional AHP server baseline that can be reused for further servers. Import session functions and configuration factories from `@sessions`, supply the appropriate domain and infrastructure contracts, and let the shared host implementation handle AHP and JSON-RPC 2.0.

**Required result:** an independent SDK client can initialize, subscribe, create a session, mutate supported session state, and observe the same authoritative result as a second client. The application author can assemble another configured host without copying protocol handlers or editing the socket loop.

This document is a local-agent implementation handoff. Its creation did not change GitHub. When explicitly assigned to execute this plan, edit only the scoped repository files, tests, and documentation described below. Do not push, merge, deploy, install another agent harness, change models/accounts, or spend outside the user's existing authorization. Commit only under the user's existing local workflow authorization.

### Non-negotiable boundaries

- Pi, its model calls, prompts, and tools remain on client machines. No Pi SDK, model API client, subprocess-based agent execution, or `prompt()` / `abort()` additions to `SessionBackend`.
- Preserve the capability-oriented modular monolith. No Redis, database, broker, extra deployment, dependency-injection framework, or event-sourcing platform.
- `src/websocket/helpers/connection.ts` remains the only per-socket JSON-RPC receive/dispatch loop.
- `@sessions` owns reusable session behavior and its ports. It must not import `ws`, `@websocket`, HTTP requests, or socket connection objects.
- The AHP-facing adapter can use pinned AHP types and reducers. A project's business entities must not be forced to contain JSON-RPC IDs, subscriptions, transport handles, or action envelopes.
- Preserve the existing shutdown, late-backend cleanup, snapshot isolation, owned-error, and unknown-additive-field fixes.
- Do not describe Milestone 1 as the entire AHP specification, production security, a Pi extension, or reconnect/replay support.

### How a smaller implementation model should work

Read Sections 0–4 once. Execute **one packet from Section 5 at a time**, opening only its listed source files and relevant contracts. Return the packet's evidence before starting the next dependent packet. Do not rewrite the whole project to fit the suggested tree. If two repair attempts do not resolve the same failing criterion, obtain a smaller reproduction or a focused review instead of guessing a third patch.

Use the installed `architecture-aware-delivery` workflow. Keep one task record with: candidate identity; current packet; files owned; decisions; failing/passing checks; unresolved findings; next safe action. A checked Markdown box is not test evidence.

## 1. Read and respect the current repository

Before editing:

```sh
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
git diff --cached --stat
node --version
pnpm --version
```

Read these repository instructions, not old copies from a prior chat:

1. `AGENTS.md` and `.agents/AGENTS.md`.
2. `.agents/hooks/task-execution-review.md` and `.agents/skills/architecture-aware-delivery/SKILL.md`.
3. `docs/CodingRules.md`.
4. The review input and Milestone 1 of `docs/plans/ProvidersPlan.md`.
5. Owning READMEs for files in the packet being executed.

For plan/final review, load the skill's `references/review.md`; for delegation, its `references/delegation.md`. Run the existing documentation-drift procedure once within this review's scope; do not create a separate documentation-only agent. Follow its approval rules. Executing this handoff includes only the directly affected README/plan/report updates described here, not an unrelated documentation crawl.

If HEAD or the worktree differs from the reviewed candidate, inspect the affected differences. Preserve staged, unstaged, and untracked user work. Do not reset, stash, checkout, cherry-pick, or overwrite it to match this baseline. Update the task record and revalidate findings that touch changed files.

Current pinned toolchain: Node `24.x` (Volta `24.21.0`), pnpm `10.34.6`, TypeScript `5.9.3`, AHP package `1.0.0`. `package.json` and `pnpm-lock.yaml` remain authoritative. Do not upgrade dependencies to make this task easier.

Current repository gate:

```sh
pnpm validate
# lint -> typecheck -> tests -> docs:check -> build
```

Record a baseline result when the environment permits. An inability to run the gate is a limitation, not permission to report it passed.

### File conventions

Use `index.ts` for exports; `types.ts` for contracts and runtime schemas; `helpers.ts` / `helpers/` for behavior; `constants.ts` for stable values. Supporting modules belong below the owning capability's `helpers/`. Use existing `@sessions`, `@websocket`, `@jsonrpc`, and `@env` aliases across boundaries. Prefer meaningful destructuring aliases. Do not add `schemas.ts`, global `utils/`, or a second naming convention.

Every production TypeScript file under `src/` or `env/` must be listed by its nearest owning README using its path relative to that README. Tests belong only under `src/tests/`; the documentation gate excludes them, but module Testing tables should describe them. Do not weaken `docs:check`.

## 2. Revalidated findings and necessary adjacent corrections

Evidence labels below distinguish source inspection from runtime evidence. The existing review records temporary SDK probes and a passing 111-test gate. Those are **that report's historical results**, not tests run for this handoff. The temporary acceptance probes were removed; retain their replacements this time. [E1]

| ID | Current source evidence | Required repair |
| --- | --- | --- |
| R1 | `createAHPHandlers` captures a connection during one invocation, then removes it in `finally`. The removal also happens before an async handler settles. | Register for the socket lifetime; unregister exactly once on close. |
| R2 | `dispatchAction` sends the returned envelope directly while the factory listener also sends it. | One publication route per accepted envelope; no handler-local success echo. |
| R3 | `initialized` is not a gate; the context cannot close after a negotiation failure. | Explicit connection lifecycle, message-kind/order checks, reply-before-close behavior. |
| R4 | Unknown params are cast to records/actions; `Number(clientSeq)` coerces input; only action names are checked. | Runtime envelope and variant schemas, then capability/domain policy, before mutation. |
| R5 | The sessions factory throws a plain `Error` for a missing dispatch target. | Throw `SessionsError(AhpErrorCodes.SessionNotFound, ...)`; distinguish notification rejection from request error replies. |
| A1 — P1 | `Object.assign(handlers, { __dispose })` puts cleanup in the public RPC method map. The transport invokes any own callable member. | Return lifecycle operations separately from wire handlers; remote `__dispose` must not disable fan-out. |
| A2 — P1 | Initialize marks the connection ready before checking all initial subscriptions. Subscribe adds a URI before checking its snapshot. | Prepare then commit atomically; failures leave no new subscription or initialized identity. |
| A3 — P2 | `getCurrentServerSeq()` takes the maximum of retained session records and returns zero for an empty registry. | Read a real shared sequence cursor, including after disposal and non-session/rejection envelopes. |
| A4 — P2 | `dispatchAction` changes session metadata but does not emit `root/sessionSummaryChanged`. | Update the catalogue projection when summary fields change; keep root-only clients accurate. |
| A5 — lifecycle integration | `main()` stops the transport but does not own/dispose the AHP subscriptions and session factory it creates. | Give the composed host one explicit idempotent cleanup owner. |

R1–R4/A1/A2 are supported by current source; R1–R3 also have runtime evidence in the existing review. A3/A4/A5 are source-level integration findings. Do not label them independently reproduced until the retained tests run. [E2–E6]

### R5 correction: do not create a new protocol bug

`dispatchAction` is a **notification**, not a request. A notification has no JSON-RPC response ID and must not receive a JSON-RPC result/error response. The current transport drops notification exceptions, so a normal malformed/missing-target dispatch does **not** currently send `-32603`; that error appears if the operation is exercised as an ID-bearing request. The missing owned error is real, but the review's proposed request test is insufficient. [P1, P2]

Test three separate contracts:

- Direct capability call: a valid action against a missing session throws the owned `SessionNotFound` error, with no mutation.
- Real request path: `subscribe` to that missing session receives the correct typed JSON-RPC error.
- Real dispatch notification: no JSON-RPC response. A validated but rejected action uses the pinned AHP rejection-envelope mechanism, with no reducer application; malformed unrepresentable input never gets cast into `StateAction`. [P3]

Do not invent `actionRejected`, add an RPC ID to the SDK dispatch, or forward arbitrary exception text as a rejection reason.

## 3. Architecture decision: reusable capability composition

### 3.1 Ownership and dependency direction

```text
Project composition / domain adapter
    | supplies session definitions, configuration, and infrastructure ports
    v
@ sessions: createSessionsFactory
    | validates -> enforces session rules -> reduces state -> emits typed events
    ^
    | invoked through a small session-channel adapter
Reusable AHP binding inside @websocket
    | initialize / URI routing / subscriptions / origin / publication
    v
Existing JSON-RPC dispatcher -> existing WebSocket transport -> clients
```

The `@sessions` import hides **session protocol machinery** from its consumer. A **host composition factory** hides the transport wiring. Do not make `@sessions` import the host merely to satisfy a one-import aesthetic; that reverses dependencies and makes the session capability difficult to test or reuse.

Business-domain code owns business decisions and repository interfaces. A domain-to-session adapter maps those decisions into supported AHP session state. The existing session provider is an integration contract, not a requirement to run an LLM. For this milestone use explicitly labelled mock/test session providers only, with no execution capabilities.

Do not turn native `SessionState` into `SessionState<TArbitraryBusinessObject>` by casting. Native channels have fixed protocol contracts. A later custom domain channel needs an explicit extension contract and a client that understands it; generic AHP clients cannot be assumed to render arbitrary domain state. This plan implements no custom wire channel.

### 3.2 Public composition surface to prove

Reuse the existing `createSessionsFactory`, `SessionProvider`, `SessionConfigContract`, and error classes. Introduce only meaningful missing seams:

| Surface | Location/owner | Purpose |
| --- | --- | --- |
| `createActionSequence` / `ActionSequence` | Initially `@sessions` sequence helper | One allocator with `next()` and `current()`; host-owned instance can serve other channel producers. |
| `createSessionConfig` | `@sessions` configuration helper | Bind the existing configuration descriptor to a runtime parser and a sanitized validation boundary. Not a second schema language. |
| `registryFactory` option | `SessionsFactoryOptions` | Inject a fresh synchronous live-session registry; default to the current in-memory implementation. |
| `createAHPConnectionModule` | `@websocket` AHP submodule | Return `{ handlers, lifecycle, dispose }`; cleanup is not an RPC method. |
| `createAHPServer` | `@websocket` composition helper | Construct and own sequence, sessions, AHP bindings, transport, and composed shutdown. |
| `AHPServerHandle.sessions` | Composed host handle | Reuse the session public API for local application calls; no manual JSON-RPC framing. |

Names above are the handoff's **proposed target API**, not existing Microsoft SDK exports or currently implemented repository functions. Freeze the final signatures in Packet 1 before coding against them.

`createAHPServer` accepts **session factory options**, not an already-owned factory, in this first convenience API. It creates fresh resources and owns disposing them. Advanced callers may use `createSessionsFactory` plus `createAHPConnectionModule` and the raw transport, but then explicitly own their lifetimes. Do not create ambiguous borrowed/owned flags for the first version.

Example target consumer — this must become a compiled and exercised example, not merely README pseudocode:

```ts
// ./src/tests/websocket/composition.test.ts — target public usage
import { createSessionConfig } from "@sessions";
import type { SessionProvider } from "@sessions";
import { createAHPServer } from "@websocket";
import { z } from "zod";

const workspaceConfig = createSessionConfig({
  schema: {
    type: "object",
    properties: { projectKey: { type: "string", title: "Project key" } },
    required: ["projectKey"],
  },
  parser: z.object({ projectKey: z.string().min(1) }).strict(),
});

const provider: SessionProvider = {
  providerId: "baseline-test",
  agentInfo: {
    provider: "baseline-test",
    displayName: "Baseline test sessions",
    description: "State-only test fixture; no agent execution.",
    models: [],
  },
  config: workspaceConfig,
  startSession: async () => ({ dispose: () => undefined }),
};

const host = createAHPServer({
  host: "127.0.0.1",
  port: 0,
  sessions: { providers: [provider] },
});

try {
  await host.start();
  await host.sessions.createSession({
    channel: "ahp-session:/00000000-0000-4000-8000-000000000001",
    provider: "baseline-test",
    config: { projectKey: "example-project" },
  });
  // Connected SDK clients receive the same catalogue/state notifications.
} finally {
  await host.stop();
}
```

The URI remains the native session identifier; local callers may generate it without constructing JSON-RPC. Keep the wire's client-selected URI semantics unchanged. A domain convenience function may choose an ID; do not silently change `createSession` to overwrite a remote client's ID.

### 3.3 A small channel seam, not a second framework

Extract the existing root/session snapshot routing into **one AHP channel-adapter registry** inside the AHP submodule. Register root and session adapters during composition. Its purpose is to select a known URI scheme's snapshot/validated-dispatch behavior. Reject duplicate scheme registrations at construction.

Each adapter owns its native state contract, action validation/policy, snapshot read, and typed event subscriptions. The shared AHP layer owns connection registration, initialization, delivery barriers, error translation, and fan-out. A channel adapter must not install socket listeners or build JSON-RPC responses.

Start with a concrete root/session union and a narrow interface; do not widen everything to `any` or build generic type plumbing for every possible future channel. A future channel will add an adapter and its contracts/tests, **not** another receive loop or another copy of initialize/subscribe.

Implement and test only these two native adapters now. No terminal/chat runtime, custom channel URI, dynamic plugin loader, or channel database is authorized.

### 3.4 Infrastructure truthfulness

The current `SessionRegistry` stores live `SessionRecord` objects, including provider and backend handles. It is a synchronous **live-state port**, not a durable database repository. A `registryFactory` enables deterministic testing and alternate in-process implementations; it does not make a SQL adapter a drop-in replacement.

A domain provider may close over domain repository interfaces supplied by the application. Do not serialize functions, promises, provider objects, or backend handles. Durable session records and async commit-before-publish semantics are a later, separately designed contract.

## 4. Freeze these behavioral contracts before implementation

### 4.1 Message kinds and connection phases

AHP phases: `new -> initializing -> ready -> closing -> closed`.

- Generic JSON-RPC transport remains usable without AHP. Do not force old echo/ping transport tests to initialize.
- The AHP binding enforces its own method kind and initialization rule **before** method lookup/invocation. Requests before initialization receive a safe error with their original ID; no domain work runs.
- `initialize`, `ping`, `subscribe`, and `createSession` are requests. `unsubscribe` and `dispatchAction` are notifications.
- An `initialize` notification must not initialize a peer. A request-shaped `dispatchAction` must not mutate state; report an invalid request for that wrong method kind.
- Duplicate initialization cannot change the negotiated ID, reset subscriptions, or re-enter initialization. Reject it without mutating the existing connection.
- Unsupported negotiation marks the peer closing immediately, sends one `UnsupportedProtocolVersion` response with `supportedVersions`, then begins transport closure. No pipelined message can execute in between.
- A connection ID and negotiated client ID are correlation identities, not authentication. Do not trust a payload's clientId/origin as the authenticated caller.

Use the pinned SDK's constants/helpers. Protocol version is not the application version; `serverInfo.version` should identify the host build or be omitted, not automatically copy `PROTOCOL_VERSION`.

### 4.2 Per-invocation reply ordering

Add a minimal, transport-owned **per-invocation reply-settled callback** or equivalent typed operation result. It must distinguish success/failure and whether a response was sent. The callback belongs to that invocation, not a mutable shared `afterReply` slot on the socket.

Use it to commit/flush successful snapshot subscriptions and to close after a fatal error reply. Register/send/cleanup effects must each execute at most once. Sending a response means local ordered enqueue/write completion, not proof that a remote machine received it.

Do not implement reply ordering using sleeps, `setTimeout(close, 0)`, polling flags, raw socket access from session code, or by serializing every request behind a potentially unresolved `createSession` startup promise.

### 4.3 Atomic subscribe and initialization

Prepare validated URIs, snapshots, candidate identity/version, and subscription changes without exposing partial state. For a new subscription, use a bounded pending-delivery barrier: capture snapshot/cursor, buffer later matching events while its reply is pending, enqueue the successful reply, then activate and flush in order. Roll back on failure/close. Existing active subscriptions remain valid if a replacement subscribe fails.

An initialization containing one valid and one missing URI must leave the connection uninitialized and with **no** new subscriptions. A failed standalone subscribe must not leave a ghost URI that starts receiving events when that resource is created later.

Do not hold a global lock during backend startup. Local synchronous state preparation is short; a pending subscription's queue must have explicit bounded behavior. Overflow closes/resynchronizes that peer rather than dropping a state action and pretending it is current. Reconnect implementation remains deferred.

### 4.4 Exactly one publication route

An accepted session mutation follows:

```text
validated intent -> session policy -> reducer -> sequence/envelope
   -> session event -> shared publisher -> eligible subscribed connections
```

No direct successful send in `dispatchAction`. Each socket receives at most one local enqueue of that accepted envelope through this route. A slow/broken recipient cannot prevent healthy peers from receiving it.

This is **not** a claim of network exactly-once delivery, replay, durable acknowledgment, or deduplication of retried user commands. Do not implement those features here.

Rejection delivery is an explicit publisher mode targeted to the originating connection; it is not a second success-broadcast path. A rejected envelope is never reduced into authoritative state or replayed as an accepted action.

### 4.5 Validation versus policy

A type name being client-dispatchable upstream does not mean this baseline implements its side effects or permissions. Validate first, then decide support and policy. Establish one action-support table rather than letting the transport and session factory keep independent allowlists.

Recommended baseline profile: fully support `session/titleChanged`, `session/isReadChanged`, and `session/isArchivedChanged`. Preserve their native payload semantics: string title, boolean isRead, boolean isArchived. Empty-title or other extra business restrictions must be an explicit domain policy, not invented protocol validation.

The current thirteen-name allowlist is not acceptance proof. The other ten action kinds require configuration, working-directory, identity/tool, customization, or MCP semantics not fully implemented here. Do not report success by running a no-op reducer for them. Document them explicitly as unsupported in this baseline, and add negative tests. This is an explicit proposed capability narrowing of an acceptance-incomplete candidate, **not** an undocumented removal of a verified feature. If current worktree evidence demonstrates an already-required implementation for one of them, stop only that policy decision and obtain a scoped plan review; do not silently delete it.

Keep a pinned-schema inventory of all thirteen current names so future support is additive. For variants retained as valid-but-unsupported, validate their full pinned payload before constructing a rejection envelope. Never cast an unvalidated/unknown action into the SDK union. A malformed notification that cannot be represented safely is dropped with a sanitized diagnostic or closed under a documented malformed-input policy; no JSON-RPC reply and no accepted envelope.

Validate `clientSeq` as a JSON number with safe-integer/range checks consistent with the pinned contract. **No `Number(...)` or `z.coerce`**. Verify the SDK-generated initial value; do not accidentally reject a valid starting value. Check missing, null, string, fractional, boolean, unsafe integer, and negative values. Unknown additive fields may be ignored, but known fields may not escape validation.

### 4.6 One sequence, truthful snapshots, consistent summaries

Introduce a shared `ActionSequence { next(): number; current(): number }`. Its `current()` must not allocate. Use the same instance for session, root, and any rejection envelopes. Do not derive it from the session registry or reset it merely because the registry is empty.

Preserve the existing `createSequenceAllocator` public helper as a compatibility wrapper if needed. For the legacy `nextServerSeq` injection, either migrate all scoped callers/tests in a coherent change or provide a documented compatibility adapter that tracks only its own observed calls. Do not claim the legacy callback alone reveals actions minted by other producers. The recommended composed host must use the complete sequence port, not that limited compatibility route.

Snapshot state and `fromSeq` must describe one capture boundary. A record's last-modified sequence may remain an internal value, but a shared current cursor must not be fabricated from it. Do not reset domain revision/timestamps when sending a rejection.

When accepted metadata changes, emit `root/sessionSummaryChanged` with the new changed summary fields, including title/status/modifiedAt as applicable. Derive from the authoritative result, not directly from untrusted params. Catalogue notifications themselves allocate no action sequence.

The root snapshot currently includes `activeSessions`; the pinned type defines it as non-disposed sessions. Keep it synchronized using the native `root/activeSessionsChanged` action when that count changes. Root and session actions share the sequence port. Do not silently maintain a stale count or repurpose it as a count of WebSocket peers. [P4]

## 5. Execution packets

### Packet 0 — Baseline and protocol ledger

**Mode:** read/test preparation. **Owner:** lead.

Read: Sections 0–4; the existing review; `src/websocket/helpers/ahp.ts`; `src/websocket/types.ts`; `src/websocket/helpers/connection.ts`; `src/sessions/types.ts`; `src/sessions/helpers/factory/helpers.ts`; owning READMEs.

Actions:

1. Record HEAD/worktree/toolchain and baseline validation.
2. Mark R1–R5/A1–A5 as reproduced, source-confirmed, already-fixed, or not-applicable with evidence. Do not fix a finding already addressed by a newer candidate.
3. Inspect the installed `@microsoft/agent-host-protocol@1.0.0` exports/types and actual SDK subscription API. Upstream tag `v1.0.0` was resolved to `5f16d81bb7045b66d7bc768d244feab75002d943`; source pointers are in Section 8. Installed package contents remain the execution authority.
4. Record method kind, parameter schema, action variant fields, error constants, rejection-envelope contract, and sequence constraints. Avoid copying stale SDK README sample action names.
5. Critique this plan: confirm that the shared transport remains generic, sessions remain socket-free, no runtime is introduced, and the safe-profile decision is visible.

**Exit:** a short `PASS / REVISE / BLOCKED` plan gate. No production edit before PASS on the affected boundaries. A runtime environment failure can leave tests blocked while source-grounded planning continues.

### Packet 1 — Permanent harness and frozen contracts

**Owner:** lead; independent test author only after signatures are frozen.

Allowed existing files: `src/websocket/types.ts`, public index exports when required, `src/tests/index.test.ts` for changed mocks. New tests: `src/tests/websocket/ahp.test.ts`, `src/tests/websocket/helpers.ts`, and `src/tests/websocket/composition.test.ts`.

Actions:

1. Define `createAHPConnectionModule`'s non-wire lifetime handle and the generic transport's optional connection lifecycle/message-boundary integration. Do not attach lifecycle members to the handler map.
2. Define the per-invocation reply-settled operation described in 4.2. Preserve the existing handler return-value and owned-error behavior.
3. Write the real SDK host fixture: loopback, ephemeral port, configured path, mock provider, isolated state, cleanup in `finally` / `afterEach`.
4. Attach collectors **before** initiating subscriptions and actions. Use the installed SDK's subscription readiness API correctly. `attachSubscription` is local attachment, not necessarily a wire subscribe; initialSubscriptions and standalone subscribe need distinct test paths.
5. Raw-frame test support must correlate by request ID and separately collect notifications. The existing `readJson` helper that returns the next frame is not adequate once unsolicited events interleave with responses.
6. Provide bounded waits whose timers/listeners are always cleaned up. For event counts, test the synchronous publisher directly and use a known processed barrier plus bounded observation for network delivery; do not claim one client's ping proves another connection has processed its request.
7. Retain failing regressions for R1–R5/A1/A2. Record actual red results when runnable. Do not delete the probes or mark them skipped after diagnosis.

**Exit:** signatures are frozen; retained tests target the public composed AHP path, not only the generic echo server. Existing generic transport tests remain meaningful.

### Packet 2 — Connection lifetime and safe cleanup surface

**Depends on:** Packet 1. **Owner:** one implementation agent; do not parallel-edit these files.

Allowed: `src/websocket/helpers/connection.ts`, `src/websocket/helpers/server.ts`, `src/websocket/types.ts`, `src/websocket/index.ts`; current `helpers/ahp.ts` and its scoped extraction to `helpers/ahp/`; websocket tests and owning README.

Actions:

1. Move the growing AHP code, if needed, to `src/websocket/helpers/ahp/{index.ts,types.ts,constants.ts,helpers.ts}`. Remove the old competing implementation and update imports. Additional supporting modules must remain below this owner.
2. Replace `Object.assign(handlers, { __dispose })` with a typed module handle containing a plain wire-only `handlers` map and separate lifecycle/dispose functions.
3. Register one AHP peer on transport connection acceptance. Use `connectionId` as the map key, not a negotiated client ID that may collide. Keep state in an AHP-owned record instead of attaching optional fields via casts to a transport context.
4. Unregister on socket close, detach listeners, discard pending snapshot deliveries, and make cleanup idempotent across close/error/shutdown.
5. Provide the AHP close-after-reply path without exposing raw sockets to `@sessions`. Keep error listeners installed through the close lifecycle.
6. Dispose host-level catalogue/envelope subscriptions exactly once when the binding is disposed. Ensure no exception in one cleanup stops the others from being attempted.
7. Do not replace the repaired start/stop state machine or relax its no-resource-after-stop guarantees. Only thread the new lifecycle callbacks through it.

Required checks: R1 cross-client delivery; remote `__dispose` returns MethodNotFound after initialization and changes nothing; inherited method protections remain; repeated close/dispose does not duplicate callbacks; remaining peers still receive events.

**Exit:** connection state lasts as long as the socket; cleanup is never remotely callable; ordinary JSON-RPC usage still works without AHP.

### Packet 3 — Session validation, typed errors, sequence, and projections

**Depends on:** Packet 1 contracts. May proceed beside Packet 2 only with strictly disjoint files.

Allowed: `src/sessions/types.ts`, `src/sessions/constants.ts`, `src/sessions/index.ts`, `src/sessions/helpers/factory/helpers.ts`, `src/sessions/helpers/state/helpers.ts`, `src/sessions/helpers/sequence/*`, `src/sessions/helpers/summary/*`, `src/sessions/helpers/errors/*`; new `src/sessions/helpers/actions/{index.ts,types.ts,helpers.ts}`; scoped tests and READMEs.

Actions:

1. Put session action schemas and baseline support policy in the session capability. Match the pinned SDK with typed positive fixtures and wrong-shape negative fixtures. Preserve existing enum-mirror safeguards rather than using `as never` to silence failures.
2. Ensure every public client-action entry point validates or consumes an explicitly validated internal command. Direct `@sessions` use must not bypass invariants merely because TypeScript types exist.
3. Validate shape/support/target before reducer application. Missing target throws the owned `SessionsError` with `AhpErrorCodes.SessionNotFound`; safe message; no mutation or fabricated success event.
4. Add the shared sequence port and current cursor. Preserve creation, failure, and disposal behavior. Test that reads do not advance it, clearing the registry does not rewind it, and another producer using the same port is visible to the snapshot boundary.
5. After a supported action, apply the existing SDK reducer once, update timestamp, create one accepted envelope, and emit it once. If a listener fails, state remains committed and other listeners still run.
6. Emit accurate catalogue summary changes from the result. Do not leak a live `SessionRecord` through snapshots or events. Preserve defensive clones.
7. Narrow the baseline support profile explicitly as in 4.5. Do not add MCP execution, client-provided tool execution, working-directory grants, or mutable-config semantics to make an allowlist entry look implemented.

Required checks: missing-target unit error; negative action/sequence cases; valid title/read/archive states through the SDK reducer; no action event on malformed input; immutable snapshots; one event per mutation; summary changes; shared cursor across sessions and disposal; all existing lifecycle regressions.

**Exit:** local session calls and wire calls can share one safe state transition path. No transport dependency enters the module.

### Packet 4 — Transactional AHP handshake and subscriptions

**Depends on:** Packets 2–3. **Owner:** lead AHP integration agent.

Allowed: AHP submodule; generic invocation hooks only where required; new AHP tests; websocket README.

Actions:

1. Replace unsafe params casts with runtime schemas for initialize/ping/subscribe/unsubscribe/dispatch envelope. Validate optional known fields in the pinned contract; ignore compatible additive unknown fields without trusting them.
2. Enforce the AHP phase and method kind at its boundary. Remove synthetic empty contexts and `unknown-client` fallbacks.
3. Prepare all initialization fields/snapshots before committing them. Failure must not write negotiated identity or subscriptions.
4. Implement pending snapshot delivery and reply commit/rollback. Repeated subscribe is one subscription, not a second broadcast registration. Unknown URI does not create a subscription.
5. On unsupported version, stage the safe error, enter closing before another message can execute, send the error response, then close. Flush/close failures clean up locally and are not reported as successful handshakes.
6. Reject duplicate initialization and pre-initialize domain operations. Test notifications as well as requests. Pre-initialize dispatch must not alter session state or create an origin called `unknown-client`.
7. Stamp origin from the registered connection. A supplied top-level `origin`, `clientId`, or `serverSeq` is ignored/rejected according to schema; it never overrides server authority.

Required checks: initialize happy path; standalone subscribe; duplicate initialize; initialize without params/wrong fields; mixed valid/missing initialSubscriptions rollback; ghost-subscription regression; error-before-close; back-to-back unsupported initialize plus create; two distinct connections remain isolated.

**Exit:** the first request boundary is functional and transactional, with one snapshot then ordered subsequent events.

### Packet 5 — Shared publication, notification rejection, and live root view

**Depends on:** Packet 4. **Owner:** lead AHP integration agent.

Allowed: AHP submodule and session event/summary helpers only for directly coupled changes; scoped tests and docs.

Actions:

1. Delete the direct success echo from `dispatchAction`. Factory events enter one shared publication service. Route by subscription and lifecycle, honoring pending snapshot barriers.
2. Implement the narrow root/session adapter registry from 3.3. Register once, reject duplicates, and release source subscriptions once. No per-method transient connection capture.
3. For accepted actions, sender and other eligible subscribers each receive exactly one matching envelope. A non-subscriber receives none. Unsubscribing one client does not affect another.
4. Translate a **validated** rejected dispatch into the pinned `ActionEnvelope` with `rejectionReason`, correlated origin, and the shared sequence; never apply it to authoritative state. Route it through the publisher's origin-only rejection mode. Do not also throw/send a JSON-RPC error response for that notification.
5. Keep malformed notifications separate: no mutation, no unsafe cast, no accepted event, no JSON-RPC response. Record only sanitized diagnostic fields. If the pinned package differs from the rejection contract, flag that exact difference instead of creating a custom standard-looking event.
6. Keep metadata summaries and the root `activeSessions` count live. Implement native root count actions from actual non-disposed session changes using the shared sequence. Catalogue notifications do not consume it. Do not count connections as sessions.
7. A publication failure on one peer must not break delivery to the rest. A send failure marks/cleans that peer rather than silently claiming it is synchronized.

Required checks: sender/observer/non-subscriber counts; unsubscribe barrier; client disconnect; publication after creator request completes; rejected action leaves snapshots unchanged; correct notification silence; root-only client sees rename/status/count; sequences unique and monotonic in the shared stream.

**Exit:** R1/R2/R5 are closed through actual notifications and real SDK consumption, not just hand-called functions.

### Packet 6 — Public factories and repeatable host composition

**Depends on:** Packets 3–5. **Owner:** lead.

Allowed: `src/sessions/helpers/configuration/{index.ts,types.ts,helpers.ts}` (new), sequence/registry options and exports; `src/websocket/helpers/host/{index.ts,types.ts,helpers.ts}` (new), websocket exports; `src/index.ts`; composition/index tests; owning READMEs.

Actions:

1. Implement `createSessionConfig({ schema, parser })` around the existing `SessionConfigContract`. Use a typed Zod output constrained to a configuration record. Normalize before session registration, preserve defaults, and sanitize unexpected parser errors. The provider owns business validation; no values/stacks should appear in public validation diagnostics.
2. Clone/protect the descriptor supplied to the config helper. Do not claim descriptor/parser equivalence is mathematically enforced: test that each provider's descriptor and parser agree on required/type/default/enum/unknown-key behavior. Do not build a new general-purpose schema generator.
3. Add `registryFactory` with the current in-memory default. Invoke once per factory/host, not per operation; document exclusive ownership. The new port is synchronous live state, not advertised as persistence.
4. Implement `createAHPServer({ host, port, path?, sessions, ... })`. Construct one sequence instance, one fresh session factory, one root/session binding, and one transport. All bindings receive that same sequence. Consumers do not manually register methods or fan-out listeners.
5. Expose `{ start, stop, sessions }`. `stop()` is one shared terminal completion that stops intake, closes connections/transport, detaches binding listeners, and disposes sessions. Attempt every cleanup even if one fails; report an aggregate failure after attempts. Startup failure must clean up constructed resources too.
6. Preserve the session factory's documented standalone reuse after its own disposal. The composed host is terminal after `stop()`. A caller retaining `host.sessions` must not revive that stopped host; document that its capability lifetime ends with the host and guard composed-use operations accordingly.
7. Wire `main()` to the composed host and its existing signal handling. Remove no validation hooks and introduce no global provider/registry singleton.
8. Prove the example in 3.2 using public imports. Start two independently configured hosts in a test, create a session in each, and prove no providers, registry records, sequence counters, subscriptions, or notifications leak across them. No network frame code belongs in a provider or domain factory.

Required checks: config normalization/rejection before registration; custom registry-factory spy; isolated two-host fixtures; local `host.sessions.createSession` observed by remote clients; composed shutdown/startup failure; compiled public example.

**Exit:** the server is reusable by changing options/domain adapters, not by modifying `ahp.ts` or `connection.ts`.

### Packet 7 — Documentation, final regression matrix, independent review

**Depends on:** all prior packets.

Allowed docs: current review (append resolution addendum only), `docs/plans/ProvidersPlan.md` Milestone 1/current-state/acceptance sections, `src/websocket/README.md`, relevant session READMEs, `src/README.md`, root README, `docs/technical/wire-contract.md`, and architecture capability map only where actual boundaries changed. Do not rewrite later milestones.

Actions:

1. Correct the current websocket README's contradictory claims: the raw transport is session-agnostic, but its contained AHP binding is AHP/session-aware and owns fan-out. Separate those API descriptions.
2. Map new/moved production files in their owning READMEs. Include a working five-minute public-factory example and an intermediate injected-domain/infrastructure example with explicit lifecycle ownership.
3. Record the exact baseline supported actions and intentionally unsupported operations. Explain request errors versus notification rejection; no authentication/replay/complete-protocol claim.
4. Preserve the original review's candidate/evidence. Append a dated R1–R5/A1–A5 resolution matrix with test paths/names, actual results, candidate identity, and any residual limitation. Do not erase the prior failures or pretend its deleted probes are retained tests.
5. Run the full gate on the final integrated candidate, including docs changed at close-out:

```sh
pnpm typecheck
pnpm exec vitest run src/tests/websocket.test.ts src/tests/websocket src/tests/sessions src/tests/index.test.ts
pnpm docs:check
pnpm validate
git diff --check
git diff --stat
git status --short
```

6. Repeat the focused SDK suite using the harness's supported repeated-run facility or several explicit runs. Record counts; do not invent a portable `--repeat` flag. Investigate any flake rather than increasing sleeps until it disappears.
7. Have a read-only independent reviewer inspect the actual candidate and evidence when available/authorized. Self-review must be labelled self-review. Reviewer checks the acceptance matrix and public composition test, not just the implementation summary.
8. Fix any blocker, rerun affected checks, then rerun the final required gate. Do not mark M1 accepted with validation incomplete or a required matrix row missing.

**Exit:** `VERIFIED` only when the implemented baseline satisfies every applicable required criterion. Otherwise report `IMPLEMENTED / VALIDATION INCOMPLETE`, or `BLOCKED / PARTIAL` with exact evidence gaps.

## 6. Acceptance matrix — retain these tests

| Test ID | Scenario | Required evidence |
| --- | --- | --- |
| T01 | SDK initialize with root initial subscription | Correct negotiated version, truthful cursor, usable root snapshot. |
| T02 | Two ready root subscribers; A creates after all subscribe replies | B receives one catalogue addition; A also receives its subscription event. |
| T03 | Two session subscribers plus non-subscriber; A renames | One matching envelope each for A/B, none for C; identical authoritative title. |
| T04 | Creator request finishes before an unrelated later change | Lifetime registration still delivers the change. |
| T05 | B unsubscribes; barrier on B; A changes | B receives no later matching action; A still receives one. |
| T06 | A disconnects, B remains | No stale A sends, B keeps working, resources detach once. |
| T07 | Ping/subscribe/create/dispatch before initialize | No domain effects; proper request errors, notification silence. |
| T08 | Unsupported version plus pipelined create | Error frame with supportedVersions precedes closure; session never created. |
| T09 | Duplicate initialize / initialize as notification | Existing identity/subscriptions untouched; no unauthorized phase transition. |
| T10 | Mixed valid/missing initialSubscriptions | Atomic failure: no ready state, no partial registration. |
| T11 | Failed subscribe; target later created | No ghost subscription. |
| T12 | Missing/wrong title; wrong read/archive flags | No reducer application, accepted envelope, or state corruption. |
| T13 | String/null/boolean/fractional/unsafe/negative clientSeq | No coercion; rejection policy verified against pinned numeric constraints. |
| T14 | Server-only/unsupported action and spoofed origin | No unauthorized accepted mutation; origin derives only from connection. |
| T15 | Missing target, direct session API | Owned SessionNotFound, no state/event side effects. |
| T16 | Missing target, subscribe request | Correct JSON-RPC code with matching request ID. |
| T17 | Valid but rejected dispatch notification | Pinned rejection envelope; no JSON-RPC response; no authoritative mutation. |
| T18 | Remote `__dispose`, `dispose`, inherited property names | Not registered as lifecycle methods; fan-out continues. |
| T19 | Snapshot reply racing another action | Snapshot before buffered newer actions; no missing/double state effect. |
| T20 | Cursor after multiple sessions, clear/reuse, another producer | No rewinding; current read never allocates; all emitted envelopes ordered. |
| T21 | Root-only observer sees rename/read/archive/count | Summary projection and optional count remain truthful. |
| T22 | Config defaults/errors and injected registry | Public factory normalizes before registration; fresh state per instance. |
| T23 | Two hosts from public factories | No protocol edits and no cross-host leakage. |
| T24 | Host stop and failed startup | Transport, bindings, sessions cleaned; no revival or late fan-out. |
| T25 | Existing shutdown, cloning, disposal, generic RPC tests | No regression and no weakening/skipping of old tests. |
| T26 | Final repository gate and README mappings | Actual final-candidate results for all five validation stages. |

For notification tests, never use the next received message as if it must be a request reply. For positive fan-out, wait for the intended event at each recipient. For absence, use a deterministic in-process publisher assertion plus bounded wire observations after the relevant peer's processed barrier. Document what the test proves.

## 7. Team use, review gates, and commit guidance

Default: one lead implementer. These changes share the AHP boundary; five simultaneous workers in `ahp.ts` are counterproductive.

When supported and authorized, use at most two concurrent subagents and three distinct assignments, with no nested delegation:

- **Sessions worker:** Packet 3 only, after Packet 1 signatures. Owns `src/sessions/**` and associated tests; cannot edit websocket/entrypoint/configuration files outside its packet.
- **Test/review worker:** either permanent acceptance tests against frozen APIs, or read-only final review. It must not invent a competing transport API or approve its own implementation as independent review.
- **Lead:** transport/AHP lifetime, subscription barriers, composition, conflict resolution, integration, documentation, final evidence.

In a shared worktree, give one owner per file. Serialize changes to public contracts, index exports, manifests, and shared test support. Do not spawn subagents if availability or spend permission is unknown. Sequential execution is valid.

Before implementation: `PASS / REVISE / BLOCKED` for architecture/contract/testability. Before close-out: re-review the integrated candidate; tests from an earlier diff are stale when the affected behavior changes.

Suggested coherent commit units, only when commits are authorized:

```text
fix: bind AHP lifecycle to connection ownership
fix: validate session actions and preserve protocol rejection semantics
fix: publish ordered AHP snapshots and actions once
feat: expose reusable session and AHP host composition factories
note: document Milestone 1 acceptance and capability boundaries
```

Use the repository's allowed commit format and useful descriptions; inspect staged changes. Do not automatically stage other agents' files. Do not push or merge.

### Final local-agent report template

```text
Candidate: HEAD + identified staged/unstaged/untracked task changes
Mode and reviewer: execute; independent review or self-review explicitly labelled
R1–R5/A1–A5: fixed/open/not-applicable, with source + retained test evidence
Public API: factory names, ownership/lifetime, supported baseline actions
Checks: exact commands, actual outcomes, toolchain, final-candidate identity
Architecture: no session->transport dependency; no server model/Pi runtime
Documentation: updated scoped paths and remaining drift
Limitations: remaining unsupported capabilities, blocked tests, baseline failures
Status: VERIFIED or IMPLEMENTED / VALIDATION INCOMPLETE or BLOCKED / PARTIAL
```

## 8. Source ledger and verification limits

The following source files were read at the immutable candidate rather than inferred from old plans. Symbol names are more durable than line numbers during the planned extraction.

- **E1:** [Milestone 1 review](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/docs/reviews/ProvidersPlan-Milestone1-review.md).
- **E2:** [Current AHP handlers](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/websocket/helpers/ahp.ts): `createAHPHandlers`, `subscribeConnection`, `createRootHandlers`, `dispatchAction`.
- **E3:** [Transport dispatcher](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/websocket/helpers/connection.ts): `lookupHandler`, `handleRequest`, `handleNotification`, `attachConnection`.
- **E4:** [Sessions factory](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/sessions/helpers/factory/helpers.ts): `createSessionsFactory`, `getCurrentServerSeq`, `dispatchAction`, `dispose`.
- **E5:** [Session contracts](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/sessions/types.ts) and [public exports](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/sessions/index.ts).
- **E6:** [Composition root](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/index.ts).
- **E7:** [Accepted direction / milestone plan](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/docs/plans/ProvidersPlan.md).
- **E8:** [Repository instructions](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/.agents/AGENTS.md), [coding rules](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/docs/CodingRules.md), and [documentation gate](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/docs/gates/documentation.md).
- **E9:** [Websocket README](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/src/websocket/README.md) and [current package manifest](https://github.com/spore310/AHP/blob/ff95b99c4a6ed61767e962c3470e5723e8a0c477/package.json).
- **P1:** [JSON-RPC 2.0, notification semantics](https://www.jsonrpc.org/specification#notification).
- **P2:** [Official AHP message categories](https://microsoft.github.io/agent-host-protocol/specification/overview.html).
- **P3:** [Official AHP actions](https://microsoft.github.io/agent-host-protocol/guide/actions.html) and [reconciliation](https://microsoft.github.io/agent-host-protocol/guide/reconciliation.html). Consult installed v1.0.0 definitions before implementation; live documentation may evolve.
- **P4:** [Pinned v1.0.0 root state](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-root/state.ts), [session actions](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/actions.ts), and [TypeScript SDK entry points](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/README.md).

Author's verification limits: this is a source-grounded review and implementation plan, not an applied fix. The available local runtime reported Node `v22.16.0`, not the repository's pinned Node 24. A package download attempt failed because the container could not resolve the registry host; no dependency installation, `pnpm validate`, live SDK acceptance test, or independent coding-agent review was run by the handoff author. Repository-reported prior test results are attributed to E1. No repository files, hooks, branches, or commits were changed by producing this artifact.

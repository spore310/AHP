# TASK PLAN — AHP Server Stabilization & ProvidersPlan Readiness

**Repository:** https://github.com/spore310/AHP  
**Starting branch:** `develop`  
**Reviewed baseline:** `1c5f4fc3572f1af9797a59d59d1b3f915761f178` (2026-10-18)  
**Status:** **Approved direction / work not yet performed by this document**  
**Intended audience:** Local coding agents (implementers, reviewer, integrator).  
**Related review:** `AHP_DEVELOP_REVIEW_2026-10-18.md` (8 fixed, 3 partial).  
**Target plan to prepare:** `docs/plans/ProvidersPlan.md` (**do not implement its feature milestones in this task**).

## 0. Mission and definition of done

Resolve the three remaining review issues and make `docs/plans/ProvidersPlan.md` unambiguous and ready for a later AHP-client connection milestone. Do **not** add a model runtime to the AHP server.

**Success requires all of the following:**

- [ ] WebSocket `start()` and `stop()` races do not resurrect a stopped server, leave a bound port, or leak heartbeat timers.
- [ ] WebSocket shutdown semantics are accurate even when a deadline forces closure.
- [ ] Session-factory disposal cannot race with newly created sessions; late backend cleanups and errors are handled explicitly.
- [ ] Host-wide action sequence invariants are documented/tested; actual reconnect/replay remains a **future** milestone unless explicitly required for a narrow regression test.
- [ ] `docs/plans/ProvidersPlan.md` is corrected to support **Pi as an independent AHP client**, not a server-hosted Pi agent.
- [ ] No Pi SDK dependency, model API call, model lifecycle, or agent process manager is introduced into the server.
- [ ] Tests are added to `src/tests/` and `pnpm validate` passes on the repo's pinned Node 24/pnpm toolchain.
- [ ] Changes are reviewed for code/documentation drift; each implementation unit has a focused commit and short handoff notes.

**Do not silently broaden this task into an AHP host implementation.** Current runtime wiring remains ping-only until `ProvidersPlan.md` is approved for implementation.

## 1. Architectural invariants (non-negotiable)

### Accepted deployment model

```text
   Machine A / local Pi                 Machine B / local Pi
   ┌──────────────────────┐             ┌──────────────────────┐
   │ Pi agent + model     │             │ Pi agent + model     │
   │ Pi AHP extension     │             │ Pi AHP extension     │
   └──────────┬───────────┘             └───────────┬──────────┘
              │ AHP client transport                  │ AHP client transport
              └──────────────────┬───────────────────┘
                                 │ WebSocket / JSON-RPC
                         ┌───────▼───────────────────┐
                         │ SINGLE-NODE AHP SERVER    │
                         │ Connection registry       │
                         │ Protocol validation       │
                         │ Session / channel state   │
                         │ Subscriptions + fan-out   │
                         │ Authorized coordination   │
                         └───────────────────────────┘

   No LLM, Pi runtime, model credentials, or Pi child process in server.
```

**Terminology:**

- **Client transport:** Network connection made by a Pi extension or another AHP-compatible application.
- **Pi runtime:** Executes locally within the user's Pi process, *outside* the AHP server.
- **AHP session/channel state:** Server-authoritative protocol state, not a direct agent-to-agent message transport.
- **Client identity:** Logical application identity, distinct from connection ID, session URI, and authenticated principal.
- **Coordination capability:** An optional future application-level design for client/agent presence and addressed messages; **not automatically supplied by native AHP**.
- **Existing `SessionProvider` / `SessionBackend`:** Current server scaffold and mock test capability. Do not interpret these as approval to run Pi or another AI model on the host.

Preserve `.agents/AGENTS.md` and `docs/CodingRules.md`: capability-oriented modular monolith; `index.ts` public boundaries; `types.ts` contracts/schemas; `helpers.ts` implementation; minimal new abstractions; **tests in `src/tests/`**. Use the established commit convention `feat|fix|chore|scaffold|note|cdci: title` plus an explanatory description.

## 2. Execution order and ownership

| Stage | Owner suggestion | Depends on | Deliverable |
|---|---|---|---|
| A. Verify baseline | Orchestrator/integrator | Nothing | Confirm branch SHA and baseline `pnpm validate` result |
| B. Fix WebSocket lifecycle | Worker 1 | A | Race-safe server and tests |
| C. Fix session-factory lifecycle | Worker 2 | A | Factory guards, diagnostics, and tests |
| D. Sequence/replay contract audit | Reviewer or integrator | A; preferably after B/C | Tested invariants and documented future responsibilities |
| E. Prepare `ProvidersPlan.md` | Integrator / architect | D and architecture invariants | Revised implementation-ready plan, no feature code |
| F. Final review/validation | Independent reviewer | B–E | No regressions, doc drift check, handoff |

Workers B/C may proceed in parallel because they should touch separate modules. Avoid overlapping edits in `src/index.ts`, `docs/plans/ProvidersPlan.md`, shared test files, or shared contracts. An integrator resolves conflicts; reviewers do not rubber-stamp their own changes.

### Stage A — Preflight

1. Confirm HEAD of `develop` before work. If SHA differs from the baseline, inspect the diff and re-evaluate already-fixed issues rather than reverting them.
2. Read `.agents/AGENTS.md`, `docs/CodingRules.md`, `docs/plans/ProvidersPlan.md`, and this plan.
3. Record baseline outputs: `node --version`, `pnpm --version`, `pnpm validate` (whether passing or failing). **Never claim success based only on tests appearing in source.**
4. Preserve these previously fixed behaviors: malformed-upgrade handling, own-property dispatch, config parsing, typed RPC errors, state cloning, observer isolation, sanitization of unexpected errors, and tolerance of additive JSON-RPC members.

## 3. Stage B — WebSocket start/stop lifecycle (P1 — must fix)

**Current evidence:** `src/websocket/helpers/server.ts` uses `idle | listening | stopping | stopped`. `beginListening()` installs a `listening` callback later, while `performShutdown()` only closes the HTTP server if the lifecycle was already `listening`. `start(); stop();` immediately can therefore report stopped and later enter listening.

**Owned implementation files:**

- `src/websocket/helpers/server.ts`
- `src/websocket/types.ts` (only if shutdown semantics change)
- `src/tests/websocket.test.ts`
- `src/websocket/constants.ts` (only if truly necessary)

**Required work:**

1. Add a coherent **`starting` lifecycle** or equivalent single-flight state machine. Define legal transitions before editing:

   ```text
   idle -> starting -> listening -> stopping -> stopped
             \------------------> stopping -> stopped
   idle ------------------------> stopped (stop before start)
   ```

2. Coordinate `startPromise`, listening/error callbacks, and `stop()` so a late callback can **never** restore `listening` after shutdown begins.
3. If shutdown occurs during bind, cancel/close or await binding safely. Do not return a resolved `stop()` while a usable listener can still appear.
4. Keep repeated `start()` and repeated `stop()` behavior deterministic. `start()` during/after shutdown must fail predictably; concurrent callers of `stop()` should share completion.
5. Keep heartbeat allocation/cleanup tied to the actual listening lifecycle, and guarantee no timer survives stopped state.
6. Reconcile the timeout behavior: currently `withDeadline()` may resolve after **initiating** forced close, before close callbacks finish. Pick and document one truthful contract:
   - **Preferred:** await resource closure confirmation where possible, with bounded forced shutdown; distinguish inability to guarantee remote peer acknowledgment.
   - **Alternative:** explicitly label deadline completion as *best-effort forced shutdown initiated* and avoid promising that every resource has finished closing.
7. Preserve safe HTTP 426 responses, upgrade path validation, payload limits, heartbeat, and close codes.
8. Do not add another HTTP/WebSocket framework or background service.

**Regression tests (mandatory):**

- `const p = server.start(); const q = server.stop(); await Promise.allSettled([p,q]);` leaves no open listener, client-connectable port, or heartbeat.
- `stop()` before `start()` does not allow a subsequent successful start.
- Concurrent `start()` calls share the same bind (no double-listen).
- Repeated/concurrent stops share completion; late `listening` and `error` events cannot resurrect or crash the process.
- Forced shutdown with a partial HTTP request completes according to the chosen, documented contract.
- Existing malformed URL, wrong upgrade path, binary-frame, and HTTP 426 tests still pass.
- Avoid flaky time sleeps; use controlled gates and port probing only when necessary. Ensure test cleanup even when assertions fail.

**Acceptance gate B:** Every terminal lifecycle state is meaningful; no reachable interleaving can transition `stopping/stopped -> listening`.

## 4. Stage C — Session-factory shutdown / reuse (P1 — must fix)

**Current evidence:** `src/sessions/helpers/factory/helpers.ts` clears the registry and awaits disposers, but does not prohibit new `createSession()` calls during disposal. Late-starting backends are released by an identity check, but failures from their cleanup are silently swallowed in `src/sessions/createSession/helpers.ts`.

**Owned implementation files:**

- `src/sessions/helpers/factory/helpers.ts`
- `src/sessions/createSession/helpers.ts`
- `src/sessions/types.ts` (only for a meaningful lifecycle/diagnostic seam)
- `src/sessions/helpers/errors/` (only if appropriate)
- `src/tests/sessions/factory.test.ts`
- `src/tests/sessions/createSession.test.ts`

**Required work:**

1. Choose an explicit factory policy, and document it:
   - **Recommended for this stage:** **reject new creation while disposal is in progress**, with a typed, stable error. Preserve the existing tested ability to reuse the factory **after** disposal settles, unless an accepted architecture decision changes it.
   - Do not introduce session-generation abstractions unless they solve a demonstrated race.
2. Make it impossible for `createSession()` to begin and register after a disposal boundary was established. Check at the **authoritative factory entry point**, not only deep inside async startup.
3. Preserve the record-identity check preventing a stale startup from overwriting an existing session with the same URI.
4. Establish a precise contract for starts already pending when `dispose()` begins. **Important:** no design can both wait forever for a non-cooperative provider and promise bounded shutdown. Decide whether cancellation (`AbortSignal`), bounded drain, and/or detached late cleanup is part of the current slice. Document what `dispose()` completion guarantees.
5. Report failed late backend disposal to a minimal **injected non-sensitive diagnostic sink** (or equivalent observable host-owned mechanism); do not broadcast exception text to clients and do not throw from unawaited callbacks.
6. Maintain best-effort cleanup of every known backend even if one disposal fails; retain `AggregateError` for ordinary in-flight known disposer failures where appropriate.
7. Keep repeated `dispose()` calls consistent, avoid re-entrant cleanup and ambiguous lifecycle generations.
8. Preserve test-only mock backends; do **not** add actual Pi SDK, inference, or agent tools.

**Regression tests (mandatory):**

- Start a deferred backend disposal; issue `createSession()` while `dispose()` is pending; verify rejection or the explicitly selected serialization behavior.
- After disposal fully settles, `createSession()` succeeds again only if reuse remains the documented contract.
- Backend startup resolving after the old generation is cleared is disposed and emits no stale `session/ready` event.
- Reused URI does not receive late completion events from an older record.
- Late cleanup failure reaches diagnostics in sanitized form and does not prevent other cleanup.
- Multiple disposer failures attempt all cleanups and produce the documented aggregate result.
- Concurrent dispose callers observe the same completion and no double-dispose.

**Acceptance gate C:** No new sessions are accepted inside a disposal critical section; stale backends cannot rejoin the registry or silently leak cleanup failures.

## 5. Stage D — Host-wide sequencing and replay readiness (P1 design / narrow tests)

**Current evidence:** `src/sessions/helpers/sequence/helpers.ts` correctly offers a monotonic sequence allocator, and session actions use it. However, the running server still exposes only `ping`; there is **no complete host-wide connection, subscription, event journal, or reconnect/replay implementation**.

**Owned review files:**

- `src/sessions/helpers/sequence/helpers.ts`
- `src/sessions/helpers/state/helpers.ts`
- `src/sessions/helpers/factory/helpers.ts`
- `src/tests/sessions/compliance.test.ts`
- `docs/plans/ProvidersPlan.md` (requirements specification only; Stage E owns edits)

**Required work now:**

1. Re-confirm that separate session actions within one host receive monotonically increasing sequence values. Preserve ability to inject one allocator shared by **all** future action-producing modules.
2. Distinguish clearly:
   - `serverSeq` allocation / global ordering;
   - immutable snapshots and snapshot cursors;
   - action envelopes and subscriber fan-out;
   - persistent or bounded event retention / replay;
   - root catalogue notifications, which must follow their **actual protocol semantics**, not be assigned invented action envelopes.
3. Specify what a future host connection manager must own: subscriptions, global sequencer, ordered publication, replay cursor, snapshot boundary, disconnect/reconnect, and authorization.
4. Add only cheap, narrowly scoped unit tests if new invariant coverage is missing. **Do not implement reconnect or an event database in this task.** Reserve an explicit integration gate in `ProvidersPlan.md`.
5. Do not claim `createSequenceAllocator()` alone provides reconnect safety, replay, durable ordering, or message delivery.

**Later acceptance gate for `ProvidersPlan.md` (not a current task):** Two independent clients and multiple sessions, with concurrent publication and mid-stream subscribe/reconnect, obtain consistent state with no missing or duplicate actions. Validate against Microsoft's current SDK and supported protocol version.

## 6. Stage E — Rewrite `docs/plans/ProvidersPlan.md` as an executable *future* plan (P1 prep)

**Goal:** Make the next milestone implementable without changing the approved deployment model. This stage updates **planning documentation only** and any confirmed stale affected docs; it does **not** execute that future plan.

**Current mismatch:** The present plan says Pi is a client but proposes `SessionBackend.prompt()`, `abort()`, agent event streaming inside server, and `src/providers/pi/` inside the host. That confuses a client connection adapter with a server-owned agent runtime. It also says tests belong at root `tests/` instead of `src/tests/`.

**Required changes to `docs/plans/ProvidersPlan.md`:**

1. State these decisions at the top under **Established**:
   - Pi process and model execution live entirely on client machines.
   - The host owns network connections, protocol operations, authoritative state, subscriptions, permissions, and (later) coordination.
   - The server must not launch Pi, call models, handle Pi prompt execution, or own its tools.
   - Client integration belongs in a **Pi extension / client-side package**, not under a server-side provider registry.
2. Preserve Microsoft AHP SDK as the source of truth for native methods, channel types, protocol errors, and version negotiation. Distinguish custom extensions by their own names and schemas.
3. Split the planned work into **clearly bounded future milestones**:

   **Milestone 1: Native AHP host connection (server-only)**
   - Implement `initialize`, `ping`, `subscribe`, `unsubscribe`, `createSession`, and appropriate root/session snapshots using supported contract shapes.
   - Introduce per-connection identity and subscription tracking; connection ID ≠ client ID ≠ session ID ≠ authenticated principal.
   - Feed the existing **mock** session engine into protocol tests solely to prove host correctness; do not create a Pi backend.
   - Test Microsoft `AhpClient` over `WebSocketTransport` against the server. No Pi process is necessary.

   **Milestone 2: Remote-client identity / presence design (may require a custom extension)**
   - Define how an independently running Pi client registers an addressable agent instance, renews a lease, disconnects, and reclaims identity.
   - Clarify standard AHP session hosting semantics versus any **custom client-owned session or participant registration**. Never advertise a fake host-side Pi runtime as a standard provider.
   - Define authentication and authorization before accepting a non-loopback deployment: client ID is not authentication; use explicit principal and access checks.
   - Agree on protocol representation before implementation: native AHP where suitable, otherwise explicit namespaced methods/events with validation and versioning.

   **Milestone 3: Pi client extension (client-side package)**
   - Use Microsoft's AHP client SDK (not a duplicate wire implementation) in a Pi extension that opens its own WebSocket connection, initializes, subscribes, and exposes `/connectAHP` or similar commands and agent tools.
   - Decide package/repository boundary separately; do not add Pi dependencies to the host package merely to build a client extension.
   - Distinguish notifications visible in Pi's UI from information explicitly exposed to Pi's model context through tools/events.

   **Milestone 4: Client-to-client coordination (separate design and later code)**
   - Define addressed message/task envelopes, delivery acknowledgment, idempotency, permissions, ordering, and offline/disconnect policy.
   - Do not assume that storing AHP session state alone delivers messages into a second agent's local model runtime.
   - Keep coordination distinct from session snapshots, chat actions, and terminal channels.

   **Milestone 5: Reconnect & replay**
   - Add the bounded/durable event journal and subscription reconciliation only once the transport and action publication work; verify ordering across channel producers.

4. Remove or explicitly defer the current Phase 1 proposal to add `prompt()`, `abort()`, and stream events to server-side `SessionBackend`. Keep the existing mock provider contract only as testing scaffolding unless there is an independently approved use.
5. Relocate `src/providers/pi/` from the host implementation plan into a client-side extension/package concept; consider naming the server's AHP request boundary `src/websocket/connection/` (or another owner-aligned module) without introducing two competing connection managers.
6. Correct all future test paths to **`src/tests/`**, matching repository rules and Vite/Vitest configuration.
7. Separate **current implementation** (`ping` only) from **future state**. Mark each future milestone `Proposed` or `Agreed / not implemented`; do not claim native conformance before a real SDK-based smoke test succeeds.
8. Fix the inaccurate sentence in `src/sessions/types.ts` that says config `schema` and `parse()` **cannot drift**. Since they are independently supplied, rephrase as a design responsibility or require a shared source / per-provider conformance tests.
9. Confirm `src/websocket/types.ts` shutdown documentation matches the actual chosen Stage B guarantee. Treat this as scoped documentation drift resolution.
10. Include an explicit **non-goals** paragraph: no Kubernetes, Redis, database, queues, remote agent process management, additional deployment node, agent SDK on server, or multi-agent orchestration implementation in this milestone.

**Acceptance gate E:** A new implementer can identify which files are **server** responsibilities, which are **client** responsibilities, and exactly which protocol portions are native AHP versus proposals. The plan must not tell agents to add Pi model execution to the server.

### Suggested lean directory ownership (future only; do not create now)

```text
AHP SERVER (existing repository)
src/
  jsonrpc/                    # Wire parsing and typed errors
  websocket/                  # Transport; later AHP connection methods
  sessions/                   # Server-owned protocol state
  tests/                      # ALL server tests

PI CLIENT EXTENSION (future package / separate project, packaging TBD)
  index.ts                    # Pi extension entrypoint
  types.ts                    # Client-side contracts
  helpers/connection/         # Microsoft AHP client/WS transport
  helpers/tools/              # Model-visible actions
  helpers/commands/           # Human-visible Pi commands
```

Do not create both trees as scaffolding; use them to clarify ownership in planning.

## 7. Stage F — Review, validation, and handoff

### Verification commands

```bash
node --version
pnpm --version
pnpm validate
```

`pnpm validate` must execute lint, TypeScript checking, Vitest, and the production build. Record outputs/exit codes, especially if a check is already failing before the changes. Add focused tests as work proceeds; do not replace the final validation with only focused tests.

### Independent review checklist

- [ ] WebSocket state-machine transitions / lifecycle races inspected with adversarial interleavings.
- [ ] Forced shutdown promise/timeout guarantees match documentation and tests.
- [ ] Session factory cannot accept work during disposal; old pending backend cannot publish to new generation.
- [ ] Diagnostic path does not expose secrets, stack traces, model credentials, or raw provider exceptions.
- [ ] Shared sequencing remains correct for session actions; future replay is not misrepresented as implemented.
- [ ] No existing F01–F11 fix was regressed.
- [ ] No model runtime, Pi SDK, subprocess, runtime gateway, or unnecessary infra was added to the AHP host.
- [ ] `docs/plans/ProvidersPlan.md` now has an accurate client/server contract and milestone sequence.
- [ ] Documentation review is scoped to touched modules and linked architecture documents, following `.agents/skills/code-review-documentation-drift/SKILL.md`.
- [ ] Tests follow `src/tests/` conventions; tests cover failure/race paths as well as happy paths.
- [ ] Git diff contains no unrelated refactors or accidental secret data.

### Commit sequencing (suggested, adapt to natural boundaries)

```text
fix: make websocket startup and shutdown race-safe

Guard starting/listening/stopping transitions and add interleaving tests.

fix: serialize session factory disposal and creation

Define disposal critical section and sanitized late-cleanup diagnostics.

chore: cover host action sequence and shutdown edge cases

Verify monotonic sequence ownership and lifecycle invariants.

note: align provider connection plan with external pi clients

Clarify host-only AHP ownership, native vs custom semantics, and later client milestones.
```

Use the exact commit grammar defined by `.agents/AGENTS.md`. Do not commit generated artifacts or plan examples as functioning code.

### Final agent handoff format

```markdown
## Completed
- Change and paths
- Tests added
- Commit SHA(s)

## Validation
- Node / pnpm versions
- pnpm validate result
- Any tests intentionally deferred and reason

## Architectural decisions
- WebSocket stop() semantics
- Session-factory disposal/reuse semantics
- Provider plan revision summary

## Remaining risks
- Known gaps, with severity and evidence

## Next milestone (not started)
- Minimal mock-backed AHP initialization/subscription end-to-end test
```

## 8. Stop / escalation rules

Stop and report (do not silently expand scope) if:

- An AHP SDK requirement conflicts with the no-model-runtime-on-server invariant.
- A fix requires changing the public AHP protocol rather than adding a separate versioned extension.
- A shutdown guarantee cannot honestly be satisfied with the chosen non-cooperative backend semantics.
- Existing tests depend on an unclear or mutually contradictory lifecycle contract.
- A change requires new broker/database/orchestration services not approved for the current single-node deployment.

A concise decision note in the handoff is better than hiding architectural uncertainty in a large refactor.

---

## Source pointers (reviewed baseline)

- [`src/websocket/helpers/server.ts`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/src/websocket/helpers/server.ts)
- [`src/websocket/types.ts`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/src/websocket/types.ts)
- [`src/sessions/helpers/factory/helpers.ts`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/src/sessions/helpers/factory/helpers.ts)
- [`src/sessions/createSession/helpers.ts`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/src/sessions/createSession/helpers.ts)
- [`src/sessions/helpers/sequence/helpers.ts`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/src/sessions/helpers/sequence/helpers.ts)
- [`src/sessions/types.ts`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/src/sessions/types.ts)
- [`docs/ProvidersPlan.md`](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/docs/ProvidersPlan.md)
- [Baseline-to-develop comparison](https://github.com/spore310/AHP/compare/40f0c5c29c39ed4727216dae500f19814192d263...1c5f4fc3572f1af9797a59d59d1b3f915761f178)

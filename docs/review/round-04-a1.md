# Round 04 — A1 (side A) verdict

**Candidate under review: `65127f6` ("fix: bind owner at attach and finish the round-03 closures"), branch `agentIdentity`, superseding `d3c33d1`.**
**Lens:** identity / authorization / binding lifecycle / wire mapping — adversarial rigs over real wiring.
**Filed by the side-A coordinator from the reviewer's verbatim final report. Blind: reviewer A1 ran with fresh context (round-01..03 triages + panel rules only).**

**Verdict: `PASS`** — with two non-blocking P3 documentation nits and two P3 observations (no production change required).

## Basis

All four round-03 reproduction rigs were re-run against the new code as targeted single-file commands (all green): `agentWork.disposal.test.ts` (9), `createSession.test.ts` (24), `agentWork.binding.test.ts` (7), `agentWork.integration.test.ts` (2), plus `workService.test.ts` (20) and `agentWork.test.ts` (15) for the round-03 side-A-adjacent closures that landed in this bundle. Full `pnpm validate` was not run (forbidden for reviewers).

### The load-bearing property (verified by reading, not assumed)

The correctness of the fix family rests on one invariant: **the AHP create handler's pre-check, `factory.createSession`'s invocation, `executeCreateSession`'s uniqueness/attach, and the hook's `bind` all execute in one synchronous run per create call.** In `src/websocket/helpers/ahp/helpers.ts` the handler body contains no `await` before `await factory.createSession(params, onRecordCreated)` (line 408), and `factory.createSession` (`src/sessions/helpers/factory/helpers.ts:153–166`) invokes `executeCreateSession` synchronously, whose preamble (parse → prepare → resolve provider → `sessions.has` → config parse → `sessions.add` → hook, `src/sessions/createSession/helpers.ts:37–108`) contains no await either — the first await is inside `startBackend` (line 114). Single-threaded event-loop ordering therefore makes "pre-check passed in block N, hook fires in block N+k" unreachable, and equally makes the interleaving "another creator's attach lands between my `has()` and my `add()`" unreachable. Every new-race hypothesis below was evaluated against this invariant.

## Findings

### P1 — none found.

### P2 — none found.

The round-03 P2 family (F1 takeover; F2 ghost; F3 in-flight window) is closed by the bind-at-attach mechanism plus the resolution-time verification (typed `RpcError(AhpErrorCodes.Conflict, "The created session is no longer available.")`, surfaced publicly because `AhpErrorCodes` is fully allowlisted in `src/jsonrpc/helpers.ts:48–50`). No reproduction survives; the pinning rigs pass.

### P3 — two doc nits + two observations (non-blocking)

**P3-D1 (doc drift): `src/sessions/README.md:62` still shows the old factory signature.**
- Evidence: line 62 reads `- createSession(params: unknown): Promise<void> — validate, register, emit \`root/sessionAdded\` …`, while `src/sessions/types.ts:250–255` now carries the optional `onRecordCreated?: (sessionUri: string) => void` attach hook and `src/sessions/createSession/README.md` documents the contract. The parent module's API list and the type contract now disagree.
- Scenario: an embedder reading `src/sessions/README.md` as the factory reference will not learn the hook exists (and that a throwing hook removes the record), despite the hook being load-bearing for identity-scoped installers.
- Minimal fix: update the bullet to `createSession(params, onRecordCreated?)` with one clause pointing at the attach-hook contract in `createSession/README.md`.

**P3-D2 (doc wording): `src/websocket/README.md` (new caveat, ~line 166)** — the parenthetical "(its own disposal, or a same-principal successor attach)" attributes a mid-start *removal* to a successor *attach*. Mechanically a live record is only ever removed by a dispose (`factory.disposeSession` / `performDispose`; an attach cannot remove a live record — `sessions.has()` rejects it with `SessionAlreadyExists`); a successor attach is what happens *after* a removal and is what the resolution-time check then detects. Repro reasoning: trace `executeCreateSession` — the only record-mutation points are `add`/`delete` in this file plus `factory.disposeSession`/`performDispose`; an attach path never deletes.
- Minimal fix: reword to "(its own disposal, or the URI re-attached by a successor)".

**P3-O1 (observation, pre-existing, accepted): the host facade create passes no hook, so facade-created records are ownerless by design and cannot take durable work.** `src/websocket/helpers/host/helpers.ts:147–159` — the facade has no principal context, so there is no subject to bind; wire-created bindings are the only binding source (`createAHPBinding` hook). Consequences verified: an ownerless facade record is disposable by any wire principal (dispose guard passes when `owner === undefined`, `src/websocket/helpers/ahp/helpers.ts:431–435`) and `work.submit/claim` answer `not_found` for it (`src/work/helpers/helpers.ts:186–192`). This predates the commit (the old code also bound nothing for facade creates) and is covered by the README's "Direct host disposal … does not add authorization" boundary sentence. The absence does not *leak* anything the wire path can seize: settle-probe + facade finally-unbind (`host/helpers.ts:167–184`) keep the settlement window closed to facade creates too (pinned end-to-end by the new integration test). No change required; optionally one README clause noting "facade-created sessions are ownerless by construction".

**P3-O2 (observation, benign, typed; no change): a wire dispose that observes an ownerless/live record can still out-race a foreign create attaching during its `assertSessionDisposable` await window.** Trace: D (any principal) passes the dispose guard on an ownerless record → awaits `assertSessionDisposable` → C attaches the same URI while D is parked, `bind`s C's principle in the hook → D's `factory.disposeSession` deletes C's freshly attached record and its `finally` unbind releases C's fresh binding → C's post-check sees `owner === undefined`/snapshot gone and answers typed `Conflict`; C's late backend self-disposes detached (`src/sessions/createSession/helpers.ts:182–198`). Outcome: honest conflict, no stranded binding, no ownerless record left, URI re-creatable. Reachable only against ownerless records (a foreign *bound* record is denied at D's guard), which is the documented POC baseline; the unconditional settle-unbind is exactly what keeps the no-strand guarantee on this path. The reverse interleave (attach completing after D's `factory.get` sees `undefined`) strips nothing: the record/binding attach is later, in its own sync block. Verified both orderings safe.

### New-race hunt (task 2) — explicitly checked, all clean

| Hypothesis | Result |
| --- | --- |
| Hook re-entry / two invocations per create | Impossible: the hook is invoked exactly once, only after `sessions.add` (`createSession/helpers.ts:103–108`). All pre-add throws (params, provider, uniqueness, config) skip the hook. Wired into one handler only (`ahp/helpers.ts:395–407`); the facade passes none, so no second hook path exists. |
| Hook replacing a foreign binding | Unreachable — cross-subject incumbent at attach contradicts the same-sync-block pre-check (comment at `ahp/helpers.ts:400–403` is accurate). The fail-loud fallback is sound: `mapWorkError(WorkError("conflict"))` throws `RpcError(Conflict)` from the catch block → `executeCreateSession` deletes the record and rethrows → typed public Conflict, no record, re-creatable. A non-`WorkError` from a custom registry rethrows raw → generic internal error, record still cleaned. |
| Hook firing after the URI was re-created by someone else | Impossible under sync-block atomicity: a foreign create is either entirely before (then `has()` denies this create) or entirely after (then this create attached first). |
| Catalogue/state consistency when the hook throws | Clean: the hook sits before the `root/sessionAdded` broadcast (`createSession/helpers.ts:97–112`), no envelope/activeSessionsChanged is emitted (factory `.then` skipped on rejection), backend never started; `sessions.delete` keeps the URI immediately re-creatable — pinned by the two new hook tests. |
| Settle probe × same-principal re-create | Unchanged and still pinned: owner-held + record-less denies everyone (round-02 test intact); after the settlement releases the binding the same principal rebinds at attach. |
| Facade hook carriage | See P3-O1 — intentional, safe; probe present; dispose unbind present. |
| Resolution check scoped by principal, not connection (same-principal successor) | Accepted-design residual consistent with the round-03 declared verification semantics ("owner must still equal the caller"): a same-principal stale create can resolve success against the successor's record; no authority implications (one identity), aligns with the documented deferred same-owner residual family. |
| `activeSessionsChanged` count emitted by a losing create's late resolution | Count is read live at emit time (`factory/helpers.ts:161–165`) — truthful envelope, no quarantine needed. |

### F4 and dispose path (task 3)

- The dispose handler keeps the exact shape: ownership guard + `assertSessionDisposable` (now text-gated) inside the first `try` (a denied dispose never reaches the `finally` unbind), then `try { await factory.disposeSession } finally { unbind }` (`src/websocket/helpers/ahp/helpers.ts:427–449`). Ownership denial therefore never releases a binding; a *successful pre-check* dispose releases exactly once per settle (custom registries re-running `unbind` on a re-dispose are idempotent map deletes in the shipped registry, `src/work/helpers/helpers.ts:156–176`).
- F4 semantics as decided in the triage (fail-loud; no swallow; heal by re-dispose, including `SessionNotFound` resolves whose `finally` still unbinds): code-verified and pinned by the new test ("surfaces a failing settlement unbind and heals the settle window on a re-dispose") which passes: first dispose rejects with the unbind's throw (outcome replaced, binding kept), re-dispose answers `SessionNotFound` *after* releasing the binding, recreate binds the true creator at attach. Factory-side `record.backend` capture (get→delete→read in one sync run, `factory/helpers.ts:194–221`) guarantees exactly one backend disposer even when a create races a disposal of the same URI.

### Tests pin what the triage promises (task 4)

- Both late-start rigs and the F4 rig honestly drive the real factory + real AHP binding + real registry + real work service (`agentWork.disposal.test.ts:174–238`), with FIFO park/release making the races deterministic; F1's durable-channel outcome is asserted through the real service (`alice → unauthorized`, `bob → resolves`).
- The two hook tests pin "invoked once with the record live" and "hook-throws → rejects + no record" against the real factory.
- The stub-factory change in `agentWork.binding.test.ts` is honest and documented: the stub now reports live records via `getSessionSnapshot`, deletes on dispose, and invokes the attach hook at attach with an in-file comment explaining why (without it the handler's resolution-time verification would read every create as lost). It mirrors, not silently diverges from, real factory semantics.
- The facade settle-window test drives a real socket server with token auth and a disposal-gated backend — genuinely open settle window observed, facade denial `HOST_SESSIONS_SETTLING`, reopen after settle.
- Probe semantics test covers exactly the three requested readings: unknown channel → false, live+owned → false, record-less+owned → true, post-settle → false.

### Docs consistency (task 5)

- `src/websocket/README.md`: settle-window caveat added and factually matches code (bind-at-attach, resolution verification, every-principal denial on wire and facade, failing-unbind fail-loud); `settling.ts` row added; testing rows updated including the new disposal-rig description. One wording nit → P3-D2.
- `src/sessions/createSession/README.md`: enforce-order line and attach-hook contract match code (`add → hook → sessionAdded → backend start`); test row updated. Correct.
- `src/work/README.md`: dispose-gate wording ("refuses a session URI whose text the JSONB storage cannot compare (no repository access happens)") matches `assertSessionDisposable` (`src/work/helpers/helpers.ts:385–393`); `WORK_MAX_REQUEST_KEY_LENGTH` wording matches the shared-cap change; testing rows updated.
- Registry "A session is bound only after an authenticated `createSession`" remains true under the hook (unauthenticated creates install no hook).
Sessions README gap → P3-D1.

## Closure evidence table

| Round-03 item (declared fix design) | Status | Mechanism verified at | Run evidence |
| --- | --- | --- | --- |
| F1 — stale detached create late-binds a foreign successor's live record (P2 takeover) | **Closed** | Hook binds `principal.subject` at record-attach (`ahp/helpers.ts:395–407` wired into `createSession/helpers.ts:97–112`); post-factory resolution verification answers typed `Conflict` when owner ≠ caller or snapshot absent (`ahp/helpers.ts:409–423`) — the late resolution can act only via verification, no bind exists after resolution | Rig "denies a stale detached create from binding a foreign successor's record" — stale create rejects with `Conflict`/"The created session is no longer available.", binding stays `bob`, snapshot intact, real-service work channel: alice `unauthorized`, bob resolves. Test passes |
| F2 — settlement-last ghost binding (create racing a settle binds after the settlement) | **Closed** | Same single bind moment: no bind can occur after the settlement's `finally` unbind; combined with the disposal's own dispose→unbind, nothing binds into a record-less state | Rig "answers conflict for a create whose record was disposed mid-start and never binds a ghost" — conflict after stale resolution, `owner === undefined`, snapshot undefined, URI immediately re-creatable with rebind at attach. Test passes |
| F3 — in-flight create dispose window | **Closed** | Binding exists from attach through the whole backend start; foreign/unauthenticated dispose denied by the dispose guard (`ahp/helpers.ts:430–439`); unauthenticated baseline boundary unchanged and documented | Rig "protects a live in-flight create against foreign disposal" — bob's dispose rejected `InvalidParams` "Session not found", record + binding untouched, create resolves owned. Test passes |
| F4 — hypothetical failing custom `unbind` | **Pinned per triage decision (fail-loud, no production change)** | `try { factory.disposeSession } finally { unbind }`; shipped registry unbind cannot throw; on a thrown settle unbind the dispose outcome is replaced loudly; re-dispose heals (unbind runs in `finally` even for `SessionNotFound`) | Rig "surfaces a failing settlement unbind and heals the settle window on a re-dispose" — rejects "unbind failed", binding retained, re-dispose `SessionNotFound` + release, post-heal recreate binds alice. Test passes |
| B1-R2 / round-03 P3 — facade settling mirror, shared single source | **Closed** | `src/websocket/helpers/settling.ts` is the single probe used by both `ahp/helpers.ts:385` and `host/helpers.ts:155`; façade probe → `sessions.createSession` is one sync run (no bypass window) | End-to-end facade test with real sockets + auth + gated backend — denial while settling, success after settlement settles. Test passes |
| A2-r3 adjacents in this bundle (dispose-channel text gate; JSONB depth budget; request-key cap 256) | **Closed** | `assertSessionDisposable` gates via `isJsonbSafeText` before the repository (`work/helpers/helpers.ts:385–393`); `isJsonbSafe` depth budget 512 (`persistence/helpers/text.ts`); wire request-key uses the exported service cap (`ahp/agentWork.ts:62`) | `workService.test.ts` (dispose-channel typed `invalid`, repository untouched; deep projection refused) and `agentWork.test.ts` (service-length key accepted, longer rejected pre-service; deep payload rejected pre-service) pass |

**Validator note:** all single-file targeted commands green; per panel rule 6 the full `pnpm validate` remains the coordinator's step on the integrated tree; no SQL executed.

**Bottom line:** the takeover/ghost/in-flight family is closed by a mechanism that is correct under the event-loop ordering I verified directly, the F4 decision is implemented exactly as triaged, the new tests pin the promises honestly, and nothing I hunted in the new hook surface produces a reachable untyped, unowned, or stranded-owning outcome. The two P3 doc nits (P3-D1, P3-D2) are the only actionable items and do not block under the panel verdict rule.

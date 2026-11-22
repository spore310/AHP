# Round 03 — Triage & Consolidation (coordinator)

**Candidate reviewed by all four blind reviewers:** `d3c33d1`
("fix: close the settling-window recreate and finish the storage-shape gate"),
HEAD of `agentIdentity`.

**Round verdicts received (blind, independent):**

| Reviewer | Lens | Verdict |
| --- | --- | --- |
| A1-r3 (side A) | identity / authorization / binding lifecycle / wire mapping (adversarial rigs over real wiring) | **CHANGES REQUIRED** (F1 P2 reproduced; F2–F3 P3; F4 P3 hypothetical) |
| A2-r3 (side A) | persistence / SQL / validation contracts / documentation truth | **CHANGES REQUIRED** (F1–F2 P3) |
| B1-r3 (side B) | adversarial agent/work end-to-end (per-row verification ledger) | **PASS** (R1–R5, all P3) |
| B2-r3 (side B) | full-scope static verification (ledger + trace) | **PASS** (F-01–F-03, all P3) |

**Convergence.** A1-r3's reproduced P2 (F1: a stale, self-disposed create
late-binds onto a concurrently created foreign live record) is the blocking
member of the same family that B1-r3 (R1, hypothetical settle-strip) and B2-r3
(F-01, post-settlement stranded binding) filed as P3s, plus A1's own F2/F3.
Independent agreement from three reviewers on the same root — the owner binding
lands only *after* the factory call resolves — makes the P2 confirmed by the
panel's own ≥1 reproduction bar. The B-side found the same family only as
availability defects because their frame stopped at same-owner interleavings;
A1's cross-creator rig shows the takeover variant is reachable, so the family
is closed this round, not deferred.

## Findings and decisions

| Finding | Source | Decision | Change |
| --- | --- | --- | --- |
| Stale create late-binds onto a foreign live record; true creator locked out, stale principal gains the durable work channel (P2, reproduced) | A1-r3 F1 | **Fixed** | The owner binding is acquired **at the record-attach moment** inside the factory call (new optional `onRecordCreated` hook on `SessionsFactory.createSession`, threaded through `executeCreateSession`, invoked synchronously immediately after `sessions.add(record)` and before the backend start), instead of after the resolution. A late-detached resolution can therefore never re-bind: no cross-creator takeover, no settlement-last ghost, no in-flight ownerless window. The resolution-time step now *verifies* (`owner === subject && snapshot exists`) and replies public `Conflict` instead of a silent success when the created record vanished or the URI is no longer this creator's. |
| Settlement-last ghost binding (create racing a settle binds after the settlement; recovery required one extra failing dispose) | A1-r3 F2, B1-r3 R1, B2-r3 F-01 | **Fixed** (same root) | Same mechanism: the only bind moment is the record-attach of the call that still owns the record. The "repair by issuing a failing dispose" workaround is gone (it never strands), and the stale create now answers `Conflict` rather than plain `success`. |
| During the create-in-flight window any connection — including unauthenticated ones — can dispose the record (P3) | A1-r3 F3 | **Fixed** (same root) | The binding exists from the record-attach moment, so the dispose path's ownership guard protects the record through the entire backend start (a foreign/unauthenticated dispose during in-flight start is denied). The residual no-binding window (unauthenticated baseline creates with no agent-work surface at all) is the documented host-global POC boundary, unchanged. |
| Throwing custom `SessionOwnerRegistry.unbind` inside the dispose `finally` would strand a settling window (P3, hypothetical — not reachable with shipped registries) | A1-r3 F4 | **Documented + pinned, no production change** | Chosen over A1's "swallow it" suggestion: swallowing would turn a loud, repairable failure into a silent permanent settle-lockout (create denied to every principal with no recovery signal). Kept fail-loud; README documents that a failing settle unbind surfaces from the dispose and that a re-dispose heals the window (unbind runs in `finally` even when the factory answers `SessionNotFound`); a regression test pins both. |
| `disposeSession` channel reaches `hasDependentWork($1)` ungated — NUL/lone surrogates reach SQL as a TEXT parameter and surface as an unclassified `Internal error` (P3) | A2-r3 F1 | **Fixed** | `WorkService.assertSessionDisposable` gates `sessionUri` through `isJsonbSafeText` before the repository call (`WorkError("invalid")`), mirroring the submit/claim gates; the service level covers both the AHP handler and the host facade. The baseline wire `channelParamsSchema` (shared with subscribe/unsubscribe) is deliberately left untouched. |
| `isJsonbSafe` recursion has no depth budget — a deliverably deep payload (~3k levels, far under the 1 MiB frame cap, `JSON.parse`-survivable) stack-overflows into an unclassified `Internal error` (P3) | A2-r3 F2 | **Fixed** | Explicit depth budget (`512`) in `src/persistence/helpers/text.ts`: deeper shapes are rejected as `false` so both layers answer the typed `invalid` path. Far inside PostgreSQL's own JSONB nesting limits, so no legitimate round-trip is rejected. |
| Facade settling mirror untested and hand-duplicated (P3) | B1-r3 R2 | **Fixed** | The predicate is extracted into a shared module (`src/websocket/helpers/settling.ts`) used by both the AHP handler and the facade (single source), **and** an end-to-end facade-level test drives `createAHPServer`: an AHP dispose parked mid-backend keeps the facade create denied with `HOST_SESSIONS_SETTLING`, and after the settle the facade create succeeds. |
| Migrations README names the wrong first re-apply failure mode (P3 doc) | B1-r3 R3 | **Fixed** | Reworded to "re-applying fails (on the first duplicate object or the version key) rather than silently re-running statements". |
| Session-tables banner cites the M2 document for deferred retention, which contains no retention statement (P3 doc) | B1-r3 R4, B2-r3 F-03 | **Fixed** | The citation now points at `docs/architecture/agent-task-lifecycle.md` ("Not implemented" retention note), which does carry it. |
| Wire request-key cap is 128 while service, DDL, and README say 256 (P3, pre-existing) | B1-r3 R5 | **Fixed** | The wire schema uses the shared service cap (new exported `WORK_MAX_REQUEST_KEY_LENGTH` from `@work`, same pattern as the round-01 payload-bounds alignment). Wire no longer rejects keys the service would accept. |
| Agents README bounded-growth example describes a shape the code does not produce (P3 doc) | B2-r3 F-02 | **Fixed** | Reworded to the verified reachable shape (one connection racing two distinct-key registrations both passing the synchronous pre-check; or one key raced across two connections — one row, one refused bind). |
| Register pre-check read outside the mapped `try`; same-owner recreate during a submission write; presence-cache staleness; reconcile-per-claim; reserved `exhausted`; dropped failure message; `landed === null` fail-open | A1-r3 / A2-r3 / B1-r3 / B2-r3 re-evaluations | **Accepted (unchanged)** | Re-checked by all four reviewers against the current code; no new evidence. The same-owner recreate residual is now stated in the README together with the closed family: the *binding-scoped* late-bind takeover is fixed; the *submission-write-scoped* same-owner residual still requires a wire-visible identity field and stays deferred. |
| Durable-session repository `get`/`delete` have no in-slice callers | B2-r3 note | **Observed, no change** | Dead surface only; unreachable by any client path. |

## Declared shared write set (coordinator `w3:p1`; side-B coordinator reports only)

Code:

- `src/sessions/types.ts` — additive optional `onRecordCreated` param on
  `SessionsFactory.createSession` (unfrozen; no `agents`/`persistence`/`work`
  `types.ts` touched).
- `src/sessions/createSession/helpers.ts` — hook invoked at the record-attach moment.
- `src/sessions/helpers/factory/helpers.ts` — thread the hook through `createSession`.
- `src/websocket/helpers/settling.ts` — **new** shared settle-window probe.
- `src/websocket/helpers/ahp/helpers.ts` — create handler: hook + resolution verification.
- `src/websocket/helpers/host/helpers.ts` — facade uses the shared probe.
- `src/work/helpers/helpers.ts` — `assertSessionDisposable` text gate; export `WORK_MAX_REQUEST_KEY_LENGTH`.
- `src/work/index.ts` — export the request-key cap.
- `src/websocket/helpers/ahp/agentWork.ts` — wire request-key cap from `@work`.
- `src/persistence/helpers/text.ts` — recursion depth budget.

Tests:

- `src/tests/websocket/agentWork.disposal.test.ts` — late-start provider rigs
  (takeover denial, settlement-last conflict + no ghost, in-flight dispose
  denial, F4 unbind-failure recovery) + shared settle-window probe tests.
- `src/tests/work/workService.test.ts` — dispose-channel text gate (typed
  `invalid`, repository untouched).
- `src/tests/websocket/agentWork.test.ts` — wire depth-budget and 256-char request key.
- `src/tests/websocket/agentWork.integration.test.ts` — facade settle-window test.

Docs:

- `src/websocket/README.md` (create/bind semantics, stale-create conflict, settle probe row, failing-unbind note)
- `src/work/README.md` (dispose gate scope, request-key cap wording, testing rows)
- `src/sessions/createSession/README.md` (hook contract)
- `src/persistence/README.md` (text.ts depth budget)
- `src/agents/README.md` (bounded-growth example correction)
- `database/session-tables.md` (retention citation)
- `database/migrations/README.md` (re-apply failure wording)

Edits are serialized through this file, per panel Ownership. No SQL is executed
anywhere (panel rule 7). Reviewers stay read-only; side-B findings are
integrated by the side-A coordinator as in round-02.

## Validation (filled after the fix bundle)

Pending: focused regressions, then full `pnpm validate` on the integrated tree,
then re-review of the new candidate as round 04.

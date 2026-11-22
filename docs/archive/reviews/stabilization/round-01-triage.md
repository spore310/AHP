# Round 01 — Triage & Consolidation (coordinator)

**Candidate reviewed:** `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` (branch `agentIdentity`).
**Round verdicts received (blind, independent):**

| Reviewer | Lens | Verdict |
| --- | --- | --- |
| A1 (side A) | identity / authorization / lifecycle / wire mapping | **CHANGES REQUIRED** (F1, F2 — P2, both reproduced) |
| A2 (side A) | persistence / PostgreSQL / migrations / docs truth | **PASS** (advisory P3s) |
| B1 (side B) | adversarial agent/work end-to-end | **PASS** (P3s only) |
| B2 (side B) | full-scope static verification | **PASS** (P3s only) |

Side A blocks on the two reproduced P2s; side B independently found the same
area only as an unreachable P3 shape (B1-P3-06) — A1's reproduction (real
wiring, disposing backend that fails or parks) establishes that the shape is
reachable, so the P2s are confirmed.

## Decision rules applied

- P1/P2 or a finding reproduced by ≥1 reviewer → fix in this round.
- P3s with tiny, behavior-compatible fixes → fix in this round.
- P3s requiring a product/contract decision, a frozen-contract change, or an
  I/O path that does not exist in this slice → document the decision and defer
  with rationale. Nothing was dismissed without a written rationale.
- No SQL was executed (panel rule 7). SQL files were edited only.

## Fix bundle applied (all changes below are in the round-01 fix commit)

| Finding | Source | Decision | Change |
| --- | --- | --- | --- |
| Stale owner binding after failed disposal → cross-principal work ownership | A1-F1 (P2, reproduced) | **Fixed** | `createSession` pre-checks the owner binding and fails closed before touching live state; `disposeSession` releases the binding in `finally` (authoritative removal point survives backend dispose failures); `createSessionOwnerRegistry.bind` now raises typed `WorkError("conflict")`, mapped to the public `Conflict` code. Regression: `src/tests/websocket/agentWork.disposal.test.ts` (real factory + binding + registry + work service). |
| Recreate lands between record delete and unbind → ownerless zombie session | A1-F2 (P2, reproduced) | **Fixed** | Same coordination fix: mid-window recreates are rejected fail-closed while the binding persists; the binding is released exactly once at removal; the recreated session rebinds to its true creator. Regression: disposal-race tests (fail and success settle variants). |
| Submit vs dispose TOCTOU orphans durable work | A1-F3 (P3), A2-05, B1-P3-04 | **Fixed** | `WorkService.submit` re-verifies the owner binding and live projection after the repository write resolves; a vanished/replaced owner cancels the just-recorded row (best effort, principal-scoped) and reports `conflict`. Regressions: race-reconciliation unit test, disposal-race tests. Docs: `agent-task-lifecycle.md` disposal invariant now states the reconciliation behavior. |
| Register creates durable rows then `bindPresence` rejects (pollution growth) | A1-F4 (P3) | **Fixed** (main trigger) | `x-ahp/agents/register` pre-checks the connection-level conflict and returns the same public `Conflict` reply before any repository call; re-registering the connection's own agent key stays allowed. Residual: row count is bounded by unique `(principal, agentKey)` (stable rows are upserts — no growth path remains). Regression: `agentWork.test.ts` "does not create a durable registration row behind a connection conflict". |
| Presence renewals consult a stale registration cache | A1-F5, B1-P3-02, B2-P3-04 | **Documented, code deferred** | `bindPresence` is a synchronous frozen contract; there is no disable path in this slice; every work mutation re-reads the registration (unaffected). Cache-staleness boundary documented in `src/agents/README.md`; invalidation is specified to land together with a real disable/decommission path. |
| Whitespace-only `requestKey`/`kind` accepted by the service | A1-F6 | **Fixed** | Service validation mirrors the DDL `length(trim(...))` CHECKs. Regression test added. |
| NUL/unpaired surrogates pass bounding, fail JSONB cast → InternalError | A2-01 | **Fixed** | `isJsonbSafe` (NUL code unit, unpaired surrogate rejection) applied at the service (`boundedJsonBytes`) and mirrored at the wire payload schemas; error class becomes `invalid` → `InvalidParams` at both layers. Regressions: service + wire tests. |
| `target_agent_id` principality is service-enforced only; disabled/foreign targets can strand queued rows | A2-02 | **Documented, policy deferred** | `database/M2_AGENT_WORK_DATABASE_SCHEMA.md` now names `WorkService.submit` as the enforcement point (the DDL cannot express it across tables); direct repository calls bypass the service check. Operational reconciliation of orphaned targeted queued rows is a policy decision, deferred with the note that owner `cancel` remains the recovery path. |
| Whitespace-only `displayName` passes the wire, fails DB CHECK → InternalError | A2-03, B2-P3-01 | **Fixed** | Wire `displayName` schema gains the same trim refine as its sibling fields. Regression test added. |
| `schema_migrations` created but never written | A2-04 | **Fixed** | Both migrations now insert their version rows after their DDL (applied scripts record themselves; no runner needed yet). |
| Wire payload bounds looser than service; result shape mismatch | B1-P3-01 | **Fixed** | Shared constants `WORK_MAX_INPUT_BYTES` (64 KiB) / `WORK_MAX_RESULT_BYTES` (256 KiB) exported from `@work` and used by both layers; `completeSchema.result` tightened to a bounded object, mirroring the service. |
| Timing-unsafe bearer comparison | B2-P3-02 (+ B1 hypothetical) | **Fixed** | Tokens are compared as SHA-256 digests with `crypto.timingSafeEqual` over every configured token — cost reveals only the token count, never prefixes or lengths. Regression: prefix-token discrimination test. |
| Reconcile-per-claim overhead | B2-P3-03 | **Documented, deferred** | Accepted overhead; the claim CTE re-checks the DB clock itself so correctness never depends on the reconciler. Recorded in `src/work/README.md` caveats; scheduler variant is a possible follow-up. |
| Unbounded registration cache | B2-P3-04 | **Documented** | Same documentation as A1-F5 (invalidation lands with a disable path; work mutation caching unaffected). |
| Dead `exhausted` code and unused mapping | B1-P3-07, B2-P3-05 | **Reserved (documented)** | Kept as reserved wire vocabulary until a producer exists; `src/work/README.md` records this. Removal would be a frozen-contract change. |
| Failure `message` validated then dropped | B2-P3-06 | **Documented decision** | Frozen v1 reply is `{ status }` and no column exists; the deliberate discard is recorded in `src/work/README.md`. Persisting it is a schema change, deferred. |
| `sessionUri` bound only at the wire | B2-P3-07 | **Fixed** | Service-level 2,048-char bound on `submit` and `claim` (`MAX_SESSION_URI_LENGTH`), mirroring the wire. Regression test added. |
| Fixture-vs-SQL `displayName` divergence pinned by tests | B2-P3-08 | **Fixed** | Test fixture now mirrors the real upsert (`displayName` replaced when provided, matching `COALESCE(EXCLUDED…)`, `enabled` untouched); `directory.test.ts` expectation updated to "Renamed". |
| Session disposal rejected while any work row references it (absolute claim) | A1 doc drift | **Updated** | `agent-task-lifecycle.md` now states the check-time rule plus the racing-submission reconciliation. |
| Two authority narratives for the `sessions` table | A2 doc drift | **Updated** | `database/session-tables.md` carries a superseded banner pointing at the shipped migrations and the M2 doc. |
| Per-agent kind eligibility (plan LEASE-03) | B1-P3-03 | **Documented, deferred** | V1 keeps one host-global allow-list (frozen ledger decision); per-agent grants are a contract change. Noted in `agent-task-lifecycle.md` "Not implemented". |
| Retention / never-delete durable state | B1-P3-05 | **Documented, deferred** | Noted in `agent-task-lifecycle.md` "Not implemented": a retain/cancel-and-archive policy is required before production use. |
| PostgreSQL runtime acceptance | All four review reports | **Blocked (unchanged)** | Per user instruction no SQL was executed; the blocker is recorded in every report and in the repository docs. Real-DB probes owed when a database is approved: concurrent `SKIP LOCKED` claim race, replay/conflict (DATA-04/05), CHECK lease-shape, `\u0000` payload probe, disabled-target remediation test. |

## Deliberately not changed (with rationale)

1. **Baseline AHP surface (subscribe/dispatch/dispose) without credentials** —
   intentionally unauthenticated for host-global POC sessions per
   `src/websocket/README.md`; work authorization is the guarded boundary.
2. **Frozen contracts** (`src/agents/types.ts`, `src/persistence/types.ts`,
   `src/work/types.ts`) — no type-shape changes; all fixes live inside module
   helpers or the wire extension.
3. **`x-ahp/tools/*` and SDK behavior** — untouched; the full suite (291 tests)
   pins the same behavior as before the fix bundle.

## Validation after fixes

`pnpm validate` — lint 0 warnings, `tsc --noEmit` clean, vitest 40 files /
291 tests passing (281 before + 10 new regression tests), docs gate 95 files
mapped, build succeeds.

## Round-02 scopes (re-review of the fix bundle)

- **A-side re-review:** verify the two P2 fixes plus the reconciliation and
  input-bound changes at the real wiring; re-run adversarial probes that
  previously reproduced F1/F2.
- **B-side re-review:** verify the fix set against the updated docs; confirm
  no regression in baseline `x-ahp/tools/*` and SDK paths.
- Both sides re-check the documentation updates for factual drift.

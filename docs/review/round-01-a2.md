# Round 01 — Blind Review A2 (side A): Persistence & Database Contracts

**Reviewer:** independent subagent, blind to A1 and to side B.
**Candidate:** `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` (verified; work tree clean except `docs/review/`).
**Evidence level:** source inspection only — no SQL executed, no migrations applied, no `pnpm validate` (per panel rules and user instruction; PostgreSQL acceptance remains BLOCKED).
**Verdict:** **PASS** — no blocking correctness defect found; advisory P3s below.

Composite (exact text): `C:\Users\Yohan\.local\share\opencode\storage\subagents\ses_ea4394a9fffebo56o1850y5VKm\...` — findings consolidated verbatim below.

## Method / evidence level

Source inspection only. **No SQL or migration was executed** (per instruction; no container authorized), no `pnpm validate` run. Claims are static-analysis reasoning against PostgreSQL READ COMMITTED semantics; anything not pinned to PostgreSQL behavior is labeled as needing runtime verification.

## Findings

### A2-01 — P3 — open — NUL-containing JSON passes service bounding but fails the JSONB cast; failure surfaces unclassified
- **Location:** `src/work/helpers/helpers.ts:24-34` (`boundedJsonBytes`), `src/websocket/helpers/ahp/agentWork.ts:60-77` (`isBoundedJson`), cast sites `src/persistence/helpers/workItems.ts:86,235` (`$4::jsonb`), `src/persistence/helpers/sessions.ts:49,61,89` (`$8::jsonb`, `$4::jsonb`).
- **Expected contract:** Work README "Bounded input": input/result are accepted JSON objects within size limits (64 KiB / 256 KiB); request validation is the gate before SQL.
- **Observed:** Only `JSON.stringify` try/catch + byte-length is checked. A payload string containing U+0000 passes all service/wire validation and then fails the jsonb cast ("unsupported Unicode escape sequence"). `databaseFailure` (`src/persistence/helpers/pool.ts:41-54`) maps only 23505/23503/22P02; this error class (SQLSTATE likely 22023 — **unverified, runtime check required**) falls through to `RepositoryError("database")` → work layer throws plain `Error("Durable work storage is unavailable.")` → wire `InternalError`.
- **Trigger (hypothetical, not reproduced):** `x-ahp/work/submit` with `input: {"note":"a\u0000b"}` or `x-ahp/work/complete` with such a result.
- **Impact:** fail-closed (no persistence corruption), but the client receives a misleading internal error for a payload the documented bounding contract appears to accept.
- **Correction direction:** reject NUL/invalid-Unicode strings in service validation (or map the jsonb input error class to `invalid`); verify with a service-layer unit test plus a real-PostgreSQL acceptance probe when the DB gate unblocks.

### A2-02 — P3 — open — `target_agent_id` principality is service-enforced only; disabled/foreign targets can strand queued rows with no sweeper
- **Location:** DDL `database/migrations/0002_agent_work.sql:27` (FK only) vs `database/M2_AGENT_WORK_DATABASE_SCHEMA.md:127,212-214` ("Targeted work must be for the same principal as the session owner"); enforcement only in `src/work/helpers/helpers.ts:174-182`.
- **Row-state counterexample:** A direct durability write (adapter is a public export, `src/persistence/index.ts:18`) can submit with `targetAgentId` of another principal's registration; claim eligibility then excludes every agent of the owning principal, while foreign agents fail the owner join — the row is permanently unclaimable (`claim` requires `attempt_count < max_attempts`; only `reconcileExpired` terminalizes *leased* rows; an orphan *queued* row has no sweeper; only owner `cancel` clears it). Same outcome legitimately if a targeted registration is disabled after submit (`claim` requires `a.enabled = TRUE`).
- **Impact:** Bounded (owner can cancel; FK + claim join fail closed), but no automatic reconciliation of abandoned targeted *queued* rows; doc presents target ownership as a column invariant while neither DDL nor claim enforces principality at write time.
- **Correction direction:** document the enforcement point (service, not DDL), and/or add an operational policy for orphaned targeted queued rows.
- **Verification needed:** queue-state simulation with an expired/disabled target.

### A2-03 — P3 — open — wire schema admits whitespace-only `displayName` that the DDL CHECK rejects; user sees InternalError instead of InvalidParams
- **Location:** `src/websocket/helpers/ahp/agentWork.ts:44` (`min(1).max(128)`, no trim refine — unlike `agentKey` at line 40) vs `database/migrations/0002_agent_work.sql:16` (CHECK trim 1–200); failure path `23514 → database` → `InternalError`.
- **Trigger (hypothetical):** `x-ahp/agents/register` with `displayName: " "`.
- **Impact:** error-classification mismatch only; no persistence corruption.
- **Correction direction:** add `.refine((v) => v.trim().length > 0)` to the wire schema (and/or map known column CHECK 23514s to `invalid`). Verification: wire-schema unit test.

### A2-04 — P3 — open — `schema_migrations` created but never written/read; migrations single-shot, non-idempotent
- **Location:** `database/migrations/0001_session_tool_baseline.sql:8-11`; no repository reference anywhere else; no runner exists.
- **Observed:** No version rows inserted; README documents "apply in order to an empty database" (not drift), but a dangling bookkeeping table invites a future runner to assume version tracking exists; re-running `0001` fails on the first `CREATE TABLE` while `schema_migrations` (IF NOT EXISTS) survives — confusable partial-reapply signature.
- **Correction direction:** insert a `schema_migrations` row per applied script, or drop the table until a runner exists.

### A2-05 — P3 — open — concurrent dispose-vs-submit TOCTOU can durably create work for a session the host no longer has live
- **Location:** `src/work/helpers/helpers.ts:164-195` (submit: live check → owner check → `repository.submit`) and `src/websocket/helpers/host/helpers.ts:144-180` (`disposeSession`: disposable check then remove — durable rows: replaced, not removed, and only after conflict check; window between snapshot and unbind).
- **Counterexample (logic-level, hypothetical):** submit's snapshot passes as the session is disposed in another task; the submit then inserts its work attached to a sessions row no longer backed by a live session. Net: bounded orphan state with no cleanup path until disposal is retried or retention runs.
- **Impact:** bounded; consistent with at-least-once caveat but undocumented window.
- **Correction direction:** pin disposal and submission against the same durable transaction, or document the window in `src/work/README.md` caveats.
- **Verification:** composed test after the DB gate opens.

### A2-06 — P3 — open (informational) — concurrency core reasoning sound; real-DB confirmation still owed
Probes that held (a)–(h): single-lease authority via `FOR UPDATE OF w SKIP LOCKED` + re-check quals; token-rotation EPQ re-checks fail closed; replay `ON CONFLICT DO NOTHING` + refreshed statement snapshot; attempt-budget invariant preserved by every writer; no lock-order cycle; DB-clock (`statement_timestamp`) only; parameterization everywhere with compile-time constant interpolations; env TTL bounds safe for `$x::int`.
**(i)** remains reasoning, not runtime evidence — repo correctly labels PostgreSQL acceptance BLOCKED (`docs/architecture/agent-task-lifecycle.md:172-177`); at least one real concurrent-claim race harness is owed when a database is approved.

## Prescinded false negatives (considered, cleared)

- `retryable`/attempt semantics, 1-based attempt numbering, `queued→failed` decisions — match README/M2 doc exactly.
- `leaseToken` in repository `get`: repository record includes it, `WorkService.get` redacts it (test-pinned); consumer-facing claim true — no confirmed drift.
- JSONB semantic equality for idempotent replay — defensible interpretation of "same immutable payload".
- JS-number precision beyond 2^53 for `lastServerSeq` — SQL-side GREATEST/CASE uses exact bigint text; port-level cosmetic.
- Kinds CSV array literalization — env parsing excludes comma-containing kinds.
- Partial index BitmapOr planning for claim OR-predicate — immaterial given per-session scope; no statement/idle timeouts on the pool is a robustness note, not a contract breach.

## Documentation drift

1. **`database/session-tables.md`** — proposes a `sessions`/`session_active_clients` shape (`title/status/lifecycle/creation_error/working_directories/state`, `action_sequence`) that the shipped `0001_script` `sessions` table and `src/persistence/helpers/sessions.ts` superseded (`session_type_id`, `provider_id`, `owner_principal_subject`, `last_server_seq`, `durable_state`). The plan doc already declares this an unimplemented superseded proposal, but this file lacks a superseded/reconciliation pointer, so two authority narratives coexist. **Suggested fix:** label it superseded and link to `database/M2_AGENT_WORK_DATABASE_SCHEMA.md` / `0001`.
2. **`database/M2_AGENT_WORK_DATABASE_SCHEMA.md`** — "Targeted work must be for the same principal as the session owner" reads as a column invariant, but principality is enforced only at `WorkService.submit` (see A2-02). **Suggested fix:** precision note naming the service layer as the enforcement point.

Per `.agents/memory/documentation-review.md`, the documentation-update prompt preference is `enabled`; this is recorded for consolidation at review close.

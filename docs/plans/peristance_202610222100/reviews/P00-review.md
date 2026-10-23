# P00 independent review — READ-ONLY

Reviewer: independent read-only reviewer (not the writer, not the integrator).
Date: 2026-10-22. Candidate: `agentIdentity` @ `6bd3c5e4aef22d81bcce156eb190708f237efc66`.
Review method: independent re-verification of git state, persistence source
behavior, consumer scans, migration hashes, and `pnpm validate`. The handoff and
BASELINE were read only after the underlying evidence was collected; no writer
claims were trusted without re-execution or direct source reading. No files
outside `docs/plans/peristance_202610222100/reviews/` were written; no DB,
install, or git-mutation commands were run.

## Verdict: ACCEPT WITH NOTES

P00's evidence is accurate and independently reproducible. None of the notes
below block P01. Items N1–N3 are documentation hygiene to correct in the next
touch of the bundle (they may be fixed by the integrator or in P01's evidence
update; they do not need a new packet).

## 1. Checkout pin and checkpoint delta (B01) — VERIFIED

| Check | Command | Result |
| --- | --- | --- |
| Branch | `git branch --show-current` | `agentIdentity` |
| HEAD | `git rev-parse HEAD` | `6bd3c5e4aef22d81bcce156eb190708f237efc66` (matches handoff) |
| Working tree | `git status --short` | `?? docs/plans/peristance_202610222100/` only; nothing after `pnpm validate` either |
| Delta | `git rev-list --count f280496..HEAD` | `1` |
| Delta content | `git show --stat HEAD` | `docs/review/00-final-report.md` (+243), `docs/review/round-04-a2.md` (+131) — docs-only, 374 insertions |
| Scoped diff | `git diff --stat f280496..HEAD -- src env scripts database package.json pnpm-lock.yaml` | empty |
| Reflog | `git reflog -8` | only `commit:` entries since `checkout: moving from develop to agentIdentity`; no `reset`, no stash pops, no branch switches |
| Stash | `git stash list` | empty |

Claimed "373 insertions" in BASELINE §1 is actually **374** (243 + 131); off by
one, immaterial (N2). The writer's "not 4 commits, it is 1 docs-only commit"
correction is independently confirmed, including that `f280496` contains the
four earlier commits.

## 2. Persistence source spot-checks (B02) — VERIFIED

Every behavior claimed in BASELINE §2 was found by reading the files directly:

- `types.ts` — sentinels: registrations/sessions → `undefined`
  (`getById`, `get`), work lookups/claim/renew/fail/cancel → `null`,
  `complete` → `boolean` (C01). Four `RepositoryErrorCode` values (C08).
- `helpers/pool.ts` — `max: options.maxConnections ?? 10` (line 16);
  `withTransaction`: `BEGIN` → op → `COMMIT`, `ROLLBACK` swallowed, `release()`
  in `finally`; `databaseFailure`: identity-keeps `RepositoryError`,
  `23505` → `conflict`, `23503`/`22P02` → `not_found`, else `database`, and
  indeed trusts a plain thrown object's `code` (lines 41–54).
- `helpers/agentRegistrations.ts` — `ON CONFLICT (principal_subject, agent_key)
  DO UPDATE SET display_name = COALESCE(...)`; missing RETURNING row → internal
  `Error` → mapped to `database`; `getById` `$1::uuid`, miss → `undefined`.
- `helpers/sessions.ts` — insert `ON CONFLICT (session_uri) DO NOTHING`,
  re-select, lost row → `database` error, owner mismatch → `unauthorized`;
  update guarded by `GREATEST(modified_at)`, `GREATEST(last_server_seq)`,
  `durable_state = CASE WHEN $3 >= last_server_seq ...`; delete `RETURNING`
  + `rowCount > 0`, special-case `23503` → `conflict` "The session still has
  dependent work." **Optional fields not round-tripping confirmed:**
  `SessionRow`/`SELECT_COLUMNS` contain only `session_type_id`;
  `sessionTypeKey`/`sessionTypeVersion` are never selected or mapped;
  `last_server_seq` is `string` in the row and coerced via `Number()` (line 25).
- `helpers/workItems.ts` — default `leaseTtlSeconds: 60`; `submit` calls
  `ensureSession(client, input.session)` on the **same `withTransaction`
  client** as the insert (lines 81–83); replay compares `(kind, input,
  target_agent_id IS NOT DISTINCT FROM)`; `claim` is a pool-level CTE with
  `FOR UPDATE OF w SKIP LOCKED`, eligible = queued or expired-leased,
  `attempt_count < max_attempts`, target restriction, enabled+owner checks,
  `ORDER BY w.created_at, w.id LIMIT 1`, token `gen_random_uuid()`,
  `attempt_count + 1`, deadline `statement_timestamp() + $5 seconds`;
  `renew`/`complete` fenced predicates with unexpired lease
  (`lease_expires_at > statement_timestamp()`); `fail` `FOR UPDATE OF w` then
  `queued`/`failed`; `cancel` terminal rows returned unchanged; `get`
  owner-join; `reconcileExpired` terminalizes expired-with-exhausted-budget;
  `hasDependentWork` `EXISTS` including terminal rows. **DB clock:
  `statement_timestamp()` in every lease predicate; no `Date.now` in the
  file.**
- `helpers/text.ts` — rejects U+0000 and unpaired surrogates (lone low
  surrogate rejected at line 28; valid pairs accepted via `index += 1`),
  recursion includes object keys, `JSONB_SAFE_DEPTH = 512`, reject when
  `depth > 512`. Pure; no `pg` import.
- `index.ts` — neutral type/error exports **plus concrete
  `createPostgres*` exports** (lines 15–18), as claimed.
- `src/index.ts` — `createAgentWorkOptions` builds the pool, two repositories,
  `dispose: async () => { await pool.end(); }`, fail-closed on partial
  URL/token config; handlers installed in `main`; matches BASELINE §2/§6-3.

## 3. Permitted baseline checks re-run (B03) — VERIFIED

| Check | Command | Reported | Independently obtained |
| --- | --- | --- | --- |
| Migration list | `git ls-files database/migrations` | 3 files | identical: `0001_session_tool_baseline.sql`, `0002_agent_work.sql`, `README.md` |
| Migration diff | `git diff -- database/migrations` (+ `--stat` re-run) | empty | empty |
| Blob hashes | `git hash-object` both `.sql` files | `3709f44a…`, `af0e314d…` | identical |
| SHA-256 | `Get-FileHash` | `46E640A3…`, `AC5FE261…` | identical |
| Full gate | `pnpm validate` | exit 0 | **exit 0**: eslint clean; `tsc --noEmit` clean; vitest `40 files / 312 tests` passed; docs gate `97 source files mapped`; vite build `87 modules`, `dist/index.js 185.09 kB` |

All BASELINE §5 numbers reproduce exactly. No baseline failure was hidden; the
claim "no baseline failures" is true as re-run.

## 4. Consumer inventory vs. actual tree (B02) — VERIFIED, no missed consumers

Independent scans (`rg -n "@persistence|persistence/helpers" src env scripts`,
`rg "persistence"` over the same paths, `rg 'from "pg"' src`,
JSONB wording scan):

- Production consumers reproduced exactly: `src/index.ts`,
  `src/agents/types.ts`, `src/agents/helpers/directory.ts`, `src/work/types.ts`,
  `src/work/helpers/helpers.ts`, `src/work/index.ts` (`isJsonbSafe` re-export at
  `work/index.ts:5`), `src/websocket/helpers/host/types.ts`, and
  `src/websocket/helpers/host/helpers.ts` (both `import type`),
  `src/websocket/helpers/ahp/agentWork.ts` (value import of `RepositoryError`
  from the root barrel at line 6 — the F-P00-1 chain is real: barrel →
  `helpers/pool.ts` → `import { Pool } from "pg"` at runtime).
- Test consumers reproduced exactly: `src/tests/agents/fixtures.ts`,
  `src/tests/work/workService.test.ts`, `src/tests/websocket/agentWork.disposal.test.ts`,
  `src/tests/websocket/agentWork.integration.test.ts`, and
  `src/tests/websocket/agentWork.test.ts:604` (wire title).
- **No missed consumers.** A broader `persistence` search found only prose
  comments (`src/sessions/types.ts:137`, `src/sessions/helpers/registry/helpers.ts:6`)
  and module READMEs — no additional imports. No relative persistence import
  exists outside `src/persistence/`; all external access is via the tsconfig
  aliases (`tsconfig.json:29-30`). `env/` and `scripts/` carry zero persistence
  tokens. `from "pg"` occurs only in the four persistence helper files.
- JSONB wording sites match §3.4, including `work/helpers/helpers.ts:45`
  ("…contains text JSONB cannot store.") and the four wire messages in
  `agentWork.ts` (agent key, display name, request key, session URI) and the
  asserting test titles at `workService.test.ts:223,323,458`.

## 5. Honesty check (BASELINE / handoff / LEDGER) — PASS

- No claim of DB execution anywhere: both files explicitly disclaim queries,
  migrations, provisioning, and use of any connection string; only read-only
  file hashing of tracked migrations was done, and that is what the evidence
  shows. LEDGER correctly states database authorization is not granted.
- `pnpm validate` claims match a real re-run exactly (§3 above).
- No test-related cheating: the gate was green before and after the packet
  because no source was touched — consistent with `git status`.
- B01 evidence (status/reflog/delta), B02 evidence (importer/symbol table with
  relative imports, re-exports, transitive pg chain, JSONB wording assets), and
  B03 evidence (hashes + empty diff + no-DB-access statement) are adequate for
  the acceptance matrix's evidence requirements.
- The adversarial finding (F-P00-1, wire layer transitively evaluates `pg`) was
  independently confirmed and is correctly routed to the facade/wire packets.

## 6. Notes (non-blocking)

- **N1 — stray character:** BASELINE.md line 50 still contains a stray CJK
  glyph in `hasDependentWork`: `EXISTS`职. Fix next time the file is touched.
- **N2 — insertion count:** BASELINE §1 and the handoff say the docs-only
  commit has "373 insertions"; `git show --stat` gives 374 (243+131).
- **N3 — matrix bookkeeping:** the handoff marks B01–B03 "passed" while
  `ACCEPTANCE_MATRIX.md` still reads NOT RUN for those rows. This is consistent
  with P00's declared write ownership ("only a task-local baseline report and
  handoff"), but a later packet (or the integrator) should sync the matrix
  statuses/evidence pointers so the spec file does not appear silently stale.

## 7. Contract drift / blockers for P01

None. Observed behavior in `types.ts` matches C01 (sentinels, operation sets)
and C08 (codes, DTO shapes); no CORE_CONTRACT amendment is recorded or needed.
The consumer inventory is complete against the live tree, so P01 can freeze the
shared provider contract on this HEAD. Carry F-P00-1 into the facade packets
and F-P00-2/F-P00-3 into P04/P05 mapping work as planned.

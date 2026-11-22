# P00 baseline report — persistence dependency inventory

Recorded by packet P00 (GLM 5.3 Flash writer) on 2026-10-22, on the live
`agentIdentity` worktree. This is observed current-state only; proposed targets
are quoted from [CORE_CONTRACT.md](CORE_CONTRACT.md) and labeled as targets.
No application source was edited. No database was queried, migrated, or
provisioned. No `DATABASE_URL` was used even if present in the environment.

## 1. Checkout pin (check: `git status --short`, `git branch --show-current && git rev-parse HEAD`)

| Item | Value |
| --- | --- |
| Branch | `agentIdentity` |
| HEAD | `6bd3c5e4aef22d81bcce156eb190708f237efc66` |
| Reviewed checkpoint | `f2804963129403e666a6e929db92beb9b2ab761d` |
| Working tree | clean except untracked `docs/plans/peristance_202610222100/` (the plan bundle itself; expected) |
| Reset / stash / branch switch | none performed |

### Checkpoint difference

`git rev-list --count f280496..HEAD` = **1**, not 4. The tasking handoff stated
"4 later commits"; the actual graph is:

```
6bd3c5e docs(review): file the round-04 A2 verdict and the final panel report   <- HEAD
f280496 fix(tests): added tests for agentWork and workService                  <- reviewed checkpoint
```

`f280496` is the direct parent of `6bd3c5e`; it already contains 4951b82,
65127f6, d3c33d1, 27ff2bb (which may be where "4 later commits" came from).
The single later commit changed only `docs/review/00-final-report.md` and
`docs/review/round-04-a2.md` (373 insertions, no `src/`, `env/`, `scripts/`,
`database/`, manifest, or lockfile changes). **No effect on the plan or on the
persistence refactor; the plan's consumer inventory still applies verbatim.**
The checkpoint note in P00/TASKPLAN (`verify the local tree first`) is
satisfied by this comparison, not by `reset`.

## 2. Current persistence source (all 8 tracked files read)

`src/persistence/`: `types.ts`, `README.md`, `index.ts`,
`helpers/pool.ts`, `helpers/agentRegistrations.ts`, `helpers/sessions.ts`,
`helpers/workItems.ts`, `helpers/text.ts`.

| File | Current exports | Behavior recorded |
| --- | --- | --- |
| `types.ts` | `WorkStatus`, record/DTO types, `AgentRegistrationRepository` (`register`, `getById`), `DurableSessionRepository` (`ensure`, `get`, `delete`), `WorkRepository` (9 ops), `RepositoryErrorCode`, `RepositoryError` | Absence sentinels: registrations/sessions → `undefined`; work lookups and misses of claim/renew → `null`; fenced completion miss → `boolean false`. `delete` returns `Promise<boolean>`. |
| `helpers/pool.ts` | `createPostgresPool`, `withTransaction`, `Queryable`, `toIso`, `databaseFailure`, `PostgresOptions` | Pool default `max: 10`. `withTransaction`: connect → `BEGIN` → op → `COMMIT`, `ROLLBACK` on throw (swallowed), `release()` in `finally`. `databaseFailure`: identity-keeps `RepositoryError`; SQLSTATE `23505` → `conflict` ("...already exists with different immutable fields."), `23503`/`22P02` → `not_found`; everything else → `database` ("The durable store operation failed."). Trusts a thrown plain object's `code` string. |
| `helpers/agentRegistrations.ts` | `createPostgresAgentRegistrationRepository(database: Queryable)` | `register`: upsert `ON CONFLICT (principal_subject, agent_key) DO UPDATE SET display_name = COALESCE(EXCLUDED...)`, `RETURNING`; missing returning row → internal `Error` → mapped to `database`. `getById`: `$1::uuid` select; miss → `undefined`. |
| `helpers/sessions.ts` | `ensureSession(database: Queryable, input)`, `createPostgresDurableSessionRepository(pool)` | `ensureSession` is the transaction-local projection primitive (exported for reuse by `workItems.submit`). Insert `ON CONFLICT (session_uri) DO NOTHING`; if no row returned, re-select; missing row → `database` error; owner mismatch → `unauthorized`. Update guarded: `GREATEST(modified_at)`, `GREATEST(last_server_seq)`, `durable_state` replaced only when `$3 >= last_server_seq`. `get`: miss → `undefined`. `delete`: `DELETE ... RETURNING`; `rowCount > 0`; FK `23503` caught specially → `conflict` ("The session still has dependent work."). |
| `helpers/workItems.ts` | `createPostgresWorkRepository(pool, { leaseTtlSeconds? })` | Default `leaseTtlSeconds: 60`. `submit`: one `withTransaction` — `ensureSession(client, input.session)` on the **same client** as the insert; insert `ON CONFLICT (session_uri, request_key) DO NOTHING`; on replay compare `(kind, input, target_agent_id IS NOT DISTINCT FROM)` → same payload returns `{id, created:false}`, else `conflict`. `claim`: pool-level CTE `FOR UPDATE OF w SKIP LOCKED`, eligible = queued or expired-leased with `attempt_count < max_attempts`, target-agent restriction, enabled-agent + session-owner checks, `ORDER BY created_at, id LIMIT 1`; update rotates `gen_random_uuid()` token, `attempt_count + 1`, `statement_timestamp()` deadline. `renew`/`complete`: same fenced predicate (`status='leased'`, agent, token UUID, unexpired, enabled registration exists, session owner = principal); unexpired lease (`lease_expires_at > statement_timestamp()`). `fail`: `FOR UPDATE OF w` then decide `queued` (retryable && attempts remain) else `failed`. `cancel`: `FOR UPDATE OF w` via session-owner join; terminal rows returned unchanged (safe repeat). `get`: owner-join select. `reconcileExpired`: terminalize expired leased rows with exhausted budget. `hasDependentWork`: `EXISTS` incl. terminal rows. Clock: database clock (`statement_timestamp()`) everywhere, never process clock. `QueryResultRow` rows use snake_case; `mapWork`/`toIso` convert `Date`→ISO strings; `last_server_seq` is `string` in the row and coerced via `Number()` in sessions. |
| `helpers/text.ts` | `isJsonbSafeText`, `isJsonbSafe(value, depth)` | Rejects U+0000 and unpaired UTF-16 surrogates (valid pairs kept); recursive over strings, arrays, and record values **and object keys**; depth budget `JSONB_SAFE_DEPTH = 512`, reject when `depth > 512`. Pure; no `pg`. |
| `index.ts` | Public barrel | Re-exports neutral types + `RepositoryError`, **and concrete** `createPostgresAgentRegistrationRepository`, `createPostgresDurableSessionRepository`, `createPostgresPool`/`PostgresOptions`, `createPostgresWorkRepository`/`PostgresWorkRepositoryOptions`. No default `pg` export beyond these. |
| `README.md` | Module doc | Documents pool ownership (`pool.end()` at shutdown), JSONB wording, work semantics, and "Real PostgreSQL acceptance is intentionally BLOCKED". Doc file, not code. |

### Characterization notes (for later packets, no fixes authorized here)

- `DurableSessionInput` has optional `sessionTypeId`, and `sessionTypeKey`,
  `sessionTypeVersion` are carried by the type but never selected or mapped:
  `sessions.ts` selects/returns only `session_type_id`. The
  type-key/version fields do not round-trip. (Contract C08: record, do not fix.)
- `lastServerSeq` is a `number` port, coerced through `Number(string)`; values
  beyond `Number.MAX_SAFE_INTEGER` are silently imprecise. Same method note as
  above; no silent representation change permitted.
- `durableState` is serialized as `JSON.stringify(input.durableState ?? {})` —
  non-JSON `undefined` collapses to `{}` on write.
- `claim` runs on the pool, not in an explicit transaction; its CTE update is
  a single statement. `submit`, `fail`, `cancel` (and `ensure` via facade) run
  `withTransaction`.
- `databaseFailure` maps FK codes to `conflict` only at the `sessions.delete`
  call site (special-case above); `pool.ts` maps `23503` to `not_found`
  generally. Two different classifications for the same SQLSTATE exist today.

## 3. Consumer inventory (check: import scan of the live tree)

Scan executed (see §8 commands) over `src`, `env`, and `scripts` for
`@persistence`, `persistence/helpers`, `createPostgres`, `isJsonbSafe`,
`JSONB`/`jsonb`, `PoolClient`, `QueryResultRow`, `Pool`, plus a
relative-import scan inside `src/persistence` and token scans of `env`,
`scripts`, and relevant `docs`/`src` READMEs. `env/` and `scripts/` contain
**zero** persistence tokens (`scripts/check-docs.ts` is the docs gate only).

### 3.1 Direct consumers

| Importer | Import mode | Symbols | Consumes | Future neutral target |
| --- | --- | --- | --- | --- |
| `src/index.ts` | runtime value | `createPostgres*Repository`, `createPostgresPool` (from root barrel) | Composition root: builds pool, two repos, `pool.end()` in `dispose` (`createAgentWorkOptions`) | Adapter-selection entrypoint + `createPersistence` (C09/C10) |
| `src/agents/types.ts` | type-only | `AgentRegistrationRecord`, `AgentRegistrationRepository` (`@persistence/types`) | Public principals/dir options contract | Neutral leaf types (unchanged path shape) |
| `src/agents/helpers/directory.ts` | runtime value | `isJsonbSafeText` (`@persistence/helpers/text`); types via `@persistence/types` | Text gate before `registrations.register` ("Registration text cannot be stored.") | `isPortableText` + neutral errors (C07) |
| `src/work/types.ts` | type-only | `AgentRegistrationRepository`, `DurableSessionInput`, `WorkItemRecord`, `WorkRepository`, `WorkStatus` | `WorkServiceOptions` / `WorkViewSource` contracts | Neutral types |
| `src/work/helpers/helpers.ts` | runtime value | `RepositoryError` (as `PersistenceError`, from `@persistence/types`); `isJsonbSafe`, `isJsonbSafeText` | Error translation to `WorkError`; text gates in `boundedJsonBytes`, `assertSubmission`, claim URI gate, durable-projection gate, `assertSessionDisposable` | Neutral leaf imports; neutral wording (C07/C08); keep translation ownership in `@work` |
| `src/work/index.ts` | re-export | `isJsonbSafe` re-exported from `./helpers/helpers` → `@work` public name | Wire layer imports it via `@work` | Remove JSONB-named re-export from public surface (TASKPLAN §6) |
| `src/websocket/helpers/host/types.ts` | type-only | `AgentRegistrationRepository`, `WorkRepository` (from root **barrel**) | `AHPServerAgentWorkOptions` | Neutral public interfaces; keep `agentWork` option shape |
| `src/websocket/helpers/host/helpers.ts` | type-only | `DurableSessionInput` (from root barrel) | Session-owner projection wiring (import audit in plan) | Neutral public types |
| `src/websocket/helpers/ahp/agentWork.ts` | **runtime value** | `RepositoryError` (from root **barrel**); `isJsonbSafeText` (`@persistence/helpers/text`) | `mapRepositoryError` → wire codes; zod refines and messages "…contains text JSONB cannot store" ×4 (agent key, display name, request key, session URI); `isJsonbSafe` is consumed re-exported from `@work` | Neutral validation import, no JSONB wording, neutral error import (C07/C11) |
| Tests: `src/tests/agents/fixtures.ts`, `src/tests/work/workService.test.ts`, `src/tests/websocket/agentWork.disposal.test.ts`, `src/tests/websocket/agentWork.integration.test.ts` | type-only | record/repository/port types (`@persistence/types`) | Fake-port seams (fakes are hand-built, no SQL) | Replace source imports; keep fake seams |
| Test: `src/tests/websocket/agentWork.test.ts` | runtime (via `@work`) | asserts wire behavior, not persistence directly | Line 604: "rejects payloads nested beyond the JSONB depth budget before the service runs" | Rename on wording change; keep invalid-input outcomes |

### 3.2 Relative imports and re-exports

- **No consumer outside `src/persistence/` reaches the module by relative
  import** — all external access goes through `tsconfig.json` aliases
  `@persistence` (`src/persistence/index.ts`) and `@persistence/*`
  (`tsconfig.json:29-30`). Verified by scan; no match misses claimed.
- Internal relative imports (must die with the SQL move): `index.ts` →
  `./types`, `./helpers/agentRegistrations|sessions|pool|workItems`;
  `pool.ts` → `../types`; `agentRegistrations.ts` → `../types`, `./pool`;
  `sessions.ts` → `../types`, `./pool`; `workItems.ts` → `../types`,
  `./sessions` (value import of `ensureSession`), `./pool`.

### 3.3 Transitive evaluation graph (adversarial check)

The root barrel `@persistence` evaluates `helpers/pool.ts` → `import { Pool } from "pg"`
**on import, unconditionally**. Therefore:

| Runtime chain | Evaluates `pg`? | Assessment |
| --- | --- | --- |
| `src/index.ts` → `@persistence` | Yes, intended today | Composition root only; goes away with C09/C10 |
| `src/websocket/helpers/ahp/agentWork.ts` → `@persistence` (RepositoryError value) | **Yes, unintended** | The AHP wire layer transitively loads the `pg` driver and constructs nothing, even when no database is configured. The neutral refactor must remove this root-barrel value import (leaf `@persistence/types` import is the fix). **Recorded as the leading adversarial finding.** |
| `src/work/helpers/helpers.ts` → `@persistence/types` + `@persistence/helpers/text` (leaves) | No | Leaf modules import nothing from `pg` or the barrel |
| host `types.ts`/`helpers.ts` → `@persistence` (type-only) | No (runtime) | `import type` is erased; a bundler may still keep `pg` in the static module graph — record for P08/P11 graph gate |
| `@work` public index (isJsonbSafe re-export) → helpers → leaves | No | Safe |

### 3.4 JSONB wording and tests that assert it

| Location | Wording/symbol |
| --- | --- |
| `src/persistence/helpers/text.ts` | `isJsonbSafeText`, `isJsonbSafe`, `JSONB_SAFE_DEPTH`, doc text "JSONB storage/KEYS" |
| `src/persistence/README.md:17` | storage-shape predicate description (JSONB) |
| `src/agents/helpers/directory.ts:88-91` | comment + gate "Registration text cannot be stored." (wording is neutral; symbol not) |
| `src/work/helpers/helpers.ts:31-32,44-45,79,86,193-195,259,390-391` | re-export of `isJsonbSafe`; messages "…contains text JSONB cannot store."; comments |
| `src/work/index.ts:5` | public re-export `isJsonbSafe` |
| `src/websocket/helpers/ahp/agentWork.ts:49-67,124-126` | `requiresStorableText`; 4 wire messages "…contains text JSONB cannot store" |
| `src/tests/work/workService.test.ts:223` | "rejects input carrying PostgreSQL-JSONB-unsafe text" |
| `src/tests/work/workService.test.ts:323` | "refuses a durable projection JSONB cannot store" |
| `src/tests/work/workService.test.ts:458` | "refuses a durable projection nested beyond the JSONB-safety depth budget" |
| `src/tests/websocket/agentWork.test.ts:604` | "rejects payloads nested beyond the JSONB depth budget before the service runs" |
| `src/work/README.md:37,62,68,70,87` | JSONB-storable wording in module doc |
| `docs/review/*`, `docs/architecture/agent-task-lifecycle.md` | Historical/current reviews reference `isJsonbSafe` and JSONB semantics; docs scope belongs to P12, not the code packets |

No test asserts the symbols `isJsonbSafeText`/`isJsonbSafe` by import name
except through behavior; renaming is wording-compatible provided the five
asserted test strings above (three service-test titles, one wire-test title,
plus behavior) keep their outcomes — C07 requires recording message-text
changes and preserving invalid-input outcomes.

## 4. Migrations (check: `git ls-files database/migrations`, `git diff -- database/migrations`)

`git ls-files database/migrations`:

```
database/migrations/0001_session_tool_baseline.sql
database/migrations/0002_agent_work.sql
database/migrations/README.md
```

`git diff -- database/migrations` → empty; `git status --porcelain database/migrations`
→ empty. **Canonical DDL is unchanged in the worktree.**

Hashes recorded without applying anything (Git blob hash; SHA-256 also taken):

| File | Git blob hash | SHA-256 |
| --- | --- | --- |
| `0001_session_tool_baseline.sql` | `3709f44ae2abd15b3feafe38804bcd3ca71e66aa` | `46E640A3B2171088074A8962D4A46C06BF57A70589D138A78F172DFED11B8A99` |
| `0002_agent_work.sql` | `af0e314d2170950ec6984a7f259b06727322321c` | `AC5FE261655841E520667EDD905545081BEF45493B1727E127C5A2187695E4D3` |
| `README.md` | (doc) | `B5E20552DEA0153D8E7B0CE7B3B87A742BA71276CD869607AB5E340FA79D0DD9` |

Constraints read (README + both scripts' role): apply-in-order to an empty
database; `0001` owns the session/tool baseline (`host_state`, `sessions`,
`session_types`, `tools`, `session_type_tools`, `schema_migrations`);
`0002` owns `agent_registrations` and `work_items` and their indexes.
`work_items.session_uri` depends on `sessions`, which the code relies on for
owner joins and FK-driven delete rejection. Marked **Written, reviewed, and
not applied** — the standing prohibition on executing them remains in force
for this whole task unless separately authorized.

**Database boundary: no queries, migrations, provisioning, or use of any
connection string occurred in P00. A database URL present in the environment
was not inspected or used.**

## 5. Validation gate (check: `pnpm validate`, pinned toolchain)

```
pnpm validate (lint → typecheck → test → docs:check → build): exit 0 PASS
  eslint --max-warnings 0 .................. passed
  tsc --noEmit ............................. passed
  vitest run: 40 files / 312 tests ......... passed (3.35s)
  docs gate: 97 source files mapped ........ passed
  vite build (ssr): 87 modules ............. passed (dist/index.js 185.09 kB)
```

- **Baseline failures:** none. **New failures introduced by P00:** none
  (no source files were touched). Toolchain/dependencies available; no
  package installs or upgrades were needed or performed.
- Real-PostgreSQL executions remain **BLOCKED / NOT RUN** by standing
  authorization boundary; category-3 evidence (concurrency, expiry, rollback)
  does not exist and distrusting that is separate from this gate result.

## 6. Known existing limitations (recorded separately; not fix authorization)

1. **No automatic session rehydration** — a live session that disappears with
   the process is not restored from `sessions`/`work_items`
   (`src/persistence/README.md` caveat; C10 keeps `sessions` detached from
   live `SessionRegistry`).
2. **Incomplete optional session-type projection** — `sessionTypeKey` /
   `sessionTypeVersion` never persist; `sessionTypeId` does not round-trip
   through map/DB. See §2.
3. **Current host stop behavior** — `src/index.ts:installShutdownHandlers`
   wires `SIGINT`/`SIGTERM` → `void server.stop().catch(...)` with
   `process.exitCode = 1`; the returned detach means `main`'s handlers stay
   installed for process lifetime. `createAgentWorkOptions` disposal is only
   ownership-safe because the pool outlives returned options; there is no
   drain of in-flight work before `pool.end()`.
4. **Fake ports do not prove SQL concurrency** — `FOR UPDATE ... SKIP LOCKED`
   claims, lease race windows, and FK behavior in `delete` are untestable
   without a real adapter; unit tests pass on hand-built fakes.
5. **Settle-window reconciliation in `@work.submit`** — the service
   cancels a just-recorded work row when the live session disappears between
   submit-time checks; a residual cancel failure is swallowed by design.
6. `databaseFailure` trusts a plain thrown object's `code` string (C08 will
   tighten this; recorded, not fixed).

## 7. Contract drift

None. All consumers found are inside the TASKPLAN §6 initial inventory, plus
exact test/import rows the §6 table's own footnote instructed P00 to resolve
(`src/tests/agents/fixtures.ts`; the `agentWork` disposal/integration tests;
the root-barrel `RepositoryError` import in `agentWork.ts`). No CORE_CONTRACT
clause conflicts with observed behavior; C01 sentinels, C08 error codes, and
C05 transactionClient affinity are present in current code as written.

## 8. Commands executed (repository root, pinned toolchain)

| Command | Result |
| --- | --- |
| `git status --short` | `?? docs/plans/peristance_202610222100/` only |
| `git branch --show-current && git rev-parse HEAD` | `agentIdentity` / `6bd3c5e4aef22d81bcce156eb190708f237efc66` |
| `git rev-list --count f280496..HEAD` / `git log --oneline f280496..HEAD` | 1 docs-only commit |
| `git diff --stat f280496..HEAD -- src env scripts database package.json pnpm-lock.yaml` | empty |
| Import/token scans (`rg`-equivalent via tool) over `src`, `env`, `scripts`, docs | results in §3, §3.4; env/scripts empty; no rg matches ≠ failure |
| `git ls-files database/migrations` | 3 files listed (§4) |
| `git diff -- database/migrations` (and porcelain) | empty |
| `Get-FileHash` / `git hash-object` on migrations | hashes (§4); not applied |
| `pnpm validate` | exit 0, all five stages pass (§5) |

# P03 independent review — READ-ONLY

Reviewer: independent read-only reviewer (same role as P00–P02 reviews; not the
writer). Date: 2026-10-22. Candidate: `agentIdentity` @ `6bd3c5e4…` + untracked
`src/persistence/helpers/adapters/` (5 files) and untracked
`src/tests/persistence/adapters/` (1 file); prior P01/P02 modifications
preserved. Method: full read of every new file, line-level comparison against
the legacy `src/persistence/helpers/pool.ts`, driver-double mutation analysis,
pg typings inspection (node_modules/@types/pg), import scans, and independent
re-runs of all commands.

## Verdict: ACCEPT WITH NOTES

withTransaction is a faithful move with real semantic proof, the error
mapping/messaging is byte-identical to the legacy module, and SQLSTATE numbers
are adapter-private. Notes N1 (connect-call count not recorded by the double)
and N2/P04 type guidance below are non-blocking.

## 1. withTransaction semantics (PG01/PG02) — VERIFIED

`adapters/postgres/helpers/connection/helpers.ts` vs legacy `helpers/pool.ts`:

- **Acquire once:** `const client = await pool.connect()` — single call.
- **One client for everything:** `BEGIN`, the operation (client is passed as
  the operation argument), `COMMIT`, and `ROLLBACK` all run via
  `client.query`, exactly the legacy sequence. `pool.query` is never used
  after (or during) BEGIN.
- **Rollback best-effort:** `await client.query("ROLLBACK").catch(()
  => undefined)` — identical to legacy; rollback failure cannot mask the
  primary operation failure or a COMMIT failure; `throw error` rethrows the
  original error object.
- **Release exactly once, after acquisition, in `finally`:** identical to
  legacy; on a `connect()` failure the helper throws before entering the
  `try`/`finally`, so **no release occurs** (proven by the connect-failure
  test asserting `releaseCount() === 0`).
- **Propagations:** result identity, operation-error identity, and
  COMMIT-error message all asserted (see §3).
- `createPostgresPool` is the same constructor call with `max:
  options.maxConnections ?? 10` — defaults preserved; verified at runtime
  against `pool.options.max` (10 default / 5 override readback).
- `toIso` body identical.

No public neutral `withTransaction` was added; nothing from this module is
re-exported through the neutral persistence root (verified: `index.ts`, README
API section, and all neutral files are unchanged).

## 2. Error mapping and identity (PG03) — VERIFIED

`databaseFailure` is byte-for-byte the legacy logic: `RepositoryError`
instance passthrough (identity, proven by `toBe(original)`), SQLSTATE
`23505` → `conflict` / `23503`+`22P02` → `not_found` / else `database`, with
the exact legacy message strings ("The resource already exists with different
immutable fields.", "The referenced resource does not exist.", "The durable
store operation failed."). Tests cover numeric SQLSTATE coerced to string,
foreign error objects, plain strings, and assert a canned "sensitive: select
* from sessions" message does not leak into the mapped error — no vendor
text/credential escape within the mapping's scope. `rg "23505|23503|22P02"`
over src excluding the adapter test returns **zero matches**: SQLSTATE numbers
exist only inside the adapter connection module.

## 3. Driver-double honesty — mostly honest; one gap

The double returns genuine `Promise.resolve/reject` results (handoff admits a
sync-throw double initially masked the helper's rollback `.catch` — the final
double genuinely exercises that path). Mutation analysis against each listed
failure mode:

| Wrong implementation | Caught? | How |
| --- | --- | --- |
| Helper routes statements via `pool.query` | **Yes** | `poolStatements` must be `[]` in every scenario; client-path assertions require exact ordered arrays (`["BEGIN","SELECT 1","COMMIT"]` etc.) — a pool-routed statement lands in poolStatements and disappears from the client list |
| Mixed pool/client routing | Yes | same two assertions |
| Double release / never release | **Yes** | `releaseCount()` asserted =1 on success, op-failure, COMMIT-failure, rollback-failure; =0 on connect failure |
| Swallowed primary error | **Yes** | `rejects.toBe(primaryError)` — identity, not message |
| Rollback masking primary | **Yes** | `failStatement: "ROLLBACK"` + `rejects.toBe(primaryError)`; a masked error would reject with "double rejected ROLLBACK" instead |
| COMMIT failure propagation | Yes | `failStatement: "COMMIT"` → exact message + release once + ROLLBACK attempted after |
| **Second `pool.connect()`** | **No — N1** | the double returns the *same client object* on every connect and does not record a connect count, so an implementation calling `connect()` twice is observationally equivalent (same client, release still 1). Not a plausible refactor accident (this code was moved, not rewritten), but the double cannot distinguish it. Strengthen: record `connectCount` in the double and assert 1 (P04/P05 when this file is next touched) |

Not covered, non-blocking: explicit BEGIN-failure case (same catch path as
COMMIT failure; behavior identical by construction), and a "release boolean
flag" variant of `release(err?)` (the double ignores the argument, matching
the legacy behavior's use).

Offline pool construction: `new Pool({...})` with a localhost probe string and
no `connect()`/query — no network or database access; the standing DB
prohibition is respected.

## 4. Boundaries, old files, mapping — VERIFIED

- `git status --short`: only P01/P02-owned files modified (`README.md`,
  `text.ts`, `types.ts`); `src/persistence/helpers/pool.ts`,
  `agentRegistrations.ts`, `sessions.ts`, `workItems.ts`,
  `src/persistence/index.ts`, and `src/index.ts` show **no diff** — legacy
  repositories untouched, no forwarding shim from the legacy module into the
  adapter (the legacy file is byte-identical; adapters never import it).
- Adapter imports: `pg` (Pool constructor + type-only), `@persistence/types`
  (leaf — never the `@persistence` root barrel), and relative `./types` /
  `../../types` only. Test imports use the adapter's explicit module
  entrypoint, which C03 permits for adapter-focused tests.
- `postgres/README.md` maps all four new source files in its table (types.ts,
  connection/types.ts, connection/helpers.ts, connection/index.ts) and states
  the interim status honestly ("connection module only"; repositories migrate
  P04–P05; provider factory P04–P06). `pnpm run docs:check` = **exit 0, "101
  source files mapped"** (97 + the 4 new adapter sources), exactly as the
  handoff claims.
- SQLSTATE numbers do not leak into generic helpers; migration files
  untouched (no diff, standing boundary).

## 5. P04 type compatibility — usable without unsafe casts, with one flag

Grounded in `node_modules/@types/pg` (pg 8.23.1):

- `Pool.connect(): Promise<PoolClient>` and
  `PoolClient.release(err?: Error | boolean): void`; real PoolClient's
  `query` overloads cover the narrowed `PoolClientLike` signature
  (`(text: string, values?: readonly unknown[]) => Promise<QueryResult<R>>`),
  and method-position bivariance covers the `Error | boolean` vs
  `Error | false` release-parameter widening. So `withTransaction(realPool, …)`
  yielding a real client into `PoolClientLike`-typed helper parameters
  **should compile**; the first P04 call site is where this gets its compile
  proof (currently only the shape-compatible double exercises the types).
- Legacy `Queryable = Pick<Pool, "query">` (adapter types.ts keeps the same
  definition) accepts real pools/clients (the still-compiling legacy
  repositories prove the real-client → `Queryable` direction).
- **Flag for P04/P05 (N2):** do not assume every direction between
  `PoolClientLike` and `Queryable` is mutually assignable — `Pool.query`'s
  overload set includes config-object/callback/Submittable shapes that the
  narrowed `PoolClientLike.query` does not declare. Type new adapter
  repository helpers' client parameters as `PoolClientLike` (or accept a real
  `PoolClient` through their own re-derived subset) rather than passing a
  `PoolClientLike`-typed value where `Queryable` is expected; if a direction
  fails, widen `PoolClientLike` (still adapter-private) instead of casting.
  No unsafe cast should be needed either way.

## 6. Commands re-run — exact results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **exit 0** |
| `pnpm exec vitest run src/tests/persistence/adapters/postgres/connection.test.ts` | **exit 0, 1 file / 14 tests** — matches handoff |
| `pnpm run docs:check` | **exit 0, "101 source files mapped"** |
| `pnpm exec eslint src/persistence/helpers/adapters src/tests/persistence/adapters --max-warnings 0` | **exit 0** |
| `pnpm validate` | **exit 0**: lint ✓, typecheck ✓, vitest **43 files / 344 tests** (P02 state 42/330 + exactly 1/14), docs gate 101 ✓, vite build 87 modules, `dist/index.js 186.23 kB` (unchanged from P02 — the bundler graph contains no adapter edges yet, as expected) |

Baseline-vs-new separation: final state **no failures**. The handoff
discloses writer-owned intermediate defects (promise-returning doubles,
`oid` typing, unused imports) consistent with the final strict double.

## 7. Notes and blocking findings for P04/P05

No blocker. Recorded notes:

- **N1 — double blind spot (whole-tree note):** the driver double does not
  count `pool.connect()` calls, so a second connect is not observable; add a
  `connectCount` assertion when the double is next modified (P04/P05). The
  packet's adversarial intent (one client) is otherwise fully enforced.
- **N2 — P04 typing guidance (§5):** use `PoolClientLike` for new helper
  params; avoid relying on `PoolClientLike → Queryable` assignability; no
  unsafe casts are required by the current shapes. The first real-Pool
  `withTransaction` call should be the P04 compile proof for the
  real-driver direction.
- **N3 (standing bookkeeping):** ACCEPTANCE_MATRIX.md PG01–PG03 rows still
  NOT RUN (sync later); LEDGER records the legacy `pool.ts` duplication debt
  with owner P08, as the handoff states. Temporary duplication is honest and
  bounded (legacy copy byte-identical, no shim, deletion scheduled).
- **N4:** the temporary `PostgresOptions` duplicate is adapter-owned and never
  re-exported neutrally (verified); P08 must delete one of the two copies so
  only the adapter's remains.

Handoff to P04 (registration/session repositories into the adapter) is clean.

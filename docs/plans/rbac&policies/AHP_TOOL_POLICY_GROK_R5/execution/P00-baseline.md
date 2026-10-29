# P00 baseline — B01 / B03

**Writer scope:** candidate, toolchain, config, persistence/DB-gate evidence only.
**Not claimed:** B02 ingress/egress inventory and SDK transport mapping (owned by w8:p4). No production edits, handoff, or ledger updates.
**Status:** recorded. No blocker for this scope.

## Candidate (B01)

| Fact | Evidence |
| --- | --- |
| Branch | `agentIdentity` (`git branch --show-current`, exit 0) |
| HEAD | `22fa7955b8e43839e041228f647f26e00762ebbe` (`git rev-parse HEAD`, exit 0) |
| Tracking | Up to date with `origin/agentIdentity` |
| Staged | none (`git diff --cached --stat` empty, exit 0) |
| Tracked unstaged vs HEAD and vs pin | none (`git diff --stat 22fa7955b8e43839e041228f647f26e00762ebbe` empty, exit 0) |
| Untracked before this write | `docs/plans/rbac&policies/` and empty file `nul` (0 bytes, 2026-10-25 21:49). Neither was reset, stashed, or deleted. |
| This write | only `execution/P00-baseline.md` and `execution/P00-baseline.validate.log` under the already-untracked plan directory |

The pin and HEAD are the same commit. There is no tracked branch divergence and no amendment is indicated by this evidence. `nul` is unrelated untracked residue, not a source change. Git printed `warning: unable to find all commit-graph files` on status/diff/show; commands still exited 0.

No `git reset`, `stash`, `checkout`, commit, worktree, or topology change was run.

## Pinned commit (historical only)

`git show --stat --format=fuller 22fa7955b8e43839e041228f647f26e00762ebbe` (exit 0):

- Author/committer: Yohans Ashine, Fri Oct 23 08:35:23 2026 -0400
- Subject: `fix: close persistence review findings`
- 14 files, +202 / -16

Touched production/test files: `src/persistence/README.md`, `src/persistence/helpers/adapters/helpers.ts`, `src/persistence/types.ts`, `src/tests/persistence/adapters/selection.test.ts`, `src/tests/persistence/conformance/helpers.ts`, `src/tests/websocket/composition.test.ts`, plus plan/review docs under `docs/plans/peristance_202610222100/` and `docs/gates/persistence-portability-validation.md`.

Those prior persistence results are historical. The current gate result is the `pnpm validate` run below, not that commit message.

The commit's code delta, read only as current-tree context, adds an own-property allowlist before persistence-provider lookup, documents JSON value equality (object key order irrelevant, array order significant) on `WorkRepository.submit`, and updates the in-memory conformance fixture to `isDeepStrictEqual`. It is not a target for removal.

## Toolchain, aliases, README gate (B03)

Installed and invoked, not upgraded:

| Tool | Actual | Pin |
| --- | --- | --- |
| Node | `v24.21.0` at `C:\Users\Yohan\AppData\Local\Volta\tools\image\node\24.21.0\node` | `engines.node` `24.x`; `volta.node` `24.21.0` |
| pnpm | `10.34.6` at `C:\Program Files\Volta\pnpm` | `packageManager` and `engines.pnpm` `pnpm@10.34.6` |
| TypeScript | manifest `5.9.3` | not re-resolved from the registry |
| Vitest | installed `5.0.5` (reporter `RUN v5.0.5`) | `devDependencies.vitest` `5.0.5`; lock `vitest@5.0.5` |
| Vite | build log `vite v8.3.4` | `devDependencies.vite` `8.3.4` |
| SDK | installed `@microsoft/agent-host-protocol` `1.0.0` | `dependencies` specifier `1.0.0`; lock `@microsoft/agent-host-protocol@1.0.0` |
| pg | installed `8.23.1` | `dependencies.pg` `8.23.1`; lock `pg@8.23.1` with `pg-pool@3.14.0` |

Lockfile is `pnpm-lock.yaml` `lockfileVersion: 9.0`. `package.json` and `pnpm-lock.yaml` have no working-tree diff.

Aliases: there is no `vitest.config.ts`. `vite.config.ts` is the shared Vite/Vitest config. `resolve.tsconfigPaths: true`. `test.environment` is `node`. `test.include` is `src/tests/**/*.{test,spec}.ts`. No extra `resolve.alias` map. TypeScript paths in `tsconfig.json`: `@env`, `@jsonrpc`, `@sessions`, `@application`, `@agents`, `@persistence`, `@work`, `@tools`, `@toolClient`, `@websocket` (each with a star companion except the exact entries shown in the file).

Helper convention (`docs/CodingRules.md`): module `index.ts` / `types.ts` / `helpers.ts` or `helpers/` / optional `constants.ts`. Tests stay under `src/tests/`. No new aliases or files were added.

README gate: `pnpm docs:check` runs `vite-node scripts/check-docs.ts`. Rule is in `docs/gates/documentation.md`: every `src/**/*.ts` outside `src/tests/` and every `env/**/*.ts` must be named by its nearest ancestor module `README.md`. This run: `Documentation gate passed: 116 source files mapped by module READMEs.`

SDK API/transport mapping is intentionally not duplicated here.

## Database gate (B03)

No live database was contacted, migrated, or queried.

Ambient presence before the gate, values not read or printed: all of the following were **unset** in this process: `AGENT_HOSTING_PROTOCOL_DATABASE_URL`, `AGENT_HOSTING_PROTOCOL_AUTH_TOKENS`, `AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER`, `AHP_TEST_DATABASE_URL`, `DATABASE_URL`, `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`, `PGPASSFILE`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS`, `SUPABASE_URL`, `SUPABASE_DB_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`. The validate child removed those plus `PGAPPNAME` before launch. The log records only `unset`.

Dotenv: `dotenv` is not a dependency. No `.env`, `.env.local`, `.env.test`, or `.env.*.local` file exists at the repo root. Installed Vite `loadEnv` (vite `8.3.4`) returns only `VITE_`-prefixed keys by default and copies only `NODE_ENV` / `BROWSER` / `BROWSER_ARGS` from parsed files into `process.env`. With no env files, that path has nothing to load. Vitest config does not set `envDir`, `env`, or a custom setup file.

Integration gating:

- `runPostgresPersistenceConformance` exists only in `src/tests/persistence/adapters/postgres/conformance.ts`. Nothing imports it. The filename does not match `*.{test,spec}.ts`, so `pnpm test` does not execute it. `database/migrations/README.md` states these scripts are not applied and that no integration test executes them.
- Tests do not read `process.env` for database credentials. The only `process.env` read under `src/tests/` is `ComSpec` in `src/tests/agent-workflow-hook.test.ts`.
- `loadEnv()` defaults to `process.env` only as a function default. Tests pass an explicit object. `main()` is the production caller of `loadEnv()` and is skipped unless the module is the process entrypoint (`src/index.ts`). `src/tests/index.test.ts` imports `APP_NAME` and `installShutdownHandlers` only.
- `src/tests/env/parse.test.ts` passes fixture URLs into `createAgentWorkOptions` behind `vi.mock` of provider selection (`selectProvider`), not a live pool.
- PostgreSQL adapter tests use query doubles, except offline `new Pool` construction in `src/tests/persistence/adapters/postgres/provider.test.ts` and `connection.test.ts`. Those pass explicit connection strings and do not call `query`/`connect`. A local probe of installed `pg` `8.23.1` constructed `new Pool({ connectionString: "postgres://127.0.0.1:1/unused", connectionTimeoutMillis: 1, max: 1 })`, observed `totalCount/idleCount/waitingCount` all `0`, and `pool.end()` resolved with `totalCount` still `0`. That is construction and idle disposal, not a query.
- `pg` `ConnectionParameters` can fall back to `PG*` when a field is absent. The validate child unset those variables, and no test queried a real pool, so that fallback was not used.

DDL unchanged: working tree has no diff under `database/migrations`. SHA-256 matches the historical gate note in `docs/gates/persistence-portability-validation.md`:

- `0001_session_tool_baseline.sql` `46E640A3B2171088074A8962D4A46C06BF57A70589D138A78F172DFED11B8A99` (2959 bytes)
- `0002_agent_work.sql` `AC5FE261655841E520667EDD905545081BEF45493B1727E127C5A2187695E4D3` (2446 bytes)

## Same-principal durable-work guards (invariants, not removal targets)

Owner-only durable work is enforced before repository writes and again on the durable session projection:

- `createSessionOwnerRegistry.bind` conflicts when the URI is already bound to another subject (`src/work/helpers/helpers.ts`).
- `createWorkService.submit` requires the live projection owner and the bound owner to both equal the caller; a target agent must share that subject; a post-await owner change cancels the new row and conflicts.
- Postgres `ensureSession` returns unauthorized when `owner_principal_subject` differs (`src/persistence/helpers/adapters/postgres/helpers/sessions/helpers.ts`). The memory conformance fixture does the same.

Current tests that pin this, not a new suite:

- `src/tests/work/workService.test.ts`: "submits only through an authenticated owned live session"; "rejects a target agent owned by another principal"; "exposes ownership conflicts as typed work-domain errors".
- `src/tests/websocket/agentWork.binding.test.ts`: "does not let another principal or an anonymous connection dispose an owned session".
- `src/tests/persistence/adapters/postgres/repositories.test.ts`: "ensureSession rejects a projection owned by another principal as unauthorized".
- `src/tests/persistence/conformance.test.ts`: "runs the reusable contract suite against a non-SQL provider" (includes the memory unauthorized owner path).

## Immutable tool-schema behavior (invariants, not removal targets)

Catalogue contracts are cloned and deep-frozen (`freezeDeep` in `src/tools/helpers/contracts/helpers.ts`). Protocol comparison treats object key order as insignificant and array order as significant. A changed wire schema is a private rejection and does not mutate session state.

Current tests:

- `src/tests/tools/contracts.test.ts`: "does not let later mutation of the seed change the captured definition".
- `src/tests/tools/protocol.test.ts`: "treats reordered object keys as equal and changed values as different"; "treats array order as significant"; "does not let a mutated descriptor change the catalogue contract".
- `src/tests/tools/schema.test.ts`: "tool schema admission" (rejects non-object roots, unknown keywords, and `$ref` / pattern / format / `$async` / `$data` without fetching).
- `src/tests/websocket/toolInvocation.test.ts`: "rejects a wire-schema change privately even for an unsubscribed same-ID sender".

## Gate command (B01)

Child process: integration DB variables removed, then `pnpm validate` from the repo root. Exact chained script: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run docs:check && pnpm run build`.

Log: `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/P00-baseline.validate.log`.

| Step | Result |
| --- | --- |
| lint (`eslint . --max-warnings 0`) | passed (no findings; chain continued) |
| typecheck (`tsc --noEmit`) | passed (no findings; chain continued) |
| test (`vitest run` v5.0.5) | 52 files passed (52); 407 tests passed (407); 0 failed; no skipped count printed; duration 3.59s; start 21:51:20 |
| docs:check | passed, 116 source files |
| build (`vite build` v8.3.4) | passed, 102 modules, built in 104ms |
| `pnpm validate` | exit 0 |

No package install or upgrade. No second repair. No source fix. The Vitest note about `isolate: false` is reporter advice, not a failure.

## Preservation proof

- HEAD remains `22fa7955b8e43839e041228f647f26e00762ebbe`.
- Staged set remains empty. Tracked diff vs the pin remains empty, including `package.json`, `pnpm-lock.yaml`, and `database/migrations`.
- Pre-existing untracked `docs/plans/rbac&policies/` and `nul` were not discarded.
- Files added by this assignment are only the two execution artifacts named above.

## Blockers

None for B01/B03. B02 was not executed here.

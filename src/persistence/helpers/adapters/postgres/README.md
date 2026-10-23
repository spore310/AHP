# PostgreSQL adapter — persistence

The concrete PostgreSQL provider for the persistence ports. This adapter owns
every driver (`pg`), `Pool`, transaction, SQL, row-mapping, SQLSTATE and
pool-ownership mechanic for the persistence domain; neutral helpers and
consumers must not detect it (CORE_CONTRACT C03/C05).

Status: **connection + all repository modules** (P03–P05). The legacy neutral
repository files remain untouched until P08; `postgres/index.ts` and the
provider factory arrive with P06/P10. Canonical DDL lives in
[`database/migrations/`](../../../../../database/migrations/).

## Files

| File | Responsibility |
| ---- | -------------- |
| `index.ts` | Explicit PostgreSQL adapter boundary and provider factory export. |
| `helpers.ts` | `createPostgresPersistenceProvider`: builds the three repositories over one owned pool and disposes it once. |
| `types.ts` | Adapter-private `PostgresOptions` (pool options; default `max` 10, preserved from the legacy module), the narrow shared query capability `QueryableClient` (P04: lets repository helpers accept a real pool or a transaction client without unsafe casts), the raw `AgentRegistrationRow`/`SessionRow` row shapes, and the work additions from P05: raw `WorkRow` plus `PostgresWorkRepositoryOptions` (lease TTL option; default 60). |
| `helpers/connection/types.ts` | Adapter-private, pg-derived driver subsets: `Queryable`, `PoolClientLike`, `PoolLike`. Never re-exported through the neutral persistence root. |
| `helpers/connection/helpers.ts` | `createPostgresPool`, `withTransaction` (one acquired client; `BEGIN`/`COMMIT`, best-effort `ROLLBACK` that never masks the primary failure, unconditional release), `toIso`, and `databaseFailure` (SQLSTATE → owned `RepositoryError` mapping; state numbers adapter-private). |
| `helpers/connection/index.ts` | Public boundary of the connection module for sibling adapter helpers and adapter-focused tests. |
| `helpers/agentRegistrations/helpers.ts` | `createPostgresAgentRegistrationRepository`: the `agent_registrations` upsert `register` and `getById`, SQL/parameters/row mapping moved unchanged from the legacy neutral helpers (P04). |
| `helpers/agentRegistrations/index.ts` | Public boundary of the registration repository module. |
| `helpers/sessions/helpers.ts` | `createPostgresDurableSessionRepository` (`ensure` via `withTransaction`, `get`, `delete` incl. the SQLSTATE 23503 → conflict dependent-work special case) plus the exported transaction-local `ensureSession` primitive for the P05 work adapter; SQL/parameters/row mapping moved unchanged (P04). |
| `helpers/sessions/index.ts` | Public boundary of the session repository module; `ensureSession` is internal and imported from `./helpers` by P05. |
| `helpers/workItems/helpers.ts` | `createPostgresWorkRepository(pool, options)`: all nine `work_items` operations — `submit` (one transaction: internal `ensureSession` + idempotent insert + exact JSONB conflict lookup on the SAME client), atomic `claim` (SKIP LOCKED, token rotation, attempt increment), fenced `renew`/`complete`, locked `fail`/`cancel`, `get`, `reconcileExpired`, `hasDependentWork`; SQL/parameters/guards/row mapping moved unchanged from the legacy neutral helpers (P05). Options: `leaseTtlSeconds` (default 60). |
| `helpers/workItems/index.ts` | Public boundary of the work repository module. |

Known limitation (recorded as F-P00-2): `sessionTypeKey`/`sessionTypeVersion`
are NOT persisted — the `sessions` table stores `session_type_id` only — and
`sessionTypeId` does not round-trip through the port contract. No columns, DDL
or claims.


## Prohibitions while shared

- Internal imports use the shared leaf contracts `@persistence/types`, never
  the neutral root barrel.
- No forwarding shim from the legacy `helpers/pool.ts` into this adapter; the
  legacy module keeps its `pg` import until its callers move (temporary
  duplication of `PostgresOptions`/connection helpers is recorded in the P03
  handoff).
- SQLSTATE numbers must not leak into generic helpers or the public surface.

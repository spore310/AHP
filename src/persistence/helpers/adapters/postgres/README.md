# PostgreSQL persistence adapter

The PostgreSQL implementation of the shared persistence ports. This module
owns `pg`, pools, transactions, SQL, row mappings, database clocks, SQLSTATE
classification, and pool cleanup. Application/domain modules use the shared
contract and do not inspect this adapter.

## Files

| File | Responsibility |
| ---- | -------------- |
| `index.ts` | Explicit adapter exports, including the provider factory. |
| `helpers.ts` | Asynchronous provider construction over one pool; waits for pool cleanup if construction fails. |
| `types.ts` | Adapter options, driver query capabilities, and PostgreSQL row shapes. |
| `helpers/connection/types.ts` | Private `PoolLike`, `PoolClientLike`, and `Queryable` shapes for driver code and query doubles. |
| `helpers/connection/helpers.ts` | Pool creation, same-client transactions, timestamp conversion, and private SQLSTATE mapping. |
| `helpers/connection/index.ts` | Connection helper boundary for sibling adapter modules. |
| `helpers/agentRegistrations/helpers.ts` | Registration upsert/get SQL and row mapping. |
| `helpers/agentRegistrations/index.ts` | Registration repository boundary. |
| `helpers/sessions/helpers.ts` | Session projection ensure/get/delete, owner checks, and dependent-work classification. |
| `helpers/sessions/index.ts` | Session repository boundary; transaction-local `ensureSession` remains internal. |
| `helpers/workItems/helpers.ts` | Idempotent submission, atomic claims, fenced lease operations, reconciliation, and dependency checks. |
| `helpers/workItems/index.ts` | Work repository boundary. |

## Provider usage

`createPostgresPersistenceProvider({ connectionString, maxConnections?, leaseTtlSeconds? })`
returns a `Promise<PersistenceProvider>`. The configured adapter registry calls
it after validating its neutral selection options. The returned provider owns
one pool shared by registration, session, and work repositories; its
`dispose()` is idempotent and closes that pool once.

Pool and transaction types never cross the shared provider contract. SQLSTATE
codes and PostgreSQL row types remain private here. Canonical schema DDL stays
under [`database/migrations/`](../../../../../database/migrations/).

## Preserved behavior and limits

- `work.submit` runs session projection and idempotent work insertion in one
  transaction using the same acquired client.
- Claim and lease updates keep their SQL predicates, database clock
  (`statement_timestamp()`), token rotation, ownership guards, retry budget,
  and `FOR UPDATE ... SKIP LOCKED` behavior.
- A pool-construction failure after allocation awaits one cleanup attempt and
  rethrows the original construction error.
- The schema stores `session_type_id`; current mapping limitations for the
  optional session type fields are recorded in the shared
  [persistence README](../../../README.md#postgresql-behavior).
- Query doubles cover SQL behavior offline. No test here proves real database
  contention or transaction behavior; those cases require separate
  authorization and a dedicated database.

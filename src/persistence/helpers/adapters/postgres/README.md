# PostgreSQL persistence adapter

The PostgreSQL implementation of the shared persistence ports. This module
owns `pg`, pools, transactions, SQL, row mappings, database clocks, SQLSTATE
classification, and pool cleanup. Application/domain modules use the shared
contract and do not inspect this adapter.

## Files

| File | Responsibility |
| ---- | -------------- |
| `index.ts` | Explicit adapter exports, including the provider factory. |
| `helpers.ts` | Provider assembly, registration and work-read pool, and shared host ownership. |
| `types.ts` | Adapter options, driver query capabilities, and PostgreSQL row shapes. |
| `helpers/connection/types.ts` | Private `PoolLike`, `PoolClientLike`, and `Queryable` shapes for driver code and query doubles. |
| `helpers/connection/helpers.ts` | Pool creation, same-client transactions, timestamp conversion, and private SQLSTATE mapping. |
| `helpers/connection/index.ts` | Connection helper boundary for sibling adapter modules. |
| `helpers/ownership/index.ts` | Adapter-private ownership entry point. |
| `helpers/ownership/types.ts` | Acquired ownership, sequence checkpoint and transaction lock capability. |
| `helpers/ownership/helpers.ts` | Dedicated advisory-lock connection, takeover epoch and loss notification. |
| `helpers/resources/index.ts` | Durable storage factory. |
| `helpers/durableWork/helpers.ts` | Exact-instance work submissions, quota serialization, epoch-fenced data writes and atomic settlement. |
| `helpers/durableWork/rows.ts` | Internal work record and selectors, including microsecond timestamps. |
| `helpers/resources/types.ts` | Transaction and resource-row types. |
| `helpers/resources/helpers.ts` | Session/root reservation, fenced state writes, resource data CAS and recovery reads. |
| `helpers/resources/rows/helpers.ts` | Exact reference lookup, row mapping, bounded value capture and resource insertion. |
| `helpers/resources/retirement/helpers.ts` | Dependency-ordered retirement, anchored work cancellation and retention purge. |
| `helpers/agentRegistrations/helpers.ts` | Registration quota checks, upsert/get SQL, and row mapping. |
| `helpers/agentRegistrations/index.ts` | Registration repository boundary. |
| `helpers/sessions/helpers.ts` | Historical 0001 projection SQL exercised by driver-double tests. |
| `helpers/sessions/index.ts` | Historical projection helper exports. |
| `helpers/workItems/helpers.ts` | Historical 0002 work SQL exercised by driver-double tests. |
| `helpers/workItems/index.ts` | Historical work helper exports. |

## Provider usage

`createPostgresPersistenceProvider({ connectionString, maxConnections?, leaseTtlSeconds?, registrationLimits? })`
returns a `Promise<PersistenceProvider>`. The configured adapter registry calls
it after validating its neutral selection options. Pass the returned
`provider.durability` to the durable session host. Its registration port
uses the same captured epoch. Registration writes require an acquired host.
The host uses a dedicated ownership connection and a separate pool for durable
transactions. Both pools bound checkout at five seconds and apply PostgreSQL
statement and idle-in-transaction timeouts of 30 seconds. Provider disposal
drains and closes its resources.

Applications using durable sessions independently can construct
`createPostgresDurableStorage({ connectionString, maxConnections? })`.
Acquire it once per host with a stable store ID. Startup refuses a concurrent
owner or a different ID for an initialized namespace. A connection loss
closes admission and invokes the host's loss callback. A replacement owner
waits for transactions admitted under the prior epoch.

Pool and transaction types never cross the shared provider contract. SQLSTATE
codes and PostgreSQL row types remain private here. Canonical schema DDL stays
under [`database/migrations/`](../../../../../database/migrations/).

## Preserved behavior and limits

- `registrationLimits` sets `maxPerPrincipal` and `maxTotal` to positive safe
  integers. The defaults are 128 and 4,096. Registration checks both limits
  and writes on one transaction client under a table lock. The lock serializes
  registration writes and allows ordinary reads. Registration identity and per-principal quotas include the trusted domain. Lowering a limit preserves
  existing identities and their ability to re-register.
- The legacy provider namespaces reject URI-only projection methods, work submissions and
  lease commands. A work read requires the owner and trusted domain of an
  active session, joins its exact incarnation, and omits lease credentials.
  Its dependent-work lookup
  joins the current session incarnation and domain. The retirement repository
  fences nonterminal work under the session graph lock and retains terminal
  work until explicit purge.
- A pool-construction failure after allocation awaits one cleanup attempt and
  rethrows the original construction error.
- The acquired host exposes exact-instance work graph lookup, submission, data replacement and settlement. Submission serializes quota reservations on the host state row and writes work and selections atomically. Settlement checks the registration epoch, attempt, token and database deadline.
- Session rows join exact catalogue ID, key, version, provider and work manifest.
  State commits take the host checkpoint lock first. Ordinary resource data
  writers take shared session locks and compare the exact data revision.
  Lifecycle writers take an exclusive session lock before changing resources.
- The disposable PostgreSQL conformance runner exercises ownership takeover,
  deferred root checks, concurrent writers, anchored retirement and purge.
  [PostgreSQL setup and conformance](../../../../../docs/guides/postgresql.md)

# Persistence

Database-neutral repository contracts, facades, and provider selection for
durable agent registrations, session projections, and work items. The live
`SessionRegistry` remains synchronous and in memory. Concrete database and ORM
behavior belongs inside an adapter; the initial production adapter is
PostgreSQL.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Repository ports, plain DTOs, `PersistenceProvider`, and `RepositoryError`. |
| `index.ts` | Neutral public exports: ports, `createPersistence`, portable-text helpers, and `RepositoryError`. |
| `helpers/provider/` | Composes repository facades under one lifecycle and disposer. |
| `helpers/lifecycle/` | Shared operation admission, draining, safe error normalization, and terminal disposal. |
| `helpers/agentRegistrations.ts` | Neutral facade for registration operations. |
| `helpers/sessions.ts` | Neutral facade for durable session operations. |
| `helpers/workItems.ts` | Neutral facade for atomic work repository operations. |
| `helpers/text.ts` | Portable-text profile v1 predicates for interoperable strings and object trees. |
| `helpers/adapters/` | Static allowlist and lazy adapter selection. |
| `helpers/adapters/types.ts` | Neutral provider-selection input contract. |
| `helpers/adapters/helpers.ts` | Allowlisted lazy provider loader. |
| `helpers/adapters/index.ts` | Explicit selection API export. |
| `helpers/adapters/postgres/` | PostgreSQL pool, SQL, transactions, row mapping, driver errors, and owned provider. |
| `helpers/lifecycle/types.ts` | Private operation-scope contract. |
| `helpers/lifecycle/helpers.ts` | Operation admission, tracking, normalization, and disposal implementation. |
| `helpers/lifecycle/index.ts` | Internal lifecycle exports. |
| `helpers/provider/helpers.ts` | Managed provider composition. |
| `helpers/provider/index.ts` | `createPersistence` export. |

## Provider contract

`PersistenceProvider` exposes `registrations`, `sessions`, `work`, and one
`dispose()` method. It contains no query, connection, transaction, ORM, or
vendor fields. All three repositories in a provider share one logical store and
ownership scope.

`createPersistence(provider)` returns managed repository facades. Each call
passes one repository operation through the shared lifecycle; it does not split
or retry atomic operations. Disposal closes admission synchronously, waits for
admitted calls to settle, and calls provider cleanup once. A cleanup failure is
cached and does not reopen the facade. Hung operations have no forced timeout.

Work submission owns its atomic unit. `work.submit(input)` inserts/ensures the
session projection and the work row within the adapter's one coherent operation.
Callers must not replace that operation with separate session and work writes.

## Selecting an adapter

The process composition root imports
`createConfiguredPersistenceProvider` from
`@persistence/helpers/adapters`. The registry contains a static allowlist,
defaults an omitted selector to `postgres` only when the durable feature is
enabled, rejects unknown names, and imports the selected adapter lazily.
Adapter-specific options are validated before the adapter allocates resources.
The environment selector is an optional string and does not define provider
names.

To add another provider, implement the shared contracts and add an explicit
allowlisted loader. A fake provider demonstrates contract substitution only; it
does not establish that another database is supported in production.

## Portable-text profile v1

`isPortableText(text)` rejects U+0000 and unpaired UTF-16 surrogates while
accepting valid surrogate pairs. `hasPortableTextTree(value, depth)` applies the
same rule to string values and object keys, rejecting when `depth > 512`.
This is an application interoperability policy so stores receive the same
accepted work payloads. JSON can represent escaped NUL; this is not a universal
JSON restriction or a complete JSON, schema, authorization, or object-safety
check. Existing shape, serialization, byte-size, UUID, request-key, and
allowed-kind checks remain with their callers.

## PostgreSQL behavior

The explicit adapter entrypoint is
`@persistence/helpers/adapters/postgres`. It owns one pool for all repository
constructors and releases it once. Work SQL keeps the database clock,
transaction-client affinity, atomic `SKIP LOCKED` claims, lease-token rotation,
owner checks, and fenced updates inside adapter operations. SQLSTATE mapping
and row normalization stay private to that adapter.

The PostgreSQL schema stores `session_type_id`, but the existing row mapping
does not round-trip that ID, and `sessionTypeKey` / `sessionTypeVersion` are not
persisted. No schema change is part of this refactor. Live session state is not
restored automatically after restart.

## Testing and evidence

Unit tests exercise the neutral contracts/facades with an independent in-memory
provider. PostgreSQL query doubles cover parameters, mappings, transactions,
rollback/release, SQLSTATE handling, and query predicates. They do not prove
database locking or clock behavior. Real PostgreSQL contention, rollback, and
expiry acceptance remains **BLOCKED / NOT RUN**; no database was provisioned,
migrated, or queried for this work.

| Test | Pins |
| ---- | ---- |
| [`src/tests/persistence/contracts.test.ts`](../tests/persistence/contracts.test.ts) | Provider shape and neutral contract constraints. |
| [`src/tests/persistence/facade.test.ts`](../tests/persistence/facade.test.ts) | Exact delegation, receiver preservation, shared draining, and no driver evaluation. |
| [`src/tests/persistence/conformance.test.ts`](../tests/persistence/conformance.test.ts) | Provider substitution, sentinels, idempotency, leases, and instance isolation. |
| [`src/tests/persistence/adapters/postgres/`](../tests/persistence/adapters/postgres/) | Offline PostgreSQL query-double coverage; no live connection. |

The explicit real-database conformance runner is
[`src/tests/persistence/adapters/postgres/conformance.ts`](../tests/persistence/adapters/postgres/conformance.ts).
It requires an authorized, separately prepared test database and is not run by
the ordinary test suite.

## Related Documentation

- [`env/README.md`](../../env/README.md) — validated provider selection inputs.
- [`src/work/README.md`](../work/README.md) — authorization and work-service policy.
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) — capability ownership and composition.

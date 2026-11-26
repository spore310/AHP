# Persistence

Database-neutral repository contracts, facades, and provider selection for
agent registrations, durable session incarnations, canonical resources and work.
A host configured for durability publishes live state after a successful commit.
PostgreSQL implements the production storage adapter.

## Files

| File | Responsibility |
| ---- | -------------- |
| `helpers/durability/types.ts` | Exact session/resource records, data CAS, lifecycle operations, host lease, membership claim and the `HostCoordination` port. |
| `helpers/durability/workTypes.ts` | Work intent, internal records, lease fences and the owned repository. |
| `helpers/durability/workPages.ts` | Ordered per-session work keys and bounded finite pages in memory. One index per store, shared by every host that acquires it. |
| `helpers/durability/workFences.ts` | Synchronous readers tied to the acquired host, exact session lifecycle and work revision. |
| `helpers/durability/workEvents.ts` | Publishes confirmed work revisions after invalidation, including lease expiry and retirement cancellation. |
| `helpers/durability/workIntent.ts` | Canonical work capture and structural replay equality. |
| `helpers/durability/memoryWork.ts` | Work admission, quotas, data CAS and settlement over the same records used for retirement. |
| `helpers/durability/memoryScheduling.ts` | In-memory candidate ordering, identity-wide capacity, lease renewal and bounded exhaustion. |
| `helpers/durability/scheduling.ts` | Shared preparation bounds and synchronous admission against exact, detached session and work records. |
| `helpers/durability/helpers.ts` | Bounded data capture, resource identities and graph order. |
| `helpers/durability/memory.ts` | In-memory lifetime, revisions and retirement transactions, with the same membership, per-session ownership, revocation and sequence transitions as the PostgreSQL adapter. |
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

## Durable host storage

Pass `provider.durability` and a stable logical `hostId` to the protected session factory. The PostgreSQL provider shares its acquired host fence with registration writes. Migration 0003 requires empty legacy identities, registrations and work. Every mutation owns its transaction. The host holds its ownership connection through shutdown. A separate host can take over after release or connection loss. `createMemoryDurableStorage()` keeps state for the lifetime of the storage object and supports deterministic host restarts in one process.

The session/root reservation and retirement transitions are atomic. Resource data uses full-object CAS and independent decimal revisions. Terminal work remains scoped to its original incarnation through retirement. Explicit purge with a retention cutoff deletes eligible history in bounded batches. Applications monitor retained disk usage and choose a cutoff appropriate to their retention policy.

Both adapters retain the exact type ID, key, version, provider and serializable work manifest after session purge and host reacquisition. A changed work manifest requires a new type version and ID. Reserving a resource or changing its lifecycle advances the owning session's graph revision, including when a grant parent's lifecycle changes. Repeating the same lifecycle preserves the graph revision.

## Provider contract

`PersistenceProvider` exposes `registrations`, `sessions`, `work`, optional
`durability`, and one `dispose()` method. Its repositories share a logical store
and ownership scope. An acquired `DurableHost` provides session, resource and
work operations over one store. Its `work` port submits immutable intent,
replaces data by revision and settles an exact lease. The provider-level legacy
ports reject URI-only session and work mutations.

`createPersistence(provider)` returns managed repository facades. Each call
passes one repository operation through the shared lifecycle; it does not split
or retry atomic operations. Disposal closes admission synchronously, waits for
admitted calls to settle, and calls provider cleanup once. A cleanup failure is
cached and does not reopen the facade. Hung operations have no forced timeout.

The legacy work test contract owns its atomic unit. Its `work.submit(input)` inserts/ensures the
session projection and the work row within the adapter's one coherent operation.
Callers must not replace that operation with separate session and work writes.
An idempotent replay compares the immutable JSON value: object key order is
irrelevant, while array order remains significant.

## Registration quotas

The registration repository resolves one durable identity for each trusted domain,
principal and agent key. Providers used with registration quotas enforce them during
`register`. The PostgreSQL provider defaults to 128 per principal and 4,096
total. Existing keys retain their IDs and allow display-name updates at
capacity. A new key above quota returns a repository conflict. Use consistent
limits across instances that write to the same database.

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

The PostgreSQL provider owns a pool for registration operations and work reads. Each acquired
host retains a dedicated advisory-lock connection and a separate pool for session
and resource transactions, canonical work reads and work writes. Both pools allow five seconds for checkout and
configure PostgreSQL to terminate a statement or an idle transaction after
30 seconds. Registration writes check the current ownership epoch before their
quota check and upsert. [PostgreSQL adapter](helpers/adapters/postgres/README.md)

Migration 0003 ties each session incarnation to its persisted catalogue ID, key,
version and provider. Startup of a protected durable host loads recoverable records,
matches the registered provider and type, and requires fresh restoration approval
before publishing live state. Work reads select the active incarnation by trusted
domain and owner and omit lease credentials. Retirement fences nonterminal work
and retains terminal rows until purge. [Session recovery](../sessions/README.md)

## Testing and evidence

Routine tests exercise the advanced example provider, the historical URI-only
work fixture, and PostgreSQL query doubles. The opt-in PostgreSQL 17 runner
exercises migrations 0003 and 0004, ownership takeover, blocked registration shutdown,
concurrent resource writes, exact-instance retirement, purge, public host recovery,
deferred positive-scope constraints, replay at full quota and atomic fenced settlement.
Two independent pools exercise claims, renewal, registration epochs and capacity
across sessions. The same scheduling contract runs against the in-memory repository.
Durable admission and requeue support up to 128 exact selectors per set. The
work service applies its configured selector budget at the request boundary.

| Test | Pins |
| ---- | ---- |
| [`src/tests/persistence/contracts.test.ts`](../tests/persistence/contracts.test.ts) | Provider shape and neutral contract constraints. |
| [`src/tests/persistence/facade.test.ts`](../tests/persistence/facade.test.ts) | Exact delegation, receiver preservation, shared draining, and no driver evaluation. |
| [`src/tests/persistence/conformance.test.ts`](../tests/persistence/conformance.test.ts) | Example provider durability and closed mutations, historical work fixture and provider substitution. |
| [`src/tests/persistence/scheduling.test.ts`](../tests/persistence/scheduling.test.ts) | Bound capacity, exact lease attempts, stale epochs and bounded expiry against the memory repository. |
| [`src/tests/persistence/conformance/workPages.ts`](../tests/persistence/conformance/workPages.ts) | Finite sweeps, denied-row continuations and cursor lifetimes on both stores. |
| [`src/tests/persistence/adapters/postgres/`](../tests/persistence/adapters/postgres/) | Driver-double unit tests and opt-in PostgreSQL 17 conformance. |

The explicit real-database conformance runner is
[`src/tests/persistence/adapters/postgres/conformance.ts`](../tests/persistence/adapters/postgres/conformance.ts).
The [PostgreSQL guide](../../docs/guides/postgresql.md) shows how to run it
against a dedicated local database with the migrations already applied.

## Related Documentation

- [`env/README.md`](../../env/README.md) — validated provider selection inputs.
- [`src/work/README.md`](../work/README.md) — authorization and work-service policy.
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) — capability ownership and composition.

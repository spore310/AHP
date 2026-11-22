# Frozen design contract — persistence portability

**Design revision:** R2. **Status:** proposed target, not implemented.
**Source:** `agentIdentity` at `f2804963129403e666a6e929db92beb9b2ab761d`.
Every implementation packet consumes this contract. An agent may not silently
change it to make a packet easier. Record a contract change, assess dependents,
and invalidate affected evidence before proceeding.

## C01 — Preserve the existing repository language

`src/persistence/types.ts` remains the source of truth for public record types,
repository interfaces, and `RepositoryError`. Retain `WorkStatus`, the current
optional properties, and all current operation signatures. Retain the different
absence sentinels: registration/session lookups use `undefined`; work lookups
and unsuccessful claims use `null`; unsuccessful fenced completion uses `false`.
Do not homogenize these returns during this refactor.

Keep these operation sets:

| Namespace | Existing contract | Operations |
| --- | --- | --- |
| `registrations` | `AgentRegistrationRepository` | `register`, `getById` |
| `sessions` | `DurableSessionRepository` | `ensure`, `get`, `delete` |
| `work` | `WorkRepository` | `submit`, `claim`, `renew`, `complete`, `fail`, `cancel`, `get`, `reconcileExpired`, `hasDependentWork` |

The returned object looks ORM-like because repositories are grouped by domain.
It is **not** a new ORM or a lowest-common-denominator CRUD abstraction.
`work.claim` stays a semantic, atomic operation; it is never reconstructed from
`findFirst` followed by `update` in generic code.

## C02 — One shared provider shape

Add this shape alongside the existing interfaces in `src/persistence/types.ts`:

```ts
export interface PersistenceRepositories {
  readonly registrations: AgentRegistrationRepository;
  readonly sessions: DurableSessionRepository;
  readonly work: WorkRepository;
}

/** A complete, owned persistence backend with one disposal boundary. */
export interface PersistenceProvider extends PersistenceRepositories {
  dispose(): Promise<void>;
}
```

Use this same shape for the adapter output and the managed public facade. Do not
invent a second copy of all repository method declarations, a generic table
schema type, or two structurally identical driver/client interfaces.

Proposed public function:

```ts
// ./src/persistence/helpers/provider/helpers.ts
export function createPersistence(
  provider: PersistenceProvider,
): PersistenceProvider;
```

The declaration above is a target signature, not a complete implementation.
`createPersistence` constructs the neutral facades and a shared lifecycle scope.
Adapters provide storage behavior. Generic helpers consume repository contracts.
All three adapter repositories must belong to the same logical store and ownership
scope; combining registrations from one database with work from another is not a
supported provider implementation.

“Provider” here means a persistence backend. It is not `SessionProvider`, an
agent registration, a model provider, or an AHP protocol provider identity.

## C03 — Public boundary and dependencies

`src/persistence/index.ts` exports interfaces, owned errors, portable validation,
and `createPersistence`. Implementation code stays in helpers, following
`docs/CodingRules.md`; the index does not become an implementation file.

The neutral root must not re-export concrete adapters, import their registry, or
transitively evaluate `pg`. Existing `createPostgres*` exports leave the root in P10, atomically with the
entrypoint migration. During P08–P09 only, the existing export names may forward
to their relocated adapter functions to keep the intermediate tree typecheckable.
This is temporary migration debt, not an accepted final boundary.
Update every repository-owned consumer in this task. This is a documented source
API migration, not a claim of external-package backward compatibility.

Only the executable composition root may import the adapter-selection entrypoint:

```ts
import { createPersistence } from '@persistence';
import { createConfiguredPersistenceProvider }
  from '@persistence/helpers/adapters';
```

Internal persistence helpers and adapters import shared types/errors from the
leaf `@persistence/types` (or a direct relative types path), not their own root
barrel. This prevents parent-barrel cycles, including during the temporary export
transition. External consumers prefer the neutral root public API.

All other production consumers use neutral public contracts. A specific adapter
may also be imported through its explicit entrypoint by a deliberate embedding
application or adapter-specific tests. Do not add those imports to `@agents`,
`@work`, `@sessions`, the AHP handlers, or generic persistence helpers.

The exception is **selection**, not a license for SQL outside adapters. The
composition root passes an opaque selection configuration and consumes the common
result. It must contain no `Pool`, `.query`, `.end`, `createPostgres*`, SQLSTATE,
PostgreSQL SQL, raw ORM entity, or vendor-specific branch.

## C04 — Target source organization

```text
src/persistence/
├── README.md
├── types.ts                    # existing ports + PersistenceProvider
├── index.ts                    # neutral public exports only
└── helpers/
    ├── agentRegistrations.ts   # generic facade over registrations port
    ├── sessions.ts             # generic facade over sessions port
    ├── workItems.ts            # generic facade over work port
    ├── text.ts                 # portable text/tree predicates, no JSONB vocabulary
    ├── provider/
    │   ├── index.ts
    │   └── helpers.ts          # createPersistence; wires one operation scope
    ├── lifecycle/
    │   ├── index.ts
    │   ├── types.ts            # private operation-scope contract
    │   └── helpers.ts          # admission, drain, disposal, safe error boundary
    └── adapters/
        ├── index.ts            # exports lazy configured-provider loader
        ├── types.ts            # opaque selection envelope
        ├── helpers.ts          # static allowlist of lazy loaders
        └── postgres/
            ├── README.md
            ├── index.ts        # explicit createPostgresPersistenceProvider export
            ├── types.ts        # Postgres options and adapter-private types
            ├── helpers.ts      # owns pool; builds one complete provider
            └── helpers/
                ├── connection/
                │   ├── index.ts
                │   ├── types.ts
                │   └── helpers.ts  # Pool, Queryable, transaction, mapping helpers
                ├── agentRegistrations/
                │   ├── index.ts
                │   └── helpers.ts
                ├── sessions/
                │   ├── index.ts
                │   └── helpers.ts  # includes transaction-local ensureSession
                └── workItems/
                    ├── index.ts
                    └── helpers.ts
```

Keep established neutral facade filenames to minimize consumer churn. New nested
modules use the repository's index/types/helpers pattern. Adapter-private row
interfaces may live in `postgres/types.ts`; split only when that improves actual
ownership. Do not create empty SQLite/Prisma/Drizzle/MongoDB folders.

`helpers/pool.ts` is moved, then removed from the neutral area. A pool is not a
universal persistence concept; do not replace it with a misleading generic pool.
Every *remaining* neutral helper consumes common contracts or implements neutral
policy. No final compatibility forwarding file outside adapters may import `pg`.
The temporary root forwards just described must be deleted in P10.

## C05 — Adapter-owned atomic units

The PostgreSQL adapter retains all driver calls, row mappings, SQL, transactions,
constraint interpretation, SQLSTATE decoding, connection release, and DB-clock
lease decisions. Another adapter may use an ORM, conditional writes, or different
locking, but must implement the same repository semantics.

### Work submission

`provider.work.submit(input)` is one transactionally coherent operation: ensure
its session projection and insert/resolve the idempotent work item. PostgreSQL
must call its internal `ensureSession(transactionClient, input.session)` on the
**same** client used by the work insert and conflict lookup. Never implement:

```ts
// FORBIDDEN: two independently committed repository calls.
await persistence.sessions.ensure(input.session);
return persistence.work.submit(input);
```

The public session facade is not used inside the adapter's transaction. Internal
helper sharing inside the adapter is intentional and necessary.

### Claims and settlement

Keep claim/reclaim predicates, ordering, target-agent restriction, enabled-agent
and owner checks, retry budget, token rotation, and attempt increment together.
Preserve `FOR UPDATE OF w SKIP LOCKED` for this PostgreSQL adapter. No generic
JavaScript lock or process-local flag substitutes for database concurrency.

Renew/complete/fail must preserve the current owner, agent, token, status, and
expiry checks at their current transactional evaluation points. Preserve fail
and cancel locking paths. Do not promise a stronger linearization instant than
the current SQL actually provides, or change that timing as part of a move.

A lease is authoritative only while the repository accepts its fencing
conditions. Completion fencing does not stop an already running process and does
not make side effects exactly-once. No automatic write retry is added by facades.

## C06 — Neutral operation lifecycle

The common facade has a real responsibility beyond renaming methods:

1. One synchronous admission boundary shared by all repository namespaces.
2. Track admitted async operations and contain synchronous adapter throws.
3. Normalize unexpected adapter exceptions into a sanitized owned error.
4. Dispose once, after admitted operations settle; reject subsequent operations.

Internal target (keep private, not part of provider SDK):

```ts
interface PersistenceOperationScope {
  run<T>(operation: () => Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}
```

`dispose()` changes `open -> closing` synchronously and returns one cached promise.
While closing/closed, `run` rejects with a sanitized `RepositoryError('database',
'Persistence is closed.')` and never invokes the adapter. Existing operation
results/errors still settle to their original callers. Use all-settled draining;
a rejected query must not prevent adapter cleanup. Prior operation failure alone
does not make disposal fail again. Cleanup failure does reject the cached promise.
After a failed cleanup, the facade still stays closed and never retries cleanup
implicitly. Preserve the same promise settlement for repeated calls.

Do not use an untracked `finally()` promise that can generate an unhandled
rejection. Do not parallel-close repositories that share the same pool. The
adapter owns that pool and disposes it once. This drain is not a cancellation or
bounded-shutdown guarantee; hung operations remain a documented limitation.

Facade delegates must preserve method receivers (`driver.claim(input)`, not an
unbound extraction of `claim`). They call each atomic adapter operation once.
The raw adapter is not handed to domain services; only managed repositories are.

## C07 — Portable data policy, not disguised PostgreSQL checks

Current `isJsonbSafeText`/`isJsonbSafe` imports appear in domain and wire code.
Replace them with a deliberately owned **portable-text profile v1**:

- `isPortableText(text)` rejects U+0000 and unpaired UTF-16 surrogates; valid
  surrogate pairs remain accepted.
- `hasPortableTextTree(value, depth = 0)` checks string values and object keys
  under the existing inclusive depth budget: reject when `depth > 512`.
- Keep the existing callers' object-shape, JSON serialization, byte-size, UUID,
  request-key, and allowed-kind checks. The tree predicate is **not** a complete
  JSON parser, schema validator, authorization check, or arbitrary-object sanitizer.
- Preserve valid-wire behavior and existing invalid-input test outcomes. Do not
  silently introduce a stricter plain-object/NaN/accessor policy in this move.
- Replace storage-branded error wording with neutral wording, keeping existing
  public error codes and failure categories. Document text-message changes.

This restriction is an application interoperability choice. JSON itself can
represent escaped NUL; do not claim the restriction is a universal JSON rule or
necessary for every database. The same boundary policy applies to all adapters,
so switching stores does not silently broaden accepted work payloads. A later
policy revision can widen it deliberately.

Keep implementation pure, deterministic, and database/ORM free. The PostgreSQL
adapter retains any *additional* database-specific validation or encoding. Never
rename a PostgreSQL query wrapper to make it appear portable.

## C08 — Errors and plain data

Retain the four `RepositoryErrorCode` values: `conflict`, `not_found`,
`unauthorized`, `database`. SQLSTATE mapping belongs inside PostgreSQL only.
Domain services continue translating owned repository errors into domain/wire
failures; do not move authorization policy to the generic facade.

Facades preserve recognized error codes and sanitize unexpected errors. Define
canonical safe messages for facade-normalized failures; do not forward arbitrary
SQL text, credentials, original driver exceptions, or stack traces. Do not trust
plain thrown objects solely because they contain a `code` property. Keep one
`RepositoryError` runtime class identity by avoiding duplicated error modules.

Adapters return existing plain DTOs: ISO timestamp strings, ordinary strings and
numbers, plain JSON payloads, existing status values and absence sentinels. Raw
`Pool`, query result objects, ORM model instances, native transactions, driver
`Date` values, driver errors, decimal wrappers, or `bigint` must not cross this
boundary. `lastServerSeq` remains the existing `number`; do not silently change
its representation or claim support beyond the JS safe integer range.

Preserve existing mapping behavior on the characterized input range. Record
pre-existing mapping issues (including optional type-key/version fields that the
current SQL does not round-trip) separately; do not manufacture columns or silently
claim full support for those optional fields.

## C09 — Configuration and lazy selection

Add an optional neutral `AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER` string to
`env/types.ts`. Do not put a PostgreSQL enum or default there. Preserve the existing
DATABASE_URL, AUTH_TOKENS, lease TTL, presence TTL, and allowed-kind variables.

Adapter selection is inside `helpers/adapters/`:

```ts
// ./src/persistence/helpers/adapters/types.ts
export interface PersistenceSelection {
  readonly provider?: string;
  readonly options: Readonly<Record<string, unknown>>;
}
// target signature; loader body is in helpers.ts
export function createConfiguredPersistenceProvider(
  selection: PersistenceSelection,
): Promise<PersistenceProvider>;
```

A static allowlisted loader map resolves an omitted name to `postgres` for
compatibility. PostgreSQL uses a lazy `import('./postgres')` selected only on
activation, then validates options before acquiring a pool. No user-controlled
module path, `eval`, auto-installation, or arbitrary dynamic import. An explicit
unknown name is an error, never a fallback. No installed ORM is required by the
neutral module.

For the initial PostgreSQL adapter, the selection options are `url`,
`workLeaseSeconds`, and optionally `maxConnections`; the adapter translates these
into its own pool and repository options. Future adapters parse their own options.
The environment loader does not acquire resources or resolve database URLs.

## C10 — Ownership at process composition

`createAgentWorkOptions` becomes async because selecting an adapter is lazy.
`main` awaits it. Keep the returned `AHPServerAgentWorkOptions` shape unchanged:

```ts
const provider = await createConfiguredPersistenceProvider({
  provider: config.AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER,
  options: {
    url: databaseUrl,
    workLeaseSeconds: config.AGENT_HOSTING_PROTOCOL_WORK_LEASE_SECONDS,
  },
});
const persistence = createPersistence(provider);
return {
  authenticator,
  registrations: persistence.registrations,
  work: persistence.work,
  allowedKinds,
  presenceTtlMs,
  dispose: () => persistence.dispose(),
};
```

This is an excerpt: retain existing validated setup and add ownership-aware
failure cleanup around it. Parse token/kind configuration and create the
credential adapter before acquiring persistence. If facade/composition construction
fails after acquisition, release what was acquired and preserve a sanitized
primary failure. Once successfully handed to the host, the host owns the supplied
dispose hook. Do not also call pool.end from the entrypoint.

Configuration truth table:

| URL | Tokens | Provider name | Outcome |
| --- | --- | --- | --- |
| absent | absent | absent | Baseline host; no loader call or pg import |
| absent | absent | supplied | Configuration error, not implicit activation |
| one present | other absent | any | Configuration error before allocation |
| present | present | absent | Adapter registry selects existing postgres default |
| present | present | supported | Select named adapter |
| present | present | unsupported | Fail before allocation; no fallback |

The new `sessions` repository is exposed by the shared persistence object, but
is not automatically attached to live `SessionRegistry`. Keep the current work
submission projection path; no restore-on-start or new persistence of live state.

## C11 — Preserve domain and wire behavior

Do not change any `x-ahp/agents/*`, `x-ahp/work/*`, or `x-ahp/tools/*` names or v1
payload shapes. Keep authenticated-principal derivation, connection/generation
checks, same-principal ownership policy, session-attach hooks, settling-disposal
guards, work-view token redaction, and the difference between presence TTL and
work TTL. Keep source-independent fake repositories usable in existing tests.

`@work` uses `WorkRepository`; `@agents` uses `AgentRegistrationRepository`;
`createAHPServer` consumes its existing repository ports. They must not receive
adapter names or branch on engine/ORM type. Imports should use `@persistence`
where practical, and no deep adapter imports are allowed in these modules.

## C12 — Evidence, not portability by declaration

A second production database is not in scope. Prove the neutral boundary with
an independently constructed fake provider and existing composed host/service
tests. That establishes contract substitution, not real database compatibility.

Keep PostgreSQL-specific tests for SQL parameters, transaction-client affinity,
rollback/release, row normalization, errors, and query parity. Provide a reusable
repository conformance harness whose scenarios can run against an authorized
real adapter. No fake or mocked SQL runner proves row-lock behavior.

Do not provision/query a real database or apply migrations without separate
explicit authorization. If unavailable, mark real-PostgreSQL acceptance
`BLOCKED / NOT RUN`, separately from unit-test and `pnpm validate` results.
Canonical DDL stays byte-for-byte unchanged in `database/migrations/`.

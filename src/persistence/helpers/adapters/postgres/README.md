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
| `helpers/ownership/types.ts` | Acquired ownership, sequence checkpoint, transaction fence, authority revision and event subscription. |
| `helpers/ownership/helpers.ts` | Namespace join, membership lease and heartbeat, per-host advisory lease, takeover epoch, standby wait, loss notification and the durable event reader. |
| `helpers/coordination/index.ts` | Coordination entry point. |
| `helpers/coordination/helpers.ts` | Member listing, session location, transfer, adoption, namespace revocation and shared sequence allocation. |
| `helpers/resources/index.ts` | Durable storage factory. |
| `helpers/durableWork/helpers.ts` | Exact-instance work submissions, quota serialization, epoch-fenced data writes and atomic settlement. |
| `helpers/durableWork/rows.ts` | Internal work records, selector hydration, lease samples and exact-session work pages with microsecond timestamp/UUID keys. |
| `helpers/durableWork/scheduling.ts` | Keyset candidate scans, registration-wide capacity, locked claim and renewal admission, and bounded expiry. |
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
statement and idle-in-transaction timeouts of 30 seconds. A failed rollback
discards its client and preserves the original transaction error. Provider disposal
drains and closes its resources.

Applications using durable sessions independently can construct
`createPostgresDurableStorage({ connectionString, maxConnections?, schema? })`.
Acquire it once per host with a stable store ID. Startup refuses a concurrent
owner of the same host ID, and a different ID in an exclusive store. A
connection loss closes admission and invokes the host's loss callback. A
replacement owner waits for transactions admitted under the prior epoch.

## Host coordination

Migration `0005_host_coordination` adds namespace binding, membership, a lease
per logical host, per-session ownership and a durable event table.

- `schema` selects the PostgreSQL schema that holds one namespace's store. It
  is validated as a lowercase identifier and comes from trusted configuration.
- `acquire(hostId, onLost, claim?)` joins the namespace as one instance, then
  takes that host's lease. Without a claim the store must be exclusive.
- A join checks the namespace binding, the store mode, the policy revision and
  digest, duplicate instances and the instance limit in one transaction.
- The lease is a session-level advisory lock keyed by the host's `lease_slot`.
  Activation advances `ownership_epoch` after prior admitted transactions end.
- Membership liveness uses the database clock. The owner renews at one third
  of the lease. A row that expired, a superseded policy revision, or a local
  renew deadline closes admission and reports loss.
- Every fenced transaction locks its host row at the acquired epoch, takes a
  share lock on the namespace row, and fails while an unacknowledged
  revocation exists. A revocation updates that row, so it waits for
  transactions that were already admitted.
- A locked session read admits only the owning host. `sessions_owner_fence`
  rejects any other write to a session row, including direct SQL.
- `transfer` moves one session under its exclusive row lock. `adopt` requires
  the previous owner's lease to be free and its membership expired, advances
  that owner's epoch, then moves only sessions whose provider the adopter
  declares.
- Locks are taken in one order: the caller's host row, the namespace row,
  the session row, the registration row, work rows. A revocation takes the
  host row and then the namespace row exclusively. Competing transfer,
  retirement and revocation therefore queue and do not deadlock.
- Adoption never waits on another host's row. It tests the previous owner's
  lease without waiting and locks that owner's row with `NOWAIT`. If anything
  still holds the row the adoption is refused and tried again later, so a
  transaction a dead owner left open cannot stall the adopter's own writes.
- A bound namespace row cannot be renamed, truncated or inserted directly,
  and cannot be deleted while the store has unretired sessions, queued or
  leased work, or live members. `ahp_recreate_namespace` binds an emptied
  store again and invalidates every earlier epoch and membership. These
  guards act on their own schema whatever the caller's `search_path` is. A
  deletion and a recreation take the join lock before the namespace row, in
  the same order as a joining host, and are refused outside read committed.
- Statements on the retained ownership connection (heartbeat, event reads,
  pruning, role changes) are queued in the adapter, one at a time. Once
  ownership has ended, only the statements that end it are still issued.
- Shared stores allocate native sequence values from `host_server_seq`.
- `host_events` rows are written in the transaction they describe. Work rows
  record theirs through a trigger. Readers advance by transaction id below
  the snapshot horizon, so a lower identifier that commits late is not
  skipped. `LISTEN` is a wakeup; polling every `eventPollMs` is the fallback.
  More than 512 pending rows, or retention past the reader's position,
  delivers a reset. Each host removes events older than `eventRetentionMs`
  (15 minutes by default) and records how far it pruned.

A pre-0005 binary cannot acquire a migrated store: `host_state_guard` refuses
its acquisition statement. Apply the migration only after stopping every
existing host; it refuses to run while one holds the store.

Each host uses one retained ownership connection plus its transaction pool.
The registration and work-read pool is separate. Budget
`hosts x (1 + maxConnections) + registration pool` connections.

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
- Claim and renewal lock the host, session, its canonical rows in primary-key order, and the requesting registration. A separate READ COMMITTED statement counts active leases across all sessions and epochs for that registration. Claim checks prepared revisions and locks one eligible row with `SKIP LOCKED`. Renewal checks the database clock after acquiring its work lock and again in its update. Each expiry batch locks up to 32 exhausted leases in the requested session.
- Policy preparation reads the lease deadline and database time in a single nonlocking statement for the expected session and work revision. This lets a worker claim a lower-priority item while another transaction holds an expired higher-priority item.
- A list sweep reads its upper creation-time/UUID key from the session list index. Subsequent queries start strictly after the last examined key and include the upper key. Projection reads lock and reconcile a visible row's revision before delivery. [Live paging proofs](../../../../tests/persistence/adapters/postgres/p4Views.ts)
- Session rows join exact catalogue ID, key, version, provider and work manifest.
  State commits take the host checkpoint lock first. Ordinary resource data
  writers take shared session locks and compare the exact data revision.
  Lifecycle writers take an exclusive session lock before changing resources.
- The disposable PostgreSQL conformance runner exercises ownership takeover,
  deferred root checks, concurrent writers, anchored retirement and purge.
  [PostgreSQL setup and conformance](../../../../../docs/guides/postgresql.md)

## Scheduling measurements

The disposable PostgreSQL 17 gate loads 12,000 queued, leased and terminal work
items across two sessions, then runs `ANALYZE` and `EXPLAIN (ANALYZE, BUFFERS)`.
The table records a warm local run of 32 queries per operation with concurrency
four. Four clients returned idle with zero waiting. The candidate query includes
hydration of work rows and their resource selections. [Performance fixture](../../../../tests/persistence/adapters/postgres/p3Performance.ts)

| Operation | Scheduling indexes used | Shared hits / reads | Explain execution (ms) | Client p50 / p95 (ms) |
| --- | --- | --- | --- | --- |
| Candidate scan | `work_items_queued_priority_idx`, `work_items_expired_claim_idx` | 626 / 0 | 1.236 | 3.260 / 14.469 |
| Active capacity | `work_items_active_agent_idx` | 174 / 0 | 0.110 | 0.719 / 0.830 |
| Expiry batch | `work_items_expired_claim_idx` | 340 / 0 | 0.250 | 1.013 / 2.956 |

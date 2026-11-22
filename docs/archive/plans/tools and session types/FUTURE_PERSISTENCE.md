# Persistence Phase — Handoff Only, Not Part of This Goal

## Explicit phase boundary

This code-first task ends with working in-memory definitions, manifests, typed sessions, and protocol integration. It may prove JSON round-tripping of portable definitions; it must not implement session recovery, a database adapter, migrations, ORM entities, or Redis.

The next phase requires a separate execution request and accepted transaction/recovery semantics. A goal-mode agent must not interpret the following design as an invitation to keep coding after the current goal is complete.

## Preserve the five-table direction

| Future table | Source in the new application model | What must not be copied into it |
|---|---|---|
| `tools` | Immutable ToolContractDefinition revision and schemas | Compiled validators, execute functions, client handles, credentials |
| `session_types` | Immutable SessionTypeDefinition plus creation-enabled policy | Parser closures, model runtime, mutable implicit latest selection |
| `session_type_tools` | Exact type-revision to tool-revision references | Per-client live advertisements or capability leases |
| `sessions` | Exact type revision + minimal durable projection + timestamps/checkpoint | Whole SessionRecord, raw SessionState, activeClients, socket/subscription maps, backend handles |
| `host_state` | Deliberately defined durable host checkpoint | A live connection registry or substitute for Redis presence |

No sixth table is required for ordinary type-derived per-session tool assignment. A session pins its type, and the type pins its tools. A future independently approved per-session override model would need new semantics; it must not be smuggled in as a JSON array that silently defeats type immutability.

## What the current phase must leave ready

1. Stable explicit revision IDs and unique key/version identities.
2. JSON-only portable definitions, distinct from their runtime parsers/validators.
3. Exact type reference on each live application session.
4. A defensive manifest projection and clear allowed-versus-advertised semantics.
5. Separate synchronous live registry ownership, without database-shaped wrappers.
6. Documented config meanings, including which values are not safe to publish and will later need a durable-key allowlist.
7. One clear creation/action pipeline and correctly owned error/publication boundaries.
8. Tests showing that definitions reloaded from JSON can be validated and rebound to trusted code parsers without executing arbitrary source.

## Later decisions that must be made before SQL implementation

### Durable projection

Persist only proven durable state: title, read/archive preferences, applicable workspace metadata, safe selected application configuration, exact type identity, and explicitly chosen timestamps/checkpoints. Do not serialize live participants, active tool implementations, pending requests, retry buffers, subscriptions, or previously ready runtime status as proof of current availability.

Define a versioned projection format. Restoring it constructs fresh runtime state through owned helpers and legal SDK lifecycle values. Unknown projection versions or unavailable exact catalogue revisions need an explicit fail/quarantine/migrate policy, never silent fallback to latest.

### Mutation transaction boundary

Before durable mode is enabled, choose the async application service contract. A database save must not be disguised as a synchronous Map operation. For durable mutations, derive a candidate, commit required persistent data/checkpoints, install committed live state, and then publish acceptance. A failed durable write must not leave a publicly accepted mutation that cannot be restored.

A commit-before-publish crash can recover state from a snapshot, but does not imply event replay. Journal/outbox/replay are separate features and are not built here.

### Runtime events and sequence checkpoints

Not every live presence/tool-advertisement event deserves a SQL row or write. The future design must explicitly reconcile runtime-only sequence allocation with restart behavior. Options such as durable range reservation or a new server generation with snapshot-only reinitialization have different protocol consequences; decide and test them later against the pinned AHP contract.

Do not infer a global checkpoint from `MAX(sessions.last_server_seq)`, and do not solve this by persisting every connection/advertisement. `host_state` remains a checkpoint concern, not a new live-state owner. Preserving monotonic cursors is not itself lossless reconnect/replay.

### Catalogue storage and code registration

The database may store schema definitions and exact refs, but it cannot safely recreate arbitrary parser functions from JSON. Trusted application code still registers the parser/adapter matching a type revision. Add new versions when a parser changes the accepted/defaulted meaning of the config contract; do not mutate old behavior under an immutable revision.

### Provider and host ownership

Providers remain code registrations. Do not introduce a providers table merely because provider IDs appear in type definitions. The host has no model runtime or Pi execution. Loading a type/contract does not make its client tools available.

### SQL and Redis

PostgreSQL remains the proposed dialect until explicitly adopted. Authoritative migration scripts and constraints belong in `database/` when that task begins; an ORM must follow them rather than invent a second schema. Use the correct module spelling `src/persistence/` if an adapter module is later justified.

Redis remains deferred. It may later serve selected live presence, lease, cache, or coordination needs; these are not current relational record requirements. Do not create `session_active_clients`, connection, subscription, or lease tables in anticipation of Redis.

## Future gate examples — do not implement/run them as this goal

- Restart restores exact type/tool revisions and selected durable fields, not stale clients.
- Durable commit failure leaves authoritative live state and accepted publication unchanged.
- Deleting the last session cannot rewind a durable host checkpoint.
- Catalogue updates cannot migrate active/persisted sessions implicitly.
- Missing pinned revisions are handled explicitly on recovery.
- No schema metadata or stored tool description becomes executable code.
- SQL transaction semantics, numeric cursor conversion, and crash recovery are tested on the chosen engine.

The initial five-table proposal is a target, not evidence that any table, migration, transaction, or restart behavior has been implemented.

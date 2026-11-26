# Database Migrations

These SQL files are the authoritative DDL for the PostgreSQL
adapter. Apply them in version order to an empty test database. The optional
conformance runner expects migrations to have already been applied and writes
its own repository fixtures. The routine validation suite runs offline. See
[PostgreSQL setup and conformance](../../docs/guides/postgresql.md).

The executable migration set contains forward SQL. A production rollout needs
its own reviewed deployment and recovery plan.

The canonical durable tables are `host_state`, `sessions`, `session_types`,
`tools`, `session_type_tools`, `canonical_resources`, `agent_registrations`,
`work_items`, `work_resource_selections`, plus the
`schema_migrations` bookkeeping table:

- The first five are the session/tool baseline.
- `agent_registrations` stores stable identity only; it never represents a
  live connection.
- `work_items` stores durable work and the current execution lease. Agent
  presence remains in memory.
- `sessions.owner_principal_subject` is assigned from authenticated server
  context, never from client input.
- `schema_migrations` records the applied version at the end of each script.
  The table DDL is `IF NOT EXISTS`, but the object and version statements are
  not: each script
  is single-shot, and re-applying fails (on the first duplicate object, e.g.
  `CREATE TABLE`, or on the duplicate version key) rather than silently
  re-running statements.

`0001_session_tool_baseline.sql` and `0002_agent_work.sql` establish the
historical session/tool and agent/work tables.
`0003_durable_session_resources.sql` adds host ownership epochs, canonical
resource identities and recovery fields. It makes session incarnations the
relational parents of work and gives retention and retirement an exact
resource anchor. Session and root rows must agree by transaction commit.

Migration 0003 takes exclusive locks on the old session, work and registration
tables and refuses to continue if any contains rows. A populated installation
requires its own reviewed identity mapping. The migration preserves existing
catalogue records.

`0004_work_policy_scheduling.sql` preserves existing session and resource
incarnations and adds the serializable work manifest to each type. It requires
an explicit application mapping for any populated P0 work or registration
table. It installs domain-scoped registrations, execution epochs, work
provenance and priorities, revisioned data and lease constraints. A deferred
constraint checks positive scope at commit and serializes competing selector
removals on their common work row.

`0005_host_coordination.sql` adds multi-host coordination and preserves every
existing session, resource, registration and work row. It adds
`host_namespaces`, `host_members`, `host_events`, `host_event_retention` and
the `host_server_seq` sequence, a `lease_slot` on `host_state`, and
`owner_host_id` plus `ownership_epoch` on `sessions`.

- Stop every existing host first. The migration refuses to run while one
  still holds the store's ownership lock.
- Existing sessions are attributed to the store's single `host_state` row.
  A store with sessions and no host row, or with more than one host row, is
  refused without changes.
- The single-row index on `host_state` is replaced by `host_state_guard`. An
  exclusive store still admits one logical host. A shared store admits
  several.
- After the migration a pre-0005 binary cannot acquire the store. Its
  acquisition statement is refused and no epoch changes.
- `sessions_owner_fence` requires a fenced host identity for every session
  write. Raw SQL fixtures must set `ahp.host_id` for their connection.
- There is no down migration. Returning to a pre-0005 binary requires a
  reviewed manual change that drops the guards, and is only meaningful for a
  store that never had more than one logical host.
- `host_namespaces_guard` protects the namespace row. A bound namespace
  cannot be renamed or rebound. The row cannot be deleted while the store has
  a session that is not retired, queued or leased work, or a live member. It
  cannot be truncated, and a plain `INSERT` is refused.
- `ahp_recreate_namespace(namespace_id)` is the only way to bind a store
  again after its namespace row was deleted. It refuses while a namespace row
  exists or anything in the store is still active. It advances every host's
  `ownership_epoch` and removes every membership row, so an earlier ownership
  token or membership generation is refused. Retired history is kept. Run it
  as a trusted administrative action with every host stopped.
- A deletion and `ahp_recreate_namespace` take the same lock a joining host
  holds, before they touch the namespace row, so a join and an administrative
  change queue and cannot interleave. Both are refused outside a read
  committed transaction.
- Both are pinned to the schema they were created in. Calling
  `other_schema.ahp_recreate_namespace(...)` or deleting from
  `other_schema.host_namespaces` acts on that schema whatever the caller's
  `search_path` is.

The canonical durable tables now also include `host_namespaces`,
`host_members`, `host_events` and `host_event_retention`.

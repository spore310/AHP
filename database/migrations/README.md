# Database Migrations

These two SQL files are the authoritative DDL for the implemented PostgreSQL
adapter. Apply them in version order to an empty test database. The optional
conformance runner expects migrations to have already been applied and writes
its own repository fixtures. The routine validation suite runs offline. See
[PostgreSQL setup and conformance](../../docs/guides/postgresql.md).

The executable migration set contains forward SQL. A production rollout needs
its own reviewed deployment and recovery plan.

The canonical durable tables are `host_state`, `sessions`, `session_types`,
`tools`, `session_type_tools`, `agent_registrations`, `work_items`, plus the
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

The executable DDL is split into `0001_session_tool_baseline.sql` (existing
session/tool model) and `0002_agent_work.sql` (the two new tables and their
indexes). See [`database/M2_AGENT_WORK_DATABASE_SCHEMA.md`](../M2_AGENT_WORK_DATABASE_SCHEMA.md)
for the ERD, invariants, and state machine.

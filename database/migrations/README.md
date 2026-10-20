# Database Migrations

Status: **Written, reviewed, and not applied.** PostgreSQL remains a proposed
product dialect; this migration set is the authoritative DDL for the M2 POC.
The user instructed that these scripts must not be executed yet, so no database
was provisioned, migrated, or queried while producing this change.

Apply in order to an empty database only after an explicit rollout decision:

```bash
psql "$AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0001_session_tool_baseline.sql
psql "$AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0002_agent_work.sql
```

There are no integration tests that execute these scripts yet. When a disposable
database is approved, tests must own their tables, truncate only those tables,
and never point at production. Do not run these scripts against a production
database without a reviewed rollout and backup plan. There is deliberately no
destructive automated rollback for persisted work; roll back by restoring the
prior schema from a verified backup.

The canonical seven tables are `host_state`, `sessions`, `session_types`,
`tools`, `session_type_tools`, `agent_registrations`, and `work_items`:

- The first five are the session/tool baseline.
- `agent_registrations` stores stable identity only; it never represents a
  live connection.
- `work_items` stores durable work and the current execution lease. Agent
  presence remains in memory.
- `sessions.owner_principal_subject` is assigned from authenticated server
  context, never from client input.

The executable DDL is split into `0001_session_tool_baseline.sql` (existing
session/tool model) and `0002_agent_work.sql` (the two new tables and their
indexes). See [`database/M2_AGENT_WORK_DATABASE_SCHEMA.md`](../M2_AGENT_WORK_DATABASE_SCHEMA.md)
for the ERD, invariants, and state machine.

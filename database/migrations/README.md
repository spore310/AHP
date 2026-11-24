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

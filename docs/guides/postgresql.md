# PostgreSQL setup and conformance

The [advanced application](advanced.md) uses in-memory repositories for a
self-contained run. PostgreSQL implements the same public persistence ports
for durable agent registrations, session projections, and work items. The live
session factory, subscriptions, and connection presence remain in memory.

## Prepare a disposable database

Use a dedicated local PostgreSQL 17 database and `psql`. Set
`AHP_TEST_DATABASE_URL` for that database in your shell. Apply the two migrations
in order to the empty database. Both are single-shot scripts.

```powershell
psql "$env:AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0001_session_tool_baseline.sql
psql "$env:AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0002_agent_work.sql
```

In a POSIX shell, use `"$AHP_TEST_DATABASE_URL"` in those commands.
The SQL files are authoritative for the DDL. The
[schema guide](../../database/M2_AGENT_WORK_DATABASE_SCHEMA.md) explains the
relationships, lease columns, and constraints.

## Run conformance

```sh
pnpm exec vite-node examples/postgresql-conformance.ts
```

The runner writes fixture rows and exercises registration quotas across two
independent provider pools, then verifies registration, work round-trips,
ownership, and leases. A passing run prints
`PostgreSQL repository conformance passed.` Use a fresh, migrated, disposable
database for each run because the quota check assumes an empty registration
table. The command limits its target to the explicit loopback test URL.

`pnpm validate` runs the offline adapter tests and the in-memory conformance
suite. The [historical portability record](../archive/validation/persistence-portability-validation.md)
documents earlier offline results.

## Embed the adapter

Pass `createPersistence(...)` a provider from the allowlisted provider selection
API and use its registrations and work repositories in `agentWork`. When
combining work with protected tools and sessions, compose one explicit security
source and match the domain and authenticator at the work bridge. The built-in
CLI accepts database and token settings, while a protected remote SDK application
supplies the security and policy configuration shown in the advanced example.
[Persistence module](../../src/persistence/README.md) · [PostgreSQL adapter](../../src/persistence/helpers/adapters/postgres/README.md) · [CLI environment](../../env/README.md)

[Documentation index](../README.md)

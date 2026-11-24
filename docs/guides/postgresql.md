# PostgreSQL setup and conformance

The [advanced application](advanced.md) uses in-memory repositories for a
self-contained run. PostgreSQL stores session identity, committed session state,
resource data, provider recovery records and agent registrations. A protected
host reopens backends and obtains fresh bindings on restart. Subscriptions
and connection presence are process-local. [Durable lifecycle sample](../../examples/durable-lifecycle.ts)

## Run with disposable Docker PostgreSQL

On Windows, start Docker Desktop using a local Linux engine (Docker Engine 28
or later) and install dependencies with `pnpm install`. The runner needs the
Git-ignored `scripts/Invoke-LocalPostgres.ps1` and
`scripts/local-postgres-ready.mjs` files. Use the manual setup below if either
is missing from your checkout.

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/Invoke-LocalPostgres.ps1
```

Each run uses a pinned PostgreSQL 17 image, a fresh named Docker volume, and a
random loopback port. It applies migrations in filename order and
checks their recorded versions over the published port before running
conformance. The first run may download the image. The container has CPU,
memory, process, and log limits. Keep synthetic fixtures small because the
volume has no per-run disk quota.

In a PowerShell session that permits local scripts, pass `-Operation` to run
your own check. It receives `AHP_TEST_DATABASE_URL` and
`AHP_TEST_POSTGRES_CONTAINER`. The runner clears inherited PostgreSQL settings
and common application database URLs. To start the application, explicitly
set `AGENT_HOSTING_PROTOCOL_DATABASE_URL` to the generated URL within the
operation. Operations run with your account's permissions, so use trusted
commands. Close test clients before returning.

```powershell
.\scripts\Invoke-LocalPostgres.ps1 -Operation {
    pnpm exec vite-node examples/postgresql-conformance.ts
}
```

For durability, write a fixture, restart the owned container, and reconnect
before reading it:

```powershell
.\scripts\Invoke-LocalPostgres.ps1 -Operation {
    $container = $env:AHP_TEST_POSTGRES_CONTAINER
    $sql = 'CREATE TABLE durability_probe (value integer); INSERT INTO durability_probe VALUES (42);'
    docker exec $container psql -U ahp_test -d ahp_test -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) { throw 'Fixture write failed.' }
    docker restart $container
    if ($LASTEXITCODE -ne 0) { throw 'Container restart failed.' }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $container pg_isready -q -h 127.0.0.1 -U ahp_test
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not come back up.' }
    $value = docker exec $container psql -U ahp_test -d ahp_test -Atc 'SELECT value FROM durability_probe'
    if ($LASTEXITCODE -ne 0 -or $value -ne '42') { throw 'Fixture did not survive restart.' }
}
```

Throw on a failed check or leave the failing native command last so the runner
can return its exit code.

### Recover an interrupted run

Completion, failure, and Ctrl+C trigger cleanup. A hard kill, machine shutdown,
or Docker outage can require recovery. Once Docker is back, list the records
and retry with the ID printed at startup:

```powershell
.\scripts\Invoke-LocalPostgres.ps1 -List
.\scripts\Invoke-LocalPostgres.ps1 -Cleanup <run-id>
```

Cleanup refuses active runs and verifies the recorded engine and resource
ownership. Keep the Git-ignored, credential-free records in `.temp` until
cleanup succeeds. Successful cleanup removes the container, volume, and its
record. RDS and Supabase connectivity and configuration require separate
checks.

## Prepare a disposable database

Use a dedicated local PostgreSQL 17 database and `psql`. Set
`AHP_TEST_DATABASE_URL` for that database in your shell. Apply the four migrations
in order to the empty database. Each is a single-shot script. Migration 0003 refuses nonempty legacy sessions, work and registrations. Migration 0004 preserves P0 sessions and resources and requires an explicit application mapping for populated P0 work or registrations.

```powershell
psql "$env:AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0001_session_tool_baseline.sql
psql "$env:AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0002_agent_work.sql
psql "$env:AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0003_durable_session_resources.sql
psql "$env:AHP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0004_work_policy_scheduling.sql
```

In a POSIX shell, use `"$AHP_TEST_DATABASE_URL"` in those commands.
The SQL files are authoritative for the DDL. The
[schema guide](../../database/M2_AGENT_WORK_DATABASE_SCHEMA.md) explains the
relationships, lease columns, and constraints.

## Run conformance

```sh
pnpm exec vite-node examples/postgresql-conformance.ts
```

The runner checks PostgreSQL 17 and all four migration versions, then creates
an isolated schema for fixture rows. It exercises registration quotas across
two pools, host ownership and takeover, resource constraints, retirement,
data revision conflicts and public-host rollback. Work checks include command replay,
lost COMMIT acknowledgements, contended positive selectors and fenced settlement. A passing run prints
`PostgreSQL registration, durable lifecycle, work, migration and ownership conformance passed.`
The command requires a disposable database at an explicit loopback URL.

`pnpm validate` runs the offline adapter tests and the in-memory conformance
suite. The [historical portability record](../archive/validation/persistence-portability-validation.md)
documents earlier offline results.

## Embed the adapter

Pass `createPersistence(...)` a provider from the allowlisted provider selection
API. Pass its `durability` storage and a host ID in the protected session configuration. Use its registrations and work repositories in `agentWork` for agent presence and authorized work reads. When
combining work with protected tools and sessions, compose one explicit security
source and match the domain and authenticator at the work bridge. The built-in
CLI accepts database and token settings, while a protected remote SDK application
supplies the security and policy configuration shown in the advanced example.
[Persistence module](../../src/persistence/README.md) · [PostgreSQL adapter](../../src/persistence/helpers/adapters/postgres/README.md) · [CLI environment](../../env/README.md)

[Documentation index](../README.md)

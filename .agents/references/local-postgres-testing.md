# Local PostgreSQL tests

Use the disposable PostgreSQL runner to verify migrations, SQL behavior,
concurrent connections, or persistence across a restart. Run
`scripts/Invoke-LocalPostgres.ps1` for conformance or use `-Operation` for a
specific test. Use synthetic fixtures and trusted operations.

The runner and readiness helper are Git-ignored. If they are absent from your
checkout, use the manual workflow in the
[PostgreSQL guide](../../docs/guides/postgresql.md#run-with-disposable-docker-postgresql).
The guide covers custom tests and interrupted-run recovery. Report live
results separately from `pnpm validate` and managed-database checks.

# Persistence portability validation

## Candidate

The code candidate starts at `agentIdentity` commit `246d0fb` (P11) plus the
scoped P12 documentation and required lint corrections to P06–P11 test support.
The exact P12 commit is recorded in the handoff and final report.

## Scope and evidence categories

- Shared contracts, facades, provider substitution, lifecycle, and application
  imports are checked with type fixtures, unit tests, and isolated module-import
  sentinels.
- PostgreSQL behavior is checked offline with driver/query doubles for SQL
  parameters, transaction affinity, mappings, rollback/release, and error
  classification.
- Real PostgreSQL concurrency, rollback, expiry, and database-clock behavior
  are **BLOCKED / NOT RUN**. No database was provisioned, migrated, or queried.

Fake-provider and query-double results do not establish real database locking,
clock, or transaction behavior. The standalone PostgreSQL conformance runner
requires a separately authorized test database and is not run by `pnpm validate`.

## Validation results

| Check | Result |
| --- | --- |
| `pnpm validate` | PASS — lint, typecheck, 52 test files / 407 tests, docs:check (116 source files), and production build |
| `pnpm docs:check` | PASS — 116 source files mapped by module READMEs |
| `git diff --check` | PASS — no whitespace errors |
| `git diff -- database/migrations` | PASS — no migration diff |
| Production persistence-boundary scan | PASS — PostgreSQL driver, query, transaction, SQLSTATE, and SQL-only behavior remain under the PostgreSQL adapter; the only production adapter selection is the allowlisted lazy import |

## DDL and database access

The `database/migrations/` diff is empty. Current migration SHA-256 values match
the P00 baseline: `0001_session_tool_baseline.sql` is
`46E640A3B2171088074A8962D4A46C06BF57A70589D138A78F172DFED11B8A99`, and
`0002_agent_work.sql` is
`AC5FE261655841E520667EDD905545081BEF45493B1727E127C5A2187695E4D3`. No
database connection, live query, provisioning, or migration was performed.
Real-database acceptance remains blocked pending separate authorization and a
dedicated test database.

## Final integrated candidate

P13 reviewed `d68f7d2` plus the bounded RP01 repair patch with SHA-256
`EAF8B42A7D69A8AB5DFD6041468AF96B9A7211C24A8039A3B3FEAEACEFEAD9B4`.
After RP01, `pnpm validate` passed again: lint, typecheck, 52 test files / 407
tests, docs:check (116 source files), and production build. Focused selection,
conformance, and host-composition tests also passed (3 files / 9 tests). Review
passes are recorded separately in the P13 handoff and final review reports.

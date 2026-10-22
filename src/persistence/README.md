# Persistence

Asynchronous durable-storage ports and parameterized PostgreSQL adapters. The
live `SessionRegistry` remains synchronous and in memory; durable I/O never runs
from the reducer or WebSocket callbacks. SQL source of truth lives under
[`database/migrations/`](../../database/migrations/), not in this module.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `AgentRegistrationRepository`, `DurableSessionRepository`, `WorkRepository`, record/DTO types, and the sanitized `RepositoryError`. |
| `helpers/pool.ts` | `createPostgresPool`, `withTransaction`, timestamp normalization, and PostgreSQL error classification. |
| `helpers/agentRegistrations.ts` | `createPostgresAgentRegistrationRepository`: idempotent `(principal, agentKey)` registration and lookup. |
| `helpers/sessions.ts` | `ensureSession` plus `createPostgresDurableSessionRepository`: lazy session projection, owner enforcement, and FK-aware deletion. |
| `helpers/workItems.ts` | `createPostgresWorkRepository`: idempotent submit, atomic claim/reclaim, fenced renew/complete/fail/cancel/get, expiry reconciliation, and dependent-work checks. |
| `helpers/text.ts` | Pure storage-shape predicates: JSONB-safe text (NUL and unpaired-surrogate rejection) and recursive JSONB safety including object keys, bounded by an explicit 512-level depth budget so a deeply nested payload fails with a typed value error instead of relying on the engine's stack safety. |
| `index.ts` | Public surface for all ports and adapters. |

## API

- `createPostgresPool({ connectionString, maxConnections? }): Pool` — the caller
  owns the pool and must call `pool.end()` during shutdown.
- `createPostgresAgentRegistrationRepository(pool)` — stable registration rows
  keyed by `(principal_subject, agent_key)`.
- `createPostgresDurableSessionRepository(pool)` — `ensure`, `get`, and `delete`.
  `delete` rejects while work rows still reference the session.
- `createPostgresWorkRepository(pool, { leaseTtlSeconds? })` — implements the
  frozen `WorkRepository` port.
- `RepositoryError(code, message)` — expected failures only: `conflict`,
  `not_found`, `unauthorized`, or `database`. SQL detail is not surfaced.

## Work item semantics

The adapter uses the database clock (`statement_timestamp()`) for lease
boundaries, never the process clock. Session projection updates keep the
greatest sequence and only replace `durable_state` when the incoming sequence is
at least the stored one.

1. **Submit** inserts the live session projection if needed, then inserts one
   `(session_uri, request_key)` row. A replay with the same immutable payload
   returns the existing ID; a changed kind, input, or target raises `conflict`.
2. **Claim** selects one eligible queued row, or one expired lease with retry
   budget left, using `FOR UPDATE OF w SKIP LOCKED`. The update rotates
   `lease_token`, increments `attempt_count`, and stores the new deadline.
3. **Renew** updates only a current, unexpired lease held by the same agent,
   token, enabled registration, and session owner.
4. **Complete** writes a bounded JSON result only when the same fenced conditions
   hold, then clears all lease fields.
5. **Fail** locks the current lease, clears lease fields, and returns `queued`
   only when the failure is retryable and attempts remain; otherwise `failed`.
6. **Cancel** locks a row owned by the principal and terminalizes queued or
   leased work. Repeating a terminal cancel is safe.
7. **Reconcile** terminalizes expired leases whose attempt budget is exhausted.
8. **Dependent-work** checks return true for any row that still references the
   session, including terminal rows.

## Testing and current status

The work service is covered by unit tests with fake ports. The PostgreSQL
adapters are typed and reviewed but have not executed a query in this workspace.
Real PostgreSQL acceptance is intentionally **BLOCKED**: the migration scripts
were written, but the user instructed that they must not be applied yet. No
database was provisioned, migrated, or queried for this change.

| Test | Pins |
| ---- | ---- |
| [`src/tests/work/workService.test.ts`](../tests/work/workService.test.ts) | Authorization, bounded validation, presence fencing, lease mapping, stale completion, token hiding, target ownership, and disposal conflict. |

## Caveats

- **No durable presence.** Agent presence is in `src/agents/` and stays in
  memory.
- **No background scheduler.** Callers invoke `reconcileExpired`; claim also
  selects expired leases while retry budget remains.
- **At-least-once execution.** SQL fences the authority to commit a result, not
  side effects in a worker's environment.
- **No replay.** A live session that disappears with the process is not
  rehydrated automatically.
- **No SQL in the transport.** The WebSocket adapter calls `WorkService`; only
  this module imports `pg`.

## Related Documentation

- [`database/migrations/README.md`](../../database/migrations/README.md) — DDL,
  application order, and rollout caveats.
- [`src/work/README.md`](../work/README.md) — authorization and the work-service
  boundary.
- [`docs/architecture/agent-task-lifecycle.md`](../../docs/architecture/agent-task-lifecycle.md)
  — sequence diagram and failure cases.

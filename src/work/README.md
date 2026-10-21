# Work

The work-application service: principal/session authorization, bounded input
validation, presence revalidation, and lease lifecycle delegation. This module
contains no SQL and no WebSocket types. It coordinates the frozen persistence
ports and the live agent directory.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `WorkService`, `WorkSubmission`, `WorkLease`, `WorkView`, `WorkErrorCode`, `AuthorizedAgentContext`, `WorkPresence`, and `SessionOwnerRegistry`. |
| `helpers/errors.ts` | `WorkError`: sanitized `invalid`, `not_found`, `unauthorized`, `conflict`, `stale`, or `exhausted` failures. |
| `helpers/helpers.ts` | `createSessionOwnerRegistry`, `createWorkService`, bounded validation, presence/registration revalidation, and repository-error mapping. |
| `index.ts` | Public surface for the module. |

## API

`createWorkService(options)` returns:

- `submit(principal, submission)` — requires a live session whose owner is the
  authenticated principal. Validates kind, request key, JSON-object input, size,
  and (when targeted) that the target registration belongs to the same principal.
- `claim(agent, sessionUri)` — revalidates live presence and an enabled
  registration, reconciles exhausted leases, then asks the repository for one
  eligible lease.
- `renew(agent, workId, token)` — fenced by agent, token, presence, registration,
  and session owner.
- `complete(agent, workId, token, result)` — requires a bounded JSON-object
  result and the current unexpired lease.
- `fail(agent, workId, token, reason)` — bounded reason; returns the repository's
  `queued`/`failed` decision.
- `cancel(principal, workId)` — terminalizes authorized queued or leased work.
- `get(principal, workId)` — returns a view without `leaseToken` or
  `leaseAgentId`.
- `assertSessionDisposable(sessionUri)` — rejects while any work row references
  the session.

`createSessionOwnerRegistry()` keeps the in-process session-owner binding. A
session is bound only after an authenticated `createSession`; a different
principal cannot rebind it.

## Authorization

The POC policy is **same principal as the session owner**. A principal is a
server-derived handshake subject, not `clientId` or request JSON. Work is scoped
to a session, and the repository independently checks the durable session owner.

Identity used for a work mutation is always the live binding from the
authenticated connection:

```text
principal -> connection -> agentId + generation -> enabled registration
```

A stale connection, expired presence, forged token, wrong principal, or disabled
registration fails closed.

## Bounded input

- Session URI and request key are non-empty; request key is at most 256 chars.
- Kind must be in the configured allowed set and at most 128 chars.
- Input/result must be JSON objects; default limits are 64 KiB input and 256 KiB
  result. Values the PostgreSQL JSONB format cannot store (NUL code units,
  unpaired surrogates) are rejected before SQL is attempted.
- Failure messages are 1–2,000 chars; the wire adapter further caps them. The
  message is validated and then dropped: the frozen v1 reply contract is
  `{ status }` and no failure-message column exists, so the reason lives only in
  the worker's own logs.
- Work IDs and lease tokens must be UUID-shaped before SQL is attempted.

## Caveats

- **No server-side execution.** A work row is coordination state; the server
  never runs a model, process, or filesystem executor.
- **At-least-once.** A worker may retry after a lease expires; completion is
  fenced but side effects are not transactional with the database.
- **No cross-principal grants.** Targeting another principal's agent is denied.
- **No push guarantee.** v1 implements no work-available push; clients discover
  work by claiming. Any future hint would be a best-effort signal, never proof of
  assignment.
- **Reconcile per claim.** Every claim first issues a global expired-lease
  reconciliation statement. The claim CTE re-checks the DB clock itself, so
  correctness never depends on the reconciler; the statement is accepted
  overhead for refresh breadth on the claim path. A scheduler-based variant is a
  possible follow-up, not a v1 contract change.
- **Reserving `"exhausted"`.** The wire vocabulary maps `"exhausted"`, but v1
  service code never produces it: budget-exhausted leases terminalize to
  `failed` status instead of throwing a fresh observable error. Keep the mapping
  as reserved behavior until a producer exists.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/work/workService.test.ts`](../tests/work/workService.test.ts) | Owned-session submission, cross-principal and target-agent denial, bounded validation, missing/expired/mismatched presence, disabled registration, fenced renew/complete, stale completion, view redaction, and dependent-work disposal rejection. |
| [`src/tests/websocket/agentWork.test.ts`](../tests/websocket/agentWork.test.ts) | Versioned wire mapping and sanitized protocol errors for the service. |
| [`src/tests/websocket/agentWork.integration.test.ts`](../tests/websocket/agentWork.integration.test.ts) | Composed authenticated A/B flow: A submits, B registers/claims/renews/completes, A gets the result; owner and secret checks. |

## Caveats

- **No server-side execution.** A work row is coordination state; the server
  never runs a model, process, or filesystem executor.
- **At-least-once.** A worker may retry after a lease expires; completion is
  fenced but side effects are not transactional with the database.
- **No cross-principal grants.** Targeting another principal's agent is denied.
- **No push guarantee.** v1 implements no work-available push; clients discover
  work by claiming. Any future hint would be a best-effort signal, never proof of
  assignment.

## Related Documentation

- [`src/persistence/README.md`](../persistence/README.md) — SQL adapters and
  lease invariants.
- [`src/agents/README.md`](../agents/README.md) — identity and presence.
- [`docs/architecture/agent-task-lifecycle.md`](../../docs/architecture/agent-task-lifecycle.md)
  — end-to-end lifecycle.

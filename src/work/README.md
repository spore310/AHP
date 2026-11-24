# Work

The work-application service: principal/session authorization, bounded input
validation, presence revalidation, and lease lifecycle delegation. This module
contains no SQL and no WebSocket types. It coordinates the frozen persistence
ports and the live agent directory.

Remote access through P2 is limited to `x-ahp/work/get`. Work mutation methods
described below are in-process service calls.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `WorkService`, `WorkSubmission`, `WorkLease`, `WorkView`, `WorkErrorCode`, `AuthorizedAgentContext`, `WorkPresence`, `SessionOwnerLookup`, and legacy `SessionOwnerRegistry`. |
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
- `get(principal, workId, domainId?)` returns an authorized view with the lease
  token and holder omitted. Durable reads require the trusted domain and a
  current, ready session incarnation owned by the principal. An unavailable or
  mismatched instance returns `null`.
- `assertSessionDisposable(sessionUri)` checks the URI against the portable-text
  profile before repository access. It rejects disposal while any work row
  references that session.

`WorkServiceOptions.sessions` requires only `SessionOwnerLookup.owner(uri)`.
`SessionOwnerRegistry` extends that read-only interface with legacy bind/unbind/clear;
`createSessionOwnerRegistry()` still provides the standalone trusted legacy store.
Protected host composition never uses it as a competing owner authority: it reads
current live session full ref -> canonical P03 owner -> subject only within the
configured work domain. Failed-but-live records retain their canonical owner; no live
record projects no owner, including while an owner-free disposal marker settles.
Ownership alone is not readiness. Work owner equality, presence/lease enforcement,
repositories and persistence semantics are unchanged; a junior scoped participant
never substitutes the creator's principal for work.

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

- Session URI and request key are non-empty and satisfy the portable-text
  profile; the session URI is capped at 2,048 chars and the request key at 256.
- Kind must be in the configured allowed set and at most 128 chars.
- Input/result must be JSON objects nesting at most 512 levels — the
  portable-text tree depth budget in `@persistence` — and default size limits
  are 64 KiB input and 256 KiB result. The shared profile rejects NUL code
  units and unpaired surrogates in payload *values or object keys*, scalar
  session URIs and request keys, and the durable session projection. This is
  an application interoperability rule, not a universal JSON requirement. The
  agents directory applies it to `agentKey` and `displayName` before
  registration.
- Failure messages are 1–2,000 chars. The
  message is validated and then dropped: the frozen v1 reply contract is
  `{ status }` and no failure-message column exists, so the reason lives only in
  the worker's own logs.
- Work IDs and lease tokens must be UUID-shaped before repository access.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/work/workService.test.ts`](../tests/work/workService.test.ts) | Owned-session submission, cross-principal and target-agent denial, bounded validation (including portable-text rejection, terminal-key replays, and a dispose channel refused outside the text profile), a durable projection rejected at the 512-level depth budget before repository access, missing/expired/mismatched presence, disabled registration, fenced renew/complete, stale completion, view redaction, and dependent-work disposal rejection. |
| [`src/tests/websocket/agentWork.test.ts`](../tests/websocket/agentWork.test.ts) | Versioned reads, presence operations, strict request validation and closed work mutations. |
| [`src/tests/websocket/agentWork.integration.test.ts`](../tests/websocket/agentWork.integration.test.ts) | Internal kernel host composition rejects owner and worker mutations, preserves authorized reads, and redacts lease secrets. |
| [`src/tests/websocket/agentWork.disposal.test.ts`](../tests/websocket/agentWork.disposal.test.ts) | Backed-disposal races over the real binding: fail-closed recreates inside the settling window (owner and cross-principal), binding release exactly at settlement, post-settle rebind to the true creator, and stale detached starts answering conflict while binding nothing. |

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
- **One owner authority in the host wiring.** The live projection's owner is
  sourced from the same read-only lookup the service checks: canonical full-ref
  owner in a protected host, legacy registry otherwise. The submit pre-check thus
  corroborates one fact rather than maintaining another owner map.
- **Same-owner recreate residual.** The projection carries no stable
  session-generation field (`createdAt` is the fetch time), so a same-owner
  dispose→recreate landing inside a submission's write window is not detected by
  the reconciliation; cross-principal and owner-removal cases are caught.
  P05 fences protected session creation/disposal/backend cleanup with full refs,
  but does not add an instance field to the frozen work/persistence write contract.
  Durable write reconciliation therefore retains this v1 residual; it is not
  claimed fixed by the new canonical read-only lookup.

## Related Documentation

- [`src/persistence/README.md`](../persistence/README.md) — SQL adapters and
  lease invariants.
- [`src/agents/README.md`](../agents/README.md) — identity and presence.
- [`docs/architecture/agent-task-lifecycle.md`](../../docs/architecture/agent-task-lifecycle.md)
  — end-to-end lifecycle.

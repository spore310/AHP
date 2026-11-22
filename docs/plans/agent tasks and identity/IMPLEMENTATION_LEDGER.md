# M2 Agent Identity / Work Leasing — Execution Ledger

Status: **IMPLEMENTED / PARTIAL** — all non-DB gates pass; PostgreSQL gates
are **BLOCKED** by the explicit no-apply instruction. Code, migrations,
documentation, and non-DB tests are complete on `agentIdentity`. The final
combined-tree evidence is recorded below.

## Baseline

- Branch: `agentIdentity`
- Base commit: `3fd2986b963265a588281f6ed911183824673909`
- Baseline `pnpm validate`: **passed** (230 tests, docs gate 77 files, build).
- Previous plans were untracked under `docs/plans/agent tasks and identity/`.
- PostgreSQL: local isolated container `ahp-postgres` (`postgres:17-alpine`) was
  started during intake but **no SQL has been applied**. The user explicitly
  instructed on 2026-10-20: write the SQL scripts only; do not apply them yet.
  Real-DB acceptance is therefore **BLOCKED pending explicit user approval**.
  The container was stopped. Connection string for future approved use:
  `postgresql://ahp:ahp@127.0.0.1:55432/ahp`.
- Authentication decision for this POC: static bearer tokens from the
  trusted WebSocket handshake `Authorization` header. Absence of a valid
  principal denies every agent/work method. Deployments may replace the
  authenticator adapter; the AHP `initialize.clientId` is never identity.

## Frozen decisions

| Concern | Decision |
| --- | --- |
| New wire methods | Request-only, versioned `x-ahp/agents/*` and `x-ahp/work/*`; not standard AHP actions |
| Principal | `AuthenticatedPrincipal { subject }` from handshake authenticator |
| Agent registration | SQL `agent_registrations`, unique `(principal_subject, agent_key)` |
| Presence | In-memory only, TTL 90 s, generation-fenced, one live binding per agent |
| Work lease | SQL `work_items`, DB clock, 60 s default, token rotated per claim, max 3 attempts |
| Work scope | Same authenticated principal as session owner; session row inserted lazily from the live session on first submit |
| Allowed work kinds | Configurable, default `code.patch,code.review` |
| Session disposal | Rejected while any work row references the session |
| Restart | Registrations/work/session rows survive; presence, sockets, subscriptions and client tools do not |

## Frozen public contracts

- `src/agents/types.ts` — `AuthenticatedPrincipal`, `ConnectionAuthenticator`,
  `AgentDirectory`, `PresenceBinding`, `TrustedHandshakeContext`.
- `src/persistence/types.ts` — async registration/session/work ports and
  `RepositoryError`.
- `src/work/types.ts` — `WorkService`, `WorkSubmission`, `WorkLease`,
  `WorkView`, `AuthorizedAgentContext`, `SessionOwnerRegistry`.
- `AuthorizedAgentContext` is always server-built from the current authenticated
  connection and live presence. It is never accepted from request JSON.
- Work mutation DTOs never expose `principalSubject`, `leaseAgentId` or another
  principal's payload. Lease tokens are returned only to the current claimant.

## Wire namespace (frozen v1)

All are JSON-RPC **requests**:

- `x-ahp/agents/register` → `{ version: 1, agentKey, displayName? }` →
  `{ version: 1, agentId, presenceExpiresAt }`
- `x-ahp/agents/renew` → `{ version: 1 }` →
  `{ version: 1, agentId, presenceExpiresAt }`
- `x-ahp/agents/unregister` → `{ version: 1 }` → `null`
- `x-ahp/work/submit` → `{ version: 1, sessionUri, requestKey, kind, input, targetAgentId? }`
  → `{ version: 1, workId }`
- `x-ahp/work/claim` → `{ version: 1, sessionUri }` →
  `{ version: 1, work: { workId, sessionUri, kind, input, leaseToken, leaseExpiresAt, attempt } | null }`
- `x-ahp/work/renew` → `{ version: 1, workId, leaseToken }` →
  `{ version: 1, leaseExpiresAt }`
- `x-ahp/work/complete` → `{ version: 1, workId, leaseToken, result }` → `null`
- `x-ahp/work/fail` → `{ version: 1, workId, leaseToken, retryable, message }` →
  `{ version: 1, status }`
- `x-ahp/work/cancel` → `{ version: 1, workId }` → `null`
- `x-ahp/work/get` → `{ version: 1, workId }` →
  `{ version: 1, work: WorkView | null }`

## Write ownership during implementation

Terminal A (this session) owns:

- `database/**`
- `src/persistence/**`
- `src/work/**`
- `src/tests/persistence/**`
- `src/tests/work/**`
- `src/tests/websocket/agentWork.integration.test.ts` (integration)
- `src/index.ts`, `env/**`, `tsconfig.json`, `package.json`, lockfile
- `docs/architecture/agent-task-lifecycle.md`
- final integration in `src/websocket/helpers/host/**`

Terminal B (coworker pane `w3:p3`) owns:

- `src/agents/**` implementation (not the frozen `types.ts` contract)
- `src/websocket/types.ts`, `src/websocket/helpers/connection.ts`,
  `src/websocket/helpers/server.ts` (authentication/connection context only)
- `src/websocket/helpers/ahp/constants.ts`, `helpers.ts`, `types.ts`,
  and new `agentWork.ts`
- `src/tests/agents/**`, `src/tests/websocket/agentWork*.test.ts` except the
  final integration test
- `src/agents/README.md` and relevant additions to `src/websocket/README.md`

Shared files are serialized. Terminal B must not edit A-owned paths or shared
composition files. If a shared edit is necessary, report it instead.

## Immediate acceptance gates

1. `pnpm typecheck` after each owned slice.
2. Unit tests for presence generations, auth denial and DTO validation.
3. Real-DB tests using `AHP_TEST_DATABASE_URL` (two pools, concurrent claim) —
   **BLOCKED**: the user instructed that the migration scripts must not be
   applied. No database was provisioned, migrated, or queried.
4. End-to-end authenticated A/B test: client A creates the session and submits;
   client B (same authenticated principal) registers, claims, renews and
   completes; client A gets the result. **PASSED with an in-memory durable
   port** in `src/tests/websocket/agentWork.integration.test.ts`; the real SQL
   adapter is covered by the same service contract but not executed.
5. Full `pnpm validate` on the integrated tree.

## Final evidence (2026-10-20)

- `pnpm lint`: exit 0 with zero warnings.
- `pnpm exec tsc --noEmit`: exit 0.
- `pnpm test`: 39 files / 281 tests passed, including the composed
  authenticated A/B submit → claim → renew → complete → get test.
- `pnpm docs:check`: 95 source files mapped.
- `pnpm build`: exit 0 (`dist/index.js`, 177.48 kB).
- `pnpm validate`: exit 0 on the final combined tree.
- No SQL applied, no database provisioned, no deployment or cloud provisioning.
  The user authorized a Git push of the final commit; a push is not a deployment.

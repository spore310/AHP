# Terminal B Assignment — Agent Identity, Presence, and AHP Extension

You are **Terminal B** for the Agent Hosting Protocol identity/work-lease task.
Work in `C:\Users\Yohan\OneDrive\Documents\Code\ahp` on branch `agentIdentity`.
Terminal A (the orchestrator pane) is implementing `src/persistence/**`,
`src/work/**`, `database/**`, `env/**`, `src/index.ts`, and final host
composition concurrently.

## Read first

1. `docs/plans/agent tasks and identity/M2_AGENT_IDENTITY_WORK_LEASING_TASKPLAN.md`
2. `docs/plans/agent tasks and identity/M2_AGENT_WORK_DATABASE_SCHEMA.md`
3. `docs/plans/agent tasks and identity/IMPLEMENTATION_LEDGER.md`
4. `.agents/AGENTS.md`, `docs/CodingRules.md`
5. `src/agents/types.ts`, `src/persistence/types.ts`, `src/work/types.ts`
6. `src/websocket/types.ts`, `src/websocket/helpers/connection.ts`,
   `src/websocket/helpers/server.ts`, `src/websocket/helpers/ahp/*`
7. Existing tests: `src/tests/websocket/ahp.test.ts`,
   `src/tests/websocket/toolInvocation.test.ts`, `src/tests/websocket/helpers.ts`

## Baseline

- Base commit `3fd2986`; baseline `pnpm validate` is green.
- PostgreSQL is available for Terminal A's tests. You do not need to run SQL.
- Do not run `pnpm validate` on a half-integrated tree; run focused
  `pnpm exec tsc --noEmit` and focused `pnpm exec vitest run <paths>` instead.
  Terminal A owns the final full gate.

## Your exclusive write set

- `src/agents/**` (implementation only; do not replace the frozen
  `src/agents/types.ts` contract, but you may add exports to
  `src/agents/index.ts`)
- `src/websocket/types.ts`
- `src/websocket/helpers/connection.ts`
- `src/websocket/helpers/server.ts`
- `src/websocket/helpers/ahp/constants.ts`
- `src/websocket/helpers/ahp/helpers.ts`
- `src/websocket/helpers/ahp/types.ts`
- `src/websocket/helpers/ahp/agentWork.ts` (new)
- `src/tests/agents/**`
- `src/tests/websocket/agentWork*.test.ts` (except the final integration test name
  `agentWork.integration.test.ts`, which Terminal A owns)
- `src/agents/README.md`
- only the new-file/API rows needed in `src/websocket/README.md`

**Do not edit** `src/persistence/**`, `src/work/**`, `src/websocket/helpers/host/**`,
`src/index.ts`, `env/**`, `tsconfig.json`, `package.json`, the lockfile, or
`database/**`. Do not add dependencies or SQL. If a shared integration edit is
required, report it instead of making it.

## Implement

### 1. Authentication adapter and connection context

Implement in `src/agents/`:

- `createStaticTokenAuthenticator(tokens: ReadonlyMap<string, string>)` where
  the map is bearer token → principal subject. Read only the WebSocket upgrade
  `Authorization: Bearer <token>` header. Return `undefined` for missing or
  invalid credentials. Never log or echo the token.
- `createAgentDirectory(options)` implementing `AgentDirectory`:
  - registration through `AgentRegistrationRepository` (idempotent stable ID)
  - in-memory `PresenceBinding` map, 90 s default TTL, generation increments
  - deny a different live connection while a current binding is valid
  - renew only from the exact current binding and only before expiry
  - release only the exact binding/generation; a stale close cannot remove a
    newer binding
  - release all bindings for a connection on close
  - `getRegistration` delegates to the repository
  - injectable `now` clock for deterministic tests.

Export `createAgentDirectory` and `createStaticTokenAuthenticator` from
`src/agents/index.ts`.

Extend the transport boundary:

- `WebSocketConnectionContext` gets `readonly principal?: AuthenticatedPrincipal`.
- `createWebSocketServer` accepts `authenticator?: ConnectionAuthenticator`.
- Before emitting/attaching a connection, call the authenticator with the
  server-sourced request headers and remote address. If it returns a principal,
  put it on the connection context. If authentication throws, close/reject that
  socket without crashing the server. If no authenticator is configured,
  `principal` stays undefined and existing unauthenticated AHP behavior is
  unchanged.
- Do not derive identity from `initialize.clientId`.

### 2. Versioned AHP extension

Create `src/websocket/helpers/ahp/agentWork.ts` with a
`createAgentWorkExtension(options)` returning handlers plus connection-close
cleanup. Options carry optional `agents: AgentDirectory`, optional
`work: WorkService`, and `sessionOwners: SessionOwnerRegistry`.

All methods are **requests** and must be added to `AHP_REQUEST_METHODS`; they
must never be accepted as notifications. Enforce `version: 1`, `.strict()`
schemas, bounded strings/payloads, and generic errors.

Methods and result shapes (exact v1):

- `x-ahp/agents/register`
  input `{ version: 1, agentKey, displayName? }`
  result `{ version: 1, agentId, presenceExpiresAt }`
- `x-ahp/agents/renew` input `{ version: 1 }`
  result `{ version: 1, agentId, presenceExpiresAt }`
- `x-ahp/agents/unregister` input `{ version: 1 }` result `null`
- `x-ahp/work/submit`
  input `{ version: 1, sessionUri, requestKey, kind, input, targetAgentId? }`
  result `{ version: 1, workId }`
- `x-ahp/work/claim` input `{ version: 1, sessionUri }`
  result `{ version: 1, work: { workId, sessionUri, kind, input, leaseToken, leaseExpiresAt, attempt } | null }`
- `x-ahp/work/renew` input `{ version: 1, workId, leaseToken }`
  result `{ version: 1, leaseExpiresAt }`
- `x-ahp/work/complete`
  input `{ version: 1, workId, leaseToken, result }` result `null`
- `x-ahp/work/fail`
  input `{ version: 1, workId, leaseToken, retryable, message }`
  result `{ version: 1, status }`
- `x-ahp/work/cancel` input `{ version: 1, workId }` result `null`
- `x-ahp/work/get` input `{ version: 1, workId }`
  result `{ version: 1, work: WorkView | null }`

Security rules:

- Missing `context.principal` → generic authentication-required error, no state
  change.
- Missing configured `agents`/`work` for a sensitive method → safe failure;
  never fall back to an anonymous adapter.
- `AuthorizedAgentContext` is built only from `context.principal`,
  `context.connectionId`, and `agents.getByConnection(...)`. Never accept an
  agent ID, principal, generation, or connection ID from request JSON.
- Work submit/cancel/get use the authenticated principal; never expose another
  principal's row, token or payload.
- Map `WorkError` codes to `RpcError` with generic messages:
  `invalid` → InvalidParams; `not_found`/`unauthorized` → generic
  `InvalidParams`; `conflict` → generic conflict; `stale`/`exhausted` →
  `InvalidRequest`.
- Do not log lease tokens, bearer tokens, or full task payloads.

### 3. Bind integration in `createAHPBinding`

Extend `createAHPBinding` with an optional third options argument:

```ts
{
  agents?: AgentDirectory;
  work?: WorkService;
  sessionOwners?: SessionOwnerRegistry;
}
```

- Merge the extension handlers with the baseline handlers without allowing
  custom methods to overwrite baseline names.
- On successful authenticated `createSession`, bind the session URI to the
  authenticated principal in `sessionOwners` (parse only `params.channel` after
  the factory has accepted the request).
- On a successful `disposeSession`, call `work?.assertSessionDisposable(channel)`
  **before** `factory.disposeSession`, then unbind the owner after success.
- On connection close, release that connection's agent presence through
  `agents.releaseConnection(context.connectionId)` in addition to existing tool
  cleanup.
- On binding dispose, release all presence and extension resources.
- Keep all existing unauthenticated baseline behavior unchanged.

### 4. Tests (your slice)

Add deterministic tests for:

- static authenticator accepts a valid bearer token and rejects missing/wrong
  credentials;
- registration is stable for the same `(principal, agentKey)`;
- self-reported `initialize.clientId` cannot acquire another agent;
- duplicate live binding is denied;
- renewal only from the current binding; different connection cannot renew;
- expired presence is offline; old close callback cannot remove a newer
  generation; host/dispose clears presence;
- new methods reject notifications, bad versions, extra fields, and missing
  authentication without state changes;
- session owner binding on create and unbind on dispose (unit-level binding
  test can use the frozen types and a fake factory);
- reply shapes for the agent methods.

Do not create a flaky timing test; inject the clock.

## Report back

When finished, write a short report to
`C:\Users\Yohan\AppData\Local\Temp\opencode\m2-terminal-b-report.md` containing:

- files changed;
- focused commands + exit codes;
- test counts/results;
- any shared-path change you need Terminal A to make;
- unresolved risks or things you could not verify.

Reply in the pane with only the report path and a one-line summary.

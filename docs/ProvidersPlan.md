# Providers & Client Connection Plan

Status: agreed, not yet implemented.

## Context

The repository currently has three capability modules under `src/`:

- `src/jsonrpc/` — JSON-RPC message schemas and types.
- `src/sessions/` — the host's session engine: a `SessionsFactory` that owns a
  provider registry and an in-memory session store, plus the `SessionProvider`
  contract an agent backend implements. `SessionBackend` today is only
  `{ dispose() }`.
- `src/websocket/` — a WebSocket transport that speaks JSON-RPC over text
  frames. It dispatches a handler map and today only `ping` is wired.

`@microsoft/agent-host-protocol` (`1.0.0`) supplies the client side of AHP:
`AhpClient` (`@microsoft/agent-host-protocol/client`), `WebSocketTransport`
(`@microsoft/agent-host-protocol/ws`), and the `MultiHostClient` host
management layer (`@microsoft/agent-host-protocol/hosts`).

## Framing

In this repo the word *provider* already means an **agent backend**
(`SessionProvider`). This plan deliberately reuses `providers/` for a
different, complementary thing: **client-connection adapters** — one per
client runtime, so that a given client can connect to this host. The
server-side agent-backend role stays with `src/sessions` for now.

Confirmed decisions:

1. **Pi is a client, not a backend**, in this slice. Sessions stay backed by
   the existing `mockProvider`.
2. **The adapter layer is bidirectional by design, client direction first.**
3. **Packaging is deferred.** The installable Pi extension that adds
   `/connectAHP` is a later slice; this slice builds the reusable connection
   core plus the abstraction it will call.
4. **Backends emit AHP `SessionAction`s directly.** Mapping from an agent's
   native events to AHP actions lives inside the adapter; the session layer
   stays generic.
5. **The AHP method layer folds into `src/websocket/`, under a `connection/`
   subfolder.**

## Goal and acceptance

A real AHP client, driven over WebSocket, can complete the full loop against
this host:

```
initialize  ->  subscribe('ahp-root://')  ->  createSession  ->  dispatchAction
                                                                    |
                                    root/sessionAdded  <-  action notification
```

```
AhpClient  (test harness now, Pi terminal later)
   |  WebSocketTransport  (@microsoft/agent-host-protocol/ws)
   v
src/websocket/connection  -- AHP methods -->  src/sessions factory  -->  mockProvider
```

Acceptance for this slice: an `AhpClient` over `WebSocketTransport` performs
`initialize`, subscribes to `ahp-root://`, creates a session, dispatches an
action, and observes the catalogue notification and echoed `ActionEnvelope`
without touching raw frames.

## Phase 1 — Extend the sessions contract (`src/sessions/`)

The factory has creation and read seams but no write/dispatch path, and a
backend cannot receive prompts or stream output.

- `src/sessions/types.ts`
  - Grow `SessionBackend` from `{ dispose() }` to carry prompt/event I/O:
    - `prompt(input): Promise<void>` — deliver a user message to the backend.
    - `abort(): Promise<void>` — cancel in-flight work.
    - an event seam the session layer subscribes to. Per decision 4, the
      backend emits AHP `SessionAction`s; the session layer stamps them with
      `serverSeq` and wraps them in an `ActionEnvelope`.
  - Add to `SessionsFactory`:
    - `dispatchAction(channel, clientSeq, action): Promise<void>` — route a
      client-supplied `StateAction` to the target session's backend, then echo
      it back as an `ActionEnvelope { channel, serverSeq, action }`.
    - `disposeSession(channel): Promise<void>` — dispose one session's backend
      and emit `root/sessionRemoved`.
    - `getRootSnapshot(): { resource, state, fromSeq }` — a `RootState`-shaped
      snapshot (`agents: listAgents()`, `activeSessions`) for `subscribe` and
      `initialize`.
- `src/sessions/createSession/` and `src/sessions/helpers/factory/` — connect
  the backend event seam to `emitSessionEnvelope`, and implement the new
  factory methods on top of the existing registry and reducer.
- `src/sessions/mock/` — teach `mockProvider` the new backend surface
  deterministically (echo prompt/action, resolve abort/dispose) so the current
  60 tests stay green and the end-to-end test has a real backend to drive.
- Tests: dispatch echo, per-channel routing, dispose, backend lifecycle, root
  snapshot shape.

## Phase 2 — AHP connection layer (`src/websocket/connection/`)

New submodule inside the websocket capability:

```
src/websocket/connection/
  index.ts
  types.ts
  helpers/handlers.ts
  helpers/registry.ts
  helpers/snapshot.ts
```

- `createAhpHandlers({ sessions }) => JsonRpcHandlers`, covering the methods a
  client needs:
  - `initialize` — Zod-validate `InitializeParams` (`protocolVersions`,
    `clientId`, `initialSubscriptions`); select a version from the client's
    list; return `InitializeResult` (`protocolVersion`, `serverSeq`,
    `snapshots` for each initial subscription, `serverInfo`). The server
    advertises AHP `1.0.0`.
  - `ping` — accept AHP `PingParams` (`channel: 'ahp-root://'`) and keep
    returning `null`.
  - `subscribe` — return `SubscribeResult.snapshot` per channel:
    `ahp-root://` yields the root snapshot, session URIs yield
    `getSessionSnapshot`.
  - `createSession` — delegate to `sessions.createSession`.
  - `unsubscribe` (notification) — drop the channel from the connection's
    subscription set.
  - `dispatchAction` (notification) — delegate to `sessions.dispatchAction`.
- **Per-connection state and broadcast.** `WebSocketConnectionContext` is
  currently send-only and per-connection, so add a connection registry
  (`add` / `remove` / `broadcast(channel, message)`) and extend the websocket
  server with connection open/close hooks so the layer can track each
  connection's `clientId` and subscriptions.
  - `sessions.onCatalogueNotification` -> `root/sessionAdded` /
    `root/sessionSummaryChanged`, delivered only to connections subscribed to
    `ahp-root://`.
  - `sessions.onSessionEnvelope` -> `action`, delivered only to connections
    subscribed to that session channel.
- Tests: raw JSON-RPC frames for error paths (missing `initialize`, invalid
  params, unknown channel), plus the real `AhpClient` + `WebSocketTransport`
  end-to-end acceptance test.

## Phase 3 — `src/providers/` client adapters + Pi

```
src/providers/
  index.ts
  types.ts
  constants.ts
  helpers/registry.ts
  helpers/factory.ts
  pi/index.ts
  pi/types.ts
  pi/constants.ts
```

- `types.ts` — the **bidirectional** adapter contract. Client direction is
  implemented now: `ClientAdapter` (`id`, `connect(options) -> { client:
  AhpClient, dispose() }`). A server-direction slot is reserved next to
  `SessionProvider` for a later slice.
- `helpers/registry.ts` / `helpers/factory.ts` — `createProvidersFactory(...)`
  building an id -> adapter map with duplicate detection, mirroring the shape
  of the sessions factory.
- `pi/` — `createPiClientAdapter(...)`: encapsulates host URL, `clientId`,
  offered protocol versions, and initial subscriptions, wrapping `AhpClient`
  plus the `/ws` `WebSocketTransport`. This is the reusable core the
  `/connectAHP` extension will call.
- **Deferred to the next slice:** the installable Pi-extension package (its
  own `package.json`, command registration). No Pi runtime dependency is added
  in this slice.
- Tests: registry/factory behaviour, and the Pi adapter connecting to a
  mock-backed host over WS.

## Phase 4 — Wiring at the app boundary

- `src/index.ts`: `createSessionsFactory({ providers: [mockProvider] })` ->
  `createAhpHandlers({ sessions })` -> `createWebSocketServer({ host, port,
  handlers })`. The entrypoint guard and `void main().catch(...)` stay as they
  are.
- `env/`: host and port are already validated. Add a key only if the Pi
  adapter needs a default URL; otherwise derive it from host/port.

## Phase 5 — Tests, docs, validation, commits

- Tests under the root `tests/` directory: `tests/sessions/*` (new contract),
  `tests/websocket/connection/*` (including the end-to-end `AhpClient` test),
  `tests/providers/*`.
- Update `docs/CodingRules.md` if new folders or aliases appear.
- `pnpm validate` green (lint, typecheck, tests, build).
- Commit as coherent units, for example:
  - `feat(sessions): extend backend contract with prompt/event I/O`
  - `feat(websocket): add AHP method and connection layer`
  - `feat(providers): add client adapter layer with a Pi target`

## Deferred / out of scope

- The installable Pi extension and its `/connectAHP` command.
- Any real agent backend behind `SessionBackend` (Pi as an agent backend).
- `reconnect`, `resource*`, chat/terminal/changeset/automation channels, and
  other AHP methods not needed for the acceptance loop.
- Persistence; the session store remains in-memory.

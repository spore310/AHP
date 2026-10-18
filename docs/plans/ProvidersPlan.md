# Providers & Client Connection Plan

Status: **Agreed direction. Milestones are proposed or agreed; none is
complete. Milestone 1 has partial implementation, but its acceptance is not
met.**

This is a target-state plan for connecting independent AHP clients (Pi and
others) to this server. It describes intended behavior, not current behavior;
see "Current implementation" for what exists today. An implementation agent
must not add a Pi runtime, model client, subprocess manager, or agent SDK to
this repository.

Terminology: on the server, *provider* already means an **agent backend**
(`SessionProvider`). This plan adds no server-side `src/providers/` module;
client integration lives in a separate client-side package.

## Established decisions

1. **Pi process and model execution live entirely on client machines.**
2. **The host owns** network connections, protocol operations, authoritative
   state, subscriptions, permissions, and (later) coordination between
   clients.
3. **The server must not** launch Pi, call model APIs, execute Pi prompts, or
   own Pi tools.
4. **Client integration belongs in a Pi extension / client-side package**, not
   under a server-side provider registry.

These decisions are not reopenable by an implementation agent. A server-owned
agent runtime is out of scope for this plan.

## Goal

A Microsoft SDK client (`AhpClient` over `WebSocketTransport`) connects to this
host, negotiates a protocol version, subscribes to the root channel, and drives
the session lifecycle:

```text
AhpClient  (test harness now, Pi extension later)
   |  WebSocketTransport  (@microsoft/agent-host-protocol/ws)
   v
src/websocket  (JSON-RPC transport + AHP method layer)
   v
src/sessions   (authoritative state; mock provider is test scaffolding)
```

Acceptance for Milestone 1: an `AhpClient` performs `initialize`, subscribes to
`ahp-root://`, creates a session, dispatches an action, and observes the
catalogue notification and the echoed `ActionEnvelope` without touching raw
frames.

## Current implementation (server)

- `src/jsonrpc/` — JSON-RPC message parsing and validation, plus the owned
  `RpcError`.
- `src/websocket/` — WebSocket transport: upgrade-path check, HTTP 426 for
  ordinary requests, frame-size limits, heartbeat, and race-safe start/stop
  with a shared, bounded shutdown. `src/index.ts` wires
  `createAHPHandlers` from `src/websocket/helpers/ahp.ts`, which handles
  initialization/version negotiation, ping, subscriptions, session creation,
  action dispatch, and notification fan-out. SDK smoke tests currently show
  that Milestone 1 acceptance is not met: another subscribed client misses
  catalogue notifications, the dispatching client receives duplicate action
  envelopes, commands are accepted before `initialize`, and an unsupported
  version does not close the connection.
- `src/sessions/` — the session factory: validated session creation,
  in-memory registry, snapshots, catalogue notifications, per-listener
  isolation, host-shared sequence injection, root/session snapshot reads,
  reducer-applied client actions, and disposal that rejects creation while in
  flight and reports sanitized late-cleanup diagnostics. `SessionBackend` is
  only `{ dispose() }`; `src/sessions/mock/` is deterministic test scaffolding,
  not an agent runtime.
- `src/tests/` — all tests. Tests are never colocated with source and never
  live at a root `tests/` directory.
- `@microsoft/agent-host-protocol` is pinned at `1.0.0`. The sessions
  capability uses its types, literal mirrors, error codes, and runtime
  reducer (`sessionReducer`); its client classes are not used by server code
  yet.

## Server / client ownership

| Concern                                                     | Owner         | Location                          |
| ----------------------------------------------------------- | ------------- | --------------------------------- |
| WebSocket transport, JSON-RPC framing, heartbeat, shutdown  | server        | `src/jsonrpc/`, `src/websocket/`  |
| AHP methods, version negotiation, subscriptions, broadcast  | server        | `src/websocket/` (AHP layer)      |
| Session registry, reducer-applied state, sequencing         | server        | `src/sessions/`                   |
| Client identity and presence registration                   | server + custom design | Milestone 2              |
| Pi process, model execution, prompts, tools                 | client        | Pi extension (Milestone 3)        |
| Client-to-client coordination                               | server + custom design | Milestone 4              |

Future layout (planning only; do not create now):

```text
AHP SERVER (this repository)
src/
  jsonrpc/     # wire parsing and typed errors
  websocket/   # transport; AHP method layer, keeping helpers/connection.ts
               # as the single per-socket JSON-RPC loop
  sessions/    # server-owned protocol state
  tests/       # all server tests

PI CLIENT EXTENSION (separate project; packaging TBD)
  index.ts
  types.ts
  helpers/connection/   # Microsoft AhpClient + WebSocketTransport
  helpers/tools/        # model-visible actions
  helpers/commands/     # human-visible Pi commands
```

## Native AHP vs custom extensions

Native AHP (source of truth: the pinned `@microsoft/agent-host-protocol`):

- Commands and notifications used by Milestone 1: `initialize`, `ping`,
  `subscribe`, `unsubscribe`, `createSession`, `dispatchAction`.
- Contract shapes: `InitializeParams` / `InitializeResult`,
  `Snapshot { resource, state, fromSeq }`,
  `ActionEnvelope { channel, action, serverSeq, origin }`, `RootState`,
  `SessionState`.
- Errors and versioning: `JsonRpcErrorCodes`, `AhpErrorCodes`,
  `UnsupportedProtocolVersion` (`-32005`) with
  `UnsupportedProtocolVersionErrorData.supportedVersions`,
  `SUPPORTED_PROTOCOL_VERSIONS`, `negotiateProtocolVersion`.
- Transport: `@microsoft/agent-host-protocol/ws` is built on the global
  `WebSocket` constructor (browsers and Node 21+; this repository pins
  Node 24).

Custom extensions are allowed only where native AHP has no home: remote-client
registration/presence and client-to-client coordination. Any custom method,
event, or channel must use an explicit namespaced name and schema, be validated
at the boundary, be versioned, and never impersonate a standard AHP provider.
A host-side Pi "agent" must never be advertised for a runtime that executes on
the client.

## Milestone 1 — Native AHP host connection (server-only) — Agreed / acceptance incomplete

1. **AHP method layer** in the websocket capability (new owner-aligned module,
   for example `src/websocket/ahp/`). It must not introduce a second connection
   manager: `src/websocket/helpers/connection.ts` remains the only per-socket
   JSON-RPC loop.
2. **`initialize`** — validate `InitializeParams` and negotiate with
   `negotiateProtocolVersion` over `SUPPORTED_PROTOCOL_VERSIONS`. When no
   version matches, answer `UnsupportedProtocolVersion` (`-32005`) with
   `supportedVersions` and close the connection. Must be the first request on
   a connection. Return `InitializeResult` with the negotiated version,
   `serverSeq`, and snapshots for `initialSubscriptions`.
3. **Per-connection state** — negotiated `clientId`, protocol version, and
   subscription set. `connectionId` (transport) is not `clientId`
   (negotiated), which is not a session URI, which is not an authenticated
   principal.
4. **`ping`** — the native handler accepts `PingParams` (its `channel` is
   required) and replaces the placeholder.
5. **`subscribe` / `unsubscribe`** — root channel (`ahp-root://`) and session
   URIs; return the `SubscribeResult` snapshot; `unsubscribe` is a
   notification that drops the channel from that connection's set.
6. **`createSession`** — delegate to the sessions factory.
7. **Root snapshot** for `initialize` and `subscribe`: a `RootState`-shaped
   snapshot (`agents` from the provider catalogue, `activeSessions` as
   available) with a truthful `fromSeq`. This needs a **current-sequence
   read**: `createSequenceAllocator` only mints the next value, so the host
   must track and expose the sequence current at snapshot time instead of
   inventing one. `InitializeResult.serverSeq` follows the same rule.
8. **Broadcast** — catalogue notifications (`root/sessionAdded`,
   `root/sessionSummaryChanged`, and `root/sessionRemoved` when session
   disposal is included) go only to connections subscribed to `ahp-root://`;
   session action envelopes go only to connections subscribed to that session
   channel. Catalogue notifications are not action envelopes and never consume
   the action sequence.
9. **Action echo** (`dispatchAction` → `action` notification) — validate
   `DispatchActionParams` and apply the action to the target session through
   the existing session reducer. The envelope's
   `origin: { clientId, clientSeq }` is stamped by the connection layer from
   the negotiated `clientId`; the sessions layer cannot derive `clientId`, so
   the origin must be passed in rather than invented. Accept only an explicit
   allowlist of client-dispatchable state actions; reject everything else.
   This adds no backend I/O: `SessionBackend` stays `{ dispose() }`.
10. **Session disposal** — if added in this milestone, `disposeSession` must
    also emit `root/sessionRemoved` and include it in the root broadcast list.

Implementation constraints confirmed against the pinned SDK:

- **Transport path:** the server's default upgrade path is `/`
  (`WEBSOCKET_DEFAULT_PATH`) and is configurable; the client URL must use the
  server's configured path. Do not assume `/ws`.
- **Sequencing ownership:** one connection-wide action sequence, monotonic and
  gap-free for emitted actions, shared across sessions through the injectable
  allocator. The allocator orders actions only; it does not by itself provide
  reconnect safety. A future connection manager owns serverSeq allocation,
  current-sequence reads, snapshot cursors, envelope fan-out, origin stamping,
  notification routing, and later retention/replay.
- **Tests:** raw JSON-RPC frames for error paths (missing `initialize`, invalid
  params, unknown channel) plus the real `AhpClient` + `WebSocketTransport`
  end-to-end acceptance test, all under `src/tests/`. Update
  `docs/CodingRules.md` if new folders or aliases appear.
- **Wiring:** derive the client URL from the validated
  `AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST` / `..._PORT` values; add a URL
  environment key only if the client package needs one.

## Milestone 2 — Remote-client identity / presence design — Proposed

- Define how an independently running Pi client registers an addressable agent
  instance, renews a lease, disconnects, and reclaims identity.
- Clarify standard AHP session-hosting semantics versus any custom
  client-owned session or participant registration. Never advertise a
  host-side Pi runtime as a standard provider.
- Define authentication and authorization before accepting a non-loopback
  deployment: a client ID is not authentication; use explicit principals and
  access checks.
- Agree on protocol representation before implementation: native AHP where
  suitable, otherwise explicit namespaced methods/events with validation and
  versioning.

## Milestone 3 — Pi client extension (client-side package) — Proposed

- Build a Pi extension that uses Microsoft's AHP client SDK (not a duplicate
  wire implementation), opens its own WebSocket connection, initializes,
  subscribes, and exposes `/connectAHP` or similar commands and agent tools.
- Decide the package/repository boundary separately; do not add Pi
  dependencies to this host package merely to build a client extension.
- Distinguish notifications visible in Pi's UI from information explicitly
  exposed to Pi's model context through tools/events.

## Milestone 4 — Client-to-client coordination — Proposed

- Define addressed message/task envelopes, delivery acknowledgment,
  idempotency, permissions, ordering, and offline/disconnect policy.
- Do not assume that storing AHP session state alone delivers messages into a
  second agent's local model runtime.
- Keep coordination distinct from session snapshots, chat actions, and
  terminal channels.

## Milestone 5 — Reconnect & replay — Proposed

- Add the bounded or durable event journal and subscription reconciliation
  only once the transport and action publication work; verify ordering across
  channel producers.
- Reconnect is a host connection-manager concern; `createSequenceAllocator`
  alone is not a replay mechanism.

## Removed or deferred from the earlier draft

- `prompt()`, `abort()`, and stream events on the server-side
  `SessionBackend`: removed. The mock provider remains test scaffolding with
  `{ dispose() }`; reintroduce a backend I/O contract only under an
  independently approved server-owned runtime.
- `src/providers/` client-adapter layer in this repository (including a
  reserved server-direction slot and its speculative factory): removed. Client
  adapters live in the client package.
- Root `tests/` paths: corrected to `src/tests/`.
- `MultiHostClient` (`@microsoft/agent-host-protocol/hosts`) is not used here;
  it targets clients that manage several hosts.

## Non-goals

No Kubernetes, Redis, database, queues, remote agent process management,
additional deployment node, agent SDK on the server, or multi-agent
orchestration implementation in these milestones. The server stays a
single-node modular monolith; persistence and multi-host management remain out
of scope until a demonstrated need exists.

## Acceptance

Milestone 1 is proven by the SDK-based end-to-end test and the raw-frame
error-path tests above. The later acceptance gate for Milestone 5: two
independent clients and multiple sessions, with concurrent publication and
mid-stream subscribe/reconnect, obtain consistent state with no missing or
duplicate actions, validated against the supported protocol version of the
pinned Microsoft SDK.

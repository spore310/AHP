# Capability Map and Architecture

How the capabilities of Agent Hosting Protocol compose, and where each concern
is owned. This is the system view; per-file detail lives in the module READMEs
linked below.

## Capabilities

| Capability | Location | README | Owns |
| ---------- | -------- | ------ | ---- |
| JSON-RPC | `src/jsonrpc/` | [`../../src/jsonrpc/README.md`](../../src/jsonrpc/README.md) | Message schemas, the owned `RpcError`, the public error-code allowlist. |
| Sessions | `src/sessions/` | [`../../src/sessions/README.md`](../../src/sessions/README.md) | Provider registry, session store, reducer-applied state, sequencing, lifecycle. |
| WebSocket | `src/websocket/` | [`../../src/websocket/README.md`](../../src/websocket/README.md) | Upgrade handling, per-socket dispatch, heartbeat, bounded shutdown. |
| Environment | `env/` | [`../../env/README.md`](../../env/README.md) | Validated process configuration. |
| Composition root | `src/index.ts` | [`../../src/README.md`](../../src/README.md) | Wiring, entrypoint, shutdown handlers. |

Tests live under `src/tests/`, mirroring `src/`; each module README has a
**Testing** table mapping its tests to the behavior they pin.

## Dependency direction

Imports point one way. Do not reverse them:

```text
src/index.ts  (composition root)
   │  builds
   ├──> env                     (validated config)
   └──> src/websocket           (transport, injected handlers)
             │  dispatches with
             └──> src/jsonrpc  (schemas + RpcError)
   (sessions is not wired into the running server yet)
```

- `jsonrpc` depends on nothing in `src/`.
- `websocket` depends on `jsonrpc` (schemas, error type). It does **not** depend
  on `sessions`.
- `sessions` depends on `jsonrpc` (for `RpcError`) and the protocol package. It
  does **not** depend on `websocket`.
- The composition root is the only place that knows both transport and business
  capabilities.

This keeps the session engine transport-agnostic and composable behind any
transport, and keeps `jsonrpc` free of I/O.

## Composition root

`src/index.ts` is deliberately thin:

```text
loadEnv() → createWebSocketServer({ handlers }) → start() → installShutdownHandlers()
```

Today the handler map is `{ ping: () => null }`. The WebSocket transport is
fully built, but session creation, subscription, and chat are not exposed on the
wire; wiring them is
[`docs/plans/ProvidersPlan.md`](../plans/ProvidersPlan.md) (target state, not
implemented).

Two properties of the root matter:

- **Import is inert.** An `isEntrypoint()` guard compares `process.argv[1]` to
  the module path, so importing the composition root from a test never binds a
  port.
- **Shutdown is best-effort and observable.** `installShutdownHandlers` wires
  `SIGINT`/`SIGTERM` to `server.stop()` and records failure by setting
  `process.exitCode = 1`.

## Data flow: creating a session

The sessions path is designed end-to-end even though it is not yet reachable
over the wire:

```text
client ──JSON-RPC "createSession"──> [future AHP layer] ──> SessionsFactory.createSession
                                                                │
        validate params ──> resolve provider ──> check uniqueness
                                                                │
        parse config (provider owns policy) ──> register record
                                                                │
        emit "root/sessionAdded" (catalogue) ──> start backend
                                                                │
        session/ready | session/creationFailed ──> applySessionAction
                                                                │
        emit ActionEnvelope (session channel) + "root/sessionSummaryChanged"
```

Key invariants:

- Catalogue notifications target the **root channel** (`ahp-root://`) and never
  consume the action sequence.
- Action envelopes live on the **session channel** (`ahp-session:/<id>`) and
  carry a host-allocated `serverSeq`.
- `applySessionAction` is the only state mutation path; snapshots and delivered
  events are `structuredClone`d per consumer.

## What is not implemented

- Binding sessions to the wire (initialize, subscribe, createSession dispatch,
  action echo, broadcast). See
  [`docs/plans/ProvidersPlan.md`](../plans/ProvidersPlan.md).
- A backend I/O contract: `SessionBackend` is `{ dispose() }` only, so there is
  no prompt/stream surface.
- Persistence, multi-host management, presence, and replay.

## Related Documentation

- [`../../README.md`](../../README.md) — repository overview and status.
- [`../technical/wire-contract.md`](../technical/wire-contract.md) — the AHP
  wire contract.
- [`../technical/runtime-lifecycles.md`](../technical/runtime-lifecycles.md) —
  session and server lifecycles.

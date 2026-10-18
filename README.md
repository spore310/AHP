# Agent Hosting Protocol

An AHP host: a server that hosts agent sessions and speaks the
[Agent Hosting Protocol](https://github.com/spore310/AHP) to clients over a
WebSocket JSON-RPC 2.0 transport.

The repository is a capability-oriented modular monolith. See
[`.agents/AGENTS.md`](.agents/AGENTS.md) for repository-wide invariants and
[`docs/CodingRules.md`](docs/CodingRules.md) for coding conventions.

## Status

Early scaffold. The host is **not** yet a complete AHP endpoint.

Implemented today:

- `src/jsonrpc/` — JSON-RPC 2.0 message schemas, the owned `RpcError`, and the
  allowlisted error codes the transport may surface.
- `src/sessions/` — the session engine: a `SessionsFactory` that owns a
  provider registry, an in-memory session store, a shared action-sequence
  allocator, and a `SessionProvider` contract for agent backends. It is
  AHP-aware but transport-agnostic.
- `src/websocket/` — a JSON-RPC-over-WebSocket server. It dispatches a handler
  map, contains malformed upgrades, and shuts down idempotently within a
  deadline.
- `env/` — environment validation.

Currently **only the `ping` method is wired** into the running server. Session
creation, subscription, and chat are not exposed on the wire yet.

Planned milestones, in order:

1. A mock-backed AHP host connection: `initialize`, `ping`, `subscribe`,
   `unsubscribe`, `createSession`, and action echo, proven with a real
   `AhpClient` over `WebSocketTransport`.
2. Remote-client identity and presence design.
3. A Pi client extension in a separate client-side package.
4. Client-to-client coordination.
5. Reconnect and replay.

Chat channels and turn execution remain later server capabilities and are not
yet specified. See [`docs/ProvidersPlan.md`](docs/ProvidersPlan.md) for the
client-connection milestones.

## Requirements

- Node.js 24.x
- pnpm 10.34.6

## Install and run

```sh
pnpm install
pnpm build
pnpm start
```

`pnpm start` runs the built entrypoint at `dist/index.js`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST` | `127.0.0.1` | Network interface to bind. |
| `AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT` | `12345` | TCP port to bind (1–65535). |

Unknown environment variables are ignored. Invalid values fail startup with a
message that names the offending keys only, never their values.

## Wire behavior

The server accepts WebSocket upgrades on `/` and speaks JSON-RPC 2.0 over text
frames. Ordinary HTTP requests receive `426 Upgrade Required`. Malformed upgrade
targets are rejected without affecting the running server.

Example exchange:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "ping" }
{ "jsonrpc": "2.0", "id": 1, "result": null }
```

## Development

```sh
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest
pnpm validate     # lint, typecheck, test, build — run before completing a change
```

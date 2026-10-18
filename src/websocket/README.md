# WebSocket Transport

A JSON-RPC 2.0 server over WebSocket text frames. The raw transport owns the
network boundary: upgrade handling, per-socket framing and dispatch, heartbeat,
and race-safe start/stop with a bounded shutdown. It is session-agnostic;
method handlers are injected.

The contained AHP binding is AHP-aware. It owns connection lifetime,
initialization, subscriptions, and fan-out. Session policy stays in `@sessions`;
the binding does not import sockets into that module.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `WebSocketServerOptions`, `WebSocketServerHandle`, `JsonRpcHandler(s)`, and `WebSocketConnectionContext`. |
| `helpers/server.ts` | `createWebSocketServer`: HTTP/WebSocket lifecycle, upgrade checks, heartbeat, and shutdown. |
| `helpers/connection.ts` | `attachConnection`: per-socket framing, serialized dispatch, reply settlement, and error mapping. |
| `helpers/ahp/index.ts` | Public AHP binding exports. |
| `helpers/ahp/helpers.ts` | `createAHPBinding`: initialize, subscriptions, publication, and connection lifetime. |
| `helpers/ahp/types.ts` | AHP peer, adapter, and parameter schemas. |
| `helpers/ahp/constants.ts` | Method kinds, baseline action inventory, and pending-delivery limit. |
| `helpers/host/index.ts` | Public composed-host exports. |
| `helpers/host/helpers.ts` | `createAHPServer`: owns sequence injection, sessions, binding, transport, and shutdown. |
| `helpers/host/types.ts` | `AHPServerOptions` and `AHPServerHandle`. |
| `constants.ts` | Default path, heartbeat interval, payload limit, close codes, shutdown deadline, and the `426` status. |
| `index.ts` | Public surface: `createAHPConnectionModule`, `createAHPServer`, `createWebSocketServer`, option/handle types, and constants. |

## API

- `createWebSocketServer(options: WebSocketServerOptions): WebSocketServerHandle`
  - `options.host` / `options.port` — bind address; `port: 0` requests an
    ephemeral port.
  - `options.path` — required upgrade path (default `WEBSOCKET_DEFAULT_PATH`,
    `"/"`).
  - `options.handlers` — `Readonly<Record<string, JsonRpcHandler>>`.
  - `options.shutdownTimeoutMs` — graceful-shutdown deadline (default `5000`).
- `handle.start(): Promise<AddressInfo>` — resolves with the bound address.
- `handle.stop(): Promise<void>` — resolves once local resources are released.
- `JsonRpcHandler = (params, context, invocation) => unknown`
  - return value → the request's `result`; a thrown value → an error response.
  - `invocation.onReplySettled` runs after that invocation's response is enqueued.
- `WebSocketConnectionContext.send(message)` — enqueue a JSON-RPC message.
  Returns whether the open socket accepted the frame.
- `createAHPConnectionModule(factory)` — wire-only handlers plus `onConnection`,
  `beforeDispatch`, and `dispose`. Cleanup is not an RPC method.
- `createAHPServer({ host, port, path, sessions })` — composed host. `stop()`
  releases transport, binding, and sessions. It is terminal, including after a
  failed `start()`. `host.sessions.createSession` and
  `host.sessions.dispatchAction` then reject; a second `start()` rejects.

## 5-Minute Usage

```ts
import { createWebSocketServer } from "@websocket";

const server = createWebSocketServer({
  host: "127.0.0.1",
  port: 0,
  handlers: {
    ping: () => null,
  },
});

const address = await server.start();
console.log(`listening on ws://${address.address}:${address.port}`);

await server.stop();
```

## Intermediate Usage

Return values become results; throw an owned `RpcError` (or a `ZodError`) to
produce a specific error response. Anything else is reported generically.

```ts
import { RpcError } from "@jsonrpc";
import { z } from "zod";

const echoParams = z.object({ value: z.string() });

const server = createWebSocketServer({
  host: "127.0.0.1",
  port: 0,
  path: "/ahp",
  shutdownTimeoutMs: 1_000,
  handlers: {
    echo: (params) => {
      const { value } = echoParams.parse(params); // ZodError → -32602
      if (value.length > 100) {
        throw new RpcError(-32602, "value is too long");
      }
      return { value };
    },
  },
});
```

## Advanced Usage

Use the connection context to push server-initiated notifications on the same
socket:

```ts
const server = createWebSocketServer({
  host: "127.0.0.1",
  port: 0,
  handlers: {
    subscribe: (params, context) => {
      // context.connectionId identifies this socket; context.send is a no-op
      // once the socket is closed.
      context.send({ jsonrpc: "2.0", method: "subscribed", params: { ok: true } });
      return null;
    },
  },
});
```

## Caveats

- **The lifecycle is single-flight and terminal.** `start()` after shutdown
  rejects; concurrent `start()` calls share one bind; a bind failure returns to
  `idle` so a later `start()` can retry. A `stop()` that races an in-flight bind
  leaves no listener behind.
- **Only the configured path upgrades.** A wrong path gets `404`, a malformed
  request target gets `400`, and an upgrade while not `listening` gets `503`.
  Ordinary HTTP requests receive `426 Upgrade Required`.
- **Heartbeat terminates unresponsive sockets.** Every
  `WEBSOCKET_HEARTBEAT_INTERVAL_MS` (`30s`) a socket that did not `pong` since
  the previous ping is terminated.
- **Binary frames close the connection** with code `1003`; only text frames are
  parsed.
- **`send` is best-effort.** It is a no-op once the socket is no longer open; it
  does not queue messages for a closing connection.
- **The raw transport does not broadcast.** A generic handler sees only its
  own connection context. The AHP binding, not the socket loop, owns fan-out
  for root and session subscriptions.
- **Shutdown is bounded.** Clients get up to `shutdownTimeoutMs` to close, then
  remaining sockets and HTTP connections are force-closed; `stop()` still awaits
  local release. A slow remote peer is not guaranteed to observe the close
  handshake.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/websocket.test.ts`](../tests/websocket.test.ts) | Request/result and error mapping, parse and invalid-request handling, notification silence, binary-frame close, upgrade path/malformed-target rejection, own-property dispatch, lifecycle (stop-races-bind, terminal stop, shared bind, retry after failure, heartbeat cleanup), and bounded shutdown. |
| [`src/tests/websocket/ahp.test.ts`](../tests/websocket/ahp.test.ts) | Connection lifetime, single publication, pre-initialize rejection, unsupported-version close, failed-subscribe rollback, and post-snapshot action ordering. |
| [`src/tests/websocket/composition.test.ts`](../tests/websocket/composition.test.ts) | Two composed hosts do not share sessions; stop and failed start are terminal for start and session mutations. |
| [`src/tests/websocket/sdk.test.ts`](../tests/websocket/sdk.test.ts) | Installed SDK client initializes, observes catalogue fan-out, and receives one accepted rename. |
| [`src/tests/websocket/sessionTypeCapacity.test.ts`](../tests/websocket/sessionTypeCapacity.test.ts) | A header-enum session type accepts creation, omits admin tools, and rejects object or unmapped headers. |

## Related Documentation

- [`src/jsonrpc/README.md`](../jsonrpc/README.md) — the schemas and error type
  dispatched here.
- [`docs/technical/wire-contract.md`](../../docs/technical/wire-contract.md) —
  error mapping and classification rules.
- [`docs/technical/runtime-lifecycles.md`](../../docs/technical/runtime-lifecycles.md)
  — the server lifecycle state machine in detail.

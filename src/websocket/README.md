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
| `types.ts` | `WebSocketServerOptions`, `WebSocketServerHandle`, `JsonRpcHandler(s)`, `WebSocketConnectionContext`, and the optional handshake authenticator. |
| `helpers/server.ts` | `createWebSocketServer`: HTTP/WebSocket lifecycle, upgrade checks, handshake authentication, heartbeat, and shutdown. |
| `helpers/connection.ts` | `attachConnection`: per-socket framing, serialized dispatch, reply settlement, principal attachment, and error mapping. |
| `helpers/ahp/index.ts` | Public AHP binding exports. |
| `helpers/ahp/helpers.ts` | `createAHPBinding`: initialize, subscriptions, publication, connection lifetime, session-owner binding acquired at the record-attach moment, and extension wiring. |
| `helpers/ahp/agentWork.ts` | Authenticated agent registration/presence and work request handlers, schemas, and error mapping. |
| `helpers/ahp/toolInvocation.ts` | Namespaced client-executed tool calls, accepted executor ownership, contract validation, and settlement. |
| `helpers/ahp/types.ts` | AHP peer, adapter, parameter schemas, and `AHPBindingOptions`. |
| `helpers/ahp/constants.ts` | Method kinds, authenticated extension method inventory, baseline action inventory, and pending-delivery limit. |
| `helpers/host/index.ts` | Public composed-host exports. |
| `helpers/host/helpers.ts` | `createAHPServer`: owns sequence injection, sessions, binding, transport, and shutdown. |
| `helpers/host/types.ts` | `AHPServerOptions` and `AHPServerHandle`. |
| `helpers/settling.ts` | Shared settle-window probe: an owner binding without a live record means a disposal is still settling, so creates stay denied for every principal until the settlement releases the binding. |
| `constants.ts` | Default path, heartbeat interval, payload limit, close codes, shutdown deadline, and the `426` status. |
| `index.ts` | Public surface: `createAHPConnectionModule`, `createAHPServer`, `createWebSocketServer`, option/handle types, and constants. |

## API

- `createWebSocketServer(options: WebSocketServerOptions): WebSocketServerHandle`
  - `options.host` / `options.port` — bind address; `port: 0` requests an
    ephemeral port.
  - `options.path` — required upgrade path (default `WEBSOCKET_DEFAULT_PATH`,
    `"/"`).
  - `options.handlers` — `Readonly<Record<string, JsonRpcHandler>>`.
  - `options.authenticator` — optional handshake credential verifier. A resolved
    principal is attached to `WebSocketConnectionContext.principal`.
  - `options.shutdownTimeoutMs` — graceful-shutdown deadline (default `5000`).
- `handle.start(): Promise<AddressInfo>` — resolves with the bound address.
- `handle.stop(): Promise<void>` — resolves once local resources are released.
- `JsonRpcHandler = (params, context, invocation) => unknown`
  - return value → the request's `result`; a thrown value → an error response.
  - `invocation.onReplySettled` runs after that invocation's response is enqueued.
- `WebSocketConnectionContext.send(message)` — enqueue a JSON-RPC message.
  Returns whether the open socket accepted the frame.
- `createAHPConnectionModule(factory, reportDiagnostic?, options?)` — wire-only
  handlers plus `onConnection`, `beforeDispatch`, and `dispose`. Cleanup is not
  an RPC method. The optional third argument enables the agent/work extension
  with `agents`, `work`, and `sessionOwners`.
- `createAHPServer({ host, port, path, sessions, agentWork? })` — composed host.
  `agentWork` optionally adds the static-token authenticator, PostgreSQL-backed
  registration/work ports, allowed kinds, presence TTL, and pool cleanup. `stop()`
  releases transport, binding, sessions, and the optional pool. It is terminal,
  including after a failed `start()`. `host.sessions.createSession` and
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
- **Authentication is opt-in and fail-closed for the extension.** Only the
  upgrade `Authorization` header is read; `initialize.clientId` is a label, not
  identity. A missing credential still permits baseline methods but every
  agent/work method rejects. Static bearer tokens are POC-grade, not production
  identity.
- **Work is not tool invocation.** `x-ahp/tools/*` is short-lived and private;
  `x-ahp/work/*` is durable coordination with a database lease. The server never
  executes stored work.
- **Host-side session creation has no authenticated owner.** Calling
  `host.sessions.createSession` bypasses a WebSocket principal, so the resulting
  session cannot own or accept work. Create work-enabled sessions through an
  authenticated AHP `createSession`. Direct host disposal checks dependent work
  and releases the owner binding when the record removal settles — success or
  failure — but it does not add authorization.
- **Session ownership binds at the record-attach moment.** The AHP
  `createSession` acquires the owner binding when the record is attached —
  before the catalogue broadcast and the backend start — and verifies at
  resolution that the live record survived and is not owned by a different
  principal. A create whose record was removed mid-start (its own disposal, or
  the URI re-attached by a successor) answers typed Conflict ("The created
  session is no longer available.") and never re-binds the URI; a
  same-principal successor attach resolves success for both creates under one
  identity — the deferred residual documented in `src/work/README.md`
  ("Same-owner recreate residual"). While a disposal is settling (binding
  held, record gone), every create stays denied — on the AHP wire and on
  `host.sessions.createSession` alike — until the settlement releases the
  binding, and a custom owner registry whose `unbind` throws fails the
  disposal loudly instead of silently keeping a binding no settlement will
  release.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/websocket.test.ts`](../tests/websocket.test.ts) | Request/result and error mapping, parse and invalid-request handling, notification silence, binary-frame close, upgrade path/malformed-target rejection, own-property dispatch, lifecycle (stop-races-bind, terminal stop, shared bind, retry after failure, heartbeat cleanup), and bounded shutdown. |
| [`src/tests/websocket/ahp.test.ts`](../tests/websocket/ahp.test.ts) | Connection lifetime, single publication, pre-initialize rejection, unsupported-version close, failed-subscribe rollback, and post-snapshot action ordering. |
| [`src/tests/websocket/composition.test.ts`](../tests/websocket/composition.test.ts) | Two composed hosts do not share sessions; stop and failed start are terminal for start and session mutations. |
| [`src/tests/websocket/sdk.test.ts`](../tests/websocket/sdk.test.ts) | Installed SDK client initializes, observes catalogue fan-out, and receives one accepted rename. |
| [`src/tests/websocket/sessionTypeCapacity.test.ts`](../tests/websocket/sessionTypeCapacity.test.ts) | A header-enum session type accepts creation, omits admin tools, and rejects object or unmapped headers. |
| [`src/tests/websocket/toolInvocation.test.ts`](../tests/websocket/toolInvocation.test.ts) | Real SDK sockets: matching manifests, atomic/private advertisement denial, local calls/results and privacy, outsider/schema rejection, forged/stale/ambiguous executors, disconnect/URI reuse, concurrent self-calls, capacity/release, and empty registration. |
| [`src/tests/websocket/deferred.test.ts`](../tests/websocket/deferred.test.ts) | A broken completion predicate cannot escape the ordered socket queue. |
| [`src/tests/agents/authenticator.test.ts`](../tests/agents/authenticator.test.ts) | Bearer parsing, exact token lookup, missing/unknown credentials, repeated headers, and value-free errors. |
| [`src/tests/agents/directory.test.ts`](../tests/agents/directory.test.ts) | Stable registration, cross-principal denial, disabled agents, one live binding, generation fencing, expiry, and stale release. |
| [`src/tests/websocket/agentWork.test.ts`](../tests/websocket/agentWork.test.ts) | Extension request/notification kinds, strict v1 schemas, authenticated identity derivation, exact replies, sanitized errors, a service-length request key accepted at the wire with longer ones rejected before the service, and depth-budget rejection before the service runs. |
| [`src/tests/websocket/agentWork.binding.test.ts`](../tests/websocket/agentWork.binding.test.ts) | Session-owner binding, disposal ownership/conflict, and presence release on close/dispose. |
| [`src/tests/websocket/agentWork.disposal.test.ts`](../tests/websocket/agentWork.disposal.test.ts) | Disposal races: the binding held through a parked settle, settlement-last on backend disposal failure, the settle window denying every principal, stale starts neither binding foreign successors nor ghosts, in-flight foreign disposal denial, a failing settlement unbind failing loudly and healing on re-dispose, and the shared settle-window probe. |
| [`src/tests/websocket/agentWork.transport.test.ts`](../tests/websocket/agentWork.transport.test.ts) | Handshake auth vs. `clientId`, delayed auth frame buffering, thrown-authenticator containment, and real-socket extension calls. |
| [`src/tests/websocket/agentWork.integration.test.ts`](../tests/websocket/agentWork.integration.test.ts) | Composed host: authenticated A/B submit → register → claim → renew → complete → get through the real work service, with owner and secret checks, and the fail-closed host facade during a settling disposal. |

## Namespaced client tool invocation

The opt-in `x-ahp/tools/call` request validates against the session's issued
manifest and routes work only to the unique connected peer that both submitted
an accepted advertisement and is still subscribed to that session. Duplicate
claimed client IDs are ambiguous and rejected; a stale advertisement never
routes to a replacement connection. The server never executes tool code.
Invocation and completion are namespaced extensions, not standard AHP methods;
inputs and results are not fanned out. Completion is accepted only from the
exact executor connection that received the call. The caller must also be
subscribed to the session. The raw receive loop defers
only the invocation request response and permits only its matching completion
notification through that pending request; other frames remain serialized. This
allows self-calls without changing ordinary AHP request ordering. See
[`src/toolClient/README.md`](../toolClient/README.md) for the client adapter and
its trust limitations.

## Related Documentation

- [`src/jsonrpc/README.md`](../jsonrpc/README.md) — the schemas and error type
  dispatched here.
- [`docs/technical/wire-contract.md`](../../docs/technical/wire-contract.md) —
  error mapping and classification rules.
- [`docs/technical/runtime-lifecycles.md`](../../docs/technical/runtime-lifecycles.md)
  — the server lifecycle state machine in detail.

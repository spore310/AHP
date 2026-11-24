# General client

`connectClient(connection, options)` initializes the pinned Microsoft AHP
client. Use `client.protocol` for native operations and `client.rpc` for
extension requests, notifications and observers. Both share one receive loop.
Applications that need private tools attach the [tool client](../tool/helpers/client/README.md).
Native initialization sends the client ID and protocol versions. The pinned
Microsoft SDK has no display-name field on that request.

```ts
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { connectClient } from "@client";

const transport = await WebSocketTransport.connect(url);
const client = await connectClient({ transport, ownership: "owned" }, {
  clientId: "workspace", protocolVersions: ["1.0.0"],
});
try {
  await client.protocol.ping();
} finally {
  await client.shutdown();
}
```

An owned endpoint closes once. For a borrowed logical endpoint, supply
`{ transport, ownership: "borrowed", detach }`. Its detach callback
releases the reader and the endpoint's remote identity. Closing the client,
remote EOF and fatal transport failures end the same lifetime. The connection
also observes the SDK's state stream from before initialization and retires
its endpoint if the native reader closes independently.
The pinned SDK tears down on every refused native write, including a full
send queue. An extension capacity rejection leaves the connection usable.
Adapters use the lifetime signal and register synchronous cleanup for pending local state.
Calls to `client.shutdown()`, `client.protocol.shutdown()` and an attached
tool client's `shutdown()` share a promise that settles when endpoint release
finishes, including when a borrowed detach rejects.

Extension requests and notifications share a 64-send limit. At most 64
extension requests can await replies. The default timeout is five seconds,
with a maximum of 35 seconds. Aborting or timing out a request retires its
response correlation. A send that is already in progress occupies capacity
until the underlying transport settles. A notification resolves on send.
An extension request refused at capacity can be retried. The pinned SDK
treats a refused native send as fatal, so that path ends the shared lifetime.
Each private notification method has one owner. A work connection adapter
fans its two methods out to the connected work projections.

## Files

| File | Responsibility |
| --- | --- |
| `index.ts` | General client entry point. |
| `types.ts` | Connection ownership, RPC and lifetime contracts. |
| `helpers.ts` | Native initialization and client lifetime. |
| `helpers/transport/index.ts` | Portable transport exports. |
| `helpers/transport/helpers.ts` | Shared frame reader, bounded sends and response correlation. |

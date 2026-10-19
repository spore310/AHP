# Tool client

`src/toolClient` is an opt-in client-side executor for the namespaced
`x-ahp/tools/*` extension. The AHP server validates typed manifest contracts
and routes calls to a connected advertising client; it never executes tool
functions itself.

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Local implementation, invocation context, connect options, and `ToolClient` contract. |
| `transport.ts` | Public `AhpTransport` wrapper that intercepts invocation notifications while forwarding standard frames. |
| `index.ts` | `connectToolClient`: SDK connection, manifest discovery, advertisement acknowledgement, and local call API. |
| [`../tests/toolClient.test.ts`](../tests/toolClient.test.ts) | UUID request correlation and invocation-notification validation over a fake SDK transport. |
| [`../tests/toolClient/connection.test.ts`](../tests/toolClient/connection.test.ts) | Initialization failure closes the actual client socket. |

## Example

```ts
import { connectToolClient } from "@toolClient";
import { defineToolContract } from "@tools";

const echo = defineToolContract({
  id: "11111111-1111-4111-8111-111111111111",
  key: "example.echo",
  version: 1,
  name: "echo",
  schemaDialect: "draft-07",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
});
const client = await connectToolClient("ws://127.0.0.1:3000/", {
  clientId: "local-tools",
  protocolVersions: ["1.0.0"],
});
try {
  const channel = "ahp-session:/example";
  await client.joinSession(channel, [{
    definition: echo,
    execute: (input) => ({ result: input }),
  }]);
  const result = await client.callTool(channel, { key: echo.key, version: echo.version }, { text: "hello" });
  console.log(result);
} finally {
  await client.shutdown();
}
```

`joinSession` discovers the issued contract from the session snapshot; the
example implementation remains local to this client.

The extension is not a standard AHP method. `ToolClient.callTool` sends
`x-ahp/tools/call`; the server validates the input against the typed session
manifest and routes `x-ahp/tools/invoke` only to the unique connected client
advertising that exact contract. That client runs its local implementation and
returns `x-ahp/tools/complete`; the server validates declared output schemas
and returns the result only to the requester. Calls and results are bounded to 1 MiB, have a 64-call in-flight capacity,
and use a 30-second server timeout; disconnects, session removal, and host
shutdown reject outstanding calls. An undeclared output schema permits any
bounded JSON result; declared output schemas are enforced.

`joinSession` accepts a supported subset, including an empty list, waits for
its exact server action acknowledgement, and atomically activates the matching
local handler set only after acceptance. Failed advertisements preserve the
previous active set. Initialization failure shuts down the transport.

## Calling a tool

With the default example host running, this harmless local handler demonstrates
an actual invocation/result round trip. It echoes the input; it does not read a
file. Replace the handler with an explicitly authorized client implementation.

```ts
import { createBaselineSessionApplication } from "@application";
import { connectToolClient } from "@toolClient";

const policy = createBaselineSessionApplication();
const contract = policy.catalogue.resolveExisting({ key: "code-review", version: 1 })
  .tools.find((tool) => tool.key === "workspace.read-file");
if (contract === undefined) throw new Error("Missing local contract");

const url = "ws://127.0.0.1:12345/";
const executor = await connectToolClient(url, { clientId: "executor", protocolVersions: ["1.0.0"] });
const caller = await connectToolClient(url, { clientId: "caller", protocolVersions: ["1.0.0"] });
try {
  const channel = "ahp-session:/call-demo";
  await executor.client.request("createSession", { channel });
  await executor.joinSession(channel, [{
    definition: contract,
    execute: (input) => ({ echo: input }),
  }]);
  await caller.joinSession(channel, []); // Subscribe without contributing tools.
  const result = await caller.callTool(channel, {
    key: contract.key, version: contract.version,
  }, { path: "example.txt" });
  console.log(result); // { echo: { path: "example.txt" } }
} finally {
  await Promise.all([caller.shutdown(), executor.shutdown()]);
}
```

## Limits and trust

The SDK handles ordinary protocol operations; the wrapper handles only valid
JSON-RPC invocation notifications (not request-shaped messages). Same-socket calls are supported through a narrow
receive-loop seam: only a completion matching a pending invocation may pass a
deferred `x-ahp/tools/call`; ordinary requests and notifications remain queued
until outstanding calls settle. An implementation should not await an ordinary
AHP request on its own socket from inside a running tool. Only client-provided
code runs. This feature does not authenticate clients or prove their
implementation is trustworthy; tool advertisement remains a claim by the
connected client. It does not provide filesystem, model, Pi, or server-side
tool execution.

# Tool client compatibility entry

`@toolClient` re-exports the single runtime owned by [`@toolExecution/client`](../toolExecution/README.md). There is no duplicate broker or fallback path. New code can use the owning entry directly.

| File | Responsibility |
| ---- | -------------- |
| `index.ts` | Compatibility exports of connectToolClient and client types. |
| `types.ts` | Type-only compatibility exports from the owning entry. |
| `transport.ts` | Re-export of the same ToolInvocationTransport constructor. |

The existing URL/options call form remains available:

```ts
import { connectToolClient } from "@toolClient";

const client = await connectToolClient("ws://127.0.0.1:3000/", {
  clientId: "local-tools", protocolVersions: ["1.0.0"],
});
try {
  await client.joinSession("ahp-session:/example", []);
} finally {
  await client.shutdown();
}
```

This is source compatibility, not a working protected-host tool execution recipe. A compatible endpoint and issued manifest are prerequisites. This transitional client still uses `x-ahp/tools/call`, `invoke`, and `complete` and advertises via `session/activeClientSet`. Protected assignment delivery and execution migration remain later R5 packets. Internal broker tests use a private-kernel fixture; they do not prove public protected-host execution.

For injected SDK transports, ownership, framing, shutdown and trust limits, see the owning module README. A supplied authenticated endpoint may keep credentials in its adapter. Neither entry creates query-token authentication, arbitrary browser headers, or remote code attestation.

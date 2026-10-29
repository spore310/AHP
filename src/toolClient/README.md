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

A compatible authenticated endpoint with private v2 support is required. Both import surfaces use minimal native initialization, private assignments/advertisement and dispatch/status. Legacy call envelopes have no public fallback. The client also exports typed pending/challenge errors and receipt/status DTOs. Public SDK execution is covered separately from the frozen internal P09 compatibility fixture.

For injected SDK transports, ownership, framing, shutdown and trust limits, see the owning module README. A supplied authenticated endpoint may keep credentials in its adapter. Neither entry creates query-token authentication, arbitrary browser headers, or remote code attestation.

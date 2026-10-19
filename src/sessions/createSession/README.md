# createSession

The create-time contract for a session. It validates request parameters,
resolves the provider, enforces URI uniqueness, parses configuration, registers
the session and broadcasts `root/sessionAdded`, then starts the backend and
settles the lifecycle with `session/ready` or `session/creationFailed`.

This submodule owns the ordering guarantees; the factory in
[`../README.md`](../README.md) provides the dependencies and event seams.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `createSessionParamsSchema` / `CreateSessionParams`, with compile-time conformance to the protocol package. |
| `helpers.ts` | `executeCreateSession` and its private steps (provider resolution, config parsing, backend start). |
| `index.ts` | Re-exports `executeCreateSession`, the params schema, and the params type. |

## API

- `createSessionParamsSchema` — Zod schema for the method params. `channel` is
  the only required member.
- `executeCreateSession(dependencies, rawParams): Promise<void>` — internal entry
  invoked by `SessionsFactory.createSession`.

## 5-Minute Usage

Call it through the factory, not directly:

```ts
await factory.createSession({
  channel: "ahp-session:/demo-1",
  provider: "mock",
  workingDirectories: ["/work/demo"],
});
```

## Intermediate Usage

Handle the create-time failures by their AHP/JSON-RPC code:

```ts
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { isRpcError } from "@jsonrpc";

try {
  await factory.createSession({ channel: "ahp-session:/demo-1" });
} catch (error) {
  if (isRpcError(error)) {
    switch (error.code) {
      case AhpErrorCodes.SessionAlreadyExists:
      case AhpErrorCodes.ProviderNotFound:
      case JsonRpcErrorCodes.InvalidParams:
        // surface error.message to the client
        break;
      default:
        // unexpected
        break;
    }
  }
}
```

## Advanced Usage

Configuration is normalized by the provider before any record exists. A
provider's parser is the single runtime validation owner and can apply
required/default/type/enum and unknown-key policy:

```ts
const provider: SessionProvider = {
  providerId: "local",
  agentInfo: { provider: "local", displayName: "Local", description: "", models: [] },
  config: {
    schema: { type: "object", properties: { mode: { type: "string" } } },
    parse: (config) => ({
      mode: typeof config.mode === "string" ? config.mode : "safe",
    }),
  },
  startSession: async ({ config }) => {
    // config is the normalized object returned by parse
    return { dispose: () => undefined };
  },
};
```

## Caveats

- **Enforced order:** params shape → typed selection/application configuration
  and manifest preparation → provider resolution → URI uniqueness → provider
  config parsing → registration + `root/sessionAdded` → backend start. All
  deterministic configuration/manifest failures happen before registration.
  Application settings never enter the mock provider's config bag.
- **The backend starts last** so a failure leaves a well-formed, inspectable
  session (registered, lifecycle `creating`) rather than a half-registered one.
- **Late-backend race:** if the factory was disposed or the URI was reused while
  `startSession` was in flight, the backend is released detached, a sanitized
  `lateBackendDisposeFailed` diagnostic is reported on failure, and no action is
  published.
- **Failure detail is sanitized.** Only a deliberate `SessionStartError`
  contributes `errorType` and `message`; every other thrown value collapses to
  the generic `sessionStartFailed` payload, so credentials, paths, or service
  details never reach the wire.
- **`workingDirectories` is truncated to the first entry.**
- **No eager typed advertisement:** a non-undefined `activeClient` rejects on a
  typed host before registration. Create, subscribe, then advertise using
  `session/activeClientSet`. An untyped host accepts but ignores this field.
- **Accepted but uninterpreted:** `progressToken` and caller `_meta` are
  discarded; caller metadata cannot replace the server-authored tool manifest.
  Unknown additive members are discarded rather than rejected.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/sessions/createSession.test.ts`](../../tests/sessions/createSession.test.ts) | The creation sequence and failure payloads, provider resolution and `ProviderNotFound`, uniqueness (including while still creating), parameter validation, configuration contract behavior, and working-directory truncation. |

## Related Documentation

- [`src/sessions/README.md`](../README.md) — the factory and contracts.
- [`docs/technical/runtime-lifecycles.md`](../../../docs/technical/runtime-lifecycles.md)
  — the session lifecycle in detail.

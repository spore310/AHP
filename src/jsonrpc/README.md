# JSON-RPC

JSON-RPC 2.0 message schemas, the owned `RpcError` error type, and the
allowlisted error codes the transport is willing to surface. This capability
does no I/O: it parses, classifies, and validates messages, and it defines how a
capability reports a wire error.

The schemas are single-sourced against
`@microsoft/agent-host-protocol` (the AHP protocol package, pinned at `1.0.0`),
so a protocol change that stops matching fails type checking rather than
silently accepting a different wire shape. See
[`docs/technical/wire-contract.md`](../../docs/technical/wire-contract.md).

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Zod schemas and inferred types for requests, notifications, and responses, plus compile-time conformance with the protocol package. |
| `helpers.ts` | `RpcError`, the `isRpcError` narrowing, `parseUnknownJson`, and `JSONRPC_PUBLIC_ERROR_CODES`. |
| `constants.ts` | Standard JSON-RPC 2.0 error codes and the `"2.0"` version literal. |
| `index.ts` | Public surface: schemas, types, the error type, and the code allowlist. |

## API

Schemas (each has a matching inferred type of the same name):

- `jsonRpcParamsSchema` / `JsonRpcParams`
- `jsonRpcRequestIdSchema` / `JsonRpcRequestId` (string or integral number)
- `jsonRpcResponseIdSchema` / `JsonRpcResponseId` (request id or `null`)
- `jsonRpcErrorSchema` / `JsonRpcError`
- `jsonRpcRequestSchema`, `jsonRpcNotificationSchema`, `jsonRpcResultResponseSchema`,
  `jsonRpcErrorResponseSchema`, `jsonRpcResponseSchema`, `jsonRpcMessageSchema`
  and their inferred types.

Error surface:

- `RpcError(code: number, message: string, data?: unknown)` — the single owned
  error type the transport recognises.
- `isRpcError(value): value is RpcError`
- `JSONRPC_PUBLIC_ERROR_CODES: ReadonlySet<number>` — JSON-RPC and AHP error
  codes that may be surfaced to a client.

Constants: `JSONRPC_VERSION`, `JSONRPC_PARSE_ERROR`, `JSONRPC_INVALID_REQUEST`,
`JSONRPC_METHOD_NOT_FOUND`, `JSONRPC_INVALID_PARAMS`, `JSONRPC_INTERNAL_ERROR`.

## 5-Minute Usage

Validate an inbound frame. `jsonRpcMessageSchema` returns a discriminated union
member, so the shape is known after parsing:

```ts
import { jsonRpcMessageSchema } from "@jsonrpc";

const { data: message, error } = jsonRpcMessageSchema.safeParse(JSON.parse(frame));
if (error) {
  // Reply with -32600 Invalid Request; use an id recovered from the frame if any.
} else if ("method" in message) {
  if ("id" in message) {
    // request
  } else {
    // notification
  }
} else {
  // response
}
```

## Intermediate Usage

Report an expected wire error from a capability by throwing an `RpcError`. The
transport recognises it by `instanceof` and preserves the code only when it is
allowlisted:

```ts
import { RpcError } from "@jsonrpc";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

if (typeof params !== "object" || params === null) {
  throw new RpcError(JsonRpcErrorCodes.InvalidParams, "params must be an object");
}
```

## Advanced Usage

A capability can own a richer error type by subclassing `RpcError`. The sessions
capability does this so it can carry AHP codes without the transport importing
it:

```ts
import { RpcError } from "@jsonrpc";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

export class SessionsError extends RpcError {
  constructor(code: number, message: string) {
    super(code, message);
    this.name = "SessionsError";
  }
}
```

The transport still checks `instanceof RpcError` and the allowlist, so a
subclass inherits the same guarantees.

## Caveats

- **Trust is by `instanceof`, not duck typing.** A thrown object that merely has
  a numeric `code` is *not* trusted and becomes a generic internal error. This
  is deliberate: a library error can carry a `code` property without meaning to
  speak JSON-RPC.
- **Codes are allowlisted.** Even an `RpcError` whose `code` is outside
  `JSONRPC_PUBLIC_ERROR_CODES` collapses to `-32603 Internal error`. The
  allowlist is built only from `JsonRpcErrorCodes` and `AhpErrorCodes`.
- **Messages are classified by shape before members are validated.** Validating
  a request against a stripping notification schema would remove its `id` and
  misclassify it. Preserve this ordering if you add schemas.
- **No batch support.** A JSON array frame is rejected as an invalid request.
- **Unknown additive members are discarded, not rejected,** so a compatible
  protocol extension cannot invalidate an otherwise valid message.
- **Request ids must be strings or integral numbers.** Fractional ids and `null`
  request ids are rejected; response ids may be `null`.
- **`result: undefined` is rejected** by the result schema; serialize an absent
  result as `null`.

## Testing

| Test | Pins |
| ---- | ---- |
| [`src/tests/jsonrpc.test.ts`](../tests/jsonrpc.test.ts) | Microsoft client/notification/response shapes are accepted; strict parsing (fractional and `null` request ids, `undefined` result, unknown additive members, batch arrays); message classification (request vs response, mixed members, unknown protocol version). |

## Related Documentation

- [`docs/technical/wire-contract.md`](../../docs/technical/wire-contract.md) —
  the single-sourcing and conformance strategy.
- [`src/websocket/README.md`](../websocket/README.md) — where these schemas are
  applied to frames and where errors are mapped.

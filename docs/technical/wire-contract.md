# AHP Wire Contract

How this repository stays faithful to the pinned protocol package,
`@microsoft/agent-host-protocol@1.0.0`, without duplicating or drifting from it.
These rules are why several modules look the way they do; read this before
changing a schema, a protocol literal, or the error surface.

## Single source of truth

The protocol package is authoritative. Local code mirrors and pins, it does not
redeclare:

- JSON-RPC message schemas in
  [`src/jsonrpc/types.ts`](../../src/jsonrpc/types.ts) are asserted against the
  protocol's own message types.
- `createSession` params in
  [`src/sessions/createSession/types.ts`](../../src/sessions/createSession/types.ts)
  are asserted against the protocol's `CreateSessionParams`.
- Error codes come from the package's `JsonRpcErrorCodes` / `AhpErrorCodes`.

Conformance is enforced in two directions:

1. **Compile time** — type assertions fail the build when a protocol member
   stops fitting, or when the protocol adds a member we have not modeled.
2. **Runtime** — fixtures typed with the protocol types are parsed with our
   schemas in [`src/tests/jsonrpc.test.ts`](../../src/tests/jsonrpc.test.ts) and
   [`src/tests/sessions/compliance.test.ts`](../../src/tests/sessions/compliance.test.ts).

If the protocol moves, prefer updating the pin and the mirrors over loosening a
schema.

## Shape before validation

A frame's kind is decided by its members **before** any member is validated.
This ordering is required: validating a request against a stripping notification
schema would remove its `id` and misclassify it. In
[`src/jsonrpc/types.ts`](../../src/jsonrpc/types.ts) a message is shaped first,
then validated against the matching branch.

Unknown additive members are discarded rather than rejected, so a compatible
protocol extension cannot invalidate an otherwise valid message. Known members
stay strictly typed.

## Owned errors and the allowlist

A capability reports a wire error by throwing an
[`RpcError`](../../src/jsonrpc/helpers.ts). The transport trusts it by
`instanceof` and preserves its `code` only when the code is in
`JSONRPC_PUBLIC_ERROR_CODES` (JSON-RPC codes plus AHP codes). Consequences:

- An arbitrary thrown object that merely carries a numeric `code` is not
  trusted; it becomes `-32603 Internal error`.
- An `RpcError` with a non-allowlisted code also collapses to internal error.
- A `ZodError` is mapped to `-32602 Invalid params`.
- Handler failures on a **notification** have no reply channel and are dropped.

See [`src/websocket/helpers/connection.ts`](../../src/websocket/helpers/connection.ts)
for the exact mapping.

## Mirrored `const enum` literals

The protocol package declares discriminants (`SessionLifecycle`,
`SessionStatus`, `ActionType`, ...) as ambient `const enum`s. This project sets
`verbatimModuleSyntax: true`, under which ambient const enum members cannot be
read as values (TS2748).

[`src/sessions/constants.ts`](../../src/sessions/constants.ts) therefore mirrors
the values the server assigns. Each mirror is **pinned to the protocol type**
(so a renamed member fails type checking) and compared against the package's
runtime enum objects by
[`src/tests/sessions/compliance.test.ts`](../../src/tests/sessions/compliance.test.ts)
(so a changed value fails at test time). The file-scoped
`@typescript-eslint/no-unsafe-enum-assignment` disable exists for exactly this
assertion; do not widen it.

## Sequence and channel rules

- One connection-wide action sequence, monotonic and gap-free for emitted
  actions, allocated by the injected `nextServerSeq`.
- Catalogue notifications (`root/sessionAdded`, `root/sessionSummaryChanged`)
  target `ahp-root://` and **never** consume the action sequence.
- Action envelopes target `ahp-session:/<id>` and carry the allocated
  `serverSeq`.
- `initialize`/`subscribe` snapshots need the sequence current at snapshot time;
  the allocator mints the next value only, so a host must track the current
  sequence rather than inventing one (see
  [`docs/plans/ProvidersPlan.md`](../plans/ProvidersPlan.md)).

## Application tool extension

Typed session snapshots carry the server-authored visible contract manifest
under `_meta["x-ahp-application"]`. This does not extend AHP's top-level state or
claim the host implements `serverTools`. Client advertisements use the standard
`session/activeClientSet` action with exact revision metadata under each tool's
`_meta["x-ahp-tool-contract"]`; full schemas survive parsing for comparison.

Actual client execution uses explicitly non-standard namespaced methods:
`x-ahp/tools/call` is a request, `x-ahp/tools/invoke` is a private server
notification, and `x-ahp/tools/complete` is a client notification. Ordinary
`AhpClient` users need the [tool client adapter](../../src/toolClient/README.md)
for this extension. The server validates and routes; a registered local client
implementation executes. These operations add no persistence or server-side
filesystem/model runtime.

## Authenticated agent/work extension

The optional extension is also namespaced and versioned. Every method is a
request using `version: 1`:

- `x-ahp/agents/register`, `renew`, `unregister` — durable registration plus a
  live in-memory presence binding.
- `x-ahp/work/submit`, `claim`, `renew`, `complete`, `fail`, `cancel`, `get` —
  durable work and its current execution lease.

Only `x-ahp/work/claim` returns a lease token, and only to the current claimant.
`get` redacts lease-holder and token fields. A client cannot supply a principal,
agent ID, connection ID, or presence generation in request JSON; those come from
the authenticated connection and live directory. The work extension is separate
from `x-ahp/tools/*`: tools are short-lived private invocation, while work is a
durable record that survives a disconnect.

Registration text and work payload trees also pass the application's
portable-text profile before reaching a repository. It rejects NUL and unpaired
UTF-16 surrogates so accepted values are consistent across storage adapters;
this is application policy, not a claim that JSON itself cannot represent those
values. The profile does not replace request schemas, authorization, or payload
size checks. See the [persistence contract](../../src/persistence/README.md#portable-text-profile-v1).

When configured, the upgrade may carry `Authorization: Bearer <token>`; the
resolved subject is attached to the connection before AHP dispatch. Missing or
unknown credentials leave the connection unauthenticated, so agent/work methods
fail closed while baseline AHP methods remain available under the host's
deployment policy. `initialize.clientId` is never identity. See
[`../architecture/agent-task-lifecycle.md`](../architecture/agent-task-lifecycle.md).

## Gotchas

- Do not read a const enum member directly; add a pinned mirror instead.
- Do not reorder shaping and validation.
- Do not reject unknown additive members; discard them.
- Do not surface an arbitrary code; add it to the allowlist set only if the
  protocol defines it.

## Related Documentation

- [`../../src/jsonrpc/README.md`](../../src/jsonrpc/README.md)
- [`../../src/websocket/README.md`](../../src/websocket/README.md)
- [`../plans/ProvidersPlan.md`](../plans/ProvidersPlan.md)

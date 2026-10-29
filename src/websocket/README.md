# WebSocket Transport

A JSON-RPC 2.0 server over WebSocket text frames. The raw transport owns the
network boundary: upgrade handling, per-socket framing and dispatch, heartbeat,
and race-safe start/stop with a bounded shutdown. It is session-agnostic;
method handlers are injected.

The supported AHP binding/host is a safe facade over one private canonical
kernel. Native initialize requires verified live setup with explicit permission to
observe the host-wide global activity cursor; it is denied by default. Authorized
minimal initialize returns the genuine current sequence and empty snapshots, and
then ping works. Contextual native create requires separate explicit
registered creation approval and a `null` reply. Explicit `protectedViews` opens
projected initial/repeated subscriptions, root counts and lists through canonical
resource-read policy. Native disposal/actions and legacy tool delivery remain
unavailable. Authentication/setup is not disclosure
permission. The generic transport still accepts arbitrary trusted application
handlers; it does not sandbox application JavaScript.

## Protected session creation and canonical work ownership

A protected host reads `options.sessions.creationSecurity` only, requires P04 security,
and rejects mismatched captured compiler identity before acquiring host resources.
Public native `createSession` preserves canonical beforeDispatch ready-state/kind
checks on the same actual connection. It also requires current exact-true captured
`allowGlobalSequence`, matching live fence/snapshot, and the SDK factory output
capability. A connection-wide abort signal cancels pending preparations without
retaining one close handler per create. JSON actor/owner/roles/context claims cannot
supply any of this. Cursor permission is metadata-only; exact registered type/provider
creation and whole bootstrap-template approval remain separate requirements.

Success returns native `null` only. There is no legacy factory-create fallback,
no implicit snapshot/subscription/count/tool permission and no raw kernel export. Protected
binding rejects a competing mutable owner registry. Work consumes a read-only lookup
of current full resource ref -> canonical owner -> subject in the configured domain;
private kernel mutable hooks remain legacy/internal only. Exact-instance disposal
captures before work awaits; protected lifecycle exclusion uses the factory's separate
owner-free settle marker, not an owner-cache heuristic. Protected host stop cancels
in-process preparations synchronously as well as closing network requests; terminal
host fences prevent reuse even though standalone factories may be reused.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `WebSocketServerOptions`, `WebSocketServerHandle`, `JsonRpcHandler(s)`, `WebSocketConnectionContext`, and the optional handshake authenticator. |
| `helpers/server.ts` | `createWebSocketServer`: HTTP/WebSocket lifecycle, upgrade checks, handshake authentication, heartbeat, and shutdown. |
| `helpers/connection.ts` | `attachConnection`: per-socket framing, serialized dispatch, reply settlement, principal attachment, and error mapping. |
| `helpers/ahp/index.ts` | Public AHP binding exports. |
| `helpers/ahp/helpers.ts` | Safe public facade: cursor-authorized ready initialize, separate contextual create/null, per-connection cancellation, protected-route deferral and work delegation. |
| `helpers/ahp/helpers/kernel/helpers.ts` | Private canonical AHP mechanics: sequencing, subscriptions, reply commit, broker correlation, owner attach and cleanup. Not exported by any supported barrel. |
| `helpers/ahp/helpers/views/types.ts` | Bounded delivery intent and per-peer view ownership. |
| `helpers/ahp/helpers/views/helpers.ts` | Canonical view-source adapter, final delivery guards, ordered queues and invalidation cleanup. |
| `helpers/security/types.ts` | P04-local setup options, scoped seeds, immutable connection fences/snapshots and adapter contracts. |
| `helpers/security/constants.ts` | Independent initial setup count defaults/absolute ceilings. |
| `helpers/security/helpers.ts` | Captured limits, scoped read preparation, identity/actor/resource/binding validation, bounded snapshot freshness and release. |
| `helpers/security/index.ts` | Internal security orchestration and type exports. |
| `helpers/ahp/agentWork.ts` | Authenticated agent registration/presence and work request handlers, schemas, and error mapping. |
| `helpers/ahp/toolInvocation.ts` | Namespaced client-executed tool calls, accepted executor ownership, contract validation, and settlement. |
| `helpers/ahp/types.ts` | AHP peer, adapter, parameter schemas, and `AHPBindingOptions`. |
| `helpers/ahp/constants.ts` | Method kinds, authenticated extension method inventory, baseline action inventory, and pending-delivery limit. |
| `helpers/host/index.ts` | Public composed-host exports. |
| `helpers/host/helpers.ts` | `createAHPServer`: owns sequence injection, sessions, binding, transport, and shutdown. |
| `helpers/host/types.ts` | `AHPServerOptions` and `AHPServerHandle`. |
| `helpers/settling.ts` | Legacy/internal settle-window probe: an owner binding without a live record means a disposal is still settling, so creates stay denied for every principal until the settlement releases the binding. |
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
  with `agents`, `work`, and either legacy mutable `sessionOwners` or read-only
  `ownerLookup`. Protected SDK factories reject `sessionOwners`; the composed
  protected host supplies `ownerLookup` from its canonical full-ref/domain owner
  projection. The lookup has no bind/unbind/clear mutators and grants no new work
  authority.
- `createAHPServer({ host, port, path, sessions, agentWork?, security? })` — composed host.
  `agentWork` optionally adds the static-token authenticator, shared
  registration/work ports, allowed kinds, presence TTL, and provider cleanup.
  `stop()` releases transport, binding, sessions, and the optional provider. It is terminal,
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
- **Native setup itself needs explicit metadata permission.** With no verified
  setup, absent/false `PreparedInitialScopes.allowGlobalSequence`, or stale/expired
  permission, initialize is denied before entering the kernel or reading its
  sequence getter. The optional field defaults false, accepts actual booleans only,
  and is captured immutably. Wire fields, role labels, scope grants and authentication
  alone cannot supply it. No constant zero or missing native serverSeq substitutes
  for the genuine canonical cursor. Permission explicitly permits observing
  **host-wide activity**, not scoped counts, session/root data or tools.
- **Native setup is not resource permission.** Hosts without `protectedViews`
  reject nonempty initialSubscriptions, subscribe/repeat subscribe and lists.
  Explicit resource-view configuration uses canonical read grants and projects
  all native reads. Native dispose/actions and legacy tools remain closed.
  Empty initialize/ping remain supported only after
  the explicit live global-sequence permission gate. The
  explicit agent/work extension still requires its own principal/owner/presence
  checks; configured security additionally requires current setup.
- **Authentication has one source.** Security-only composition has no DB/work
  requirement. Mixed security/agentWork requires the explicit agents bridge over
  the exact same authenticator instance and matching workDomainId. A subject-only
  principal is projected only in that configured domain; arbitrary domains are
  not collapsed. clientId/kind/role are never identity. Static bearer tokens are
  POC-grade, not production identity.
- **Work is not tool invocation.** `x-ahp/tools/*` is short-lived and private;
  `x-ahp/work/*` is durable coordination with a database lease. The server never
  executes stored work.
- **Trusted contextual creation owns exactly its creator.** Protected callers use
  `host.sessions.authorization.createSession(params, context)` (no native cursor
  prerequisite in-process); context-free create rejects. Public native create also
  requires ready/cursor permission and explicit type capability approval. A legacy
  unprotected host's context-free create still has no authenticated owner and cannot
  own work. Direct host disposal checks work and captures the exact protected ref
  before awaits; this is lifecycle fencing, not an extra caller authorization grant.
- **Private canonical ownership mechanics remain regression-tested.** The internal
  kernel's `createSession` acquires the owner binding when the record is attached —
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
  release. Those mutable-map/same-owner assertions describe legacy/internal
  mechanics only. P05 protected records instead use full-ref cleanup and owner-free
  settle tokens; durable v1 work-write reconciliation remains a separate limitation.

## Security setup API

`security: AHPServerSecurityOptions` contains the unchanged `SecurityComposition`
ports plus `initialAuthority.prepare({context,fence,signal})`. Its optional exact
boolean `allowGlobalSequence` defaults false. Only a trusted adapter after verified
identity/actor resolution may explicitly permit this shared-cursor disclosure.
Its synchronous guard, expiry and release cover this permission as well as scope
facts; revocation must make that guard false. Consumers needing only scoped views
cannot use native initialize without permitting that host-wide cursor, because
the pinned protocol requires the real current serverSeq. Protected native views
preserve this sequence; private tool interoperability remains separate work.
Legacy agentWork authentication by itself does not establish this metadata permission.
The application selects existing full resource incarnations and grant revisions; setup calls
`resources.resolve` and `bindings.read({actor,scope,grantRevision})` exactly. It
never issues/installs grants or manufactures resources. A synchronous seed guard
must cover those exact locally mirrored facts; release owns only that connection's
reservations. Remote revocation has the declared expiry/invalidation bound, not
distributed atomicity. Roles/default scopes are not supplied by the transport.

For canonical grants, construct the host before starting it, build the grant
service from the actual `host.sessions.authorization`, bind the initially
unavailable binding/source closures once, then start. The source retains issued
scoped snapshots and seeds their exact grant revision; its currentness covers the
actual identity/connection generation and canonical state after binding reads.
See the [composition contract](../authorization/README.md#public-host-composition)
and [executable fixture](../tests/authorization/freshness.test.ts). The host forwards
captured registry/readiness capabilities and keeps readiness false after terminal
stop. Its work-owner projection checks the same owned resource before and after
canonical owner lookup.

Setup samples the finite deadline clock before the final source-currentness
predicate. No application clock runs after that canonical comparison; only SDK
release/abort flags are rechecked. Nonfinite or throwing clocks fail closed.
Canonical revocation invalidates retained setup even without a freshness event.

All setup awaits share setupDeadlineMs (default 5000, absolute 60000). Initial
scopes, total bindings, and subscription selectors each default to 128 with absolute
1024; these are independent of policy reference/map caps. Options/callbacks are
captured once. Cancel/timeout/stop prevent late attach and release late preparations.
The final local currentness check and attach have no await between them. Every
configured-context send also rechecks synchronously immediately before enqueue;
stale setup closes the connection instead of delivering a result prepared before
revocation (including deferred work reads). Every transport context carries its actual reserved ID/generation and currentness callback;
these fields are optional only for old in-process contexts, where absence is no
authority. Actor, auth revision and generation are immutable for a connection;
reconnect, not in-place credential reassignment, establishes a new fence.

Agent kind comes from the trusted ActorResolver/registered-agent facts, not missing
presence. An agent without its required generation fails setup. Directory presence
and transport generation are separate. The guarded client broker uses both when
admitting an exact executor registration.
A ready setup snapshot alone neither authorizes an operation nor reveals tools.

## Testing

The ahp/sdk/toolInvocation/capacity/owner-disposal/integration compatibility suites
are explicitly **INTERNAL** canonical host-wiring evidence. File-local mocks replace
only binding selection; real host/owner/work/stop services and original assertions
remain. The new public tests below use the real unmocked facade/host alongside them.

| Test | Pins |
| ---- | ---- |
| [`src/tests/websocket/policyInitialization.test.ts`](../tests/websocket/policyInitialization.test.ts) | Real public default cursor denial/zero getter access, explicit trusted canonical-cursor positive, immutable boolean/expiry/revocation/wire-spoof controls, protected denial, exact work bridge, parked authority and connection/currentness lifecycle. |
| [`src/tests/agents/policyActor.test.ts`](../tests/agents/policyActor.test.ts) | Exact existing scope/revision reads, no issuance, trusted user/registered agent distinction, expiry/invalidation/limits and stale cleanup. |
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

## Private canonical compatibility kernel (not a public tool route)

The supported facade denies legacy `x-ahp/tools/call`/completion. Private assignment,
and public tool SDK integration must be completed before tool delivery opens.
Internal compatibility tests use the same private kernel directly (or a file-local
isolated binding-factory substitution), without changing their canonical assertions.
They do not prove public multi-user privacy or authorized SDK interoperability.
No raw kernel, unsafe option, or no-config fallback is exported.
The internal kernel preserves inert untyped metadata reduction only when neither
canonical authorization nor a tool manifest exists. Those metadata rows never enter
the executable broker registry; attempted calls still fail closed. The raw metadata
compatibility test asserts both reducer/origin behavior and zero tool invocation.
Accepted canonical tool-row changes synchronously invalidate conflicting broker
advertisements before fanout. A different connection claiming the same client ID
cannot clear or replace another connection's admitted row, including with an empty list.
Pending advertisement tickets also observe canonical row sequences. Activation after
fanout requires that its exact accepted row is still current, so a nested removal
cannot activate an obsolete executor. Pending tickets share the bounded admission
budget and are released after reduction/rejection. Descriptor equality checks each
field under its existing budget rather than applying one definition's byte cap to
an entire multi-tool list.

Within that internal kernel, `toolExecution` wiring requires the same canonical
registry/compiler as protected creation and authenticated connection setup. Missing
wiring permits no tools. Advertisements require separate advertise and execute
assignments, exact descriptors and fresh checks before synchronous reduction and
activation. Calls use the neutral P08 proxy dispatcher, separate caller invoke and
executor execute grants, full resource routes and immutable registration revisions.
The issued manifest remains the schema authority. Work routes only to the unique
connected peer with an accepted advertisement and a current subscription. Duplicate
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

Private sends serialize first, check connection setup, then apply the invocation's
canonical policy veto and callback-free local socket fences immediately before
enqueue. Each actual invocation supports one captured final result guard; denied
results produce a safe error without the previous output. `send` returning false
is not proof of remote termination. Disconnect, timeout and shutdown cancel caller
waits while retaining unresolved remote ownership. `toolExecutionStats()` reports
active/draining counts after bounded shutdown; no retry or reroute is implied.

`toolPolicyAdmission.test.ts` covers canonical grant separation, post-await ad
revocation/disconnect/rebind, final-send revocation, private raw-frame canaries,
draining and reentrant reducer vetoes. Its explicit credential/canonical-authority
fixtures still select the internal kernel and are not P12 public privacy proof.

## Protected native resource views

`protectedViews` is an explicit host opt-in with the same canonical registry and
compiler as creation. Its admitted policy refs authorize resource content reads
through selected discover/reveal, actual scoped bindings, mandatory route rules
and no challenge. Authentication, creator identity and tool assignments do not
substitute for these grants. Global-sequence consent remains independently required.

Initial batches are atomic. Repeated subscriptions and listings use the same
neutral `createResourceViews` service. Root agents are empty; counts and pages
include permitted sessions only. Opaque cursors bind recipient, catalogue basis,
authority and expiry. Only a proof's `value` leaves the host; private stamps and
canonical basis refs include facts that must never become a wire payload.

Pending and active delivery share 256-record/2-MiB per-peer bounds; at most 128
native views are admitted per peer. Queued intents reauthorize at delivery, then
check aggregate proof freshness and the exact subscription generation/sequence at
the final transport guard. Unsubscribe invalidates in-flight delivery/refresh and
releases retained channel state. Revoked views close.
Failed replacement snapshots also close the existing view, including a final
reply veto: events suppressed while replacement was pending cannot leave an old
subscription silently out of sync. Root membership comparisons
use full incarnation sets: observed canonical additions retain native catalogue
and count events; permission-only membership changes require a fresh connection.
No synthetic native sequence or upstream removal action is emitted.

`policyEgress.test.ts` exercises the supported public binding (an observation-only
test wrapper retains actual transport contexts), real SDK transport/reducers,
raw canaries, initial/repeated reads, final-send revocation, queue bounds and
unsubscribe/resnapshot/refresh races. `policyProjection.test.ts` additionally
checks server-tool/meta action projection with the installed reducer; there is
still no canonical server-tool producer until its later execution packet.

## Related Documentation

- [`src/jsonrpc/README.md`](../jsonrpc/README.md) — the schemas and error type
  dispatched here.
- [`docs/technical/wire-contract.md`](../../docs/technical/wire-contract.md) —
  error mapping and classification rules.
- [`docs/technical/runtime-lifecycles.md`](../../docs/technical/runtime-lifecycles.md)
  — the server lifecycle state machine in detail.

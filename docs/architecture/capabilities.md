# Capability Map and Architecture

How Agent Hosting Protocol composes. Module READMEs contain the public contracts and file maps.

## Capabilities

| Capability | Location | README | Owns |
| ---------- | -------- | ------ | ---- |
| JSON-RPC | `src/jsonrpc/` | [README](../../src/jsonrpc/README.md) | Message schemas, owned wire errors, JSON decoding boundary. |
| Tools | `src/tool/` | [README](../../src/tool/README.md) | Immutable exact tool contracts, trusted-schema validation, detached descriptor projection. |
| Sessions | `src/sessions/` | [README](../../src/sessions/README.md) | Provider registry, in-memory sessions, type/visible-tool policy, manifests, advertisement admission, reducer and sequence. |
| WebSocket | `src/websocket/` | [README](../../src/websocket/README.md) | Raw transport, connection-bound AHP state, subscriptions, private invocation routing and composed host lifecycle. |
| Application | `src/application/` | [README](../../src/application/README.md) | Baseline session types, scoped policy examples and an inert host action registration. |
| Authorization | `src/authorization/` | [README](../../src/authorization/README.md) | Trusted actor context, scoped bindings, resource operations, proof, and invalidation. |
| Policy compiler | `src/authorization/helpers/policies/` | [README](../../src/authorization/helpers/policies/README.md) | Direct policies, namespaces and admission selection. |
| Tool execution | `src/tool/helpers/execution/` | [README](../../src/tool/helpers/execution/README.md) | Scoped client/server lifecycle, private results, challenge handling, and approved artifact delivery. |
| General client | `src/client/` | [README](../../src/client/README.md) | Native AHP, private RPC and shared endpoint lifetime. |
| Agents | `src/agents/` | [README](../../src/agents/README.md) | Static bearer authentication, durable registration, and in-memory generation-fenced presence. |
| Persistence | `src/persistence/` | [README](../../src/persistence/README.md) | Neutral durable ports/facades, lazy allowlisted provider selection, and the PostgreSQL adapter. No SQL in the session engine. |
| Work | `src/work/` | [README](../../src/work/README.md) | Session-owner authorization, bounded validation, and work-lease coordination. |
| Environment | `env/` | [README](../../env/README.md) | Validated process configuration. |
| Process composition | `src/index.ts` | [README](../../src/README.md) | Application/host wiring, optional agent/work composition, entrypoint guard and signal handlers. |

Tests live under `src/tests/`. Each module README maps the relevant acceptance tests.

## Dependency direction

```text
src/index.ts -> env + application + websocket.createAHPServer
                 + optional persistence/agents/work composition
application -> public sessions + tools
websocket host -> sessions + AHP binding + raw transport
AHP binding -> sessions + tools + JSON-RPC + optional agents/work
work -> agents + persistence ports
persistence contract/facades -> plain repository ports; selected PostgreSQL adapter -> pg
session recovery -> exact durable session and resource incarnations
sessions -> tools + JSON decoding; never sockets
general client -> public AHP SDK + bounded extension RPC
tool client -> general client + private V1 tool protocol
```

The raw WebSocket server owns framing and connection lifecycle. The AHP binding
owns identity, subscriptions, and delivery. The session engine accepts domain
inputs and owns reducer state. Advertisement admission compares descriptors to
an exact approved contract. An authorized proposal uses a separate, bounded
validation and publication path. `jsonrpc` owns message shapes and error values.

## Process composition

```text
loadEnv -> createBaselineSessionApplication
        -> createAgentWorkOptions(config)        # undefined, or auth + managed provider
        -> createAHPServer({ sessions, agentWork? })
        -> start -> installShutdownHandlers -> host-owned provider disposal
```

Importing the entrypoint or application module is inert: it does not bind ports. Each host owns its session factory, sequence, catalogues, transport and cleanup. Shutdown is terminal and best-effort; signal-handler failures set `process.exitCode = 1`.

The agent/work option is all-or-nothing. Without both a database URL and token
map, the extension methods are not registered and no provider is selected. A
provider selector alone is a configuration error. With both, the adapter
registry resolves the configured provider (PostgreSQL by default), the
transport authenticates the upgrade, and an authenticated AHP
`createSession` binds the owner, and connection close releases live presence
without deleting durable work.

## Typed session flow

```text
native createSession / public createApplicationSession
  -> validate native params
  -> resolve explicit header string or configured exact default
  -> validate application config separately from provider config
  -> pin type + visible tool refs; construct server-authored manifest
  -> register one session record
  -> emit root/sessionAdded; start provider backend
  -> reducer applies session/ready or session/creationFailed
  -> publish session action + root summary change
```

The canonical typed snapshot holds the pinned tool manifest. The protected
public host projects native snapshots and actions per recipient and sends exact
tool assignments through the private extension. Explicit activation of a
published revision updates the exact live session and invalidates its tool views.

## Client execution boundary

The negotiated `x-ahp/tools/*` extension checks independent caller and executor
authority before dispatching to a remote client or a trusted host registration.
Inputs and results travel through owned private routes. Optional proposal and
artifact ports enter the same protected session and assignment boundaries.
The trusted security configuration is independent of durable work. Resource view
authorization and tool grants use the same canonical registry with distinct
purposes. See the [tool client contract](../../src/tool/helpers/client/README.md).

## Agent/work boundary

The protected host exposes V1 `x-ahp/agents/*` and `x-ahp/work/*`
requests. A registered worker claims a durable item, renews its lease and
settles its own attempt. Work-tagged tool calls check the lease and its scope
alongside the caller's and executor's tool authority. Work and registration
records survive host restart. A reconnecting worker establishes fresh presence
on its authenticated connection, and clients re-establish their subscriptions
and private advertisements.

See [`agent-task-lifecycle.md`](agent-task-lifecycle.md) for the sequence, state
machine, and failure cases.

## Deferred

- Production identity and OIDC.
- Durable event replay across reconnects.
- Filesystem executors, model inference and Pi runtime.
- Chat/prompt streaming; `SessionBackend` still exposes disposal only.
- Redis or a second coordination service.

## Related documentation

- [Source overview](../../src/README.md)
- [Wire contract](../technical/wire-contract.md)
- [Runtime lifecycles](../technical/runtime-lifecycles.md)
- [Archived application capacity proposal](../archive/plans/tools%20and%20session%20types/APPLICATION_CAPACITY.md)
- [Documentation index](../README.md)

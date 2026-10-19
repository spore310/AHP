# Capability Map and Architecture

How Agent Hosting Protocol composes. Module READMEs contain the public contracts and file maps.

## Capabilities

| Capability | Location | README | Owns |
| ---------- | -------- | ------ | ---- |
| JSON-RPC | `src/jsonrpc/` | [README](../../src/jsonrpc/README.md) | Message schemas, owned wire errors, JSON decoding boundary. |
| Tools | `src/tools/` | [README](../../src/tools/README.md) | Immutable exact tool contracts, trusted-schema validation, detached descriptor projection. |
| Sessions | `src/sessions/` | [README](../../src/sessions/README.md) | Provider registry, in-memory sessions, type/visible-tool policy, manifests, advertisement admission, reducer and sequence. |
| WebSocket | `src/websocket/` | [README](../../src/websocket/README.md) | Raw transport, connection-bound AHP state, subscriptions, private invocation routing and composed host lifecycle. |
| Application | `src/application/` | [README](../../src/application/README.md) | Fresh baseline `code-review`/`coding` policy. Descriptors only; no filesystem executor. |
| Tool client | `src/toolClient/` | [README](../../src/toolClient/README.md) | Public SDK adapter for local tool implementations and application-extension calls. |
| Environment | `env/` | [README](../../env/README.md) | Validated process configuration. |
| Process composition | `src/index.ts` | [README](../../src/README.md) | Application/host wiring, entrypoint guard and signal handlers. |

Tests live under `src/tests/`. Each module README maps the relevant acceptance tests.

## Dependency direction

```text
src/index.ts -> env + application + websocket.createAHPServer
application -> public sessions + tools
websocket host -> sessions + AHP binding + raw transport
AHP binding -> sessions + tools + JSON-RPC
sessions -> tools + JSON decoding; never sockets
client adapter -> public AHP SDK + tools
```

The raw WebSocket server remains session-agnostic. The contained AHP binding owns connection identity and delivery. Sessions own business policy; no socket enters the session engine. Schema compilation is for trusted application definitions, never for client tool advertisements. `jsonrpc` does no I/O.

## Process composition

```text
loadEnv -> createBaselineSessionApplication
        -> createAHPServer({ sessions: { providers: [mockProvider], application } })
        -> start -> installShutdownHandlers
```

Importing the entrypoint or application module is inert: it does not bind ports. Each host owns its session factory, sequence, catalogues, transport and cleanup. Shutdown is terminal and best-effort; signal-handler failures set `process.exitCode = 1`.

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

The ordinary session snapshot lists full visible tool contracts under `_meta["x-ahp-application"]`. `getSessionToolManifest` is a detached, non-allocating read. `serverTools` remains absent because the host does not implement the listed tools. `activeClients` starts empty.

A client advertises an exact subset through `session/activeClientSet`. Typed admission checks connection-derived origin against nested client ID, revision identity, name and full schema before the reducer. One mismatch rejects the entire update; accepted descriptors are normalized from the trusted catalogue. An untyped host preserves its documented legacy behavior.

## Client execution boundary

The namespaced `x-ahp/tools/*` extension connects discovery/advertisement to local client implementations. It is not a standard AHP tool-invocation method. The binding validates and routes a call; it does not execute the tool. Inputs/results are private rather than session broadcasts. See the [tool client contract and limitations](../../src/toolClient/README.md).

The host still has no authenticated principal/session authorization layer. Type policy and exact connection correlation are consistency controls, not a claim that unauthenticated remote deployment is safe. Presence leases and automatic stale advertisement cleanup remain separate work.

## Deferred

- Persistence, SQL/Redis adapters and replay.
- Server-side tool functions, filesystem executors, model inference and Pi runtime.
- Chat/prompt streaming; `SessionBackend` still exposes disposal only.
- Authentication and comprehensive session authorization.

## Related documentation

- [Source overview](../../src/README.md)
- [Wire contract](../technical/wire-contract.md)
- [Runtime lifecycles](../technical/runtime-lifecycles.md)
- [Application capacity follow-up](../plans/tools%20and%20session%20types/APPLICATION_CAPACITY.md)

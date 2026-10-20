# Source (`src`)

`src/` is a capability-oriented modular monolith. Each capability below is a
folder with its own colocated `README.md` and an `index.ts` that defines its
public surface. `src/index.ts` is the **process composition root**. It combines
validated environment settings, the baseline application policy and the composed
AHP server.

Start here, then read the README of the capability you are changing.

## Capabilities

| Capability | README | Responsibility |
| ---------- | ------ | -------------- |
| `jsonrpc/` | [`jsonrpc/README.md`](jsonrpc/README.md) | JSON-RPC 2.0 message schemas, the owned `RpcError`, and the allowlisted error codes. No transport, no I/O. |
| `sessions/` | [`sessions/README.md`](sessions/README.md) | The session engine: provider registry, session store, state reducer, sequencing, and lifecycle. AHP-aware but transport-agnostic. |
| `websocket/` | [`websocket/README.md`](websocket/README.md) | Raw transport, AHP subscriptions/publication, handshake authentication, and the composed host. |
| `tools/` | [`tools/README.md`](tools/README.md) | Immutable exact-revision contracts, schema validation and descriptor projection. |
| `application/` | [`application/README.md`](application/README.md) | Fresh baseline policy for `code-review` and `coding` sessions. |
| `toolClient/` | [`toolClient/README.md`](toolClient/README.md) | Public SDK adapter for local implementations and namespaced tool invocation. |
| `agents/` | [`agents/README.md`](agents/README.md) | Static bearer authentication, durable agent registration, and in-memory generation-fenced presence. |
| `persistence/` | [`persistence/README.md`](persistence/README.md) | Async durable ports and parameterized PostgreSQL adapters. No SQL in the live session engine. |
| `work/` | [`work/README.md`](work/README.md) | Principal/session authorization, bounded work validation, and the work-lease application service. |
| `tests/` | see per-module **Testing** sections | All tests. Never colocated with source. |

Cross-cutting behavior that no single capability owns lives in
[`docs/architecture/capabilities.md`](../docs/architecture/capabilities.md),
[`docs/technical/wire-contract.md`](../docs/technical/wire-contract.md), and
[`docs/technical/runtime-lifecycles.md`](../docs/technical/runtime-lifecycles.md).

## Files

| File | Responsibility |
| ---- | -------------- |
| `index.ts` | Composition root and entrypoint: loads validated environment config, builds the WebSocket server with the wired JSON-RPC handler map, connects termination signals to shutdown, and starts listening only when executed as the process entrypoint. |

## API

Exported from `src/index.ts`:

- `APP_NAME: string` — the product name used in startup logging.
- `createAgentWorkOptions(config): AHPServerAgentWorkOptions | undefined` — builds
  the optional static-token authenticator and PostgreSQL-backed registration/work
  adapters. Both database and token configuration are required together; a
  partial pair is a startup error.
- `installShutdownHandlers(server: WebSocketServerHandle): () => void` — wires
  `SIGINT`/`SIGTERM` to `server.stop()` and returns a function that removes the
  handlers.
- `main(): Promise<void>` — loads config, composes the mock provider with
  `createBaselineSessionApplication()`, optionally enables the authenticated
  agent/work extension, starts the AHP server and logs its address.

## 5-Minute Usage

Run the host as a process:

```bash
pnpm build
pnpm start
# Agent Hosting Protocol listening on ws://127.0.0.1:12345
```

The address comes from the validated environment (see
[`env/README.md`](../env/README.md)); the defaults bind `127.0.0.1:12345`.

## Intermediate Usage

Import the module without starting a server. Importing `src/index.ts` has no
side effects; `main()` only runs when the file is the process entrypoint.

```ts
import { installShutdownHandlers, main } from "./index";

// Install shutdown wiring around a server you built yourself and clean it up
// so tests do not leak process listeners.
const removeHandlers = installShutdownHandlers(server);
await server.start();
// ...
removeHandlers();

void main; // only call main() when you actually want the default wiring
```

## Caveats

- **The default host is typed.** Native creation without a selector uses
  `code-review@1`; `config["x-ahp-session-type"] = "coding"` selects the larger
  contract set. Initialize, create, subscribe, list/dispose and the supported
  session actions are wired. Chat/model execution is not implemented. The
  server lists contracts; client implementations execute tools.
- **Import is inert.** The entrypoint guard compares `process.argv[1]` to this
  module's path, so importing `src/index.ts` from tests or tools never starts a
  listener. Running `vite-node src/index.ts` directly does **not** satisfy the
  guard and will exit without listening; use `pnpm start` (the built entry) or
  call `main()` yourself.
- **The agent/work extension is opt-in.** Without both
  `AGENT_HOSTING_PROTOCOL_DATABASE_URL` and
  `AGENT_HOSTING_PROTOCOL_AUTH_TOKENS`, the server runs the baseline host and the
  namespaced methods are not registered. Supplying only one of the pair throws
  before startup rather than silently disabling authorization.
- **Shutdown failures set `process.exitCode = 1`** instead of throwing from the
  signal handler, so a failed shutdown is observable without crashing the
  process.

## Related Documentation

- [`docs/architecture/capabilities.md`](../docs/architecture/capabilities.md) —
  how the capabilities compose.
- [`env/README.md`](../env/README.md) — configuration required before startup.
- [`docs/technical/runtime-lifecycles.md`](../docs/technical/runtime-lifecycles.md)
  — session and server lifecycles.

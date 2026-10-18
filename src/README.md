# Source (`src`)

`src/` is a capability-oriented modular monolith. Each capability below is a
folder with its own colocated `README.md` and an `index.ts` that defines its
public surface. `src/index.ts` is the **composition root**: the only place that
wires capabilities together and the process entrypoint.

Start here, then read the README of the capability you are changing.

## Capabilities

| Capability | README | Responsibility |
| ---------- | ------ | -------------- |
| `jsonrpc/` | [`jsonrpc/README.md`](jsonrpc/README.md) | JSON-RPC 2.0 message schemas, the owned `RpcError`, and the allowlisted error codes. No transport, no I/O. |
| `sessions/` | [`sessions/README.md`](sessions/README.md) | The session engine: provider registry, session store, state reducer, sequencing, and lifecycle. AHP-aware but transport-agnostic. |
| `websocket/` | [`websocket/README.md`](websocket/README.md) | JSON-RPC over WebSocket transport: upgrade handling, per-socket dispatch, heartbeat, and race-safe start/stop. |
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
- `installShutdownHandlers(server: WebSocketServerHandle): () => void` — wires
  `SIGINT`/`SIGTERM` to `server.stop()` and returns a function that removes the
  handlers.
- `main(): Promise<void>` — loads config, creates the server, starts it, and logs
  the bound address.

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

- **Only `ping` is wired today.** `main()` passes `handlers: { ping: () => null }`.
  Session creation, subscription, and chat are not exposed on the wire yet; see
  [`docs/plans/ProvidersPlan.md`](../docs/plans/ProvidersPlan.md).
- **Import is inert.** The entrypoint guard compares `process.argv[1]` to this
  module's path, so importing `src/index.ts` from tests or tools never starts a
  listener. Running `vite-node src/index.ts` directly does **not** satisfy the
  guard and will exit without listening; use `pnpm start` (the built entry) or
  call `main()` yourself.
- **Shutdown failures set `process.exitCode = 1`** instead of throwing from the
  signal handler, so a failed shutdown is observable without crashing the
  process.

## Related Documentation

- [`docs/architecture/capabilities.md`](../docs/architecture/capabilities.md) —
  how the capabilities compose.
- [`env/README.md`](../env/README.md) — configuration required before startup.
- [`docs/technical/runtime-lifecycles.md`](../docs/technical/runtime-lifecycles.md)
  — session and server lifecycles.

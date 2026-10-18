import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "@env";

import { createWebSocketServer, type WebSocketServerHandle } from "./websocket";

export const APP_NAME = "Agent Hosting Protocol";

/**
 * Connects termination signals to server shutdown.
 *
 * Returns a function that removes the handlers, so tests and embedders can
 * install and clean up the wiring without leaking process listeners.
 */
export const installShutdownHandlers = (server: WebSocketServerHandle): (() => void) => {
  const shutdown = (): void => {
    void server.stop().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Failed to shut down");
      process.exitCode = 1;
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return (): void => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  };
};

export const main = async (): Promise<void> => {
  const config = loadEnv();

  const server = createWebSocketServer({
    host: config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST,
    port: config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT,
    handlers: {
      ping: () => null,
    },
  });

  const address = await server.start();
  installShutdownHandlers(server);
  console.log(`${APP_NAME} listening on ws://${address.address}:${String(address.port)}`);
};

// Run only when executed as the process entrypoint, so importing this module
// from tests or tools has no side effects.
const isEntrypoint = (): boolean => {
  const invoked = process.argv[1];
  return invoked !== undefined && fileURLToPath(import.meta.url) === resolve(invoked);
};

if (isEntrypoint()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Failed to start");
    process.exitCode = 1;
  });
}

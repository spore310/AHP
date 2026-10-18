import { fileURLToPath } from "node:url";

import { loadEnv } from "@env";

import { createWebSocketServer } from "./websocket";

export const APP_NAME = "Agent Hosting Protocol";

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
  console.log(`${APP_NAME} listening on ws://${address.address}:${String(address.port)}`);
};

// Run only when executed as the process entrypoint, so importing this module
// from tests or tools has no side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Failed to start");
    process.exitCode = 1;
  });
}

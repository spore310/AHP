import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createStaticTokenAuthenticator } from "@agents";
import { loadEnv, parseAllowedKinds, parseAuthTokens, type EnvConfig } from "@env";
import {
  createPostgresAgentRegistrationRepository,
  createPostgresPool,
  createPostgresWorkRepository,
} from "@persistence";

import { createBaselineSessionApplication } from "./application";
import { mockProvider } from "@sessions/mock";
import {
  createAHPServer,
  type AHPServerAgentWorkOptions,
  type WebSocketServerHandle,
} from "./websocket";

export const APP_NAME = "Agent Hosting Protocol";

/**
 * Build optional durable agent/work wiring from validated environment values.
 *
 * Both the database URL and at least one bearer token are required. A partial
 * configuration is a startup error rather than a silently unauthenticated or
 * non-durable server.
 */
export const createAgentWorkOptions = (
  config: EnvConfig,
): AHPServerAgentWorkOptions | undefined => {
  const databaseUrl = config.AGENT_HOSTING_PROTOCOL_DATABASE_URL;
  const authTokens = config.AGENT_HOSTING_PROTOCOL_AUTH_TOKENS;

  if (databaseUrl === undefined && authTokens === undefined) {
    return undefined;
  }
  if (databaseUrl === undefined || authTokens === undefined) {
    throw new Error(
      "Agent/work features require both AGENT_HOSTING_PROTOCOL_DATABASE_URL and AGENT_HOSTING_PROTOCOL_AUTH_TOKENS",
    );
  }

  const tokens = parseAuthTokens(authTokens);
  const allowedKinds = parseAllowedKinds(
    config.AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS,
  );
  const pool = createPostgresPool({ connectionString: databaseUrl });

  return {
    authenticator: createStaticTokenAuthenticator(tokens),
    registrations: createPostgresAgentRegistrationRepository(pool),
    work: createPostgresWorkRepository(pool, {
      leaseTtlSeconds: config.AGENT_HOSTING_PROTOCOL_WORK_LEASE_SECONDS,
    }),
    allowedKinds,
    presenceTtlMs: config.AGENT_HOSTING_PROTOCOL_PRESENCE_TTL_SECONDS * 1_000,
    dispose: async (): Promise<void> => {
      await pool.end();
    },
  };
};

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
  const agentWork = createAgentWorkOptions(config);
  const server = createAHPServer({
    host: config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST,
    port: config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT,
    sessions: {
      providers: [mockProvider],
      application: createBaselineSessionApplication(),
    },
    ...(agentWork !== undefined ? { agentWork } : {}),
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

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createStaticTokenAuthenticator } from "@agents";
import { loadEnv, parseAllowedKinds, parseAuthTokens, type EnvConfig } from "@env";
import { createConfiguredPersistenceProvider } from "@persistence/helpers/adapters";
import { createPersistence } from "@persistence";
import type { PersistenceProvider } from "@persistence/types";

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
export const createAgentWorkOptions = async (
  config: EnvConfig,
): Promise<AHPServerAgentWorkOptions | undefined> => {
  const databaseUrl = config.AGENT_HOSTING_PROTOCOL_DATABASE_URL;
  const authTokens = config.AGENT_HOSTING_PROTOCOL_AUTH_TOKENS;
  const providerName = config.AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER;

  if (databaseUrl === undefined && authTokens === undefined) {
    if (providerName !== undefined) {
      throw new Error(
        "AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER requires durable agent/work configuration",
      );
    }
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
  const authenticator = createStaticTokenAuthenticator(tokens);
  let provider: PersistenceProvider | undefined;
  try {
    provider = await createConfiguredPersistenceProvider({
      provider: providerName,
      options: {
        url: databaseUrl,
        workLeaseSeconds: config.AGENT_HOSTING_PROTOCOL_WORK_LEASE_SECONDS,
      },
    });
    const persistence = createPersistence(provider);
    return {
      authenticator,
      registrations: persistence.registrations,
      work: persistence.work,
      allowedKinds,
      presenceTtlMs: config.AGENT_HOSTING_PROTOCOL_PRESENCE_TTL_SECONDS * 1_000,
      dispose: () => persistence.dispose(),
    };
  } catch (error) {
    if (provider !== undefined) {
      try {
        await provider.dispose();
      } catch {
        // Composition failure remains primary; cleanup is best-effort here.
      }
    }
    throw error;
  }
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
  const agentWork = await createAgentWorkOptions(config);
  let server: ReturnType<typeof createAHPServer>;
  try {
    server = createAHPServer({
      host: config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST,
      port: config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT,
      sessions: {
        providers: [mockProvider],
        application: createBaselineSessionApplication(),
      },
      ...(agentWork !== undefined ? { agentWork } : {}),
    });
  } catch (error) {
    try {
      await agentWork?.dispose?.();
    } catch {
      // Preserve the composition failure that prevented host ownership transfer.
    }
    throw error;
  }

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

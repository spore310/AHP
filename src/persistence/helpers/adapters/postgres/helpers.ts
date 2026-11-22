import type { PersistenceProvider } from "@persistence/types";

import { createPostgresAgentRegistrationRepository } from "./helpers/agentRegistrations";
import { createPostgresPool } from "./helpers/connection";
import { createPostgresDurableSessionRepository } from "./helpers/sessions";
import { createPostgresWorkRepository } from "./helpers/workItems";
import type { PostgresOptions, PostgresWorkRepositoryOptions } from "./types";

export interface PostgresPersistenceOptions extends PostgresOptions, PostgresWorkRepositoryOptions {}

export const createPostgresPersistenceProvider = async (
  options: PostgresPersistenceOptions,
): Promise<PersistenceProvider> => {
  if (typeof options.connectionString !== "string" || options.connectionString.length === 0
    || (options.maxConnections !== undefined
      && (!Number.isInteger(options.maxConnections) || options.maxConnections < 1))
    || (options.leaseTtlSeconds !== undefined
      && (!Number.isInteger(options.leaseTtlSeconds) || options.leaseTtlSeconds < 1))) {
    throw new Error("Invalid PostgreSQL persistence options.");
  }

  const pool = createPostgresPool(options);
  let disposal: Promise<void> | undefined;
  try {
    return {
      registrations: createPostgresAgentRegistrationRepository(pool),
      sessions: createPostgresDurableSessionRepository(pool),
      work: createPostgresWorkRepository(pool, { leaseTtlSeconds: options.leaseTtlSeconds }),
      dispose() {
        disposal ??= pool.end();
        return disposal;
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
};

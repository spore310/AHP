import type { PostgresPersistenceOptions } from "@persistence/helpers/adapters/postgres";

import { runP0PostgresConformance } from "./p0Conformance";

/** Explicit opt-in runner. The caller must supply an authorized migrated test database. */
export const runPostgresPersistenceConformance = async (
  options: PostgresPersistenceOptions,
): Promise<void> => {
  await runP0PostgresConformance(options.connectionString);
};

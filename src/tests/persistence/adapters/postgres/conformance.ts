import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";
import type { PostgresPersistenceOptions } from "@persistence/helpers/adapters/postgres";

import { assertPersistenceConformance } from "../../conformance/helpers";

/** Explicit opt-in runner. The caller must supply an authorized migrated test database. */
export const runPostgresPersistenceConformance = (
  options: PostgresPersistenceOptions,
): Promise<void> => assertPersistenceConformance(
  () => createPostgresPersistenceProvider(options),
);

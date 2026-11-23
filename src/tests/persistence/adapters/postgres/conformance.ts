import { createPersistence } from "@persistence";
import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";
import type { PostgresPersistenceOptions } from "@persistence/helpers/adapters/postgres";

import { assertPersistenceConformance, assertRegistrationQuotaConformance } from "../../conformance/helpers";

const unusedAgentId = "00000000-0000-4000-8000-999999999999";

/** Explicit opt-in runner. The caller must supply an authorized migrated test database. */
export const runPostgresPersistenceConformance = async (
  options: PostgresPersistenceOptions,
): Promise<void> => {
  const quotaOptions = { ...options, registrationLimits: { maxPerPrincipal: 1, maxTotal: 2 } };
  const first = createPersistence(await createPostgresPersistenceProvider(quotaOptions));
  try {
    const second = createPersistence(await createPostgresPersistenceProvider(quotaOptions));
    try {
      // Warm independent pools before the concurrent registrations.
      await Promise.all([first.registrations.getById(unusedAgentId), second.registrations.getById(unusedAgentId)]);
      await assertRegistrationQuotaConformance(first.registrations, second.registrations);
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose();
  }
  await assertPersistenceConformance(() => createPostgresPersistenceProvider(options));
};

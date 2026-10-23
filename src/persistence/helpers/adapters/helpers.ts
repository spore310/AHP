import type { PersistenceProvider } from "@persistence/types";

import type { PersistenceProviderLoader, PersistenceSelection } from "./types";

const loadPostgres: PersistenceProviderLoader = async (options) => {
  const { createPostgresPersistenceProvider } = await import("./postgres");
  if (typeof options.url !== "string" || options.url.length === 0
    || (options.maxConnections !== undefined
      && (typeof options.maxConnections !== "number"
        || !Number.isInteger(options.maxConnections) || options.maxConnections < 1))
    || (options.workLeaseSeconds !== undefined
      && (typeof options.workLeaseSeconds !== "number"
        || !Number.isInteger(options.workLeaseSeconds) || options.workLeaseSeconds < 1))) {
    throw new Error("Invalid PostgreSQL persistence configuration.");
  }
  return createPostgresPersistenceProvider({
    connectionString: options.url,
    maxConnections: options.maxConnections as number | undefined,
    leaseTtlSeconds: options.workLeaseSeconds as number | undefined,
  });
};

const loaders: Readonly<Record<string, PersistenceProviderLoader>> = { postgres: loadPostgres };

export const createConfiguredPersistenceProvider = async (
  selection: PersistenceSelection,
): Promise<PersistenceProvider> => {
  const name = selection.provider ?? "postgres";
  const loader = loaders[name];
  if (loader === undefined) {
    throw new Error("The configured persistence provider is not supported.");
  }
  return loader(selection.options);
};

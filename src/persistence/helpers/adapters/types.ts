import type { PersistenceProvider } from "@persistence/types";

export interface PersistenceSelection {
  readonly provider?: string;
  readonly options: Readonly<Record<string, unknown>>;
}

export type PersistenceProviderLoader = (
  options: Readonly<Record<string, unknown>>,
) => Promise<PersistenceProvider>;

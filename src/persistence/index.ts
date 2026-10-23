export { RepositoryError } from "./types";
export type {
  AgentRegistrationRecord,
  AgentRegistrationRepository,
  DurableSessionInput,
  DurableSessionRepository,
  PersistenceProvider,
  PersistenceRepositories,
  RepositoryErrorCode,
  WorkClaimInput,
  WorkItemRecord,
  WorkLeaseRecord,
  WorkRepository,
  WorkStatus,
  WorkSubmitInput,
} from "./types";
export { createPersistence } from "./helpers/provider";

// Temporary compatibility forwards; P10 removes them after the composition root migrates.
export { createPostgresAgentRegistrationRepository } from "./helpers/adapters/postgres/helpers/agentRegistrations";
export { createPostgresDurableSessionRepository } from "./helpers/adapters/postgres/helpers/sessions";
export { createPostgresPool } from "./helpers/adapters/postgres/helpers/connection";
export type { PostgresOptions, PostgresWorkRepositoryOptions } from "./helpers/adapters/postgres/types";
export { createPostgresWorkRepository } from "./helpers/adapters/postgres/helpers/workItems";

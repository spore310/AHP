export { DEFAULT_SESSION_TITLE, ROOT_CHANNEL_URI, SESSION_URI_PREFIX } from "./constants";

export { createSessionParamsSchema } from "./createSession";
export type { CreateSessionParams } from "./createSession";

export {
  SessionConfigError,
  SessionStartError,
  SessionsDisposingError,
  SessionsError,
} from "./helpers/errors";
export { createSessionConfig } from "./helpers/configuration";
export { createSessionsFactory } from "./helpers/factory";
export { createActionSequence, createSequenceAllocator } from "./helpers/sequence";
export type { ActionSequence } from "./helpers/sequence";

export { sessionUriSchema } from "./types";
export type {
  CatalogueNotification,
  ProviderSessionInput,
  SessionAddedCatalogueNotification,
  SessionBackend,
  SessionConfigContract,
  SessionProvider,
  SessionRecord,
  SessionRegistry,
  SessionsDiagnostic,
  SessionsFactory,
  SessionsFactoryOptions,
  SessionSnapshot,
  SessionRemovedCatalogueNotification,
  SessionSummaryChangedCatalogueNotification,
} from "./types";

export { DEFAULT_SESSION_TITLE, ROOT_CHANNEL_URI, SESSION_URI_PREFIX } from "./constants";

export { createSessionParamsSchema } from "./createSession";
export type { CreateSessionParams } from "./createSession";

export { SessionStartError, SessionsError } from "./helpers/errors";
export { createSessionsFactory } from "./helpers/factory";

export { sessionUriSchema } from "./types";
export type {
  CatalogueNotification,
  ProviderSessionInput,
  SessionAddedCatalogueNotification,
  SessionBackend,
  SessionProvider,
  SessionRecord,
  SessionRegistry,
  SessionsFactory,
  SessionsFactoryOptions,
  SessionSnapshot,
  SessionSummaryChangedCatalogueNotification,
} from "./types";

export { DEFAULT_SESSION_TITLE, ROOT_CHANNEL_URI, SESSION_TYPE_KEY_PATTERN, SESSION_URI_PREFIX } from "./constants";

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
export { createApplicationSession } from "./helpers/application/host";
export { defineApplicationSession } from "./helpers/application/define";
export { createSessionTypeToolMap, visibleTools } from "./helpers/application";
export type { IssuedToolContract, SessionToolManifest } from "./helpers/application/manifest";
export type {
  AuthorizedToolGrant,
  SessionApplicationBinding,
  SessionApplicationOptions,
  SessionTypeToolMap,
} from "./helpers/application";
export { ClientAccessRole, ToolAccessLevel } from "./helpers/application";
export { createSessionTypeCatalogue, SessionTypeError } from "./helpers/sessionTypes";
export type {
  ApplicationSessionType,
  ResolvedSessionType,
  SessionTypeCatalogue,
  SessionTypeDefinition,
  SessionTypeRef,
} from "./helpers/sessionTypes";
export { createActionSequence, createSequenceAllocator } from "./helpers/sequence";
export type { ActionSequence } from "./helpers/sequence";

export type { CreatorBindingTemplate, CreatorBootstrapApproval, CreatorBootstrapTemplate, SessionCreationApproval, SessionCreationCapabilityRef, SessionCreationContext, SessionCreationFacts, SessionCreationSecurityOptions, SessionFactoryAuthorization, SessionTypePolicyRegistration } from "./helpers/creation";
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

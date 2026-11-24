export { createAgentDirectory } from "./helpers/directory";
export { createAgentWorkConfig } from "./helpers/workConfiguration";
export { createStaticTokenAuthenticator } from "./helpers/authenticator";
export { createLegacyConnectionIdentityAdapter } from "./helpers/policyIdentity";
export type { LegacyIdentityAdapterOptions } from "./helpers/policyIdentity";
export { AgentDirectoryError } from "./helpers/errors";
export type { AgentDirectoryErrorCode } from "./helpers/errors";
export { DEFAULT_PRESENCE_TTL_MS } from "./constants";
export type {
  AgentDirectory,
  AgentWorkConfig,
  AgentWorkConfiguration,
  AgentDirectoryOptions,
  AgentDirectoryRegistrationLimits,
  AuthenticatedPrincipal,
  ConnectionAuthenticator,
  PresenceBinding,
  TrustedHandshakeContext,
} from "./types";

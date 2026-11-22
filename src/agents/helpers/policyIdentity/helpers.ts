import type { ConnectionIdentityAdapter } from "@authorization/types";
import { identifierSchema, securitySubjectRefSchema } from "@authorization/helpers/validation";

import type { LegacyIdentityAdapterOptions } from "./types";

const sources = new WeakMap<ConnectionIdentityAdapter, LegacyIdentityAdapterOptions>();

/** Explicit one-source bridge. It authenticates a subject, never classifies an actor. */
export const createLegacyConnectionIdentityAdapter = (options: LegacyIdentityAdapterOptions): ConnectionIdentityAdapter => {
  const domainId = identifierSchema.parse(options.domainId);
  const authenticator = options.authenticator;
  const authenticate = authenticator.authenticate.bind(authenticator);
  const adapter: ConnectionIdentityAdapter = Object.freeze({
    authenticate: async (input: Parameters<ConnectionIdentityAdapter["authenticate"]>[0]) => {
      const principal = await authenticate(input);
      return principal === undefined ? undefined : securitySubjectRefSchema.parse({ domainId, subject: principal.subject });
    },
  });
  sources.set(adapter, Object.freeze({ authenticator, domainId }));
  return adapter;
};

/** Internal composition provenance; intentionally not re-exported by the agents barrel. */
export const legacyIdentitySource = (adapter: ConnectionIdentityAdapter): LegacyIdentityAdapterOptions | undefined => sources.get(adapter);

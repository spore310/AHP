import type { ConnectionAuthenticator } from "@agents/types";

export interface LegacyIdentityAdapterOptions {
  readonly authenticator: ConnectionAuthenticator;
  readonly domainId: string;
}

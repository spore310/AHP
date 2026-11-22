import type { AgentRegistrationRecord, AgentRegistrationRepository } from "@persistence/types";

/** A trusted subject derived from the transport handshake, never `clientId`. */
export interface AuthenticatedPrincipal {
  readonly subject: string;
}

/** Server-sourced handshake data available to a connection authenticator. */
export interface TrustedHandshakeContext {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly remoteAddress?: string;
}

export interface ConnectionAuthenticator {
  /** Returns `undefined` when the handshake carries no valid credential. */
  authenticate(input: TrustedHandshakeContext): Promise<AuthenticatedPrincipal | undefined>;
}

/** An ephemeral binding between a durable agent and one live connection. */
export interface PresenceBinding {
  readonly agentId: string;
  readonly principalSubject: string;
  readonly connectionId: string;
  readonly generation: number;
  readonly expiresAt: number;
}

export interface AgentDirectoryOptions {
  readonly registrations: AgentRegistrationRepository;
  /** Monotonic milliseconds used for presence deadlines. */
  readonly now?: () => number;
  readonly presenceTtlMs?: number;
}

export interface AgentDirectory {
  register(
    principal: AuthenticatedPrincipal,
    agentKey: string,
    displayName?: string,
  ): Promise<AgentRegistrationRecord>;
  /** Denies a different live connection while the current binding is valid. */
  bindPresence(
    agentId: string,
    principal: AuthenticatedPrincipal,
    connectionId: string,
  ): PresenceBinding;
  /** Returns `undefined` when the binding is no longer current or has expired. */
  renewPresence(binding: PresenceBinding): PresenceBinding | undefined;
  releasePresence(binding: PresenceBinding): void;
  /** Clears only bindings owned by that exact connection. */
  releaseConnection(connectionId: string): void;
  getOnline(agentId: string): PresenceBinding | undefined;
  getByConnection(connectionId: string): PresenceBinding | undefined;
  getRegistration(agentId: string): Promise<AgentRegistrationRecord | undefined>;
}

import type { AgentRegistrationRecord, AgentRegistrationRepository } from "@persistence/types";
import type { RegisteredAgentIdentity } from "@work/types";

export interface AgentWorkConfig {
  readonly defaultMaxActiveClaims?: number;
  readonly identities?: readonly {
    readonly identity: { readonly domainId: string; readonly subject: string; readonly agentKey: string; readonly actorAgentId?: string };
    readonly maxActiveClaims?: number;
    readonly allowedKinds?: readonly string[];
  }[];
}

export interface AgentWorkConfiguration {
  resolve(identity: RegisteredAgentIdentity): { readonly revision: string; readonly maxActiveClaims: number; readonly allowedKinds?: readonly string[] };
  replace(input: AgentWorkConfig): void;
}

/** A trusted subject derived from the transport handshake, never `clientId`. */
export interface AuthenticatedPrincipal {
  readonly domainId?: string;
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
  readonly executionEpoch?: string;
  readonly agentId: string;
  readonly principalSubject: string;
  readonly connectionId: string;
  readonly generation: number;
  readonly expiresAt: number;
}

export interface AgentDirectoryRegistrationLimits {
  readonly maxRetained: number;
  readonly maxPending: number;
}

export interface AgentDirectoryOptions {
  readonly changed?: () => void;
  readonly domainId?: string;
  readonly registrations: AgentRegistrationRepository;
  readonly registrationLimits?: Partial<AgentDirectoryRegistrationLimits>;
  /** Monotonic milliseconds used for presence deadlines. */
  readonly now?: () => number;
  readonly presenceTtlMs?: number;
}

export interface AgentDirectory {
  registerPresence(principal: AuthenticatedPrincipal, key: string, connectionId: string,
    options?: { readonly displayName?: string; readonly current?: () => boolean; readonly requireExecutionEpoch?: boolean }): Promise<PresenceBinding>;
  setEnabled(agentId: string, enabled: boolean): Promise<AgentRegistrationRecord>;
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
  capturePresenceFence?(binding: PresenceBinding, epoch: string): () => boolean;
  getByConnection(connectionId: string): PresenceBinding | undefined;
  getRegistration(agentId: string): Promise<AgentRegistrationRecord | undefined>;
}

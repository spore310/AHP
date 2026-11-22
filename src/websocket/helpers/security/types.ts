import type { TrustedHandshakeContext } from "@agents/types";
import type { ResourceRef, ResourceResolution, ScopedPolicyBinding, SecurityComposition, TrustedRequestContext } from "@authorization/types";

export interface ConnectionFence {
  readonly connectionId: string;
  readonly connectionGeneration: number;
}
export interface InitialBindingScope {
  readonly scope: ResourceRef;
  readonly grantRevision: number;
}
export interface PreparedInitialScopes {
  readonly scopes: readonly InitialBindingScope[];
  /** Explicit host-wide activity-cursor disclosure permission, default false. Guard/expiry cover it too. */
  readonly allowGlobalSequence?: boolean;
  readonly validUntil: number;
  isCurrent(): boolean;
  release(): void;
}
export interface InitialAuthoritySource {
  prepare(input: { readonly context: TrustedRequestContext; readonly fence: ConnectionFence; readonly signal: AbortSignal }): Promise<PreparedInitialScopes>;
}
export interface InitialScopeAuthority {
  readonly scope: ResourceRef;
  readonly grantRevision: number;
  readonly resolution: ResourceResolution;
  readonly bindings: readonly ScopedPolicyBinding[];
}
export interface ConnectionSecuritySnapshot {
  readonly context: TrustedRequestContext;
  readonly fence: ConnectionFence;
  readonly scopes: readonly InitialScopeAuthority[];
  readonly allowGlobalSequence: boolean;
  readonly validUntil: number;
}
export interface AHPServerSecurityOptions {
  readonly composition: SecurityComposition;
  readonly initialAuthority: InitialAuthoritySource;
  readonly setupDeadlineMs?: number;
  readonly maxInitialScopes?: number;
  readonly maxInitialBindings?: number;
  readonly maxInitialSubscriptions?: number;
  readonly now?: () => number;
  readonly workDomainId?: string;
}
export interface PreparedConnectionSetup {
  readonly snapshot: ConnectionSecuritySnapshot;
  isCurrent(): boolean;
  release(): void;
}
export interface ConnectionSetupAdapter {
  prepare(input: {
    readonly handshake: TrustedHandshakeContext;
    readonly fence: ConnectionFence;
    readonly authRevision: string;
    readonly signal: AbortSignal;
  }): Promise<PreparedConnectionSetup | undefined>;
}
export interface ConnectionAttachment {
  readonly fence: ConnectionFence;
  readonly setup?: PreparedConnectionSetup;
}

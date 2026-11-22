import type { BindingInstallationToken, ResourceInstallationToken, PolicyRef, PolicyScopeRules, ReferenceAuthorizer, ResourceRef, TrustedRequestContext } from "@authorization";
import type { ToolPolicyFactory } from "@toolPolicy";

export interface SessionCreationCapabilityRef { readonly key: string; readonly revision: number }
export interface CreatorBindingTemplate {
  readonly key: string;
  readonly purpose: "admitted" | "mandatory";
  readonly roles: readonly string[];
  readonly policies: readonly PolicyRef[];
  readonly authority: { readonly kind: "host-policy"; readonly policy: PolicyRef };
  readonly maxLifetimeMs: number;
}
export interface CreatorBootstrapTemplate { readonly id: string; readonly revision: number; readonly bindings: readonly CreatorBindingTemplate[] }
export interface SessionTypePolicyRegistration {
  readonly rules: PolicyScopeRules;
  readonly creatorBootstrap?: CreatorBootstrapTemplate;
  readonly creation: {
    readonly capability: SessionCreationCapabilityRef;
    prepare(input: { readonly request: SessionCreationFacts; readonly signal: AbortSignal }): Promise<SessionCreationApproval>;
  };
}
export interface SessionCreationContext {
  readonly context: TrustedRequestContext;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly validUntil: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
export interface SessionCreationFacts {
  readonly attemptId: string;
  readonly caller: TrustedRequestContext;
  readonly connectionGeneration: number;
  readonly candidate: ResourceRef<"session">;
  readonly type: { readonly id: string; readonly key: string; readonly version: number; readonly providerId: string };
  readonly capability: SessionCreationCapabilityRef;
  readonly rules: PolicyScopeRules;
  readonly bootstrap?: CreatorBootstrapTemplate;
  readonly config: Readonly<Record<string, unknown>>;
  readonly workingDirectories: readonly string[];
}
export type CreatorBootstrapApproval = { readonly kind: "none" } | {
  readonly kind: "template"; readonly id: string; readonly revision: number;
  readonly bindings: readonly { readonly key: string; readonly lifetimeMs: number }[];
};
export type SessionCreationApproval = { readonly effect: "deny"; release(): void } | {
  readonly effect: "allow";
  readonly request: SessionCreationFacts;
  readonly bootstrap: CreatorBootstrapApproval;
  readonly validUntil: number;
  isCurrent(): boolean;
  release(): void;
};
export interface SessionCreationSecurityOptions {
  readonly registry: ReferenceAuthorizer;
  readonly policies: ToolPolicyFactory;
  readonly prepareDeadlineMs?: number;
  readonly maxPendingCreates?: number;
  readonly maxSettlingSessions?: number;
  readonly maxBootstrapBindings?: number;
  readonly maxBootstrapLifetimeMs?: number;
  readonly maxCreationInputBytes?: number;
}
export interface SessionRecordOwnership {
  readonly ref: ResourceRef<"session">;
  readonly resource: ResourceInstallationToken;
  bootstrap: readonly BindingInstallationToken[];
}
export interface SessionFactoryAuthorization {
  usesRegistry(registry: ReferenceAuthorizer): boolean;
  isReady(expected: ResourceRef<"session">): boolean;
  createSession(params: unknown, caller: SessionCreationContext): Promise<void>;
  getResource(sessionUri: string): ResourceRef<"session"> | undefined;
  disposeSession(expected: ResourceRef<"session">): Promise<boolean>;
  isSettling(sessionUri: string): boolean;
}

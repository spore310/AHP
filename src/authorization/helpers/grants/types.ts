import { z } from "zod";

import { POLICY_LIMIT_ABSOLUTE, POLICY_LIMIT_DEFAULTS } from "../../constants";
import { grantAuthoritySchema, policyActorRefSchema, policyRefSchema, resourceRefSchema, roleNameSchema } from "../validation";
import { MAX_GRANT_LIMITS } from "./constants";
import type { BindingResolver, GrantIssueRequest, GrantIssuer, GrantRevocation, PolicyActorRef, PolicyRef, PreparedGrant, ResourceRef, ScopedPolicyBinding, TrustedRequestContext } from "../../types";
import type { CanonicalBindingToken, InstalledBinding, ResourceBindingBasis, ScopedBindingSnapshot } from "../bindings/types";
import type { ReferenceAuthorizer } from "../evaluate/types";

export interface GrantServiceLimits {
  readonly maxRegisteredRules: number;
  readonly maxMutationInputBytes: number;
  readonly maxPendingMutations: number;
  readonly maxPendingPerActor: number;
  readonly maxBindingsPerActor: number;
  readonly maxChildrenPerParent: number;
  readonly maxGrantLifetimeMs: number;
  readonly prepareDeadlineMs: number;
  readonly maxCleanupRoots: number;
}
export interface GrantSessionAuthority {
  usesRegistry(registry: ReferenceAuthorizer): boolean;
  isReady(expected: ResourceRef<"session">): boolean;
}
export type GrantRootGate = {
  readonly authorityPolicy: PolicyRef;
  readonly requiredPolicies: readonly PolicyRef[];
} & ({ readonly mode: "roles"; readonly anyOf: readonly string[] } | { readonly mode: "direct" });
export interface GrantAssignmentCeiling {
  readonly actorKinds: readonly ("user" | "agent")[];
  readonly roles: readonly string[];
  readonly policies: readonly PolicyRef[];
  readonly scope: "same" | "descendant";
  readonly maxLifetimeMs: number;
  readonly maxDepth: number;
  readonly childRules: readonly PolicyRef[];
}
export type GrantRevokeRelation = "issued" | "descendants" | "scope";
export interface RegisteredGrantControlRule {
  readonly ref: PolicyRef;
  readonly issuerKinds: readonly ("user" | "agent")[];
  readonly root?: GrantRootGate;
  readonly delegated?: boolean;
  readonly assign?: GrantAssignmentCeiling;
  readonly revoke?: { readonly relation: GrantRevokeRelation; readonly scope: "same" | "descendant" };
  prepare(input: { readonly request: GrantControlRequest; readonly signal: AbortSignal }): Promise<GrantControlApproval>;
}
export interface GrantControlRequest {
  readonly rule: PolicyRef;
  readonly context: TrustedRequestContext;
  readonly scope: ResourceRef;
  readonly issuerBinding: ScopedPolicyBinding;
  readonly request: GrantIssueRequest | GrantRevocation;
}
export type GrantControlApproval = { readonly effect: "deny"; release(): void | Promise<void> } | {
  readonly effect: "allow";
  readonly request: GrantControlRequest;
  readonly validUntil: number;
  isCurrent(): boolean;
  release(): void | Promise<void>;
};
export interface ResolvedGrantTarget {
  readonly actor: PolicyActorRef;
  readonly validUntil: number;
  isCurrent(): boolean;
  release(): void | Promise<void>;
}
export interface GrantServiceOptions {
  readonly sessions: GrantSessionAuthority;
  readonly rules: readonly RegisteredGrantControlRule[];
  readonly limits?: Partial<GrantServiceLimits>;
  resolveTarget(actor: PolicyActorRef, signal: AbortSignal): Promise<ResolvedGrantTarget>;
}
export interface BoundGrantContext {
  readonly context: TrustedRequestContext;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly validUntil: number;
  readonly signal: AbortSignal;
  readonly rule: PolicyRef;
  readonly basis: CanonicalBindingToken;
  readonly scope: ResourceRef;
  readonly revokeTarget?: CanonicalBindingToken;
  isCurrent(): boolean;
}
export interface GrantService {
  readonly bindings: BindingResolver;
  /** Samples the clock before the supplied identity guard and SDK readiness, then compares canonical facts without callbacks. */
  isBindingSnapshotCurrent(snapshot: ScopedBindingSnapshot, guard: () => boolean): boolean;
  issuer(context: BoundGrantContext): GrantIssuer;
  sweep(): void;
  dispose(): void;
}
export interface LocalInvalidation {
  readonly epoch: number;
  readonly grantRevision: number;
  readonly cause: "authority";
}
export interface InvalidationListenerState {
  readonly listener: (notice: LocalInvalidation) => unknown;
  active: boolean;
  running: boolean;
}

/** Internal immutable lineage facts; live authority remains in the canonical map. */
export interface GrantControlFacts {
  readonly service: object;
  readonly ceiling: GrantAssignmentCeiling;
  readonly revokeRelation?: GrantRevokeRelation;
}
export interface CapturedGrantBasis {
  readonly epoch: number;
  readonly grantRevision: number;
  readonly scope: ResourceRef;
  readonly root: ResourceRef<"session">;
  readonly parent: ScopedPolicyBinding;
  readonly ancestors: readonly ScopedPolicyBinding[];
  readonly controls?: GrantControlFacts;
  readonly target?: ScopedPolicyBinding;
  readonly targetAbsent: boolean;
  readonly targetDescendsFromBasis: boolean;
  readonly targetIssuedByBasis: boolean;
  readonly admitted?: readonly PolicyRef[];
  readonly relationships: readonly ResourceBindingBasis[];
}
export interface CanonicalGrantBasisState {
  readonly parent: InstalledBinding;
  readonly target?: InstalledBinding;
  used: boolean;
}
export interface GrantMutationSlot {
  readonly actor: PolicyActorRef;
  readonly controller: AbortController;
  readonly aborted: Promise<never>;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly guards: Array<() => unknown>;
  readonly releases: Array<() => unknown>;
  deadline: number;
  timer?: ReturnType<typeof setTimeout>;
  work: number;
  closed: boolean;
  receipt?: PreparedGrant;
}

/** Only the authorizer passes this port to its one service. Never publicly exported. */
export interface CanonicalGrantPort {
  readonly registry: ReferenceAuthorizer;
  readonly identity: object;
  now(): number;
  policyKnown(ref: PolicyRef): boolean;
  root(scope: ResourceRef, time: number): ResourceRef<"session">;
  snapshotCurrent(snapshot: ScopedBindingSnapshot, time: number): boolean;
  drain(): void;
  capture(context: BoundGrantContext, time: number): CapturedGrantBasis;
  basisCurrent(basis: CapturedGrantBasis, time: number): boolean;
  capacity(basis: CapturedGrantBasis, actor: PolicyActorRef, limits: GrantServiceLimits): boolean;
  commit(basis: CapturedGrantBasis, binding: ScopedPolicyBinding, control: GrantControlFacts, limits: GrantServiceLimits, time: number): boolean;
  revoke(basis: CapturedGrantBasis, time: number): boolean;
  dispose(): void;
  sweep(limit: number, time: number): void;
}

export const roles = z.array(roleNameSchema).max(POLICY_LIMIT_DEFAULTS.maxRoles);
export const policies = z.array(policyRefSchema).max(POLICY_LIMIT_DEFAULTS.maxPolicyRefs);
export const kinds = z.array(z.enum(["user", "agent"])).min(1).max(2);
export const callable = z.custom<() => unknown>((value) => typeof value === "function");
export const rootFields = { authorityPolicy: policyRefSchema, requiredPolicies: policies };
export const ceilingSchema = z.strictObject({ actorKinds: kinds, roles, policies, scope: z.enum(["same", "descendant"]),
  maxLifetimeMs: z.number().int().positive().max(MAX_GRANT_LIMITS.maxGrantLifetimeMs),
  maxDepth: z.number().int().positive().max(POLICY_LIMIT_ABSOLUTE.delegationDepth), childRules: policies,
});
export const ruleSchema = z.strictObject({ ref: policyRefSchema, issuerKinds: kinds,
  root: z.discriminatedUnion("mode", [z.strictObject({ ...rootFields, mode: z.literal("direct") }),
    z.strictObject({ ...rootFields, mode: z.literal("roles"), anyOf: roles.min(1) })]).optional(),
  delegated: z.boolean().optional(), assign: ceilingSchema.optional(),
  revoke: z.strictObject({ relation: z.enum(["issued", "descendants", "scope"]), scope: z.enum(["same", "descendant"]) }).optional(),
});
export const issueSchema = z.strictObject({ operation: z.literal("assign"), issuer: policyActorRefSchema, actor: policyActorRefSchema,
  scope: resourceRefSchema, roles, policies, authority: grantAuthoritySchema,
  delegationDepth: z.number().int().min(0).max(POLICY_LIMIT_ABSOLUTE.delegationDepth), expiresAt: z.iso.datetime().optional(),
});
export const revokeSchema = z.strictObject({ operation: z.literal("revoke"), issuer: policyActorRefSchema,
  grantId: z.string().min(1).max(POLICY_LIMIT_DEFAULTS.maxIdentifierLength), instanceId: z.string().min(1).max(POLICY_LIMIT_DEFAULTS.maxIdentifierLength),
});
export const targetSchema = z.strictObject({ actor: policyActorRefSchema, validUntil: z.number(), isCurrent: callable, release: callable });
export const approvalSchema = z.strictObject({ effect: z.literal("allow"), request: z.unknown(), validUntil: z.number(), isCurrent: callable, release: callable });

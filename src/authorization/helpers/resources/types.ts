import type { PolicyRef, ResourceRef, ResourceRoute, SecuritySubjectRef } from "../../types";

/** Trusted registration input; installation identity is issued separately. */
export interface ResourceRegistration {
  readonly resource: ResourceRef;
  readonly owner: SecuritySubjectRef;
  readonly route: ResourceRoute;
  readonly allowedRoutes?: readonly ResourceRoute[];
  readonly mandatory?: readonly RegisteredMandatory[];
  readonly externalAuthority: "none" | "required";
  readonly admission?: { readonly sessionType: { readonly key: string; readonly version: number }; readonly providerId: string };
  readonly grantParent?: ResourceRef;
}

/** Trusted host registration. Applicability is not a caller-supplied policy boolean. */
export interface RegisteredMandatory {
  readonly ref: PolicyRef;
  readonly applicable: boolean;
}

export interface RegisteredResource {
  readonly resource: ResourceRef;
  readonly owner: SecuritySubjectRef;
  readonly route: ResourceRoute;
  readonly allowedRoutes?: readonly ResourceRoute[];
  readonly mandatory: readonly RegisteredMandatory[];
  readonly externalAuthority: "none" | "required";
  readonly relationshipRevision: number;
  readonly admission?: ResourceRegistration["admission"];
  readonly grantParent?: ResourceRef;
}

/** A registered owner must validate payloads and invoke admission immediately before mutation. */
export interface ResourceOperation {
  readonly name: string;
  readonly purpose: import("@authorization/policies").PolicyOperation;
  readonly policies: readonly PolicyRef[];
  validate?(payload: unknown): boolean;
  commit?(payload: unknown, context: ResourceOperationRequest, admission: () => boolean): boolean;
  /** The durable owner invokes admission synchronously at its first write, then awaits commit. */
  commitDurable?(payload: unknown, context: ResourceOperationRequest, admission: () => boolean): Promise<boolean>;
}
export interface ResourceKindAdapter {
  readonly kind: string;
  resolve(selector: { readonly kind: string; readonly id: string }, signal: AbortSignal): ResourceRef | undefined | Promise<ResourceRef | undefined>;
  current(resource: ResourceRef): boolean;
  /** Pure instance/revision fence, with no callbacks or clock reads. */
  fence(resource: ResourceRef): boolean;
  proof?(resource: ResourceRef, actor: import("../../types").TrustedRequestContext, signal: AbortSignal): import("../evaluate/types").PresentedExternalProof | undefined | Promise<import("../evaluate/types").PresentedExternalProof | undefined>;
}
export interface ResourceTypeRegistration {
  readonly kind: string;
  readonly type: { readonly key: string; readonly version: number };
  readonly providerId: string;
  readonly operations: readonly ResourceOperation[];
}
/** Host-owned restrictive authority. The fence samples only local owned state. */
export interface WorkOperationGuard { current(): boolean; fence(): boolean; release(): void }
export type PrepareWorkOperation = (caller: import("../../types").TrustedRequestContext, work: import("@work").WorkExecutionRef,
  route: ResourceRoute, input: unknown, signal: AbortSignal) => Promise<WorkOperationGuard>;
export interface WorkOperationRestriction {
  readonly work?: import("@work").WorkExecutionRef;
  readonly prepareWork?: PrepareWorkOperation;
}
export interface ResourceOperationRequest {
  readonly actor: import("../../types").TrustedRequestContext;
  readonly route: ResourceRoute;
  readonly target: ResourceRef;
  readonly operation: string;
  readonly payload: unknown;
  readonly signal: AbortSignal;
}
export interface ResourceOperationAuthority {
  readonly registry: import("../evaluate/types").ReferenceAuthorizer;
  readonly decisions: readonly { readonly stamp: import("../evaluate/types").LocalDecisionStamp; readonly actor: import("../../types").TrustedRequestContext }[];
}
export interface ResourceOperationTicket { readonly kind: "resource-operation" }
export interface ResourceOperationHandle {
  readonly ticket: Promise<ResourceOperationTicket | undefined>;
  /** Actual resolver/provider/policy settlement, including after timeout/cancellation. */
  readonly settled: Promise<undefined>;
}
export interface ResourceOperationsOptions {
  readonly prepareWork?: PrepareWorkOperation;
  readonly registry: import("../evaluate/types").ReferenceAuthorizer;
  readonly policies: import("@authorization/policies").PolicyFactory;
  readonly kinds: readonly ResourceKindAdapter[];
  readonly types: readonly ResourceTypeRegistration[];
  readonly maxPending?: number;
  readonly timeoutMs?: number;
}
export interface ResourceOperations {
  install(registration: ResourceRegistration): void;
  authorize(request: ResourceOperationRequest & Pick<WorkOperationRestriction, "work">): ResourceOperationHandle;
  /** The trusted guard must aggregate original invocation proofs with these operation proofs. */
  commit(ticket: ResourceOperationTicket, admission: (authority: ResourceOperationAuthority) => boolean): boolean;
  /** Waits for the registered owner's mutation, retaining its capacity slot until settlement. */
  commitDurable(ticket: ResourceOperationTicket, admission: (authority: ResourceOperationAuthority) => boolean): Promise<boolean>;
  cancel(ticket: ResourceOperationTicket): void;
  dispose(): void;
  stats(): { readonly active: number };
}

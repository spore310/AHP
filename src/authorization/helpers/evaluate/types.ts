import type { ToolContractDefinition } from "@tools";
import type { ToolExecutionBinding, ToolOperation, ToolPolicyFactory } from "@toolPolicy";

import type {
  ExecutorRevision,
  PolicyActorRef,
  PolicyDecision,
  PolicyRef,
  ResourceRef,
  ResourceRoute,
  ScopedPolicyBinding,
  SecuritySubjectRef,
  TrustedRequestContext,
} from "../../types";
import type { ResourceRegistration } from "../resources/types";
import type { BindingInstallationToken, ResourceInstallationToken, ScopedBindingSnapshot } from "../bindings/types";

/** Finite registry budgets. These are not `PolicyLimits.maxPolicyRefs`. */
export interface ReferenceRegistryCaps {
  readonly maxResources: number;
  readonly maxBindings: number;
  readonly maxTools: number;
  readonly maxExecutors: number;
  readonly maxAdmissions: number;
  readonly maxToolAssignments: number;
  readonly maxPermissionEvaluators: number;
  readonly maxExtensionEvaluators: number;
  readonly maxExternalInvalidations: number;
}

/** Trusted in-process adapter fact. Not a transport or client proof. */
export interface PresentedExternalProof {
  readonly resource?: ResourceRef;
  readonly revision: string;
  readonly validUntil: number;
}

export interface CapturedExternalProof {
  readonly resource: ResourceRef;
  readonly revision: string;
  readonly validUntil: number;
}

export interface LocalDecisionStamp {
  readonly authority: import("../../types").AuthorityRevisionStamp;
  readonly validUntil: number;
  readonly epoch: number;
  readonly grantRevision: number;
  readonly relationshipRevisions: readonly { readonly resource: ResourceRef; readonly revision: number }[];
  readonly bindingExpiries: readonly { readonly bindingId: string; readonly expiresAt?: string }[];
  readonly externalProofs: readonly CapturedExternalProof[];
}

export interface StampedDecision {
  readonly decision: PolicyDecision;
  readonly stamp: LocalDecisionStamp;
}

export interface PermissionCheck {
  readonly permission: string;
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
}

export type PermissionEvaluator = (
  input: PermissionCheck,
) => Promise<"allow" | "deny"> | "allow" | "deny";

export type ExtensionEvaluator = (input: {
  readonly policyRef: PolicyRef;
  readonly extension: unknown;
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
}) => Promise<"allow" | "deny"> | "allow" | "deny";

export interface MandatoryBindingSelector {
  readonly resource: ResourceRef;
  readonly policyRef: PolicyRef;
  readonly bindingId: string;
}

export interface EvaluateSelector {
  readonly actor: TrustedRequestContext;
  readonly operation: ToolOperation;
  readonly bindingId: string;
  readonly policyRef: PolicyRef;
  readonly scope: ResourceRef;
  readonly route: ResourceRoute;
  readonly external?: PresentedExternalProof;
  readonly externalProofs?: readonly PresentedExternalProof[];
  readonly executor?: ExecutorRevision;
  readonly mandatoryBindings?: readonly MandatoryBindingSelector[];
  /** Ignored. Mandatory rules come from registration, not the request. */
  readonly mandatory?: readonly PolicyRef[];
}

export interface ToolAssignmentRecord {
  readonly resource: ResourceRef;
  readonly route: ResourceRoute;
  readonly recipient: PolicyActorRef;
  readonly contract: { readonly id: string; readonly key: string; readonly version: number };
  readonly operation: ToolOperation;
  readonly bindingId: string;
  readonly policyRef: PolicyRef;
  readonly executor?: ExecutorRevision;
  readonly implementation?: ToolExecutionBinding;
}

export interface AssignmentItem {
  readonly contractId: string;
  readonly policyRef: PolicyRef;
  readonly bindingId: string;
  readonly operation?: ToolOperation;
}

export interface ProjectAssignmentsInput {
  readonly actor: TrustedRequestContext;
  readonly purpose: ToolOperation;
  readonly recipient: "caller" | "executor";
  readonly executor?: ExecutorRevision;
  readonly scope: ResourceRef;
  readonly route: ResourceRoute;
  readonly tools: readonly AssignmentItem[];
  readonly external?: PresentedExternalProof;
  readonly externalProofs?: readonly PresentedExternalProof[];
  readonly mandatoryBindings?: readonly MandatoryBindingSelector[];
  readonly harnessName?: string;
  /** Ignored. Mandatory rules come from registration, not the request. */
  readonly mandatory?: readonly PolicyRef[];
}

export interface AdmittedAssignment {
  readonly tuple: ToolAssignmentRecord;
  readonly allowed: boolean;
  readonly reveal: boolean;
  readonly challengeRequired: boolean;
  readonly decision: StampedDecision;
}

export interface AssignmentAuthorization {
  readonly decisions: readonly StampedDecision[];
  readonly stamps: readonly LocalDecisionStamp[];
  readonly admitted: readonly AdmittedAssignment[];
}

export interface ReferenceAuthorizerOptions {
  readonly policies: ToolPolicyFactory;
  readonly now: () => number;
  readonly permissionEvaluators?: Readonly<Record<string, PermissionEvaluator>>;
  readonly decisionTtlMs?: number;
  readonly hookDeadlineMs?: number;
  readonly caps?: Partial<ReferenceRegistryCaps>;
  readonly inputLimits?: Partial<ReferenceInputLimits>;
  readonly maxGrantResourceDepth?: number;
  readonly maxInvalidationListeners?: number;
}

/** List budgets. These are not registry caps and not `maxPolicyRefs`. */
export interface ReferenceInputLimits {
  readonly maxAdmissionInstalls: number;
  readonly maxRouteTargets: number;
  readonly maxProofs: number;
  readonly maxMandatorySelectors: number;
  readonly maxProjectionTools: number;
}

export interface ReferenceAuthorizer {
  onInvalidate(listener: (notice: import("../grants/types").LocalInvalidation) => void): () => void;
  drainInvalidations(): void;
  createGrantService(options: import("../grants/types").GrantServiceOptions): import("../grants/types").GrantService;
  readBindings(query: { readonly actor: PolicyActorRef; readonly scope: ResourceRef }): ScopedBindingSnapshot;
  isBindingSnapshotCurrent(snapshot: ScopedBindingSnapshot): boolean;
  usesPolicyFactory(factory: ToolPolicyFactory): boolean;
  removeBinding(expected: { readonly bindingId: string; readonly scope: ResourceRef; readonly revision: number }): boolean;
  installAdmission(input: { readonly sessionType: { readonly key: string; readonly version: number }; readonly providerId: string }): void;
  installAdmissions(inputs: readonly { readonly sessionType: { readonly key: string; readonly version: number }; readonly providerId: string }[]): void;
  prepareResourceInstallation(input: ResourceRegistration): ResourceInstallationToken;
  prepareBindingInstallation(binding: ScopedPolicyBinding, resource: ResourceInstallationToken): BindingInstallationToken;
  isResourceInstallationCurrent(installation: ResourceInstallationToken): boolean;
  isBindingInstallationCurrent(installation: BindingInstallationToken): boolean;
  removeInstalledBinding(installation: BindingInstallationToken): boolean;
  teardownInstalledResource(installation: ResourceInstallationToken): boolean;
  installResource(input: ResourceRegistration, installation?: ResourceInstallationToken): void;
  installBinding(binding: ScopedPolicyBinding, installation?: BindingInstallationToken): void;
  installTool(contract: ToolContractDefinition): void;
  installToolAssignment(input: ToolAssignmentRecord): void;
  installExecutorAssignment(input: ToolAssignmentRecord): void;
  /** Removes only this exact host-installed tuple; never revokes its underlying grant. */
  removeExecutorAssignment(expected: ToolAssignmentRecord): boolean;
  installPolicyExtensionEvaluator(policyRef: PolicyRef, evaluator: ExtensionEvaluator): void;
  invalidateExternal(revision: string): void;
  teardown(resource: ResourceRef): void;
  owner(resource: ResourceRef): SecuritySubjectRef | undefined;
  evaluate(input: EvaluateSelector): Promise<StampedDecision>;
  projectAssignments(input: ProjectAssignmentsInput): Promise<AssignmentAuthorization>;
  matches(stamp: LocalDecisionStamp, actor: TrustedRequestContext): boolean;
  /** One canonical clock sample for a bounded set of genuine issued stamps. */
  matchesAll(stamps: readonly LocalDecisionStamp[], actor: TrustedRequestContext): boolean;
  /** Callback-free local mutation fence. Neither permission nor an expiry check. */
  captureFence(): () => boolean;
  validateAssignments(authorization: AssignmentAuthorization, actor: TrustedRequestContext): boolean;
  getContract(id: string): ToolContractDefinition | undefined;
}

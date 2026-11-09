import type { AssignmentAuthorization, AuthorityRevisionStamp, ExecutorRevision, ReferenceAuthorizer, ResourceRef, ResourceRoute, TrustedRequestContext } from "@authorization";
import type { MandatoryBindingSelector, PresentedExternalProof } from "@authorization/helpers/evaluate/types";
import type { ToolExecutionBinding, ToolOperation, ToolPolicyFactory } from "@toolPolicy";
import type { ToolContractDefinition } from "@tools";
import type { Awaitable } from "../../types";

export type ToolExecutionLocation = ToolExecutionBinding["location"];
/** Approved implementation metadata; source binding is not remote code attestation. */
export interface ToolPolicyRegistration<TLocation extends ToolExecutionLocation = ToolExecutionLocation> {
  readonly definition: ToolContractDefinition;
  readonly implementation: Extract<ToolExecutionBinding, { location: TLocation }>;
  readonly revision: number;
  readonly source: { readonly id: string; readonly revision: number };
}
export interface ToolPolicyRoute {
  readonly route: ResourceRoute;
  readonly externalProofs?: readonly PresentedExternalProof[];
  readonly mandatoryBindings?: readonly MandatoryBindingSelector[];
}
export interface ToolPolicyResolutionRequest<TLocation extends ToolExecutionLocation = ToolExecutionLocation> {
  readonly caller: TrustedRequestContext;
  readonly origin: ResourceRef;
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
  readonly registration: ToolPolicyRegistration<TLocation>;
  readonly input: unknown;
  readonly signal: AbortSignal;
}
export interface ToolExecutorPolicyOptions<TLocation extends ToolExecutionLocation = ToolExecutionLocation> {
  readonly registry: ReferenceAuthorizer;
  readonly policies: ToolPolicyFactory;
  readonly registrations: readonly ToolPolicyRegistration<TLocation>[];
  resolve(request: ToolPolicyResolutionRequest<TLocation>): Awaitable<ToolPolicyRoute>;
}
export interface ToolExecutorPolicyRequest<TLocation extends ToolExecutionLocation = ToolExecutionLocation> extends ToolPolicyResolutionRequest<TLocation> {
  readonly operation: Extract<ToolOperation, "discover" | "invoke" | "advertise" | "execute">;
  readonly resolution: ToolPolicyRoute;
  readonly executor?: ExecutorRevision;
  readonly executorContext?: TrustedRequestContext;
}
export interface ToolExecutorProof {
  readonly challengeRequired: boolean;
  readonly authorization: AssignmentAuthorization;
  readonly authority: AuthorityRevisionStamp;
  current(): boolean;
}

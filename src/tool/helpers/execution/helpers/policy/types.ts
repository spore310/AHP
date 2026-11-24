import type { AssignmentAuthorization, AuthorityRevisionStamp, ExecutorRevision, ReferenceAuthorizer, ResourceRef, TrustedRequestContext } from "@authorization";
import type { ResourceAuthorizationRoute } from "@authorization";
import type { ToolExecutionBinding } from "@tool/policy/binding";
import type { PolicyOperation, PolicyFactory } from "@authorization/policies";
import type { ToolContractDefinition } from "@tool";
import type { Awaitable } from "../../types";

export type ToolExecutionLocation = ToolExecutionBinding["location"];
/** Approved implementation metadata; source binding is not remote code attestation. */
export interface ToolPolicyRegistration<TLocation extends ToolExecutionLocation = ToolExecutionLocation> {
  readonly definition: ToolContractDefinition;
  readonly implementation: Extract<ToolExecutionBinding, { location: TLocation }>;
  readonly revision: number;
  readonly source: { readonly id: string; readonly revision: number };
}
export type ToolPolicyRoute = ResourceAuthorizationRoute;
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
  readonly policies: PolicyFactory;
  readonly registrations: readonly ToolPolicyRegistration<TLocation>[];
  resolve(request: ToolPolicyResolutionRequest<TLocation>): Awaitable<ToolPolicyRoute>;
}
export interface ToolExecutorPolicyRequest<TLocation extends ToolExecutionLocation = ToolExecutionLocation> extends ToolPolicyResolutionRequest<TLocation> {
  readonly operation: Extract<PolicyOperation, "discover" | "invoke" | "advertise" | "execute">;
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

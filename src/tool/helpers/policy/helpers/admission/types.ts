import type { PolicyRef, ReferenceAuthorizer, ResourceRef, TrustedRequestContext } from "@authorization";
import type { ResourceAuthorizationRoute } from "@authorization";
import type { ToolContractDefinition } from "@tool";
import type { PolicyFactory } from "@authorization/helpers/policies/helpers/factory";

export interface ToolAdmissionScope {
  readonly actor: TrustedRequestContext;
  readonly origin: ResourceRef<"session">;
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
  readonly signal: AbortSignal;
  current(): boolean;
  fence(): boolean;
}

export type ToolAdmissionRoute = ResourceAuthorizationRoute;

export interface ToolAdmissionOptions {
  readonly registry: ReferenceAuthorizer;
  readonly policies: PolicyFactory;
  readonly activationPolicies: readonly PolicyRef[];
  readonly resolve?: (scope: ToolAdmissionScope) => ToolAdmissionRoute | Promise<ToolAdmissionRoute>;
  readonly allowSelfApproval?: (scope: ToolAdmissionScope) => boolean;
  readonly now?: () => number;
}

export type ToolManagementRequest
  = | { readonly operation: "propose"; readonly definition: unknown }
    | { readonly operation: "approve" | "publish"; readonly proposalId: string; readonly revision: number };

export interface ToolProposalReceipt {
  readonly proposalId: string;
  readonly revision: number;
  readonly status: "proposed" | "approved" | "published";
}

export interface PublishedTool {
  readonly definition: ToolContractDefinition;
  readonly origin: ResourceRef<"session">;
  readonly source: { readonly id: string; readonly revision: number };
}

export interface ToolAdmission {
  usesRegistry(registry: ReferenceAuthorizer): boolean;
  reserveBase(definitions: readonly ToolContractDefinition[]): void;
  manage(scope: ToolAdmissionScope, request: ToolManagementRequest): Promise<{ readonly receipt: ToolProposalReceipt; current(): boolean } | undefined>;
  review(scope: ToolAdmissionScope, proposalId: string): Promise<ToolContractDefinition | undefined>;
  prepareActivation(scope: ToolAdmissionScope, proposalId: string): Promise<{ readonly tool: PublishedTool; current(): boolean } | undefined>;
  dispose(): void;
}

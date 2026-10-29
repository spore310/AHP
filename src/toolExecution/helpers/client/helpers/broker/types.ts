import type { AssignmentAuthorization, AuthorityRevisionStamp, ExecutorRevision, ReferenceAuthorizer, ResourceRef, ResourceRoute, TrustedRequestContext } from "@authorization";
import type { MandatoryBindingSelector, PresentedExternalProof } from "@authorization/helpers/evaluate/types";
import type { ToolExecutionBinding, ToolOperation, ToolPolicyFactory } from "@toolPolicy";
import type { ToolContractDefinition } from "@tools";
import type { Awaitable, ToolActionContext } from "@toolExecution/types";
import type { ToolDispatcherOptions } from "@toolExecution/helpers/dispatcher";

/** Host approval metadata; it is not evidence of the remote process's actual code. */
export interface ClientToolRegistration {
  readonly definition: ToolContractDefinition;
  readonly implementation: Extract<ToolExecutionBinding, { location: "client" }>;
  readonly revision: number;
  readonly source: { readonly id: string; readonly revision: number };
}

export interface ClientToolRoute {
  readonly route: ResourceRoute;
  readonly externalProofs?: readonly PresentedExternalProof[];
  readonly mandatoryBindings?: readonly MandatoryBindingSelector[];
}

export interface ClientToolResolutionRequest {
  readonly caller: TrustedRequestContext;
  readonly origin: ResourceRef;
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
  readonly registration: ClientToolRegistration;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

export interface ClientToolBrokerOptions {
  readonly registry: ReferenceAuthorizer;
  readonly policies: ToolPolicyFactory;
  readonly registrations: readonly ClientToolRegistration[];
  /** Trusted resource resolution. It cannot grant permission or replace the origin. */
  resolve(request: ClientToolResolutionRequest): Awaitable<ClientToolRoute>;
  readonly dispatcher?: ToolDispatcherOptions;
}

export interface ClientToolPolicyRequest extends ClientToolResolutionRequest {
  readonly operation: Extract<ToolOperation, "discover" | "invoke" | "advertise" | "execute">;
  readonly resolution: ClientToolRoute;
  readonly executor?: ExecutorRevision;
  readonly executorContext?: TrustedRequestContext;
}

export interface ClientToolProof {
  readonly authorization: AssignmentAuthorization;
  readonly authority: AuthorityRevisionStamp;
  /** Freshness only. Construction has already required the exact allowed tuple. */
  current(): boolean;
}

export interface ClientToolDispatchRequest extends ClientToolResolutionRequest {
  readonly callId: string;
  readonly executor: ExecutorRevision;
  readonly executorContext: TrustedRequestContext;
  /** Captured host connection/resource/registration fences, never a grant. */
  current(): boolean;
  /** Settles on the selected remote protocol completion, not on caller cancellation. */
  send(input: unknown, context: ToolActionContext): Promise<unknown>;
  /** Callback-free check of broker-owned fences after all authority/identity callbacks. */
  fence(): boolean;
}

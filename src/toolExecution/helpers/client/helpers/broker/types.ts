import type { ExecutorRevision, TrustedRequestContext } from "@authorization";
import type { ToolActionContext } from "@toolExecution/types";
import type { ToolDispatcherOptions } from "@toolExecution/helpers/dispatcher";
import type { ToolPolicyRegistration, ToolPolicyRoute, ToolPolicyResolutionRequest, ToolExecutorPolicyOptions, ToolExecutorPolicyRequest, ToolExecutorProof } from "@toolExecution/helpers/policy";

export type ClientToolRegistration = ToolPolicyRegistration<"client">;
export type ClientToolRoute = ToolPolicyRoute;
export type ClientToolResolutionRequest = ToolPolicyResolutionRequest<"client">;
export interface ClientToolBrokerOptions extends ToolExecutorPolicyOptions<"client"> {
  readonly dispatcher?: ToolDispatcherOptions;
}
export type ClientToolPolicyRequest = ToolExecutorPolicyRequest<"client">;
export type ClientToolProof = ToolExecutorProof;

export interface ClientToolDispatchRequest extends ClientToolResolutionRequest {
  readonly callId: string;
  readonly executor: ExecutorRevision;
  readonly executorContext: TrustedRequestContext;
  /** Captured host connection/resource/registration fences, never a grant. */
  current(): boolean;
  /** Settles on the selected remote protocol completion, not on caller cancellation. */
  send(input: unknown, context: ToolActionContext, onEnqueued: () => void): Promise<unknown>;
  /** Callback-free check of broker-owned fences after all authority/identity callbacks. */
  fence(): boolean;
}

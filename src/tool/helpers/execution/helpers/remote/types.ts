import type { ExecutorRevision, TrustedRequestContext } from "@authorization";
import type { ToolActionContext } from "@tool/helpers/execution/types";
import type { WorkOperationRestriction } from "@authorization/helpers/resources/types";
import type { ToolDispatcherOptions } from "@tool/helpers/execution/helpers/dispatcher";
import type { ToolPolicyRegistration, ToolPolicyRoute, ToolPolicyResolutionRequest, ToolExecutorPolicyOptions, ToolExecutorPolicyRequest, ToolExecutorProof } from "@tool/helpers/execution/helpers/policy";
import type { ApprovedArtifactSource } from "@tool/helpers/execution/helpers/artifacts";

export type ClientToolRegistration = ToolPolicyRegistration<"client">;
export type ClientToolRoute = ToolPolicyRoute;
export type ClientToolResolutionRequest = ToolPolicyResolutionRequest<"client">;
export interface ClientToolBrokerOptions extends ToolExecutorPolicyOptions<"client"> {
  readonly dispatcher?: ToolDispatcherOptions;
  readonly artifacts?: ApprovedArtifactSource;
}
export type ClientToolPolicyRequest = ToolExecutorPolicyRequest<"client">;
export type ClientToolProof = ToolExecutorProof;

export interface ClientToolDispatchRequest extends ClientToolResolutionRequest, WorkOperationRestriction {
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

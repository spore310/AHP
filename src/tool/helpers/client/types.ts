import type { Client } from "@client";

import type { ToolContractDefinition } from "@tool";
import type { ApprovedArtifactLoader } from "../execution/helpers/artifacts/types";
import type { ToolInvoke, ToolDispatchReply, ToolStatusReply, ToolManagementReply } from "../protocol";

/** A local, client-executed implementation pinned to one contract. */
export interface LocalToolImplementation {
  readonly definition: ToolContractDefinition;
  execute(input: unknown, context: ToolInvocationContext): unknown;
}

export interface ToolInvocationContext extends Omit<ToolInvoke, "version" | "input"> {
  readonly callId: string;
  readonly channel: string;
  readonly key: string;
  readonly version: number;
  readonly signal: AbortSignal;
}

export interface ToolCallOptions { readonly work?: import("@work").WorkExecutionRef; readonly signal?: AbortSignal; readonly timeoutMs?: number }
export interface ToolClient {
  readonly connection: Client;
  /** Subscribe, obtain private assignments, and activate an exact private advertisement. */
  joinSession(channel: string, implementations: readonly LocalToolImplementation[]): Promise<void>;
  /** Ask a connected session tool provider to execute one exact contract. */
  callTool(channel: string, ref: { readonly id?: string; readonly key: string; readonly version: number }, input: unknown, options?: ToolCallOptions): Promise<unknown>;
  dispatchTool(channel: string, contract: ToolInvoke["contract"], input: unknown, options?: ToolCallOptions): Promise<ToolDispatchReply>;
  statusTool(callId: string): Promise<ToolStatusReply>;
  cancelTool(callId: string): Promise<ToolStatusReply>;
  resumeTool(continuationId: string, proofRef: string): Promise<ToolDispatchReply>;
  proposeTool(channel: string, definition: ToolContractDefinition): Promise<ToolManagementReply>;
  approveTool(channel: string, proposalId: string, revision: number): Promise<ToolManagementReply>;
  publishTool(channel: string, proposalId: string, revision: number): Promise<ToolManagementReply>;
  /** Verify and load one approved artifact, then advertise it on the same assignment. */
  loadApprovedTool(channel: string, contract: ToolInvoke["contract"], loader: ApprovedArtifactLoader): Promise<void>;
  shutdown(): Promise<void>;
}

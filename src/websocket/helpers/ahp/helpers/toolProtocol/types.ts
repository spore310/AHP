import type { z } from "zod";
import type { PrivateToolCallHandle } from "@tool/helpers/execution/helpers/calls";
import type { ToolAssignedReply, toolAdvertiseRequestSchema, toolArtifactRequestSchema, toolDispatchRequestSchema, toolManagementRequestSchema } from "@tool/protocol";
import type { ApprovedArtifact } from "@tool/helpers/execution/helpers/artifacts";
import type { ToolProposalReceipt } from "@tool/policy";
import type { JsonRpcHandlers, WebSocketConnectionContext } from "@websocket/types";

/** Trusted broker preparation; never supplied by a wire client. */
export interface PrivateAssignmentTicket {
  readonly value: Omit<ToolAssignedReply, "version" | "channel" | "viewRevision">;
  current(): boolean;
  fence(): boolean;
  advertise(contracts: z.infer<typeof toolAdvertiseRequestSchema>["contracts"], advertisementId: string): PrivateAdvertisementTicket;
  artifact?(contract: z.infer<typeof toolArtifactRequestSchema>["contract"], signal: AbortSignal): Promise<{
    readonly artifact: ApprovedArtifact;
    readonly encoded: string;
    current(): boolean;
    recordDelivery(): void;
  } | undefined>;
}
export interface PrivateAdvertisementTicket {
  readonly tools: ToolAssignedReply["tools"];
  current(): boolean;
  /** Pure owned-state commit after a successful response enqueue. */
  commit(): boolean;
  release(): void;
}
export interface PrivateProtocolCall extends PrivateToolCallHandle {
  current(): boolean;
  refresh(signal: AbortSignal): Promise<(() => boolean) | undefined>;
}
export interface PrivateToolProtocolPorts {
  readonly continuation?: boolean;
  readonly artifacts?: boolean;
  manage?(context: WebSocketConnectionContext, request: z.infer<typeof toolManagementRequestSchema>, signal: AbortSignal): Promise<{ readonly receipt: ToolProposalReceipt; current(): boolean } | undefined>;
  ready(context: WebSocketConnectionContext): boolean;
  fence(context: WebSocketConnectionContext): boolean;
  assignment(context: WebSocketConnectionContext, channel: string, signal: AbortSignal): Promise<PrivateAssignmentTicket>;
  dispatch(context: WebSocketConnectionContext, request: z.infer<typeof toolDispatchRequestSchema>, callId: string): PrivateProtocolCall;
  onInvalidate(listener: () => void): () => void;
}
export interface PrivateToolProtocol {
  readonly handlers: JsonRpcHandlers;
  negotiated(context: WebSocketConnectionContext): boolean;
  invalidate(channel: string): void;
  forget(context: WebSocketConnectionContext, channel?: string): void;
  removeSession(channel: string): void;
  dispose(): void;
}
export interface PrivateProtocolView {
  readonly context: WebSocketConnectionContext;
  readonly channel: string;
  readonly revision: string;
  readonly controller: AbortController;
  readonly ticket: PrivateAssignmentTicket;
}

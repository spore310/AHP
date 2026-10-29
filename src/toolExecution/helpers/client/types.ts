import type { AhpTransport } from "@microsoft/agent-host-protocol/client";

import type { ToolContractDefinition } from "@tools";
import type { ToolInvoke, ToolDispatchReply, ToolStatusReply } from "./helpers/protocol";

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

export interface ToolClientOptions {
  readonly clientId: string;
  readonly displayName?: string;
  readonly protocolVersions: readonly string[];
}

export interface ToolClient {
  /** The installed public AHP SDK client used for ordinary protocol operations. */
  readonly client: import("@microsoft/agent-host-protocol/client").AhpClient;
  /** Subscribe, obtain private assignments, and activate an exact private advertisement. */
  joinSession(channel: string, implementations: readonly LocalToolImplementation[]): Promise<void>;
  /** Ask a connected session tool provider to execute one exact contract. */
  callTool(channel: string, ref: { readonly id?: string; readonly key: string; readonly version: number }, input: unknown): Promise<unknown>;
  dispatchTool(channel: string, contract: ToolInvoke["contract"], input: unknown): Promise<ToolDispatchReply>;
  statusTool(callId: string): Promise<ToolStatusReply>;
  cancelTool(callId: string): Promise<ToolStatusReply>;
  resumeTool(continuationId: string, proofRef: string): Promise<ToolDispatchReply>;
  shutdown(): Promise<void>;
}

/** A connected, exclusive, not-yet-initialized SDK endpoint. */
export type ToolClientConnection
  = | { readonly transport: AhpTransport; readonly ownership: "owned" }
    | {
      readonly transport: AhpTransport;
      readonly ownership: "borrowed";
      /** Retire the logical endpoint, pending reader and remote routing, not the physical carrier. */
      readonly detach: () => void | Promise<void>;
    };

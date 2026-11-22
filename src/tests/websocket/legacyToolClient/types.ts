// TEST ONLY: frozen P09 internal native-broker client. Not the public v2 runtime.
import type { AhpTransport } from "@microsoft/agent-host-protocol/client";

import type { ToolContractDefinition } from "@tools";

/** A local, client-executed implementation pinned to one contract. */
export interface LocalToolImplementation {
  readonly definition: ToolContractDefinition;
  execute(input: unknown, context: ToolInvocationContext): unknown;
}

export interface ToolInvocationContext {
  readonly callId: string;
  readonly channel: string;
  readonly key: string;
  readonly version: number;
}

export interface ToolClientOptions {
  readonly clientId: string;
  readonly displayName?: string;
  readonly protocolVersions: readonly string[];
}

export interface ToolClient {
  /** The installed public AHP SDK client used for ordinary protocol operations. */
  readonly client: import("@microsoft/agent-host-protocol/client").AhpClient;
  /** Subscribe to a typed session, discover its manifest, and advertise local tools. */
  joinSession(channel: string, implementations: readonly LocalToolImplementation[]): Promise<void>;
  /** Ask a connected session tool provider to execute one exact contract. */
  callTool(channel: string, ref: { readonly key: string; readonly version: number }, input: unknown): Promise<unknown>;
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

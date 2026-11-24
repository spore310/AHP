import type { ServerToolBrokerOptions } from "@tool/server";
import type { Snapshot } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import type { ResourceRef, TrustedRequestContext } from "@authorization";
import type { ParsedClientSessionAction } from "@sessions/helpers/actions";

import type { AgentDirectory } from "@agents";
import type { ClientToolBrokerOptions } from "@tool/helpers/execution/helpers/remote";
import type { ResourceViewOptions } from "@sessions/views";
import type { JsonRpcMessage } from "@jsonrpc";
import type { SessionOwnerRegistry, WorkReadPort } from "@work";
import type { WebSocketConnectionContext } from "../../types";
import { CLIENT_SESSION_ACTION_NAMES } from "./constants";

export type ConnectionPhase = "new" | "initializing" | "ready" | "closing" | "closed";

export interface AHPPeer {
  phase: ConnectionPhase;
  clientId?: string;
  protocolVersion?: string;
  readonly subscriptions: Set<string>;
  readonly pending: Map<string, JsonRpcMessage[]>;
  readonly context: WebSocketConnectionContext;
  closeNotified: boolean;
}

export interface ChannelAdapter {
  readonly scheme: string;
  matches(uri: string): boolean;
  snapshot(uri: string): Snapshot;
}

const safeClientSeq = z.number().refine(
  (value): boolean => Number.isSafeInteger(value) && value >= 0,
);

const actionRecord = z.record(z.string(), z.unknown()).refine(
  (value): boolean => typeof value.type === "string" && CLIENT_SESSION_ACTION_NAMES.has(value.type),
);

export const initializeParamsSchema = z.object({
  channel: z.literal("ahp-root://"),
  clientId: z.string().min(1),
  protocolVersions: z.array(z.string().min(1)).min(1),
  initialSubscriptions: z.array(z.string().min(1)).optional(),
  clientInfo: z.unknown().optional(),
  locale: z.string().optional(),
  capabilities: z.unknown().optional(),
});

export const channelParamsSchema = z.object({
  channel: z.string().min(1),
});

export const dispatchActionParamsSchema = z.object({
  channel: z.string().min(1),
  clientSeq: safeClientSeq,
  action: actionRecord,
});

export type DispatchActionParams = z.infer<typeof dispatchActionParamsSchema>;

/** Host policy for durable native commands. The callback runs synchronously at admission. */
export interface NativeSessionWrites {
  admit(input: {
    readonly context: TrustedRequestContext;
    readonly session: ResourceRef<"session">;
    readonly command: Extract<ParsedClientSessionAction, { type: "session/titleChanged" | "session/isReadChanged" | "session/isArchivedChanged" }> | { readonly type: "disposeSession" };
  }): boolean;
}

export interface AHPDiagnostic {
  readonly event: "malformedNotification" | "publicationFailed";
  readonly method?: string;
  readonly connectionId?: string;
}

export interface AHPConnectionModuleOptions {
  readonly onDiagnostic?: (diagnostic: AHPDiagnostic) => void;
}

/** Optional authenticated agent/work extension wiring for an AHP binding. */
export interface AHPBindingOptions {
  readonly protectedWork?: import("./agentWork").ProtectedWorkBinding;
  readonly nativeWrites?: NativeSessionWrites;
  readonly protectedViews?: ResourceViewOptions;
  readonly toolExecution?: ClientToolBrokerOptions;
  readonly serverToolExecution?: ServerToolBrokerOptions;
  readonly prepareToolWork?: (context: WebSocketConnectionContext, ...args: Parameters<import("@tool/execution").ToolWorkPreparation>)
  => ReturnType<import("@tool/execution").ToolWorkPreparation>;
  readonly maxInitialSubscriptions?: number;
  readonly agents?: AgentDirectory;
  readonly work?: WorkReadPort;
  readonly sessionOwners?: SessionOwnerRegistry;
}

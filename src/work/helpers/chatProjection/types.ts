import type { MessageKind, Message, ChatState, ChatAction } from "@microsoft/agent-host-protocol";
import type { ResourceRef, TrustedRequestContext } from "@authorization";
import type { WorkEvent } from "../events/types";
import type { AuthorizedWorkView } from "../commands/types";

export type WorkChatState = ChatState;
export type WorkChatAction = ChatAction;
export type WorkChatMessage = Pick<Message, "text" | "_meta"> & { readonly origin: { readonly kind: MessageKind.SystemNotification } };
export interface WorkChatProjectionInput {
  readonly chat: ResourceRef<"chat">;
  readonly event: WorkEvent;
  readonly work: AuthorizedWorkView;
  readonly recipient: TrustedRequestContext;
  readonly signal: AbortSignal;
}
export interface WorkChatProjectionAdapter {
  project(input: WorkChatProjectionInput): WorkChatMessage | undefined | Promise<WorkChatMessage | undefined>;
}
export interface WorkChatPresentation {
  present(input: WorkChatProjectionInput, authorized: () => boolean): Promise<boolean>;
}
export interface WorkChatProjectionOptions {
  readonly adapter?: WorkChatProjectionAdapter;
  /** Synchronous application handoff under the retained work and resource approvals. */
  deliver(message: WorkChatMessage, input: WorkChatProjectionInput): undefined;
  readonly maxPending?: number;
  readonly timeoutMs?: number;
}

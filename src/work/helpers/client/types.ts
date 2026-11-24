import type { Client } from "@client";
import type { WorkListSummary } from "../commands/types";
import type { WorkSubscribeRequest } from "../views/types";
import type { ResourceLocator } from "../selections/types";

/** The existing SDK transport owns recv. Observing private extensions never starts another reader. */
export interface WorkExtensionPort {
  /** Cancel pending reads on abort. When an aborted allocating call receives a late
   * response, pass it to releaseLate so the caller can free the server-assigned ID. */
  request(method: string, params: unknown, timeoutMs?: number, signal?: AbortSignal, releaseLate?: (response: unknown) => unknown): Promise<unknown>;
  onNotification(method: string, receive: (params: unknown) => unknown): () => void;
  onClose(receive: () => unknown): () => void;
}
export interface WorkClientOptions {
  readonly maxTrackedItems?: number;
  readonly maxPages?: number;
  readonly refreshTimeoutMs?: number;
  readonly reconcileIntervalMs?: number;
}
export interface WorkViewSubscription extends Omit<WorkSubscribeRequest, "version" | "resource"> {
  readonly resource: ResourceLocator & { readonly instanceId: string };
}
export interface WorkClientSnapshot {
  readonly status: "idle" | "loading" | "ready" | "incomplete" | "limit" | "disconnected" | "disposed";
  readonly items: readonly WorkListSummary[];
  readonly subscriptionId?: string;
  readonly streamEpoch?: string;
  readonly nextCursor?: string;
  /** Authorized rows from the limited sweep that could not enter the preserved
   * display, followed by any unread suffix from its last fixed-size page. */
  readonly remainingItems?: readonly WorkListSummary[];
}
export interface WorkClient {
  subscribe(target: WorkViewSubscription): Promise<WorkClientSnapshot>;
  refresh(): Promise<WorkClientSnapshot>;
  reconnect(port: WorkExtensionPort | Client): Promise<WorkClientSnapshot>;
  snapshot(): WorkClientSnapshot;
  onChange(receive: (snapshot: WorkClientSnapshot) => unknown): () => void;
  dispose(): Promise<void>;
}

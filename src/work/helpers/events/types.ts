import type { ResourceRef } from "@authorization";
import type { Revision } from "@persistence";

export type WorkEventKind = "submitted" | "claimed" | "renewed" | "completed" | "failed" | "requeued" | "cancelled" | "dataUpdated";
export interface WorkEvent {
  readonly version: 1;
  readonly type: WorkEventKind;
  readonly workId: string;
  readonly revision: Revision;
  readonly session: ResourceRef<"session">;
  readonly occurredAt: string;
}
export interface WorkEventPublisher {
  publish(event: WorkEvent): void;
  subscribe(listener: (event: WorkEvent) => unknown): () => void;
  dispose(): void;
}

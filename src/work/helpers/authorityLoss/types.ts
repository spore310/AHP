import type { StoredWork, WorkInspection } from "@persistence/helpers/durability/workTypes";
import type { RegisteredAgentIdentity } from "../commands/types";

export type WorkAuthorityLossReason = "policy-changed" | "connection-lost" | "registration-disabled" | "resource-unavailable" | "authority-expired";
export type WorkAuthorityLossDecision = { readonly action: "retainUntilExpiry" | "requeue" | "cancel" } | { readonly action: "fail"; readonly code?: string };

export interface WorkAuthorityLossContext {
  readonly work: Pick<StoredWork, "id" | "session" | "kind" | "submitter" | "owner" | "input" | "data" | "status" | "revision" | "scope" | "announce">;
  readonly executor: RegisteredAgentIdentity;
  readonly attempt: number;
  readonly reason: WorkAuthorityLossReason;
  readonly signal: AbortSignal;
}
export interface WorkServiceHooks {
  onLeaseAuthorityLost?(context: WorkAuthorityLossContext): WorkAuthorityLossDecision | Promise<WorkAuthorityLossDecision>;
}
export interface WorkAuthorityLossOptions {
  readonly hooks: WorkServiceHooks;
  readonly deadlineMs?: number;
  readonly maxPending?: number;
  repository(): import("@persistence/helpers/durability/workTypes").DurableWorkRepository;
  assess(inspection: WorkInspection): Promise<{ readonly reason: WorkAuthorityLossReason; readonly executor: RegisteredAgentIdentity } | undefined>;
  mutate<T>(id: string, run: () => Promise<T>): Promise<T>;
}

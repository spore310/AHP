import type { ResourceRef } from "@authorization";
import type { WorkStatus } from "@persistence/types";
import type { StoredWork, WorkIntent } from "@persistence/helpers/durability/workTypes";
import type { ResourceViewRecord } from "@toolExecution/helpers/views";
import type { WorkApproval, WorkCommandOptions, WorkListSummary, WorkRequestContext } from "../commands/types";
import type { ResourceLocator } from "../selections/types";

export interface WorkListFilter { readonly kinds?: readonly string[]; readonly statuses?: readonly WorkStatus[] }
export interface WorkListRequest {
  readonly version: 1; readonly session?: ResourceLocator; readonly announceTo?: ResourceLocator;
  readonly filter?: WorkListFilter; readonly limit?: number; readonly cursor?: string; readonly subscriptionId?: string;
}
export interface WorkSubscribeRequest { readonly version: 1; readonly resource: ResourceLocator; readonly filter?: WorkListFilter; readonly limit?: number }
export interface WorkPage { readonly items: readonly WorkListSummary[]; readonly nextCursor?: string }
export interface WorkViewTarget extends WorkApproval {
  readonly session: ResourceRef<"session">; readonly record: ResourceViewRecord; readonly announceTo?: ResourceRef;
  readonly kinds: readonly string[]; readonly statuses: readonly WorkStatus[]; readonly limit: number;
}
export interface WorkViewOptions extends Pick<WorkCommandOptions, "repository" | "resolveType" | "selectionLimits"> {
  readonly allowedKinds: readonly string[];
  prepare(caller: WorkRequestContext, operation: "read", intent: WorkIntent, row: StoredWork): Promise<WorkApproval>;
  captureAuthority(caller: WorkRequestContext): () => boolean;
}
export interface WorkViews {
  resolve(caller: WorkRequestContext, request: WorkListRequest): Promise<WorkViewTarget>;
  list(caller: WorkRequestContext, request: WorkListRequest, target: WorkViewTarget, visibility: WorkApproval,
    subscriptionId?: string): Promise<WorkPage & { readonly version: 1 }>;
  hint(caller: WorkRequestContext, target: WorkViewTarget, event: { readonly session: ResourceRef<"session">; readonly workId: string; readonly revision: string },
    visibility: WorkApproval): Promise<WorkApproval | undefined>;
  discardCursor(caller: WorkRequestContext, cursor: string): void;
  releaseConnection(connectionId: string): void;
  releaseSubscription(connectionId: string, subscriptionId: string): void;
  close(): void;
}

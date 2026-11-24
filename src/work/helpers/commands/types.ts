import type { PolicyActorRef, ResourceRef, SecuritySubjectRef, TrustedRequestContext } from "@authorization";
import type { DataSnapshot, JsonObject, ReplaceData, StoredSession } from "@persistence";
import type { DurableWorkRepository, StoredWork, WorkIntent } from "@persistence/helpers/durability/workTypes";
import type { WorkStatus } from "@persistence/types";
import type { ResolvedSessionType } from "@sessions/helpers/sessionTypes";
import type { ResourceLocator, ResourceSelectionInput, WorkResourceSelection, WorkSelectionLimits } from "../selections/types";

export interface WorkSubmission<TInput extends JsonObject = JsonObject, TData extends JsonObject = JsonObject> {
  readonly session?: ResourceLocator;
  readonly requestKey: string;
  readonly kind: string;
  readonly input: TInput;
  readonly priority?: number;
  readonly targetAgentId?: string;
  readonly scope: readonly ResourceSelectionInput[];
  readonly announce?: readonly ResourceSelectionInput[];
  readonly data?: TData;
}
export interface WorkRequestContext {
  readonly context: TrustedRequestContext;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  /** The actual transport retains this proof until it settles the response. */
  retainReply?(approval: WorkApproval): void;
}
export interface RegisteredAgentIdentity {
  readonly registrationId: string;
  readonly principal: SecuritySubjectRef;
  readonly agentKey: string;
  readonly actorAgentId: string;
}
export interface WorkAgentContext extends WorkRequestContext {
  readonly agent: RegisteredAgentIdentity;
  readonly executionEpoch: string;
  fence?(): boolean;
}
export interface WorkExecutionRef { readonly workId: string; readonly attempt: number; readonly leaseToken: string }
export interface WorkEntities { readonly submitter: PolicyActorRef; readonly owner: SecuritySubjectRef; readonly executor?: RegisteredAgentIdentity }
export interface WorkListSummary {
  readonly id: string; readonly session: ResourceRef<"session">; readonly kind: string; readonly priority: number;
  readonly status: WorkStatus; readonly revision: string; readonly createdAt: string; readonly updatedAt: string;
}
export interface AuthorizedWorkView extends WorkListSummary {
  readonly input?: JsonObject; readonly data?: JsonObject; readonly dataRevision?: string; readonly result?: JsonObject;
  readonly entities?: WorkEntities; readonly scope?: readonly WorkResourceSelection[]; readonly announce?: readonly WorkResourceSelection[];
  readonly attemptCount?: number; readonly maxAttempts?: number; readonly failure?: StoredWork["failure"];
}
export interface WorkApproval { isCurrent(): boolean; fence?(): boolean; release(): void }
export interface WorkExecutionGuard { current(): boolean; fence(): boolean; release(): void }
export interface WorkCommandOptions {
  readonly authorityLoss?: Omit<import("../authorityLoss/types").WorkAuthorityLossOptions, "repository" | "mutate">;
  readonly selectionLimits?: WorkSelectionLimits;
  repository(): DurableWorkRepository;
  resolveType(type: StoredSession["type"]): ResolvedSessionType;
  prepare(caller: WorkRequestContext, operation: "submit" | "read" | "updateData" | "complete" | "fail" | "claim" | "renew" | "announce" | "cancel",
    intent: WorkIntent, row?: StoredWork, execution?: import("../authorization/types").WorkPolicyFacts["execution"]): Promise<WorkApproval>;
  readonly limits?: { readonly session: number; readonly host: number };
}
export interface WorkService {
  authorityChanged(): void;
  authorityIdle(): Promise<void>;
  prepareExecutionGuard(caller: WorkAgentContext, execution: WorkExecutionRef,
    route: { readonly origin: ResourceRef; readonly targets: readonly ResourceRef[] }, input?: unknown): Promise<WorkExecutionGuard>;
  close(): void;
  submit(caller: WorkRequestContext, input: WorkSubmission): Promise<{ readonly id: string }>;
  get(caller: WorkRequestContext, id: string): Promise<AuthorizedWorkView | null>;
  cancel(caller: WorkRequestContext, id: string): Promise<void>;
  updateData(caller: WorkRequestContext, id: string, change: ReplaceData, execution?: WorkExecutionRef): Promise<DataSnapshot>;
  complete(caller: WorkAgentContext, execution: WorkExecutionRef, command: { readonly result: JsonObject; readonly data?: ReplaceData }): Promise<void>;
  fail(caller: WorkAgentContext, execution: WorkExecutionRef, command: { readonly retryable: boolean; readonly code?: string; readonly message?: string; readonly data?: ReplaceData }): Promise<{ readonly status: WorkStatus }>;
}

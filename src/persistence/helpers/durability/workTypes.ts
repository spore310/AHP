import type { PolicyActorRef, ResourceRef } from "@authorization";
import type { ResourceLocator, WorkResourceSelection } from "@work/helpers/selections/types";
import type { WorkStatus } from "../../types";
import type { Admission, DataSnapshot, JsonObject, ReplaceData, ResourceRecord, Revision, StoredSession } from "./types";

/** Immutable fields used to compare retries inside one exact session. */
export interface WorkIntent {
  readonly session: ResourceRef<"session">;
  readonly kind: string;
  readonly requestKey: string;
  readonly submitter: PolicyActorRef;
  readonly priority: number;
  readonly input: JsonObject;
  readonly submittedData: JsonObject;
  readonly targetAgentId: string | null;
  readonly maxAttempts: number;
  readonly scope: readonly WorkResourceSelection[];
  readonly announce: readonly WorkResourceSelection[];
}

export interface StoredWorkLease {
  readonly registrationId: string;
  readonly executionEpoch: Revision;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly expiresAt: string;
}

export interface StoredWork extends WorkIntent, DataSnapshot {
  readonly id: string;
  readonly owner: string;
  readonly revision: Revision;
  readonly status: WorkStatus;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lease?: StoredWorkLease;
  readonly result?: JsonObject;
  readonly failure?: { readonly code: string; readonly summary: string; readonly occurredAt: string };
}

export interface WorkGraph {
  readonly session: StoredSession;
  readonly resources: readonly ResourceRecord[];
  readonly previous?: StoredWork;
}
export type WorkReplayKey = Pick<WorkIntent, "kind" | "requestKey" | "submitter">;

/** Captured under session and work locks, after any earlier mutation has settled. */
export interface WorkInspection extends WorkGraph {
  readonly row: StoredWork;
  readonly databaseTime: number;
  readonly registration?: { readonly id: string; readonly subject: string; readonly key: string; readonly epoch: string; readonly enabled: boolean };
}

export interface WorkFence {
  readonly graphRevision?: Revision;
  readonly session: ResourceRef<"session">;
  readonly id: string;
  readonly revision: Revision;
  readonly execution?: Omit<StoredWorkLease, "expiresAt">;
}

export type WorkSettlement
  = | { readonly status: "completed"; readonly result: JsonObject; readonly data?: ReplaceData }
    | { readonly status: "failed"; readonly retryable: boolean; readonly code: string; readonly summary: string; readonly data?: ReplaceData };

export type WorkDisposition = "cancel" | "requeue" | "fail";

/** Exact-host work operations. Each write checks admission after obtaining its durable locks. */
export interface DurableWorkRepository {
  observe?(session: ResourceRef<"session">, id: string): { current(): boolean; release(): void };
  inspect(domainId: string, id: string): Promise<WorkInspection | undefined>;
  leased(after: string | undefined, limit: number): Promise<readonly { readonly domainId: string; readonly id: string }[]>;
  disposition(fence: WorkFence, action: WorkDisposition, admit: Admission): Promise<StoredWork>;
  graph(domainId: string, locator: ResourceLocator, replay?: WorkReplayKey): Promise<WorkGraph | undefined>;
  get(domainId: string, id: string): Promise<StoredWork | undefined>;
  /** Admit a fresh key with null, or a replay with its locked identity and current revision. */
  submit(intent: WorkIntent, graphRevision: Revision, limits: { readonly session: number; readonly host: number },
    admit: (previous: Readonly<Pick<StoredWork, "id" | "revision">> | null) => unknown): Promise<{ readonly id: string; readonly created: boolean }>;
  replaceData(fence: WorkFence, change: ReplaceData, admit: Admission): Promise<DataSnapshot>;
  settle(fence: WorkFence, command: WorkSettlement, admit: Admission): Promise<StoredWork>;
}

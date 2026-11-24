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

export interface ClaimActor {
  readonly registrationId: string;
  readonly principal: PolicyActorRef["principal"];
  readonly agentKey: string;
  readonly executionEpoch: Revision;
}
export type ClaimCursor = Pick<StoredWork, "priority" | "createdAt" | "id">;
export type WorkPageKey = Pick<StoredWork, "createdAt" | "id">;
export interface WorkKeyPage { readonly rows: readonly WorkPageKey[]; readonly upper?: WorkPageKey }
export interface CandidateScan {
  readonly session: WorkIntent["session"];
  readonly registrationId: string;
  readonly allowedKinds: readonly string[];
  readonly after?: ClaimCursor;
  readonly limit: number;
}
export interface PreparedClaim {
  readonly session: WorkIntent["session"];
  readonly graphRevision: Revision;
  readonly actor: ClaimActor;
  readonly allowedKinds: readonly string[];
  readonly maxActiveClaims: number;
  readonly leaseMs: number;
  readonly candidates: readonly Pick<StoredWork, "id" | "revision">[];
}
export interface PreparedRenew {
  readonly fence: WorkFence & Required<Pick<WorkFence, "execution" | "graphRevision">>;
  readonly actor: ClaimActor;
  readonly leaseMs: number;
}
export interface LockedClaim extends WorkInspection {
  readonly hostEpoch: Revision;
  readonly registration: NonNullable<WorkInspection["registration"]>;
  readonly activeClaims?: number;
}
export type ClaimAdmission = (locked: LockedClaim) => undefined;
export type PreparedClaimResult = { readonly status: "claimed"; readonly row: StoredWork } | { readonly status: "capacity" | "changed" };
export interface WorkScheduling {
  scanCandidates(input: CandidateScan): Promise<{ readonly rows: readonly StoredWork[]; readonly hasMore: boolean }>;
  claimPrepared(input: PreparedClaim, admit: ClaimAdmission): Promise<PreparedClaimResult>;
  renewPrepared(input: PreparedRenew, admit: ClaimAdmission): Promise<StoredWork>;
  expireExhausted(session: WorkIntent["session"], limit: number, beforeWrite?: (ids: readonly string[]) => undefined): Promise<readonly Pick<StoredWork, "id" | "revision">[]>;
}

/** Exact-host work operations. Each write checks admission after obtaining its durable locks. */
export interface DurableWorkRepository extends WorkScheduling {
  observe?(session: ResourceRef<"session">, id?: string): { current(): boolean; release(): void };
  pageKeys(session: ResourceRef<"session">, limit: number, after?: WorkPageKey, upper?: WorkPageKey): Promise<WorkKeyPage>;
  /** Unlocked preparation sample for one exact leased revision, using the store clock. */
  sampleLease(fence: Pick<WorkFence, "session" | "id" | "revision">): Promise<{ readonly expiresAt: string; readonly databaseTime: number } | undefined>;
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

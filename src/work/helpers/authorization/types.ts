import type { PolicyRef, PolicyScopeRules, ReferenceAuthorizer, ResourceRef, TrustedRequestContext } from "@authorization";
import type { JsonObject, ResourceRecord, StoredSession } from "@persistence";
import type { WorkStatus } from "@persistence/types";
import type { ResolvedSessionType } from "@sessions/helpers/sessionTypes/types";
import type { PolicyOperation, PolicyFactory } from "@authorization/policies";
import type { WorkEntities } from "../commands/types";
import type { WorkResourceSelection } from "../selections/types";

export type WorkOperation = "submit" | "read" | "claim" | "renew" | "complete" | "fail" | "cancel" | "updateData" | "announce";
export interface WorkOperationPolicy { readonly purpose: PolicyOperation; readonly policies: readonly PolicyRef[] }
export interface WorkPolicyFacts {
  /** Present for a tagged tool or resource operation after the owner resolves its route and input. */
  readonly execution?: { readonly route: import("@authorization").ResourceRoute; readonly input: unknown };
  readonly operation: WorkOperation;
  readonly caller: TrustedRequestContext;
  readonly session: ResourceRef<"session">;
  readonly entities: WorkEntities;
  readonly kind: string;
  readonly work?: { readonly id: string; readonly revision: string; readonly dataRevision: string; readonly status: WorkStatus; readonly attempt: number };
  readonly input: JsonObject;
  readonly data: JsonObject;
  readonly scope: readonly WorkResourceSelection[];
  readonly announce: readonly WorkResourceSelection[];
  readonly extension?: JsonObject;
}
export type WorkPolicyRestriction = { readonly effect: "deny"; release(): void }
  | { readonly effect: "allow"; readonly validUntil: number; isCurrent(): boolean; release(): void;
    /** Claim, renewal and paged or announced reads require a native signal or synchronous registry invalidation on policy changes. */
    readonly signal?: AbortSignal; readonly invalidation?: "registry"; };
export interface SessionWorkPolicyRegistration {
  readonly operations: Readonly<Partial<Record<WorkOperation, WorkOperationPolicy>>>;
  prepare?(facts: WorkPolicyFacts, signal: AbortSignal): Promise<WorkPolicyRestriction>;
}
export interface WorkAuthorizerOptions {
  readonly registry: ReferenceAuthorizer;
  readonly policies: PolicyFactory;
  readonly ceiling: PolicyScopeRules;
  readonly allowedKinds: readonly string[];
  readonly allowedOperations?: readonly WorkOperation[];
  resolveType(type: StoredSession["type"]): ResolvedSessionType;
  session(ref: ResourceRef<"session">): Promise<StoredSession | undefined>;
  readonly sampleLease?: import("@persistence/helpers/durability/workTypes").DurableWorkRepository["sampleLease"];
  resource?(ref: ResourceRef): Promise<ResourceRecord | undefined>;
  isSessionCurrent(ref: ResourceRef<"session">, operation: WorkOperation): boolean;
  readonly prepareDeadlineMs?: number;
  readonly maxPending?: number;
}

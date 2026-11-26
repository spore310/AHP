import type { ResourceRef } from "@authorization";
import type { WorkKindDescriptor } from "@work/helpers/definitions/types";

export type Revision = string;
export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }
export interface DataSnapshot { readonly data: JsonObject; readonly dataRevision: Revision }
export interface ReplaceData { readonly expectedDataRevision: Revision; readonly data: JsonObject }
export type ReplaceDataResult = { readonly status: "updated"; readonly value: DataSnapshot } | { readonly status: "conflict" };
export type Lifecycle = "creating" | "active" | "suspended" | "failed" | "retiring" | "retired";
export type Admission = () => unknown;
export type RetiredWork = readonly { readonly id: string; readonly revision: Revision }[];
export type RetirementObserver = (cancelled: RetiredWork) => unknown;
export interface ResourceRecord extends DataSnapshot {
  readonly ref: ResourceRef;
  readonly session: ResourceRef<"session">;
  readonly parent?: ResourceRef;
  readonly grantParent?: ResourceRef;
  readonly driver: { readonly key: string; readonly version: number };
  readonly owner: string;
  readonly providerId: string;
  readonly operationId: string;
  readonly registration: JsonObject;
  readonly recoveryInput: JsonObject;
  readonly runtimeMetadata: JsonObject;
  readonly lifecycle: Lifecycle;
  readonly resourceRevision: Revision;
  readonly createdAt: string;
  readonly modifiedAt: string;
}
export interface StoredSession {
  readonly ref: ResourceRef<"session">;
  readonly type: { readonly id: string; readonly key: string; readonly version: number; readonly workManifest?: readonly WorkKindDescriptor[] };
  readonly providerId: string;
  readonly owner: string;
  readonly lifecycle: Lifecycle;
  readonly state: JsonObject;
  readonly stateRevision: Revision;
  readonly graphRevision: Revision;
  readonly lastServerSeq: number;
  readonly createdAt: string;
  readonly modifiedAt: string;
}
export interface StateWrite {
  readonly ref: ResourceRef<"session">;
  readonly expectedRevision: Revision;
  readonly state: JsonObject;
  readonly modifiedAt: string;
  readonly serverSeq: number;
}
export interface Transition {
  readonly ref: ResourceRef;
  readonly session: ResourceRef<"session">;
  readonly expected: Lifecycle;
  readonly next: "creating" | "active" | "suspended" | "failed";
  readonly operationId: string;
  readonly runtimeMetadata?: JsonObject;
}
export interface DurableSessionRepository {
  reserve(session: StoredSession, root: ResourceRecord, admission: Admission): Promise<void>;
  get(ref: ResourceRef<"session">): Promise<StoredSession | undefined>;
  listRecoverable(after?: string): Promise<readonly StoredSession[]>;
  commitState(input: StateWrite, admission: Admission): Promise<Revision>;
  transition(input: Transition, admission: Admission): Promise<void>;
  beginRetirement(session: ResourceRef<"session">, admission: Admission, onCancelled?: RetirementObserver): Promise<readonly ResourceRecord[]>;
  finishRetirement(session: ResourceRef<"session">): Promise<void>;
  purge(session: ResourceRef<"session">, retainAfter: string): Promise<boolean>;
}
export interface DurableResourceRepository {
  reserve(record: ResourceRecord, admission: Admission): Promise<void>;
  get(ref: ResourceRef): Promise<ResourceRecord | undefined>;
  listSession(session: ResourceRef<"session">): Promise<readonly ResourceRecord[]>;
  activate(input: Transition, admission: Admission): Promise<void>;
  replaceData(session: ResourceRef<"session">, ref: ResourceRef, input: ReplaceData, admission: Admission): Promise<ReplaceDataResult>;
  beginRetirement(session: ResourceRef<"session">, ref: ResourceRef, admission: Admission, onCancelled?: RetirementObserver): Promise<readonly ResourceRecord[]>;
  finishRetirement(session: ResourceRef<"session">, ref: ResourceRef): Promise<void>;
}
export interface DurableHost {
  readonly workEvents?: Pick<import("@work/helpers/events/types").WorkEventPublisher, "subscribe">;
  readonly work: import("./workTypes").DurableWorkRepository;
  readonly epoch: Revision;
  readonly serverSeq: number;
  readonly sessions: DurableSessionRepository;
  readonly resources: DurableResourceRepository;
  /** Present when the storage adapter supports namespace membership and per-session ownership. */
  readonly coordination?: HostCoordination;
  isOpen(): boolean;
  release(): Promise<void>;
}
export interface DurableStorage {
  /** Without a claim the store must be exclusive and the host is its only logical owner. */
  acquire(hostId: string, onLost: () => void, claim?: HostClaim): Promise<DurableHost>;
}

/** One runtime instance of a logical host, as recorded by the coordination store. */
export interface HostMember {
  readonly hostId: string;
  readonly instanceId: string;
  /** Unique per join. A restarted instance never reuses an earlier generation. */
  readonly generation: Revision;
  readonly role: "standby" | "active" | "draining";
  readonly endpoint?: string;
  readonly capabilities: JsonObject;
  readonly policyRevision: number;
}
/** Identifier-only durable namespace event. Never carries inputs, results or credentials. */
export interface HostEvent {
  readonly eventId: string;
  readonly topic: "work" | "ownership" | "authority" | "membership";
  readonly kind: string;
  readonly originHostId?: string;
  readonly session?: ResourceRef<"session">;
  readonly entityId?: string;
  readonly revision?: Revision;
  readonly occurredAt: string;
}
/** A reset tells a consumer that retained events were skipped and it must reconcile from state. */
export type HostEventDelivery = { readonly type: "event"; readonly event: HostEvent } | { readonly type: "reset" };
export interface SessionLocation {
  readonly session: ResourceRef<"session">;
  readonly hostId: string;
  readonly ownershipEpoch: Revision;
  readonly lifecycle: Lifecycle;
}
/**
 * Trusted host membership claim presented when a logical host acquires a store.
 * Every field comes from application configuration. A claim is not a credential.
 */
export interface HostClaim {
  /** Canonical namespace the store must already be bound to, or is bound to on first use. */
  readonly namespaceId: string;
  readonly instanceId: string;
  /** Shared stores let several logical hosts own disjoint sessions. */
  readonly shared: boolean;
  readonly policy: { readonly revision: number; readonly digest: string };
  readonly credentialId?: string;
  readonly endpoint?: string;
  readonly capabilities?: JsonObject;
  /** Upper bound on live instances of this logical host, including standbys. */
  readonly maxInstances?: number;
  /** Membership lease lifetime measured by the store's clock. */
  readonly leaseMs?: number;
  /** When present a replica waits for the lease as a standby instead of failing. */
  readonly standby?: { readonly signal: AbortSignal; readonly retryMs?: number; onStandby?(): void };
  /** An authoritative revocation was observed. The host must drop cached authority, then acknowledge. */
  readonly onAuthorityRevoked?: (revision: number) => void;
}
/** Namespace coordination available to an acquired host. Portable across storage adapters. */
export interface HostCoordination {
  readonly namespaceId: string;
  readonly hostId: string;
  readonly instanceId: string;
  readonly generation: Revision;
  readonly shared: boolean;
  members(): Promise<readonly HostMember[]>;
  /** True only for the exact live generation. A restarted or expired instance is rejected. */
  isCurrentMember(hostId: string, instanceId: string, generation: Revision): Promise<boolean>;
  setRole(role: "active" | "draining"): Promise<void>;
  locate(target: { readonly sessionUri: string } | { readonly workId: string }): Promise<SessionLocation | undefined>;
  /** Sessions this logical host owns, in exact-instance order. */
  listOwned(after?: string): Promise<readonly StoredSession[]>;
  /** Moves one owned session to another live member. The old owner is fenced by the same commit. */
  transfer(session: ResourceRef<"session">, toHostId: string): Promise<void>;
  /** Logical hosts that still own sessions but have no live instance. */
  orphanedOwners(): Promise<readonly string[]>;
  /** Takes over the sessions of a logical host whose lease is provably free. */
  adopt(fromHostId: string, limit?: number): Promise<readonly SessionLocation[]>;
  authorityRevision(): number;
  /** Durable namespace-wide revocation. Later fenced transactions fail until each host acknowledges. */
  revokeAuthority(): Promise<number>;
  acknowledgeAuthority(revision: number): void;
  /** Globally increasing native sequence values for a shared store. */
  allocateServerSeq(count: number): Promise<readonly number[]>;
  subscribeEvents(listener: (delivery: HostEventDelivery) => void): () => void;
}

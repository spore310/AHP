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
  beginRetirement(session: ResourceRef<"session">, admission: Admission): Promise<readonly ResourceRecord[]>;
  finishRetirement(session: ResourceRef<"session">): Promise<void>;
  purge(session: ResourceRef<"session">, retainAfter: string): Promise<boolean>;
}
export interface DurableResourceRepository {
  reserve(record: ResourceRecord, admission: Admission): Promise<void>;
  get(ref: ResourceRef): Promise<ResourceRecord | undefined>;
  listSession(session: ResourceRef<"session">): Promise<readonly ResourceRecord[]>;
  activate(input: Transition, admission: Admission): Promise<void>;
  replaceData(session: ResourceRef<"session">, ref: ResourceRef, input: ReplaceData, admission: Admission): Promise<ReplaceDataResult>;
  beginRetirement(session: ResourceRef<"session">, ref: ResourceRef, admission: Admission): Promise<readonly ResourceRecord[]>;
  finishRetirement(session: ResourceRef<"session">, ref: ResourceRef): Promise<void>;
}
export interface DurableHost {
  readonly work: import("./workTypes").DurableWorkRepository;
  readonly epoch: Revision;
  readonly serverSeq: number;
  readonly sessions: DurableSessionRepository;
  readonly resources: DurableResourceRepository;
  isOpen(): boolean;
  release(): Promise<void>;
}
export interface DurableStorage {
  acquire(hostId: string, onLost: () => void): Promise<DurableHost>;
}

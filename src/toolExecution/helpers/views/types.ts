import type { SessionState, SessionSummary, Snapshot } from "@microsoft/agent-host-protocol";
import type { LocalDecisionStamp, PolicyRef, ReferenceAuthorizer, ResourceRef, TrustedRequestContext } from "@authorization";
import type { ToolPolicyFactory } from "@toolPolicy";
import type { ClientToolRoute } from "@toolExecution/helpers/client/helpers/broker";
import type { Awaitable } from "@toolExecution/types";

export interface ResourceViewOptions {
  readonly registry: ReferenceAuthorizer;
  readonly policies: ToolPolicyFactory;
  /** Explicit host consent to use these policies for resource content reads. Not tool grants. */
  readonly admitted: readonly PolicyRef[];
  resolve(request: { readonly actor: TrustedRequestContext; readonly resource: ResourceRef; readonly signal: AbortSignal }): Awaitable<ClientToolRoute>;
}
export interface ResourceViewRecord {
  readonly resource: ResourceRef;
  readonly sessionType: { readonly key: string; readonly version: number };
  readonly providerId: string;
}
export interface ResourceViewRow extends ResourceViewRecord {
  readonly summary: SessionSummary;
}
export interface ResourceViewCatalogue {
  readonly rows: readonly ResourceViewRow[];
  readonly fromSeq: number;
  /** Callback-free canonical catalogue generation check, not authority. */
  current(): boolean;
}
export interface ResourceViewSource {
  record(uri: string): ResourceViewRecord | undefined;
  /** Capture a pure owned-state check. The returned function must not call clocks, resolvers or user hooks. */
  captureResourceFence(resource: ResourceRef): () => boolean;
  snapshot(uri: string): (Omit<Snapshot, "state"> & { state: SessionState }) | undefined;
  catalogue(): ResourceViewCatalogue;
}
export interface ResourceViewRecipient {
  readonly actor: TrustedRequestContext;
  readonly signal: AbortSignal;
  /** Includes trusted connection setup and global sequence permission. */
  current(): boolean;
  /** Callback-free local connection/owner lifetime fence, after all other checks. */
  fence(): boolean;
}
export interface ResourceViewProof<T> {
  readonly value: T;
  readonly stamps: readonly LocalDecisionStamp[];
  /** Private canonical basis, including excluded rows. Only value is a wire payload. */
  readonly basis: readonly ResourceRef[];
  current(): boolean;
  /** Owned authority/source fences, without clocks or user callbacks. */
  fence(): boolean;
}

import type { PolicyActorRef, ResourceRef, ScopedPolicyBinding } from "../../types";
import type { ResourceRegistration } from "../resources/types";
import type { GrantControlFacts } from "../grants/types";

/** Opaque installation receipts. Only the issuing registry recognizes their identity. */
export interface ResourceInstallationToken {
  readonly kind: "resource-installation";
}
export interface BindingInstallationToken {
  readonly kind: "binding-installation";
}
export type InstallationState = "prepared" | "installed" | "failed" | "retired";
export interface ResourceInstallationState {
  readonly input: ResourceRegistration;
  state: InstallationState;
}
export interface BindingInstallationState {
  readonly binding: ScopedPolicyBinding;
  readonly resource?: ResourceInstallationToken;
  state: InstallationState;
  entry?: InstalledBinding;
}

export interface ResourceBindingBasis {
  readonly resource: ResourceRef;
  readonly installation: ResourceInstallationToken;
  readonly relationshipRevision: number;
}
export interface CanonicalBindingToken {
  readonly bindingId: string;
  readonly scope: ResourceRef;
  readonly revision: number;
  /** Opaque identity rather than a caller-controlled serialized revision. */
  readonly incarnation: BindingInstallationToken;
}
export interface ScopedBindingSnapshot {
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
  readonly epoch: number;
  readonly grantRevision: number;
  readonly bindings: readonly ScopedPolicyBinding[];
  readonly tokens: readonly CanonicalBindingToken[];
}

/** Host-installed assignment. This is not GrantIssuer permission issuance. */
export interface InstalledBinding {
  readonly binding: ScopedPolicyBinding;
  readonly installation: BindingInstallationToken;
  readonly resourceInstallation?: ResourceInstallationToken;
  readonly parent?: BindingInstallationToken;
  readonly relationships?: readonly ResourceBindingBasis[];
  readonly control?: GrantControlFacts;
}

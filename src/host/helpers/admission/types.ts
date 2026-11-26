/** A host-specific secret. Supply it from the application's secret provider, never from source. */
export interface HostCredential {
  readonly id: string;
  /** Base64url Ed25519 seed. Never logged, persisted by the SDK or sent to another host. */
  readonly secret: string;
}

/** Infrastructure operations a namespace member may perform. Never an application permission. */
export type HostOperation = "serve" | "route" | "adopt";

export interface NamespaceMemberPolicy {
  /** Stable logical host name. Replicas share it; runtime instances differ. */
  readonly hostId: string;
  /** Public verifiers. List an old and a new entry with overlapping validity to rotate. */
  readonly credentials: readonly { readonly id: string; readonly publicKey: string; readonly notBefore?: string; readonly expiresAt?: string }[];
  /** Upper bound on live instances of this logical host, including standbys. */
  readonly maxInstances?: number;
  /** Exact internal endpoints this host may advertise. Routing refuses any other destination. */
  readonly endpoints?: readonly string[];
  /** Defaults to every operation. */
  readonly operations?: readonly HostOperation[];
}

/**
 * Trusted, application-owned membership policy for one namespace.
 *
 * Every member is configured with the same policy. A higher `revision`
 * supersedes a lower one and fences members still running the older
 * configuration; two different policies with one revision are rejected.
 */
export interface NamespacePolicy {
  readonly namespaceId: string;
  readonly revision: number;
  readonly members: readonly NamespaceMemberPolicy[];
  readonly revokedCredentialIds?: readonly string[];
}

export interface HostAdmissionOptions {
  readonly hostId: string;
  readonly policy: NamespacePolicy;
  /** A function is called on every use, so a secret provider can rotate without a restart. */
  readonly credential: HostCredential | (() => HostCredential);
  readonly requireTls?: boolean;
  /**
   * Application configuration every member must share, such as work kinds and
   * capacity limits. It is hashed into the policy digest: two members with one
   * revision and different configuration cannot both join.
   */
  readonly configuration?: unknown;
  readonly now?: () => number;
}

/** Signed statement one host makes to exactly one other host. */
export interface HostProofClaims {
  readonly v: number;
  readonly namespaceId: string;
  readonly hostId: string;
  readonly instanceId: string;
  readonly generation: string;
  readonly credentialId: string;
  readonly audience: string;
  readonly purpose: "relay" | "probe";
  readonly policyRevision: number;
  readonly issuedAt: number;
  readonly nonce: string;
  /** SHA-256 of the content this proof authenticates. */
  readonly bind: string;
}

/** An authenticated namespace member. It carries no user, agent, role or session authority. */
export interface VerifiedHost {
  readonly hostId: string;
  readonly instanceId: string;
  readonly generation: string;
  readonly credentialId: string;
}

export interface HostAdmission {
  readonly namespaceId: string;
  readonly hostId: string;
  readonly policy: { readonly revision: number; readonly digest: string };
  readonly maxInstances?: number;
  credentialId(): string;
  /** False once this host's own credential is expired, revoked or no longer matches policy. */
  isCurrent(): boolean;
  isMember(hostId: string): boolean;
  allows(hostId: string, operation: HostOperation): boolean;
  endpointAllowed(hostId: string, endpoint: string): boolean;
  sign(claims: Pick<HostProofClaims, "instanceId" | "generation" | "audience" | "purpose" | "bind">): string;
  verify(proof: unknown, expected: { readonly purpose: HostProofClaims["purpose"]; readonly bind: string; readonly operation: HostOperation }): VerifiedHost | undefined;
}

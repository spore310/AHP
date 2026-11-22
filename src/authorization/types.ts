/** Canonical subject inside one security domain. Display names are not subjects. */
export interface SecuritySubjectRef {
  readonly domainId: string;
  readonly subject: string;
}

/** Actual user or agent. Kind is trusted-adapter output, never inferred from a missing record. */
export type PolicyActorRef
  = | { readonly kind: "user"; readonly principal: SecuritySubjectRef }
    | {
      readonly kind: "agent";
      readonly principal: SecuritySubjectRef;
      readonly agentId: string;
    };

/** Server-owned resource incarnation. `id` may be a public URI; `instanceId` is not an alias. */
export interface ResourceRef<TKind extends string = string> {
  readonly domainId: string;
  readonly kind: TKind;
  readonly id: string;
  readonly instanceId: string;
}

/** Origin plus every resolved target. One instance id is not the whole route. */
export interface ResourceRoute {
  readonly origin: ResourceRef;
  readonly targets: readonly ResourceRef[];
}

/** Chosen executor fence. A connection string alone is not this identity. */
export interface ExecutorRevision {
  readonly actor: PolicyActorRef;
  readonly connectionId: string;
  readonly generation: number;
  readonly registrationRevision: number;
}

/**
 * Trusted caller context. `clientId`, a UI label, or a model name is not an actor.
 * Existing `AuthenticatedPrincipal.subject` maps only to `principal.subject`.
 */
export interface TrustedRequestContext {
  readonly actor: PolicyActorRef;
  readonly connectionId: string;
  readonly authRevision: string;
  readonly agentGeneration?: number;
  readonly delegationRef?: string;
}

/** Exact registered policy revision. The id is opaque. */
export interface PolicyRef {
  readonly id: string;
  readonly revision: number;
}

/** Exact registered namespace revision. Inclusion is not a grant. */
export interface NamespaceRef {
  readonly name: string;
  readonly revision: number;
}

/** Ceiling a session type may admit. Empty arrays admit nothing. */
export interface PolicyAdmission {
  readonly policies: readonly PolicyRef[];
  readonly namespaces: readonly NamespaceRef[];
}

/** Admitted alternatives plus every mandatory restriction. */
export interface PolicyScopeRules {
  readonly admitted: PolicyAdmission;
  readonly mandatory: readonly PolicyRef[];
}

/** Issuance lineage. Invoke permission is not this authority. */
export type GrantAuthority
  = | { readonly kind: "host-policy"; readonly policy: PolicyRef }
    | {
      readonly kind: "delegation";
      readonly issuer: PolicyActorRef;
      readonly parentGrantId: string;
    };

/**
 * One scoped assignment. `roles: []` does not imply a direct grant.
 * A direct grant is represented by `policies` plus an explicit direct-grant rule.
 */
export interface ScopedPolicyBinding<TRole extends string = string> {
  readonly id: string;
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
  readonly roles: readonly TRole[];
  readonly policies: readonly PolicyRef[];
  readonly authority: GrantAuthority;
  readonly revision: number;
  readonly expiresAt?: string;
}

/**
 * Local freshness stamp. It is not a cross-system transaction.
 * External adapters must still declare their own expiry.
 */
export interface AuthorityRevisionStamp {
  readonly domainId: string;
  readonly actor: PolicyActorRef;
  readonly authRevision: string;
  readonly connectionId: string;
  readonly agentGeneration?: number;
  readonly delegationRef?: string;
  readonly executor?: ExecutorRevision;
  readonly route: ResourceRoute;
  readonly relationshipRevision: number;
  readonly policyRevisions: readonly PolicyRef[];
  readonly grantRevision: number;
}

/**
 * Subject-only projection of the existing principal contract.
 * The host supplies `domainId`; this type does not replace `AuthenticatedPrincipal`.
 */
export interface PrincipalSubjectCompatibility {
  readonly subject: string;
}

/** Handshake facts a host authenticator may already hold. No socket or request type. */
export interface TrustedHandshakeInput {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly remoteAddress?: string;
}

/** Resolves identity before protected initialization. `undefined` is not a principal. */
export interface ConnectionIdentityAdapter {
  authenticate(input: TrustedHandshakeInput): Promise<SecuritySubjectRef | undefined>;
}

export interface ActorResolutionRequest {
  readonly principal: SecuritySubjectRef;
  readonly connectionId: string;
  readonly authRevision: string;
  readonly delegationRef?: string;
}

/** Resolves user/agent and delegation. Absence of an agent record does not mean human. */
export interface ActorResolver {
  resolve(input: ActorResolutionRequest): Promise<TrustedRequestContext>;
}

export interface BindingQuery {
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
  readonly grantRevision: number;
}

/** Reads current roles and direct bindings. It does not issue them. */
export interface BindingResolver {
  read(query: BindingQuery): Promise<readonly ScopedPolicyBinding[]>;
}

export interface GrantIssueRequest {
  readonly operation: "assign";
  readonly issuer: PolicyActorRef;
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
  readonly roles: readonly string[];
  readonly policies: readonly PolicyRef[];
  readonly authority: GrantAuthority;
  readonly delegationDepth: number;
  readonly expiresAt?: string;
}

/** Prepared assignment. Commit is a separate trusted step. */
export interface PreparedGrant {
  readonly id: string;
  readonly instanceId: string;
  readonly revision: number;
  readonly request: GrantIssueRequest;
}

export interface GrantRevocation {
  readonly operation: "revoke";
  readonly issuer: PolicyActorRef;
  readonly grantId: string;
  readonly instanceId: string;
}

/**
 * Assign and revoke authority. Using a tool is not permission to grant it.
 * `prepare` may await. `commit` and `rollback` are synchronous local steps;
 * an async persistence adapter is not this critical section.
 */
export interface GrantIssuer {
  prepare(request: GrantIssueRequest): Promise<PreparedGrant>;
  commit(prepared: PreparedGrant): ScopedPolicyBinding;
  rollback(prepared: PreparedGrant): void;
  revoke(revocation: GrantRevocation): Promise<void>;
}

/** URI and type labels are selectors. The adapter returns the authoritative instance. */
export interface ResourceSelector {
  readonly domainId: string;
  readonly kind: string;
  readonly id: string;
  readonly origin?: ResourceRef;
}

export interface ResourceResolution {
  readonly resource: ResourceRef;
  readonly owner: SecuritySubjectRef;
  readonly operations: readonly string[];
  readonly origin?: ResourceRef;
  readonly related: readonly ResourceRef[];
  readonly admitted: PolicyAdmission;
  readonly mandatory: readonly PolicyRef[];
}

/** Missing type or evaluator is a denial at evaluation time, not a parent fallback. */
export interface ResourceResolver {
  resolve(selector: ResourceSelector): Promise<ResourceResolution>;
}

/** SDK-owned decision. Unknown effects are not this type and must not be treated as allow. */
export type PolicyDecision
  = | { readonly effect: "deny"; readonly code: string }
    | {
      readonly effect: "allow";
      readonly reveal: boolean;
      readonly challengeRequired: boolean;
    };

export interface PolicyEvaluationRequest {
  readonly actor: TrustedRequestContext;
  readonly scope: PolicyScopeRules;
  readonly resource: ResourceRef;
  readonly operation: string;
  readonly input: unknown;
  readonly authority: AuthorityRevisionStamp;
}

/** Evaluates one complete grant path and every mandatory rule. Errors deny. */
export interface PolicyEvaluator {
  evaluate(request: PolicyEvaluationRequest): Promise<PolicyDecision>;
}

export interface FreshnessNotice {
  readonly domainId: string;
  readonly revision: number;
  readonly expiresAt?: string;
  readonly invalidated: boolean;
}

/** Publishes local revision changes. It does not promise distributed revocation. */
export interface FreshnessPort {
  current(domainId: string): Promise<FreshnessNotice>;
  invalidate(notice: FreshnessNotice): Promise<void>;
}

/** One host security composition. Independent of agent work and SQL. */
export interface SecurityComposition {
  readonly identity: ConnectionIdentityAdapter;
  readonly actors: ActorResolver;
  readonly bindings: BindingResolver;
  readonly grants: GrantIssuer;
  readonly resources: ResourceResolver;
  readonly policies: PolicyEvaluator;
  readonly freshness: FreshnessPort;
}

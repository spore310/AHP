# Authority contract — one identity lineage, scoped permission decisions

**Target contract, R5.** Current code is not claimed to implement these exports.
This section owns identity, grants, resource relationships and policy freshness.

## A1. Same trusted source, different facts

Existing `AuthenticatedPrincipal.subject` is obtained by a host authenticator.
Existing `SessionOwnerRegistry` stores the creator/owner subject by URI. Existing
`SessionApplicationOptions.role` is a captured host-level anonymous/admin selector.
The target must not maintain a second, conflicting global role identity source.

Keep ownership and effective roles separate:

```ts
// ./src/authorization/types.ts — proposed portable leaf contracts
export interface SecuritySubjectRef {
  readonly domainId: string;
  readonly subject: string;
}

export type PolicyActorRef =
  | { readonly kind: 'user'; readonly principal: SecuritySubjectRef }
  | {
      readonly kind: 'agent';
      readonly principal: SecuritySubjectRef;
      readonly agentId: string;
    };

export interface ResourceRef<TKind extends string = string> {
  readonly domainId: string;
  readonly kind: TKind;
  readonly id: string;          // May be the public AHP URI.
  readonly instanceId: string; // Server-owned incarnation, not a URI alias.
}

export interface TrustedRequestContext {
  readonly actor: PolicyActorRef;
  readonly connectionId: string;
  readonly authRevision: string;
  readonly agentGeneration?: number;
  readonly delegationRef?: string;
}
```

The subject is canonical within its security domain. Multi-tenant apps must not
alias two users with the same display name. The transport adapter does not trust
these shapes merely because the client supplied JSON matching them. In-process
consumers must use a trusted-context adapter; direct low-level host code is inside
the trust boundary, not magically sandboxed by TypeScript.

No agent binding does not mean human. A human UI label, shared bearer token,
`clientId`, providerId or model name cannot prove human origin. The consuming
identity adapter must establish actor classification and any delegation from
trusted credentials/state. When an agent ID is not yet registered, protected
agent tool operations remain unavailable until its connection binding resolves.

## A2. Shared harness, isolated authority

A server-provided coding harness/runtime definition can be reused. Durable agent
registration is still subject-bound; runtime implementation identity is not an
actor's authorization identity. Two developers must not accidentally share the
same mutable grant cache because their agents use the same model or executable.

For every invocation distinguish caller/initiator from chosen executor. A hosted
agent service may execute for several users, but each request carries a verified,
scoped delegation/authorization context. It must not substitute its service account
or the session owner's subject for the caller. An agent approved by a human remains
an agent. Explicit delegation, not automatic role inheritance, controls its powers.

Cache/view keys include domain, actual actor, delegation, connection/generation,
resource and session instance, relationship revision, policy revisions and grant
revision. A credential/identity change requires fenced rebind/reinitialization;
old admissions and pending challenges are invalidated, not transferred silently.

## A3. Definitions, ceilings and bindings

```ts
export interface PolicyRef { readonly id: string; readonly revision: number }
export interface NamespaceRef { readonly name: string; readonly revision: number }
export interface PolicyAdmission {
  readonly policies: readonly PolicyRef[];
  readonly namespaces: readonly NamespaceRef[];
}
export interface PolicyScopeRules {
  readonly admitted: PolicyAdmission;
  readonly mandatory: readonly PolicyRef[];
}
export type GrantAuthority =
  | { readonly kind: 'host-policy'; readonly policy: PolicyRef }
  | {
      readonly kind: 'delegation';
      readonly issuer: PolicyActorRef;
      readonly parentGrantId: string;
    };
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
```

These sketches deliberately omit persistence technology. Add runtime schemas and
finite limits beside types; generic types alone do not validate untrusted values.
Arrays normalize to empty. A direct-policy grant may work with roles=[] when its
rule explicitly admits direct grants and actor kind. A role-gated rule with absent
branch or anyOf=[] admits nobody. Do not abuse an empty allOf test to permit access.

One complete valid grant path is sufficient to satisfy the positive-grant part.
Every mandatory host/application/session/resource/provider restriction must also
pass. Alternative role variants are not all ANDed together; mandatory rules are
not optional selections. Do not synthesize broader access by mixing the resource
from one grant, operation from another and actor from a third.

Roles have meaning only in the application policy and binding scope. Provider
approval cannot widen a session's tool ceiling; session-owner role cannot override
resource-owner/provider denial. Missing required evaluator, expired binding,
unknown revision, invalid relationship or thrown evaluation fails closed.

## A4. Authorization interfaces, not a prescribed IAM stack

Public ports must support:

| Port | Required purpose |
| --- | --- |
| Connection identity adapter | Authenticate/resolve trusted identity before protected initialization. Reuse existing authenticator through compatibility wiring. |
| Actor resolver | Resolve actual user/agent and delegation context, not infer kind from an absent agent record. |
| Binding resolver | Read current scoped roles/direct policy bindings and revisions. |
| Grant issuer | Prepare/commit/revoke bounded assignments under explicit issuance authority. |
| Resource resolver | Resolve real instance, ownership, supported operations and trusted relationships. |
| Policy evaluator | Evaluate admitted selected rules and every mandatory rule with canonical input. |
| Freshness/invalidation port | Publish local revision changes and bound validity of external decisions. |

Use one host-level `security` composition object, independent of `agentWork` and
SQL. Keep authenticate compatible with current `ConnectionAuthenticator`; reject
conflicting authenticator sources rather than choosing the more permissive one.
If both old/new options are accepted temporarily, require the same instance or
an explicit one-source adapter. Expose no direct role fields in wire initialization.

An authenticator may grant direct policies through a trusted grant resolver without
namespaces. Authentication proves identity; the authorization part issues/evaluates
permission. Both can be provided by one application object without conflating them.
Missing protected authority denies. A deliberate trusted-local profile requires
explicit host configuration and a bounded direct grant; no default synthetic user.

## A5. Bootstrap, delegation and revocation

Session type declares its admitted policy refs, mandatory refs and optional
creator-bootstrap template. The template has no hardcoded role names. Check
creation, selected type/provider and bootstrap authority before allocating the
usable session. Asynchronous resolution happens before the existing synchronous
record-attach hook. Commit the resource incarnation, owner and initial bindings
before publishing. Failed commit removes the new record/bindings. Provider startup
failure may leave a failed inspectable session according to existing lifecycle,
but must not create an ownerless or privilege-leaking record.

A grant issuer needs explicit assign/revoke authority separate from invoke.
Check permitted policies/roles, target actor kinds, scope descendants/relations,
duration and redelegation depth. Reject cycles and overreach. Store lineage and
check ancestor expiry/revocation. Session teardown invalidates all instance-bound
assignments and pending work in this policy subsystem. Reused URIs get new instances.

Keep a bounded per-host in-memory reference implementation for this milestone;
restart invalidates transient grants and continuations unless a separately supplied
adapter restores them under an explicit contract. No new SQL tables are required.
Do not rebuild an external IAM service inside the SDK.

## A6. Freshness and the last local admission point

After awaits, recheck captured domain/actor/generation/resource/relationship and
policy/grant revisions before local mutation, enqueue or execution dispatch. The
last local check and admission must have no intervening await. Revision changes
force reevaluation/denial; bound retries to avoid starvation and CPU exhaustion.

External policy systems cannot promise instantaneous revocation merely through
an async `evaluate` function. Their adapter must declare freshness/expiry and
invalidation semantics. Use short-lived current decisions plus revision updates
or a trusted fresh verification contract; document the bound. Do not claim a
cross-system atomic transaction. Once bytes or a remote side effect have passed
the admission boundary, revocation does not undo them.

## A7. Existing work ownership stays separate

Do not alter WorkService/SQL owner equality or lease fencing. Tool/session grants
can enable a junior user's tools in a senior-owned session; they cannot silently
make the junior eligible for current owner-only durable work. That later change
requires acting-principal versus owner/delegation data through every repository
adapter. Never supply the owner's subject as the worker just to bypass a denial.

## A8. One ownership source; compatibility is a projection

The protected host keeps the current resource incarnation, its immutable owner
identity and scoped bindings in one coordinated authorization registry. The
existing owner-only `@work` view is an adapter over that owner fact, not another
independently writable owner map. Standalone old owner-registry fixtures may
remain for the existing work unit tests. In protected host composition, a second
owner store with a conflicting value is not accepted.

Changes to ownership are a distinct authorized operation, not the result of changing
someone's role array. Do not implement ownership transfer in this milestone.
All cleanup/rollback operations carry the expected instance ID. A late unbind for
an old incarnation must never unbind the current session at the same URI. Keep
creation attach and its local ownership/binding commit synchronous and coherent;
prepare asynchronous policy decisions before entering that critical section.

Legacy WorkService/repository APIs use a subject string rather than a composite
security-domain key. Keep those inputs canonical and unambiguous at authentication.
A host using the existing durable extension must use one identity domain or
application-issued globally unambiguous subjects; do not silently collapse two
(domain, subject) pairs into one old work identity. Multi-domain shared work storage
is not newly certified by this task. This does not prevent many distinct users in
one organization's host, or separate host instances for different domains.

## A9. Origin route plus target resources

The context of a call from a triage chat includes both its origin route
(session -> chat) and every actual target resolved from canonical input (for
example, a workspace or terminal). The SDK applies the required constraints on
all of them. The caller cannot omit the chat context to borrow its parent session's
more permissive allowlist when using a chat-scoped assignment. Assignments carry
their permitted origin routes; a separately authorized session-wide call is a
separate authority path, not a forged chat invocation.

A resource adapter resolves the authoritative target, its exact application-defined
resource type (for example triage chat or production terminal), and its links;
request URIs/type labels are selectors only. Its descriptor supplies admitted and
mandatory policies derived from the registered type plus instance/provider rules.
A missing required type/evaluator denies, rather than falling back to its parent
session policies. All provider restrictions protecting the target remain applicable.
Fixtures must prove that triage read permission cannot become terminal input or
workspace write permission through a different route. Real filesystem race,
symlink and process isolation remain responsibilities of the actual provider,
which is not implemented in this packet set.

## A10. Optional credentials do not mean identityless tool authority

Native safe initialization/ping/capability negotiation may be public. Protected
tool operations still require a trusted user or agent context. An explicitly
configured trusted-local adapter can establish that context without an external
identity provider; the SDK never manufactures a user because credentials are absent.
The action authenticate hook remains optional. Truly anonymous tool execution would
need a separately modeled actor/grant policy and is not enabled by omission in this
milestone. This keeps the user/agent contract precise without adding default roles.

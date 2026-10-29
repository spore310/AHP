# Authorization contracts

Portable authority contracts, a per-host reference evaluator and bounded grant issuance. Authentication remains an injected port; this module does not read a database. Legacy work uses `AuthenticatedPrincipal`/`SessionOwnerRegistry`; protected session composition projects this module's canonical full-ref owner through a read-only work lookup.

`createReferenceAuthorizer` evaluates scoped decisions and captures `ReferenceInputLimits` once. Those list budgets are not `maxPolicyRefs` or registry caps. An installed admission freezes the direct policy refs plus the compiler's expanded namespace closure. Namespace membership is not a grant. `createGrantService` implements asynchronous preparation/revocation and synchronous commit/rollback against the same canonical registry. These capabilities alone do not establish shared-host privacy or tool execution.

## Files

| File | Responsibility |
| ---- | -------------- |
| `constants.ts` | Frozen default and absolute policy limits. Limits are not roles or grants. |
| `types.ts` | Identity, route, executor revision, admission, binding, decision, and port contracts. |
| `helpers/validation/types.ts` | Plain-JSON depth, key-count, and byte budgets. |
| `helpers/validation/helpers.ts` | Shared identifier/role/ref schemas and bounded plain-JSON capture. |
| `helpers/validation/index.ts` | Public validation exports. |
| `helpers/context/helpers.ts` | Full actor, resource and route comparison. |
| `helpers/context/index.ts` | Context exports. |
| `helpers/resources/types.ts` | Trusted resource registration and explicit applicability. |
| `helpers/resources/helpers.ts` | Instance lookup. Owner identity is not a role. |
| `helpers/resources/index.ts` | Resource exports. |
| `helpers/bindings/types.ts` | Installation ownership, canonical lineage and scoped snapshot contracts. |
| `helpers/bindings/helpers.ts` | Exact policy membership and expiry. |
| `helpers/bindings/index.ts` | Binding exports. |
| `helpers/evaluate/constants.ts` | P03-local registry caps and decision TTL. Not policy-reference limits. |
| `helpers/evaluate/types.ts` | Selector, stamp, and authorizer contracts. |
| `helpers/evaluate/helpers.ts` | Immutable registry, one async decision path, and synchronous admission. |
| `helpers/evaluate/index.ts` | `createReferenceAuthorizer`. |
| `helpers/grants/types.ts` | Grant service contracts, private canonical port and runtime schemas. |
| `helpers/grants/constants.ts` | Independent default and absolute grant limits. |
| `helpers/grants/helpers.ts` | Bounded assign/revoke preparation, currentness, commit and cleanup. |
| `helpers/grants/index.ts` | Public grant contracts and limits; excludes private mutation ports. |
| `index.ts` | Public exports. |

## Public names

Types: `SecuritySubjectRef`, `PolicyActorRef`, `ResourceRef`, `ResourceRoute`, `ExecutorRevision`, `TrustedRequestContext`, `PolicyRef`, `NamespaceRef`, `PolicyAdmission`, `PolicyScopeRules`, `GrantAuthority`, `ScopedPolicyBinding`, `AuthorityRevisionStamp`, `PrincipalSubjectCompatibility`, `TrustedHandshakeInput`, `ConnectionIdentityAdapter`, `ActorResolutionRequest`, `ActorResolver`, `BindingQuery`, `BindingResolver`, `GrantIssueRequest`, `PreparedGrant`, `GrantRevocation`, `GrantIssuer`, `ResourceSelector`, `ResourceResolution`, `ResourceResolver`, `PolicyDecision`, `PolicyEvaluationRequest`, `PolicyEvaluator`, `FreshnessNotice`, `FreshnessPort`, `SecurityComposition`, `PolicyLimits`, `AuthorizationSchemas`.

Values: `POLICY_LIMIT_DEFAULTS`, `POLICY_LIMIT_ABSOLUTE`, `MAX_POLICY_REVISION`, `RESERVED_OBJECT_KEYS`, `policyLimitsSchema`, `createAuthorizationSchemas`, `identifierSchema`, `roleNameSchema`, `securitySubjectRefSchema`, `policyActorRefSchema`, `resourceRefSchema`, `trustedRequestContextSchema`, `policyRefSchema`, `namespaceRefSchema`, `policyAdmissionSchema`, `policyScopeRulesSchema`, `grantAuthoritySchema`, `scopedPolicyBindingSchema`, `executorRevisionSchema`, `authorityRevisionStampSchema`, `policyDecisionSchema`, `capturePlainJson`, `rejectReservedKeys`.

`PolicyDecision` is defined here so the evaluator port does not import tool policy. `@toolPolicy` re-exports it.

## Limits

Defaults include include depth 16, 32 namespace includes, 256 expanded policies, delegation depth 8, 8 challenges per actor, 64 per host, a 300-second challenge lifetime, 256 retained calls, 16 MiB aggregate results, and 60-second retention. Absolute ceilings reject larger values. `createAuthorizationSchemas` captures a validated budget, including a lower or higher value inside that ceiling. `maxNamespaceIncludes` is the include-list count. `namespaceIncludeDepth` is not that count.

`capturePlainJson` bounds visits before descending and stops once the UTF-8 size of the escaped JSON text, including container delimiters, exceeds the budget. It rejects cycles, reserved keys, array extra own names/symbols/accessors, and does not call getters or `toJSON`. It does not sandbox a Proxy that lies about its descriptors.

## Reference decisions and assignments

`evaluate` checks a selected scoped policy path plus mandatory route constraints. It is not by itself a tool execution ticket. `projectAssignments` additionally requires an exact installed canonical tool/recipient/resource/route/purpose binding; execute projections use a separate executor registry and validate its full connection/generation/registration fence. Invalid implementation registrations are rejected with the shared tool-policy schema.

Decisions retain the original caller context separately from the executor. `matches` checks caller currentness, all captured route-resource revisions, contributing binding/proof expiry and local invalidation without awaiting external work. Call it at the final local admission point; evaluation does not make a remote transaction atomic.

`validateAssignmentCohort` checks up to 512 genuine assignment authorizations and
1024 total stamps for their respective actual callers at one final canonical time,
then checks exact installed tuples. Single `validateAssignments` uses this same
check. Copied/foreign authorizations fail; no permission is created by freshness.

`matchesAll` checks up to 1024 genuine issued stamps against one final canonical
clock sample, avoiding expiry between individual proof checks. `captureFence`
returns a callback-free local mutation check; it is neither permission nor an
expiry check. Aggregate consumers run ordinary callbacks first, then aggregate
freshness, then pure registry/connection/resource ownership fences.

Identical admission/resource/assignment installations preserve currentness and capacity. Once a resource has an admission association, reinstalling it must retain that exact association; omitting or replacing it rejects atomically rather than dropping the ceiling. Explicitly unlinked direct-grant resources remain supported. Conflicting immutable admissions, bindings, contracts, implementations or assignment tuples do not silently replace approved state. Resource relationship updates invalidate prior decisions. Teardown removes bindings and assignments tied to the exact resource incarnation or its route; it does not operate on a bare instance-id string.

## Atomic admission cohorts

`installAdmissions(inputs)` stages exact canonical compiler rules and namespace
closures for the complete bounded list, checks duplicate/existing conflicts and
aggregate NEW-entry storage capacity, then installs synchronously and advances the
existing epoch/grant revision once only if something changed. An error leaves
admissions, capacity and positive/negative currentness unchanged. Empty/all-identical
cohorts are no-ops, including at capacity; existing identical entries consume no
new slots. `installAdmission` delegates to this same implementation for one item.
Protected session construction calls the batch once for the whole registration set,
never chunks/sequential compensating cleanup.

Captured `ReferenceInputLimits.maxAdmissionInstalls` defaults128, absolute1024. It
bounds each call's list BEFORE copying/iteration and counts duplicates. This is not
`ReferenceRegistryCaps.maxAdmissions`, which bounds total stored unique admissions.
P01 global schemas/limits and P02 compiler behavior are unchanged.

## Approved P05-local administrative additions

`usesPolicyFactory(factory)` is strict object identity against the compiler captured
by the reference authorizer, including after constructor-option mutation. It invokes
no callback and changes no epoch/capacity. Protected construction checks it before
admission or resource acquisition; equivalent-looking separate compilers reject.

`removeBinding({bindingId,scope,revision})` validates the bounded ID/full ref/positive
revision and conditionally removes only a matching binding. Missing/stale/mismatched
full domain/kind/id/instance or revision is a no-op with no epoch change. A hit deletes
all tool/executor tuples referring to that ID and bumps the existing epoch/revision
once, invalidating old stamps/provenance while preserving resource/owner/admission.
Removal also deletes the complete dependent grant closure. This nominal API is a
privileged administration port; SDK cleanup instead carries installation tokens.

## Installation ownership and scoped reads

`prepareResourceInstallation` and `prepareBindingInstallation` issue single-use
opaque tokens before installation. Pass them through instrumented install adapters,
including adapters that install and then throw. `teardownInstalledResource` and
`removeInstalledBinding` clean up only the exact owned installation. Equal IDs,
revisions or full resource text do not identify a later installation. Copied,
foreign or consumed tokens cannot acquire ownership. Expiry removes usable authority
without transferring cleanup ownership.

`readBindings({actor, scope})` returns immutable exact-actor/full-scope bindings,
aligned canonical tokens and one epoch/grant revision. The snapshot itself has
registry-local weak provenance; JSON copies and other registries cannot validate it.
`isBindingSnapshotCurrent` processes expiry on access before comparing canonical
state, including empty reads. Events are unnecessary for this check.

## Bounded grant service

`registry.createGrantService({sessions, rules, resolveTarget, limits})` captures one
immutable rule catalogue and the actual session capability. `usesRegistry` must
confirm strict original-registry identity before callbacks. The service's binding
reader and assignment commit require the exact session root to be ready and owned;
failed, creating, settling, stopped and stale installations cannot issue grants.

Use `service.issuer(boundContext)` with the actual trusted caller, connection and
generation, finite deadline, abort signal, exact registered rule, issued basis token
and full target scope. Tool-use permission, ownership and role names alone confer
no assign/revoke authority. Root rules explicitly select one complete canonical
basis; delegated rules attenuate actor kinds, roles, policies, scope, lifetime,
depth and further control rules. Mandatory provider constraints still apply to use.
Revoke requires its own branch and an exact issued target token.

`prepare` captures bounded intent before awaiting target resolution and approval.
At each queued target/approval invocation it rechecks trusted caller and canonical
basis before invoking the adapter. Adapter currentness guards precede the caller
identity guard, so a target or approval callback cannot invalidate the caller after
its last check. SDK readiness and the canonical comparison follow those callbacks.
Approval must return the same immutable SDK request object. `commit` requires its
own unconsumed prepared receipt and rechecks currentness/capacity synchronously.
`rollback` is idempotent; it cannot revoke a successful commit. Cancellation, timeout
and terminal service disposal reject promptly while unresolved callbacks and cleanup
retain their work slots until settlement. A new bound handle cannot reset quotas.

`DEFAULT_GRANT_LIMITS`/`MAX_GRANT_LIMITS` expose independent finite rule, input,
pending-global, pending-actor, binding, fanout, lifetime, preparation and cleanup
budgets. `sweep` is bounded maintenance; expiry never depends on a timer or sweep.
The per-actor binding budget counts all canonical bindings for that full actor
across scopes, while the canonical global binding cap also includes bootstrap roots.
`onInvalidate`/`drainInvalidations` coalesce one immutable revision hint per cohort.
Throwing/async listeners are quarantined, with unsettled listener work retaining
capacity. Hints are best-effort and never proof of current authority.

### Public-host composition

Construct fail-closed deferred binding/source ports, then the host without starting
it, then the service using `host.sessions.authorization`, then bind once and start.
An unbound/rebound port rejects; there is no always-ready placeholder. The runnable
typed fixture is [freshness.test.ts](../tests/authorization/freshness.test.ts),
`hostedGrants`. It uses the real catalogue, bootstrap, host, setup adapter and native
transport. The essential source closure for a trusted explicitly selected scope is:

```ts
const snapshot = registry.readBindings({ actor: context.actor, scope });
let released = false;
const prepared = {
  scopes: [{ scope, grantRevision: snapshot.grantRevision }],
  validUntil: selectedDeadline,
  allowGlobalSequence: selectedCursorPermission === true,
  isCurrent: () => service.isBindingSnapshotCurrent(snapshot, () =>
    !released && !signal.aborted && trustedIdentityStillCurrent()),
  release: () => { released = true; },
};
```

The selector must validate/bound scope counts, full references and deadline, and
retain the actual connection/auth/generation guard. Several scopes must share one
canonical revision. Empty scopes require a separate explicit cursor-only decision;
they are not a fallback after a failed scoped read. The service's snapshot method
samples its clock before the supplied identity guard and hosted readiness, then
performs the final canonical comparison without another callback. The setup adapter
also samples its deadline clock before that source predicate and rechecks internal
release/abort state afterward. External authority still has its own finite validity
and synchronous currentness contract; no distributed instantaneous revocation is
promised. Neither source binding nor a snapshot attests remote code execution.

## Omissions

Executor assignments include the complete executor actor, connection, generation and
registration revision in their canonical identity. Distinct connections can share an
unchanged grant. `removeExecutorAssignment(expected)` removes only the exact installed
tuple and invalidates decision proofs; stale cleanup cannot remove a successor's
generation. It does not revoke the underlying grant. Changing an implementation on
an existing executor registration is rejected; install a new registration revision.

Installing a resource, binding, or assignment is trusted host administration, not
policy-aware issuance. A compiler `select()` result is not a grant. Requests do not
supply mandatory rules. External proofs are trusted in-process adapter facts, copied
before callbacks, and are not wire credentials. `matches` re-reads live registration
without calling `FreshnessPort`. Descriptor materialization stays in `@toolPolicy`.
No database restoration, private assignment transport, challenge continuation or
remote execution attestation is implemented by this module's grant service.

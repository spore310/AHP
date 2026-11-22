# P03 repair plan v2

**Status:** plan only. Implementation is not authorized. P04 stays blocked.
**Preserved:** the rejected candidate and the seven RED tests in `src/tests/authorization/evaluateReview.test.ts`. No P01 or P02 amendment. No ledger edit. No README edit until a later accepted implementation.

## Decisions

Requests are selectors. Authority is trusted host registration plus the P02 compiler. `select()` is not a grant. There is one async evaluation path. Projection awaits that path for every contributing item, then materializes descriptors. There is no synchronous allow shortcut and no injected descriptor builder.

`PresentedExternalProof` is a trusted in-process adapter fact. Fixture compatibility does not make a wire or client proof authoritative.

Compiled `extension` is `unknown`. The host associates an exact policy ref with an own-key evaluator. An evaluator id or schema is not read from extension data. An unrelated evaluator that returns allow does not accept it.

## Helper-local interfaces

```ts
export interface ReferenceRegistryCaps {
  readonly maxResources: number;
  readonly maxBindings: number;
  readonly maxTools: number;
  readonly maxExecutors: number;
  readonly maxExternalInvalidations: number;
}

/** Finite integers, default 128, absolute 1024. Not PolicyLimits.maxPolicyRefs. */
export const DEFAULT_REFERENCE_CAPS: ReferenceRegistryCaps;

/** Trusted in-process adapter fact. Never a transport-supplied proof. */
export interface PresentedExternalProof {
  readonly revision: string;
  readonly validUntil: number;
}

export interface CapturedExternalProof {
  readonly revision: string;
  readonly validUntil: number;
}

export interface LocalDecisionStamp {
  readonly authority: AuthorityRevisionStamp;
  readonly validUntil: number;
  readonly epoch: number;
  readonly grantRevision: number;
  readonly relationshipRevisions: readonly { readonly resource: ResourceRef; readonly revision: number }[];
  readonly bindingExpiries: readonly { readonly bindingId: string; readonly expiresAt?: string }[];
  readonly external?: CapturedExternalProof;
}

export interface EvaluateSelector {
  readonly actor: TrustedRequestContext;
  readonly operation: ToolOperation;
  readonly bindingId: string;
  readonly policyRef: PolicyRef;
  readonly scope: ResourceRef;
  readonly route: ResourceRoute;
  readonly external?: PresentedExternalProof;
  readonly executor?: ExecutorRevision;
}

export interface AssignmentAuthorization {
  readonly decisions: readonly StampedDecision[];
  readonly stamps: readonly LocalDecisionStamp[];
  readonly admitted: readonly {
    readonly contractId: string;
    readonly purpose: ToolOperation;
    readonly allowed: boolean;
    readonly reveal: boolean;
    readonly challengeRequired: boolean;
  }[];
}

export interface AdmissionView {
  matches(stamp: LocalDecisionStamp, actor: TrustedRequestContext): boolean;
  getContract(id: string): ToolContractDefinition | undefined;
}
```

`createReferenceAuthorizer({ policies, now, permissionEvaluators?, extensionEvaluators?, decisionTtlMs?, caps? })`.

`decisionTtlMs` defaults to `DEFAULT_DECISION_TTL_MS` (60_000). It is not `challengeLifetimeSeconds`. Permission and extension callbacks use `asyncHookDeadlineMs`.

`BindingResolver.read` is not implemented here. If a later packet implements it, the query must include actor, scope, and `grantRevision`. No unscoped list and no manufactured grant.

## Install

Trusted installation is not issuance.

- `installAdmission({ sessionType, providerId })` freezes `forSessionType` admitted and mandatory refs.
- `installResource` copies and freezes owner, full resource ref, route, and the host applicability list `{ ref, applicable }`. That list is one mandatory source. Compiler mandatory refs are the other, and only when this resource is linked to an installed admission. The request `mandatory` array is neither source.
- Every origin and every target in a route must already be installed. A missing target denies. It is not an empty mandatory set. A target's registered mandatory ref applies even when the origin list omitted it.
- `installBinding` deep-copies and freezes actor, scope, roles, and policies. Later mutation of the caller's array is not a grant and does not bump revision. The same id with different contents throws.
- `installToolAssignment` freezes one canonical contract, one admitted policy ref, one purpose, and one `bindingId`. A bare tool id is not an assignment. No default tool admission.
- `installExecutorAssignment` freezes the full executor identity, implementation, contract id, resource ref, and `execute`. The caller is not substituted.
- `installPolicyExtensionEvaluator(policyRef, evaluator)` registers an own-key callback for that exact policy ref. It does not inspect extension data for an id.

Caps are the P03-local values above. A factory built with `maxPolicyRefs: 1` can still install up to the tool cap. One over the tool cap throws. At the cap, install succeeds.

## Evaluate

The positive path is only the selector pair `bindingId` + `policyRef`. That ref must be a member of that one binding, the actor and full scope ref must match, and the policy must be inside the resource admission when an admission is linked. Do not choose the first allowing policy. Other refs in `binding.policies` are not extra grants. Do not pair this binding's actor with another binding's policy.

Then apply every applicable mandatory rule from both sources, on the origin and every target, each on its own binding and roles. Mandatory deny does not become a challenge and does not synthesize a grant. `applicable: false` skips only that explicitly registered ref.

`requiredPermissions` run for the positive rule and every applicable mandatory rule. Missing, throwing, timing out, or non-`allow` denies. If `getPolicy(policyRef).extension !== undefined`, call only the evaluator registered for that exact policy ref. No extension means no extension callback. An allow from a permission evaluator or from another policy's extension evaluator does not accept it.

`discover`, `invoke`, and `execute` stay independent, as do `propose`, `approve`, `advertise`, and `publish`. `reveal` applies only to discover disclosure. Invoke assignment does not disclose. Execute disclosure requires the installed executor tuple for that contract and resource, not `invoke.reveal`. Challenges accumulate only on allow.

Non-finite external `validUntil` denies before allow. Omitted proof when the resource's `externalAuthority` is `required` denies. A presented proof is copied into the frozen stamp at the start. `matches` reads that copy, not the caller object.

`validUntil` is the minimum of contributing binding expiries, the captured external `validUntil` when required, and `now + decisionTtlMs`.

## Final freshness

`matches(stamp, actor)` is synchronous and does not call `FreshnessPort`. It re-reads the live resource for every route ref, the binding expiry, relationship and grant revisions, and the executor tuple. It does not compare the stamp route to itself. Teardown and owner lookup use the full resource ref, not `instanceId` alone.

After every await, and before return, run that same synchronous check. A changed epoch, expired binding, expired captured proof, or invalidated revision denies as `stale` or `expired`. No await inside the check.

## Projection

`authorizer.projectAssignments` is async. It calls `evaluate` for every selected assignment and returns `AssignmentAuthorization` with every contributing decision and stamp. It does not build descriptors and does not return an empty list before those awaits.

`projectAssignedDescriptors(view, authorization, actor)` lives in `toolPolicy/helpers/assignments` and calls `toAhpToolDefinition`. It imports authorization types and the `AdmissionView` port only. Authorization does not import it. Before emitting any descriptor, it checks every stamp with `view.matches` and every decision. One deny or one failed stamp yields no descriptors. It does not accept an injected builder.

The disclosure fixture must install the named tool assignment so the permission callback runs. The expected denial stays. A counter on that callback is the positive control that the pipeline ran.

## Test mapping

| Check | Expectation |
| --- | --- |
| RED omitted mandatory | Request `mandatory: []` still denies when `installResource` registered the restriction. |
| RED mandatory permission | Mandatory `requiredPermissions` callback deny is enforced. |
| RED disclosure | Awaited projection evaluates the installed assignment; permission deny yields no descriptors. |
| RED binding expiry | Allow at `start`, `matches` false at `start + 1001`. |
| RED external expiry | Same, from the captured proof, not the caller object. |
| RED non-finite proof | `NaN` and `Infinity` deny before allow. |
| RED mutable policies | Empty array at install stays empty after the caller pushes. |
| A01–A06 | Empty default denies. Direct grant needs no role. Fragment mix denies. Reveal is not a grant. Invoke is not publish or execute. Same harness, different actors, different stamps. |
| New | Second policy in one binding is not an extra grant. Missing target denies. Target mandatory survives origin omission. Extension without its own evaluator denies. Other evaluator allow does not accept it. Invoke does not disclose. Discover `reveal: false` hides. Execute requires the executor tuple. Mandatory allow can set `challengeRequired`; mandatory deny cannot. Permission timeout denies. Short `decisionTtlMs` expires first; the 1000 ms fixture deadlines still win under the 60 s default. Mutating `request.external` after allow does not extend `matches`. Two domains sharing `instanceId`: teardown of one does not clear the other. Tool one-over uses the P03 tool cap while `maxPolicyRefs` is 1. |

## Not authorized

This document does not authorize implementation, a P01 or P02 change, a README edit, or P04. Independent recheck comes first.

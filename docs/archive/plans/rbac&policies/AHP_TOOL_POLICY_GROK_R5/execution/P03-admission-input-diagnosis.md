# P03 admission and input-limit diagnosis

**Status:** diagnosis only. Do not implement from this note until separately assigned. Do not edit the freshness/callback slice.

## Namespace ceiling

Use the accepted factory read surface. Do not call `select()`. It returns alternatives, not a grant, and it depends on a resolver.

`forSessionType(sessionType, providerId)` returns `PolicyScopeRules`: direct refs in `admitted.policies`, namespace refs in `admitted.namespaces`, and compiler mandatory refs in `mandatory`. It does not return the expanded policy closure.

`inspect().namespaces[].expanded` is that closure. Each entry is `{ name, revision, expanded: PolicyRef[] }`. `getPolicy(ref)` reads the compiled policy. A missing policy is not admitted.

At `installAdmission`, freeze this ceiling:

1. Call `forSessionType`. If it throws `binding-not-found`, the install throws and stores nothing.
2. For each admitted namespace ref, find the same name and revision in `inspect().namespaces`. If none exists, throw and store nothing. Do not treat a miss as an empty ceiling.
3. Store the direct refs plus every `expanded` ref from those namespaces. Deduplicate by id and revision. Do not store resolver output.

At `evaluate`, when the scope resource has an admission key:

- Missing stored admission denies `missing-authority`.
- The selector `policyRef` must be in the frozen ceiling. Otherwise deny, even if a binding lists it.
- A compiled direct policy that is neither in `admitted.policies` nor in an admitted namespace expansion is outside the ceiling.
- A policy that appears only in an admitted namespace expansion is inside the ceiling. It still needs the exact binding pair, actor, and scope. Namespace membership alone is not a grant.
- Do not require a synthetic role. A direct-grant rule with no namespace remains valid when its ref is in the ceiling or when no admission is linked.

No P01 or P02 change is required.

### Tests

Add these to `src/tests/authorization/evaluateFinalReview.test.ts` only after this slice is assigned.

- Namespace-only allow: `admitted.policies` is empty, `admitted.namespaces` names a namespace whose `expanded` contains the policy, and the binding contains that ref. `evaluate` allows.
- Outside-ceiling deny: the policy is compiled and present on the binding, but absent from direct refs and from every admitted namespace expansion. `evaluate` denies.
- Unbound `installAdmission` throws and does not leave a ceiling that a later `evaluate` can use.

## Input limits

Add a P03-local option on `createReferenceAuthorizer`. Do not change `PolicyLimits`.

```ts
export interface ReferenceInputLimits {
  readonly maxRouteTargets: number;
  readonly maxProofs: number;
  readonly maxMandatorySelectors: number;
  readonly maxProjectionTools: number;
}
```

Default each field to 128. Reject construction unless every field is an integer from 1 through 1024. Capture the validated object once. These counts are not map caps and not `maxPolicyRefs`.

Before copying, reject an over-long list:

- `installResource` and `evaluate` route targets use `maxRouteTargets`.
- `evaluate` and `projectAssignments` proofs use `maxProofs`.
- Mandatory selectors use `maxMandatorySelectors`.
- Projection `tools` use `maxProjectionTools`.

Host installs throw. Selector and projection overages deny. They must not allow.

Reuse the existing default `scopedPolicyBindingSchema`, `policyRefSchema`, and `roleNameSchema` for binding roles, policy-ref arrays, and identifiers. Do not add a factory limits getter. A custom factory `maxPolicyRefs` is not automatically a binding-install cap.

## Owning files for the assigned slice

- `src/authorization/helpers/evaluate/constants.ts`
- `src/authorization/helpers/evaluate/types.ts`
- `src/authorization/helpers/evaluate/helpers.ts`
- `src/authorization/helpers/evaluate/index.ts`
- `src/tests/authorization/evaluateFinalReview.test.ts`

Do not edit P02 factory files, P01 schemas, README files, or the freshness/callback logic owned by the other writer.

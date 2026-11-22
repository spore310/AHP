# P03 repair-plan review — REVISE

**Verdict:** REVISE. Do not implement this plan as written.
**Reviewed:** `execution/P03-repair-plan-proposed.terminal.txt` against `execution/P03-review.md`, `src/tests/authorization/evaluateReview.test.ts`, `packets/P03.md`, and accepted P01/P02 contracts.
**Not done:** no code, test, or P04 changes. P03 helper sources were not treated as accepted APIs.

The direction is right: one async pipeline, requests as selectors, host registration plus the P02 compiler as authority, no synchronous allow path, authorization does not import the assignment helper, and `matches` must not compare a route to itself. That is not enough to compose the seven RED regressions with the original A01–A06 semantics.

## What already holds

- `evaluate` request `mandatory: []` must not be a source of restrictions. The RED omission test registers applicability on `installResource`, not on the request.
- Projection must call the same async pipeline. An empty descriptor list is not proof if evaluate is skipped. Installing the named assignment in that fixture is a stronger test, not a weaker denial.
- `decisionTtlMs` must not be `challengeLifetimeSeconds`. Non-finite `validUntil` denies before allow. Binding and external deadlines of 1000 ms still win when the decision TTL is longer.
- Install copies must be frozen. The empty-policies mutation test stays a denial.
- Discover, invoke, and execute are separate. `reveal` is not a grant. The caller is not the executor.
- Final `matches` is synchronous, re-reads live registration, and does not await `FreshnessPort`.

## Required corrections

1. **Do not reuse `maxPolicyRefs` as a registry cap.** It is the accepted policy-reference array budget, default 64. The plan caps resources, bindings, tools, executors, and external invalidations at `POLICY_LIMIT_DEFAULTS.maxPolicyRefs`, which repeats the P02 budget-domain bug and ignores a caller’s validated `maxPolicyRefs`. Use separate P03-local finite caps on the authorizer options, with at-limit and one-over tests. Do not amend P01 `PolicyLimits` for this.

2. **A multi-policy binding is not an implicit OR.** `ScopedPolicyBinding.policies` can hold several refs. The positive path is the selector pair `bindingId` plus `policyRef`, and that exact ref must be a member of that one binding, inside the resource admission. Do not choose the first allowing policy, and do not pair this binding’s actor with another binding’s policy. Other policies in the same array are not extra grants.

3. **Extension handling is own-key, not blanket acceptance.** A compiled extension denies when its registered evaluator id is missing, throws, times out, or does not allow. An unrelated evaluator that returns allow does not accept it. No extension means no extension callback. Permission callbacks stay own-key and use `asyncHookDeadlineMs`, not `decisionTtlMs` or challenge lifetime.

4. **External proof is captured, not borrowed.** The RED expiry test allows a finite presented `validUntil`, then requires `matches` to fail after that time. Copy that finite proof into the frozen decision record at the start of `evaluate`. `matches` reads that record, not the caller object. A later mutation must not extend it. Do not add a verifier the RED fixture does not install; that would turn the current allow into a false failure. Omitted proof when external authority is required still denies.

5. **Missing route registrations deny.** Every origin and target must be installed. A missing target is not an empty mandatory set. A target’s registered mandatory ref still applies when the origin omitted it. `matches` returning false is not a substitute for `evaluate` denying. Teardown and owner lookup use the full resource identity, not `instanceId` alone.

6. **Keep both trusted mandatory sources.** `forSessionType` mandatory refs apply when that admission is installed. The RED fixture never calls it; its `installResource` applicability list is trusted host registration and must still deny. Neither source is `evaluate`’s request array. A selected factory `select()` result remains not a grant.

7. **Do not make `decisionTtlMs` a compile break for the RED fixture.** A named default longer than the 1000 ms fixture deadlines preserves those denials. Add a separate test where a shorter `decisionTtlMs` expires first. Required-at-construction is acceptable only if the seven-test fixture is updated without changing expected effects.

8. **Materializer omission must not skip evaluate.** Run the pipeline first. Materialize descriptors only after allow. A default empty list before evaluate makes the disclosure denial vacuous again.

9. **`BindingResolver.read` stays scoped.** If this authorizer implements that port, `read` requires `BindingQuery` actor, scope, and `grantRevision`. No unscoped list and no manufactured initial user or grant.

## API ownership

| Owner | Keeps | Must not |
| --- | --- | --- |
| Authorization evaluate helpers | Registry, `evaluate`, `matches`, stamps, trusted install | Import `@toolPolicy` assignment helpers or descriptor builders |
| `toolPolicy` assignments | Descriptor materialization after an allow decision | Decide authority or offer a synchronous allow path |
| P02 factory | `forSessionType`, `getPolicy`, admission refs | Be treated as a grant issuer |
| P01 contracts | `SecurityComposition`, `PolicyScopeRules`, limits | Be amended for registry caps or decision TTL |

`LocalDecisionStamp` stays helper-local. P04 remains blocked.

## Tests the execution must add

Keep all seven RED denials and A01–A06 assertions meaningful.

- Selector pair does not authorize a second policy in the same binding, and does not combine two bindings.
- Missing target registration denies; target mandatory survives an origin omission.
- Extension without its own-key evaluator denies; a different evaluator does not accept it.
- Invoke assignment does not disclose; discover `reveal: false` hides; execute requires the executor tuple.
- Mandatory allow with `challenge.required` sets `challengeRequired`; mandatory deny does not become a challenge.
- Permission callback timeout denies.
- Short `decisionTtlMs` expires before binding expiry; the existing 1000 ms binding and proof deadlines still win under a longer TTL.
- Mutating `request.external` after allow does not extend `matches`.
- Same `instanceId` in two domains: teardown of one does not clear the other.
- Tool-registry one-over uses the P03 tool cap, and still succeeds when `maxPolicyRefs` is 1.
- Disclosure fixture installs the named assignment; permission deny still yields no descriptors.

## Documentation drift

`src/authorization/README.md` still contradicts itself about evaluation, as already recorded in `P03-review.md`. Do not update it until the repaired implementation is accepted. This review does not authorize that edit.

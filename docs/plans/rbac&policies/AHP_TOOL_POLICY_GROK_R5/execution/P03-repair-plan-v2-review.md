# P03 repair-plan v2 review — REVISE

**Verdict:** REVISE. Do not execute yet.
**Reviewed:** `execution/P03-repair-plan-v2.md` against `execution/P03-repair-plan-review.md`, `execution/P03-review.md`, and accepted P01/P02 contracts.
**Not done:** no source, test, README, or P04 change. P04 stays blocked.

V2 resolves the previous architecture defects that were fully specified. Six precise gaps remain. They are wording and interface corrections, not a new design.

## Previous findings

| # | Finding | Status |
| --- | --- | --- |
| 1 | `maxPolicyRefs` used as a registry cap | Resolved for resources, bindings, tools, executors, and external invalidations. `ReferenceRegistryCaps` is separate. Remaining: admissions, assignments, and evaluator maps are still uncapped. |
| 2 | Multi-policy binding treated as an OR | Resolved. The positive path is only `bindingId` + `policyRef` inside that one binding. |
| 3 | Blanket extension acceptance | Resolved. The evaluator is registered for the exact policy ref and is not read from extension data. |
| 4 | External proof borrowed from the caller | Resolved for the proof object. Remaining: the rest of the selector is not captured, and target external requirements are not accumulated. |
| 5 | Missing targets skipped | Resolved for missing registration and target mandatory refs. Remaining: `externalAuthority` is still described as one resource. |
| 6 | RED `installResource` mandatory source dropped | Resolved. Compiler mandatory applies only when an admission is linked. The request array is neither source. |
| 7 | Required `decisionTtlMs` breaks the RED fixture | Resolved. Default `60_000` is not challenge lifetime. The 1000 ms fixture deadlines still win. |
| 8 | Materializer can skip `evaluate` | Resolved. Projection awaits `evaluate` and does not emit descriptors before those checks. |
| 9 | Unscoped `BindingResolver.read` | Resolved. This authorizer does not implement that port. |

## Remaining corrections

1. **Tool assignment must carry resource identity.** `installToolAssignment` freezes a contract, policy ref, purpose, and `bindingId`, but not the resource or admission it belongs to. That still allows one installed contract to satisfy any resource that admits the policy. Freeze the resource ref on the assignment. A selector matches only that tuple. `installExecutorAssignment` already has a resource ref; the tool assignment must too.

2. **Accumulate external requirements on every route resource.** Mandatory refs are gathered from origin and targets. `externalAuthority` is still “the resource.” If any installed origin or target requires proof, omitted proof denies. A target requirement is not waived because the origin says none. Captured `validUntil` is the minimum across every required proof deadline and the decision TTL.

3. **Mandatory binding selection must be actor-and-scope exact.** “Its own binding” is ambiguous. For each applicable mandatory ref on a route resource, use only installed bindings whose actor is the actual actor, whose scope is that resource, and whose policies contain that ref. No such binding denies. Any deny among those bindings denies. Do not borrow a binding from another actor, the origin, or the first allow.

4. **Capture the whole selector before any await.** The plan freezes only the external proof. Also freeze actor, operation, `bindingId`, `policyRef`, scope, route, and executor into the decision record before the first callback. Later mutation of the caller object must not change the decision, stamp, or `matches` input.

5. **Cap the remaining registries.** Name which install increments `maxTools` and `maxExecutors`. Add finite caps, with the same default and absolute style, for admissions, tool assignments if they are not `maxTools`, executor assignments if they are not `maxExecutors`, permission evaluators, and extension evaluators. One-over throws. These caps are not `maxPolicyRefs`.

6. **Tie materialization to the authorized tuple.** `AssignmentAuthorization.admitted` has `contractId` and purpose, but not resource, policy ref, or binding id. `matches` checks the actor and route, not that this contract was the one allowed. Each decision, stamp, and admitted entry must carry the same assignment tuple. `projectAssignedDescriptors` emits a descriptor only when an allow decision, a stamp that passes `matches`, and the installed assignment agree on that tuple. `getContract` is lookup, not authority.

## Invoke descriptors

No requirement change. Accepted `POLICY_FACTORY` P4 requires an allowed discovery decision with `reveal=true` before descriptor delivery. An invoke assignment does not disclose, and `reveal` does not grant invocation. The plan’s “invoke does not disclose” matches that contract. Listing materialization stays discover-only. Executor contract delivery is the separate purpose-specific path and still requires the executor tuple; it is not shared discovery output. The RED `purpose: "invoke"` denial remains a permission denial, proved by the callback counter, not by a new invoke-listing rule.

## Not a blocker

Separate P03 caps, the 60-second decision TTL, own-key extension registration, scoped non-implementation of `BindingResolver.read`, and the disclosure fixture installing its named assignment are sufficient as written. No P01 or P02 amendment is required for these six corrections.

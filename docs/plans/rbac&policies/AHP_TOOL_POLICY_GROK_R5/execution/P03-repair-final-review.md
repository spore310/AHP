# P03 repair final review — CHANGES REQUIRED

**Verdict:** CHANGES REQUIRED. Not accepted. P04 stays blocked.
**Inspected:** `src/authorization/helpers/evaluate/helpers.ts`, `types.ts`, `src/toolPolicy/helpers/assignments/helpers.ts`, and `evaluate.test.ts`, `evaluateReview.test.ts`, `evaluateRepair.test.ts`, `assignments.test.ts`.
**Not done:** no test run, no log or hash audit, no code or README edit.

The seven RED denials, A01–A06, and several repair boundaries are implemented and named in tests. A green gate does not cover the gaps below.

## Must-fix

1. **Issued-authorization provenance is process-global.** `issued` is a module-level `WeakSet` (`evaluate/helpers.ts` line 39), shared by every `createReferenceAuthorizer`. `validateAssignments` (line 604) treats any object in that set as issued by the current registry. Two hosts with the same actor, resource, and binding can therefore accept each other's authorization object. The addendum requires authorizer-issued provenance. Move the set inside the authorizer closure. Repro: create two authorizers, install the same resource and binding, `evaluate` on the first, and pass that object to the second `validateAssignments` with the same actor. It must be false.

2. **Executor assignments share the tool-assignment map and cap.** `installExecutorAssignment` (lines 524–528) writes `assignments` and compares `assignments.size` with `maxExecutors`. Tool assignments use the same map and `maxToolAssignments`. An executor install can overwrite a tool assignment with the same key, and tool assignments consume the executor cap. Keep separate maps and counters. Repro: set `maxExecutors: 1`, install one tool assignment, and install an executor assignment. The executor install must not fail because of the tool assignment, and must not replace it.

3. **Mandatory policies skip extension evaluation.** The obligation loop (lines 336–348) checks roles and `requiredPermissions` only. Extension evaluation (lines 349–363) runs only for the positive policy. A mandatory policy with `extension` and no own-key evaluator still allows. Run the same exact-policy evaluator rule for every applicable mandatory policy. Repro: positive policy has no extension; mandatory policy has `extension: { lane: "chat" }` and no `installPolicyExtensionEvaluator`. `evaluate` must deny `missing-evaluator`.

4. **Execute evaluation replaces the caller with the executor.** Lines 283–285 set the binding actor from `executor.actor` whenever the operation is `execute`. The stamp then records that substituted actor, so the caller identity is not retained. The addendum requires both identities captured and the recipient binding evaluated without that substitution. Repro: caller is a user with the invoke binding; executor is a different agent. An execute decision must keep the caller on the captured selector and must not match `matches(stamp, caller)` merely because the executor was copied into `authority.actor`.

## Missing acceptance tests

These are required before acceptance even where the code appears to deny. None are in the four reviewed suites.

- Two actor-and-scope bindings for one mandatory ref, selector omitted: deny `ambiguous-authority`. Explicit selector that denies does not fall back to the other binding.
- Origin `externalAuthority: "none"`, target `required`, only the single `external` shorthand: deny. A target-scoped proof allows, and the earlier of two target deadlines wins. `invalidateExternal` on one captured revision fails `matches`.
- During a deferred permission callback, mutate actor, scope, route, and policy pair. The returned stamp still carries the pre-await values. A second projection item cannot be retargeted by mutating the first request.
- Invalidation overflow sets the latch: a later required-external `evaluate` denies, and an old proof is not removed to become allowed again.
- A copied authorization object fails `validateAssignments`. Revoking the first projection item while the second await is pending yields no descriptors.

## Covered

| Requirement | Evidence |
| --- | --- |
| A01–A06 | Named tests in `evaluate.test.ts` and `assignments.test.ts` |
| RED mandatory omission, mandatory permission, disclosure callback, binding expiry, proof expiry, non-finite proof, mutable policies | `evaluateReview.test.ts` |
| Second policy is not a grant | `evaluateRepair.test.ts` first test |
| Missing target and target mandatory | `evaluateRepair.test.ts` second test |
| Short TTL and proof-object mutation | `evaluateRepair.test.ts` third test |
| Tool cap independent of `maxPolicyRefs` | `evaluateRepair.test.ts` fourth test |
| Cross-domain teardown | `evaluateRepair.test.ts` fifth test |
| Positive extension without its evaluator | `evaluateRepair.test.ts` sixth test |
| Permission timeout | `evaluateRepair.test.ts` seventh test |
| Discover `reveal: false` hides; invoke purpose does not disclose | `assignments.test.ts` and `projectAssignedDescriptors` lines 27–28 |
| One async path; authorization does not import the assignment helper | `projectAssignments` awaits `evaluate`; assignments imports authorization types only |
| No P01/P02 contract edit observed in this review | P03-local caps and stamp types |

## Polish

- `installToolAssignment` always bumps the epoch, including an identical reinstall. Bindings do not. Fail-closed, but not the addendum's idempotent install rule.
- `liveMatches` compares relationship revision only for the origin (lines 287–294). Other resource updates currently rely on the global epoch. Per-target revision capture would match A6 more directly.
- `validateAssignments` checks assignment-key presence, not full stored-tuple equality. Epoch bumps currently close that hole on overwrite.

## Documentation drift

`src/authorization/README.md` line 3 says this module does not evaluate. Line 47 documents `createReferenceAuthorizer` as a reference evaluator. Those claims contradict each other. Do not edit the README in this review. Update it only with the accepted implementation.

# P03 correction final review — CHANGES REQUIRED

**Verdict:** CHANGES REQUIRED. Not accepted. P04 stays blocked.
**Inspected:** evaluate helper/types, assignment materializer, authorization README, and the named authorization/toolPolicy tests including both FinalReview suites.
**Not done:** no test run and no log/hash audit. The handoff says 61 files; the lead's log read says 63. That count is not settled here.

477 tests are not proof of the still-required cases. Several former RED assertions now have source counterparts. The authorization's remaining acceptance tests were not added, and three required behaviors are still absent or incomplete in source.

## Must-fix

1. **Hook deadline is still borrowed.** Construction stores `hookDeadlineMs` at `evaluate/helpers.ts` line 119, but `runCallback` line 454 reads `options.hookDeadlineMs` again. Mutating the options object after construction changes an in-flight deadline. Capture the validated number once. Repro: construct with `60_000`, set `options.hookDeadlineMs = 5`, then evaluate a hanging permission callback. A captured deadline must not deny within 50 ms.

2. **Extension evaluator replacement does not invalidate.** `installPolicyExtensionEvaluator` (lines 589–592) overwrites the same policy key, does not reject a different callback, and does not bump epoch. A pending allow callback can complete after a deny replacement. Reject the conflicting install or invalidate pending and current decisions. Repro: start evaluate against an allow evaluator, replace it with deny before release, and expect deny or `stale`, not allow.

3. **Expiry during a callback is only partial.** Lines 424–429 recheck the positive binding and captured proofs. They do not recheck mandatory binding expiries before allow. A mandatory binding can expire during its callback and the decision can still be allow. Recheck every contributing binding expiry with no await before return. Repro: mandatory binding `expiresAt` is `start + 1000`; the callback advances `now` to `start + 1001` and returns allow. The decision must be deny.

4. **Linked namespace ceilings are ignored.** The admission check only searches `admission.rules.admitted.policies`. A policy admitted only through `admitted.namespaces` is denied even though it is inside the installed ceiling. Include the installed namespace closure, or document and test that namespace admission is intentionally excluded. Repro: `forSessionType` admits the policy only by namespace; evaluate of that exact ref must follow the installed ceiling, not an empty policy list.

5. **Helper-local input limits are missing.** No `inputLimits` option or per-list cap exists for route targets, proofs, mandatory selectors, or projection tools. Map caps do not bound those arrays. Add the authorized default 128 / absolute 1024 limits and at-limit plus one-over tests. This is not `maxPolicyRefs`.

## Authorization item matrix

| Item | Status | Pointer |
| --- | --- | --- |
| Per-host issued provenance | Implemented; cross-host tested; copied object untested | `issued` is inside `createReferenceAuthorizer` (line 116). Test: `rejects an authorization issued by another identically configured host`. No copied-object test. |
| Separate executor storage and full tuple | Implemented for separate maps and JSON tuple equality; identical install untested | `executorAssignments` lines 108 and 576–586. Tests: capacity independence, conflicting assignment, recipient mismatch. |
| Mandatory own callbacks and scope | Permission scope implemented and tested. Extension missing-evaluator tested on the same scope. Target-scope extension callback untested. | `runPermissions(..., obligation.resource)` line 406. Test: `gives a target permission callback the target resource`. |
| Duplicate selectors / no fallback / valid alternative | Duplicate denial implemented. Test combines duplicate selectors with no-fallback and has no successful single alternative. | Lines 356–366. Test: `denies ambiguous mandatory bindings and does not fall back after the chosen path denies`. |
| Caller retained, executor separate | Stamp uses `input.actor` (lines 160–166). Execute allow test does not install an executor assignment or check descriptor delivery. | Test: `retains the caller on a genuinely authorized execute stamp`. Delivery: `A05 caller and executor purposes are separate`. |
| Admission, missing link, scope on route | Direct-policy ceiling, missing admission, and off-route scope are tested. Namespace ceiling is not. | Tests named in the handoff. |
| Purpose bound to tuple | Implemented and tested for invoke authorization relabeled execute. | `assignments/helpers.ts` line 27. Test: `does not disclose an invoke authorization when delivery purpose is execute`. |
| Final currentness before allow | Proof and positive-binding expiry only. Mandatory expiry during callback missing. | Lines 424–429. No during-callback expiry test. |
| Option capture | Deadline not captured. Policy registry reference is captured (`policyRegistry`). | Line 454 versus line 119. |
| Map caps and input limits | Tool one-over tested. Input limits missing. At-limit success for a custom cap is untested. | `evaluateRepair.test.ts`: `uses a tool cap independent of maxPolicyRefs`. |
| Invalidation latch | Later required-external deny is tested. Non-eviction of the retained revision is not asserted. | `latches required external authority when invalidation storage is exhausted`. |
| README contradiction | Missing. Line 3 still says the module does not evaluate; line 47 documents the evaluator. | `src/authorization/README.md`. |
| Two-target earliest deadline and either-proof invalidation | Missing tests. | Origin-versus-target proof test covers omission only. |
| Callback replacement | Missing, and source still overwrites. | Lines 589–592. |
| Projection capture and stale earlier item | Missing. Deferred test mutates only `authRevision` and `policyRef` on one `evaluate`. | `does not let a deferred callback mutation retarget the captured selector`. |
| Copied provenance | Missing test. | `validateAssignments` line 669. |

## Fixture audit

Cross-host and executor-capacity fixtures now install a real contract, binding, and assignment. Those prerequisites are valid. The execute success test still has no executor/implementation assignment; its allow proves the executor binding and caller stamp, not complete execute delivery. A05 covers delivery separately. The ambiguous test does not include a single chosen allowing alternative, so it does not yet separate duplicate rejection from no-fallback. No assertion was found that replaces a denial with an allow-all.

## Documentation drift

`src/authorization/README.md` lines 3–5 say this module does not evaluate and that current behavior is schema export only. Line 47 describes `createReferenceAuthorizer` as a per-host evaluator. Those are contradictory. Do not edit the README in this review.

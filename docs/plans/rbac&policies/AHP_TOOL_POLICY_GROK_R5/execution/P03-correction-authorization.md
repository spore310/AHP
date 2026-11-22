# P03 source-grounded correction authorization

**Status: execute authorized for one writer; candidate NOT ACCEPTED.** No new broad design cycle. Existing accepted v2 + addendum remain the contract. Independent production review and separate regression authoring now provide fresh diagnosis: 15 tests, 11 intended RED failures, 4 passing locks. P04 remains blocked.

## Single owner and scope

w8:p4 owns this correction. The previous P03 production/helper/index/README scope in `P03-repair-authorization.md` remains unchanged. Lead additionally transfers execution ownership of `evaluateFinalReview.test.ts` and `assignmentFinalReview.test.ts` from the now-resolved reviewer assignment. All previous assertions remain binding in meaning; fixture corrections below may strengthen prerequisites, not erase security outcomes. Other focused tests under the two authorized test directories may be added where necessary.

Evidence: `P03-repair-final-review.md`, `P03-repair-lead-findings.md`, `P03-repair-regression-handoff.md`, `P03-repair-regressions.log`, the accepted v2/addendum, and the actual source. No P01/P02 contract/compiler modification without an explicit amendment. No host/session/work/DB change, installs, commit/reset/stash, model switch or P04. Lead retains ledger/handoff/acceptance ownership.

## Required corrections

1. Registry-local issued-record provenance; another identically configured host and copied/fabricated aggregates cannot validate its objects.
2. Independent tool/executor assignment storage and caps. Enforce full immutable tuple identity at installation, projection and final validation; conflicting installs reject and identical installs are idempotent. Do not let a changed map key hide a conflict or silently overwrite route/recipient/executor facts.
3. Every positive and mandatory policy uses its own roles, permission callbacks, extension callback and actual resource scope. Missing/error/timeout/deny fails closed. Preserve exact selected mandatory alternatives; reject duplicate/conflicting selectors and never fallback after the chosen path denies.
4. Keep the original caller actor/connection/auth/delegation captured in the authority stamp and executor identity in its separate fence. Evaluate actual recipient bindings without replacing caller provenance. Valid execution must remain possible and current; wrong executor or changed caller/executor authority denies.
5. Enforce linked admission ceilings, missing admission failure, scope existence/route membership, and every registered target's requirements. Do not turn direct grants without namespaces into default grants or require synthetic roles.
6. Enforce delivery purpose against the actual issued assignment, recipient and executor. Invoke authorization cannot be relabeled execute to disclose. Full canonical contract identity must agree. Whole-projection validation must catch revocation of an earlier item during a later item's await.
7. Final no-await currentness check before returning allow, including binding/proof expiry that occurs during callbacks. Capture authority at the start, not a fresh epoch after each await. Evaluator replacement must reject atomically or invalidate pending/current decisions. Capture option references/deadlines at construction; do not consult later caller mutations.
8. Apply all accepted finite map and per-entry budgets, not just map sizes. Use existing P01 schema budgets for roles, policy refs, identity strings and binding data. For helper-local route/proof/mandatory-selector/projection arrays, explicit finite input limits are authorized (default 128, absolute 1024 per list; separate names, not maxPolicyRefs or map count aliases). They may be exposed through a P03-local `inputLimits` option, without changing P01 PolicyLimits. Validate hookDeadlineMs against existing async hook deadline ceilings and validate finite decision TTL. Capture validated configuration once. Test defaults and custom lower limits.
9. Update actual affected README descriptions/source maps, including the contradictory claim that authorization does not evaluate. Do not claim P03 accepted or privacy/host wiring complete.

## Regression fixture review — do not encode invalid happy paths

The independent tests demonstrate real current failures, but some fixtures lack prerequisites needed by the accepted stricter installer. Strengthen them explicitly:

- Cross-host provenance test must install a real canonical tool and exact assignment on both identically configured hosts before expecting the issuer's aggregate to validate. Keep same-host success and cross-host failure.
- Capacity independence fixture must install real canonical contracts, valid caller/executor bindings and coherent operation/recipient tuples. It currently installs an execute tool record without any binding/contract setup. Preserve independent-cap success and add one-over failure without tuple replacement.
- Genuine execute success must have a complete approved executor/implementation assignment where the corrected API requires it. Keep caller identity assertions and both currentness/changed-context assertions.
- A recipient/binding mismatch may correctly be rejected at installation. Test that rejection explicitly rather than requiring invalid state to install; also keep runtime wrong-recipient projection denial using separately valid registrations.
- Ambiguity/no-fallback fixture currently supplies two conflicting selectors. Split duplicate-selector rejection from a single explicitly chosen denying path, and add a single explicitly chosen valid alternative that succeeds. This distinguishes no-fallback from merely rejecting duplicate input.
- Deferred mutation fixture currently covers authRevision and policy only. Add actor identity, scope/route and later projection-item capture with genuine positive controls.

Any changed fixture must be documented by test name, previous invalid prerequisite and retained security assertion in the handoff. No skipped/deleted test, broad catch that hides setup failures, weakened expected denial, or deny-all control.

## Still-required distinguishing tests

In addition to all existing RED and A01–A06 assertions: two target proof deadlines with earliest expiry; invalidation of either captured proof; binding and proof expiry during a deferred callback; callback replacement during a pending decision; mandatory extension at its target scope; copied and cross-host provenance; valid execute delivery plus wrong executor/purpose denial; conflicting and identical registration; entire projection capture and stale earlier item; at-limit/one-over map and input limits; invalidation latch without eviction; unknown scope/admission and exact ceiling.

## Checks and delivery

Work in small verified slices. Run focused suites and typecheck, then DB-safe full `pnpm validate` with the exact child environment exclusions recorded in regression/baseline logs. Record exit status and all phases. After two failed repair attempts for the same criterion, stop with a minimal reproducer for fresh diagnosis rather than guessing or weakening checks.

Write `execution/P03-correction-handoff.md` and `execution/P03-correction-validate.log`. Map every review/addendum obligation to actual source and test names, including any fixture strengthening. Report actual file/test counts from the log, not memory. Actively notify w8:p2 through `herdr agent prompt`, then stop. No automatic next packet or acceptance. Final independent review remains required.

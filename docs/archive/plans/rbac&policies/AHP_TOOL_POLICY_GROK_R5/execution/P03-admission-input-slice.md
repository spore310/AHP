# P03 admission/input slice — execution authorized

**Status: execute authorized for sole writer w8:p4.** Freshness slice is resolved and internally accepted (`P03-freshness-slice-acceptance.md`). Preserve the lead-strengthened freshness tests. Diagnosis: `P03-admission-input-diagnosis.md`. No P03 acceptance or P04 authorization is implied.

## Intended bounded implementation

Use existing P02 `forSessionType` plus exact `inspect().namespaces[].expanded` at admission installation. Capture the deduplicated direct-plus-expanded policy ceiling immutably. Unknown type/provider/namespace or compiled policy reference fails installation atomically; no partial entry. Do not call `select()` or change P01/P02. Evaluation still requires the exact current binding path; namespace membership alone is not a grant. Preserve separate mandatory refs.

Add P03-local validated/captured `ReferenceInputLimits`: maxRouteTargets, maxProofs, maxMandatorySelectors, maxProjectionTools. Defaults 128, absolute ceiling 1024, positive integers. No alias to maxPolicyRefs or registry sizes. Use existing scoped-binding schemas for their applicable default role/ref/identity limits; do not invent a factory limit getter.

## Integration clarifications

- Check all relevant evaluation **and projection** lists before deep copying, including projection routes and mandatory selectors. Count the single `external` shorthand and `externalProofs` together against maxProofs; splitting across fields cannot evade it.
- Apply route bounds to host-installed resources and assignments as well. Oversized trusted installs throw atomically. Oversized evaluate/project inputs return safe denial/no authorized descriptors, not a partial allow or a forged empty successful projection. The denied path must not deep-copy the same oversized input into a stamp.
- Capture validated input-limit options once; later mutation must not widen them.
- Namespace ceiling construction must not weaken P02's separately validated reference/expansion budgets or flatten resolver output into authority. No namespace-prefix matching.
- Add focused tests in a new `src/tests/authorization/admissionInputReview.test.ts` to keep this slice distinct from freshness tests and existing independent regressions. Owning source maps and changed API documentation may be updated when execution is authorized; the diagnosis's review-only README restriction is not a final delivery prohibition.

## Required distinguishing evidence

Namespace-only policy plus exact binding allows; compiled policy outside the closure denies; namespace membership without binding denies; unbound admission install fails atomically; direct policy/no namespace still works. Namespace resolvers must not be called to build the ceiling.

For each input list: at-limit positive/control, one-over denial before callbacks/copy, invalid constructor limits, and custom lower limits independent of maxPolicyRefs/map caps. Exercise combined proof fields, projection entry points and installer atomicity. Use valid underlying authority so an oversized-input test cannot pass only because authority was already missing.

## Execution ownership and gates

Allowed production: authorization `helpers/evaluate/{constants,types,helpers,index}.ts`, owning authorization index/README, limited to admission closure, input bounds and applicable existing schema validation. Allowed test: new `src/tests/authorization/admissionInputReview.test.ts`. No edits to existing regression/freshness tests, P01 schemas/types/constants, P02 compiler, descriptor helper, or unrelated modules. If existing tests expose a genuine prerequisite conflict, report the exact case before changing them. No DB, dependency/model changes, commit/reset/stash or P04.

Add distinguishing RED tests before production edits. Implement this slice, then run the new suite, all authorization/toolPolicy suites, typecheck and docs:check with documented child DB exclusions. Record actual exits/counts, including failures. Full pnpm validate remains a later final-packet gate; do not call this a completed P03 candidate.

Outputs: `execution/P03-admission-input-handoff.md` and `execution/P03-admission-input-checks.log` (RED and GREEN evidence). After two failed repair attempts on one criterion, stop with a minimal reproducer. Actively notify w8:p2 when done, then stop. Remaining broader distinguishing coverage still requires its own integration step before final review.

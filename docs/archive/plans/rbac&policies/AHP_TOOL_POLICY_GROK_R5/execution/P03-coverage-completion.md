# P03 independent coverage completion

**Test-only execution authorized; production frozen. P03 and admission/input slice not accepted.** Freshness slice remains internally accepted. Current input implementation is present but submitted tests do not establish all required boundaries. Lead inspected helper sections, constants, all five new tests and the actual checks log. The final typecheck passed after three failed typecheck invocations; the next test run must cover the actual final file version.

## Owner / scope

w8:p3 owns this bounded test-only assignment. w8:p4 is paused. Allowed writes:

- `src/tests/authorization/admissionInputReview.test.ts` (strengthen existing five tests and add distinguishing limit cases).
- New `src/tests/authorization/completionReview.test.ts`.
- New `src/tests/toolPolicy/assignmentCompletionReview.test.ts`.
- `execution/P03-coverage-completion-handoff.md` and `execution/P03-coverage-completion-checks.log`.

No production, other existing test, README, P01/P02, ledger or orchestrator-handoff edits. No DB/dependency/model changes, commits or P04. Reuse local fixture helpers where sensible; do not create an unrelated test framework. If production fails an assertion, preserve the RED and report; do not fix code or weaken the assertion.

## A. Make input/admission tests distinguishing

Current problems to correct:

- Outside-namespace denial also has an unsatisfied mandatory rule; remove that confound or supply its valid exact binding.
- Unknown-admission atomicity test uses a binding for a different incarnation; use matching actor/scope authority so missing admission is the only denial reason.
- The `blocked` callback counter is unused by the tested policy. Attach the permission requirement and prove the valid control invokes it before relying on zero calls for early rejection.
- Combined proof test supplies duplicate proofs for one resource, already invalid without limits. Use two distinct registered required resources, separately valid proofs, and compare an at-limit allow with one-over `invalid-input` denial.
- Projection overage has no registered canonical tools or assignments. Build valid at-limit descriptor delivery first, then one extra otherwise-valid item.
- Mandatory-selector limit is not tested at all. Use exact valid mandatory bindings and unique selectors.
- A two-target route is not evidence of the 128 default boundary.

For all four limits, add a genuine at-limit valid control and one-over rejection with custom lower limits. Exercise evaluate and projection routes/proofs/selectors as applicable, resource/tool/executor installer route rejection with atomic unchanged state, and count single `external` plus `externalProofs` together. Test invalid construction values (zero, negative, fractional, NaN, Infinity, above1024), captured options after mutation, and default128/absolute1024 constants or meaningful boundary runs. Preserve independent maxPolicyRefs/map budgets.

To prove rejection before copying/callbacks, use a bounded observable fixture where possible; do not use giant allocations, sleeps, or arbitrary prototype traps. A valid callback counter plus exact invalid-input denial is preferable to merely asserting empty output from already-invalid authority.

## B. Finish previously mandatory coverage

Add focused tests with positive controls for:

1. Two required target proofs: earliest deadline wins; invalidating either captured revision fails currentness; mutable caller proofs cannot extend validity.
2. Proof expiry during a deferred callback denies before allow (positive and mandatory binding expiry now have freshness tests; do not duplicate unnecessarily).
3. Mandatory extension receives the actual target scope and its own exact-policy evaluator; unrelated evaluator allow cannot satisfy it.
4. Mandatory ambiguity: omitted selector denies; one explicitly chosen valid alternative allows; one explicitly chosen denied alternative denies without fallback; duplicate/conflicting selectors are a separate test.
5. Copied authorization object fails provenance, while original same-host object validates; cross-host case already exists.
6. Whole-selector and whole-projection capture: mutate actor identity, scope, route, positive pair and later projection item during a controlled await; result remains tied to the captured valid originals, not deny-all or retargeted authority.
7. Revoke/teardown the first projection item's resource while a later item's permission callback is pending. Final materialization yields no descriptors, with a successful unrevoked control. Use existing public APIs and valid registered routes.
8. Complete execute delivery succeeds only for exact registered executor identity/generation/registration, implementation, resource/route, recipient and contract. Wrong or missing executor/implementation and relabeled purpose cannot deliver. Retain caller identity and subsequent currentness checks. Merely evaluating an executor binding without an installed implementation is not a complete delivery control.
9. Identical registry installs retain currentness and consume no additional slot where the accepted contract promises idempotence; conflicting installs reject without replacing prior authority. At-limit/one-over map controls as relevant to uncovered registries.
10. Invalidation overflow remains latched and cannot make a retained revoked proof usable. Existing later-fresh-proof denial alone does not prove the non-eviction requirement.

Do not infer a missing API or add production seams solely for tests. If a required behavior cannot be expressed through the accepted current public surface, report the exact missing seam and contract evidence.

## Checks / handoff

Run the owned suites and then all authorization/toolPolicy tests plus typecheck in the documented DB-safe child environment. Capture final exact exits and counts, including intended security failures separately from setup failures. No test is skipped or weakened to make a green gate. Do not run a full final release gate while known RED assertions remain.

The handoff must map every item above to an actual test name, or explicitly state the precise unresolved reason. Report final source unchanged. Actively notify w8:p2 with report/log paths, then stop. This is evidence completion, not acceptance or another broad production repair assignment.

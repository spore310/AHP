# P02 review — RESOLVED / PASS

Final disposition: P02-R1–R7 resolved; see `P02-handoff.md` and final 440-test gate. Historical failed candidates and diagnostic evidence remain below.

Candidate: base + accepted P01 + submitted P02. Worker gate passed 427 tests; review tests below expose missing cases. P03 remains blocked.

## Reproduced by orchestrator

`pnpm exec vitest run src/tests/toolPolicy/factoryReview.test.ts`: exit 1, 3 failed.

- P02-R1 (P1 correctness): `select` initializes alternatives empty when any namespace is admitted. An explicitly admitted direct policy disappears when an unrelated namespace returns []. Direct and namespace modes must compose; keep direct refs independently and deduplicate namespace selections into them.
- P02-R2 (P1 safe failures): resolver output `{get id(){throw secret}, revision:1}` is read directly after callback settlement. `select` rejects with the original secret-bearing error rather than safe `resolver-output` and invokes the getter. Validate bounded plain exact-reference data without executing accessors before capture; catch malformed output failures and preserve private diagnostics.
- P02-R3 (P2 immutability): `defineToolPolicyNamespace` returns a mutable wrapper, policies array, include array and include refs. Freeze the detached declaration, not caller objects. The factory later capturing it does not meet the helper's declared immutable capture contract.

`pnpm exec vitest run src/tests/toolPolicy/portableImports.test.ts`: exit 1. P02-R4 (P1 portability): eager `node:util` import is reachable from neutral `@toolPolicy`. Replace it with a small portable structural equality for captured plain bounded data; no package/new runtime dependency.

## Source contract issue

P02-R5 (P2): `getPolicy` and `inspect().policies` return `ToolExecutionPolicyBase` that hides captured domain extension data. Typed domain evaluators must be able to consume the exact validated captured extension without unsafe casts. Use a clearly named compiled-policy contract with optional unknown extension (or an equivalent accurate existing generic surface); add a typed consumer and runtime detached-extension test. No second policy authority or mutation of frozen P01 types is needed. Namespace declaration capture must not silently erase consumer extension types.

## Bounded expansion review

P02-R6 (P1, source-proven complexity): independent worker `w8:p4` confirmed path-stack DFS re-enters every diamond/repeated include; the unique-policy cap is checked only after recursive array spreading. Construction also repeats expansion for every node without shared memo. An 11-node chain with each next include repeated 8 times performs approximately 8^10 paths despite only 11 unique policies and valid count/depth budgets. This harmful baseline was not executed.

Use one bounded factory-level memo per exact namespace and depth (or equivalent closure plus correctly checked maximum descendant depth), check the current gray/cycle stack before memo reuse, and incrementally merge into a bounded deduplicated set without raw path-array spreading. Preserve include-depth semantics when reusing closures. Add shared-DAG/repeated-edge and deeper-path memo regressions after correcting the algorithm; do not run a known exponential graph on the old code.

## Repair 1 recheck

R1–R6 corrections are present and their review regressions pass. Expansion has a shared depth-keyed memo, gray-stack check and incremental unique merge. Lead strengthened the memo regression by ordering registrations `[child, mid, root]` so shallower memo entries actually exist before deeper reuse.

Three new counterexamples expose one budget-domain conflation (lead focused run exit 1; 6 pass / 3 fail):

- `maxPolicyRefs: 1` rejects a resolver returning exactly one valid ref because plain-data key counting also counts its id/revision fields.
- `extensionDepth/Keys/Bytes: 1` rejects an otherwise valid ordinary operation rule with no extension.
- Two actor branches containing the allowed 32 role strings each fail compilation because all operation fields/roles are mistakenly counted against the extension's 32-key ceiling.

P02-R7 (P2 correctness): separate structurally bounded operation data and exact-ref output budgets from extension-only arbitrary data budgets. Reuse accepted reference/operation schemas; any plain-data precheck for refs must account for the fixed object fields, depth and maximum encoded ID size, not redefine maxPolicyRefs as total JSON keys. Preserve getter rejection and early finite bounds. Add at-limit/one-over tests.

Typed integration check: direct inline definitions with extension need to be accepted by factory options as well as returned from compiled lookup; use the existing local compiled-policy optional-unknown extension shape for that surface. Optional declaration capture budget may be a P02-local overload/argument if needed for above-default valid settings; record exact API addition.

## Independent diagnosis after repair 2

Orchestrator reproduced one remaining R7 failure with all seven operations, both actor anyOf arrays and requiredPermissions each at maxRoles. `operationPlainLimits` omitted requiredPermissions and undercounted structural keys. Command `pnpm exec vitest run src/tests/toolPolicy/factoryReview.test.ts -t 'accepts every operation'`: exit 1 (one failed; other tests intentionally not selected).

Fresh read-only diagnosis by `w8:p4` confirmed the hand-maintained counter duplicates and diverges from the already bounded operation schema. Installed Zod object/array parsing produces detached plain data for these structural fields. Narrow correction: remove the guessed operation-tree counter and freeze a clone of parsed operations; keep separate validation/capture for unknown extension. No limit is lowered or authorization relaxed: strict operation keys, finite role/permission counts, actor enums and string lengths remain enforced by the single schema. Assigned to diagnostic worker; no broad redesign.

## Acceptance

Keep all original assertions. Add narrow distinguishing regressions, rerun focused and full DB-safe validation, inspect actual candidate. P03 is not authorized until review resolves. No feature-completion or shared-host safety claim follows from P02 alone.

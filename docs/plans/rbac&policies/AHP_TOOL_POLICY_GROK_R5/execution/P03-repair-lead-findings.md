# P03 repair candidate — lead verification and additional findings

**CHANGES REQUIRED.** Applies to candidate manifest `P03-repair-candidate.sha256` (`46d6201c30f325bad79047c12a3babea75a6d80cf324ccce08b19f7afdb9940d`). Independent review: `P03-repair-final-review.md`. Lead read the actual evaluate helper/types and assignment materializer after that review resolved. No new runtime reproduction is claimed in this document.

## Confirmed independent findings

- Module-level `issued` WeakSet crosses authorizer ownership. A concrete cross-host test must pass a genuine `projectAssignments` result from host A to identically configured host B's `validateAssignments`; a plain `evaluate` result is not the expected aggregate shape.
- Tool and executor installation share `assignments`; capacities interfere, and common keys overwrite each other. Independent maps/counts are required.
- Mandatory policy loop omits extension callbacks. All applicable rules must use their own exact-policy callback, not just the positive rule.
- Execute substitutes executor actor **and connection** into the authority stamp while retaining caller auth/delegation fields. Evaluating the executor's recipient binding is correct; losing the original caller identity is not. Valid execution must retain caller context and executor fence separately. `matches(stamp, originalCaller)` should pass for an otherwise current genuinely authorized execution, and fail after caller or executor authority changes. Do not repair this by denying all execute operations.

## Additional source-backed gaps to reproduce

### 1. Descriptor-purpose escalation

`toolPolicy/helpers/assignments/helpers.ts: projectAssignedDescriptors` uses its separate `purpose` argument to decide visibility, without checking that each tuple/decision was authorized for that purpose. Passing `execute` with a genuine invoke authorization can expose a descriptor without an executor assignment. Bind requested delivery purpose, recipient and exact executor to the authorization; canonical contract lookup alone does not authorize delivery.

### 2. Admission ceilings and missing evaluation scope

`evaluateSnapshot` reads compiled rules but never verifies the positive ref against an installed admission's admitted set. `installResource` also permits an uninstalled admission link; `obligationsFor` silently treats it as no compiler mandatory rules.

The scope need not exist or occur on the route: only `routeResources(snapshot.route)` is resolved, and the route comparison applies only if one of those resources happens to equal scope. A binding for a different or unregistered scope can therefore use a known route's constraints. Evaluate must fail closed for unknown/unrelated scope and unknown linked admission, and enforce the installed ceiling when linked. Preserve explicit direct-grant/no-namespace support.

### 3. Mandatory permission evaluator receives the wrong resource

The obligation loop calls `runPermissions(snapshot, actor, ...)`; that helper always supplies `scope: snapshot.scope`. A target's evaluator thus sees the origin scope rather than the obligation resource. Test with an evaluator that allows origin and denies target, plus exact actor/scope bindings and a complete registered route. Target checks must use the target resource. Mandatory extensions must also receive their own obligation scope.

### 4. Assignment tuple is stored but not enforced

`installToolAssignment` blindly captures the record. Projection searches only contract id, binding id, policy ref, operation and resource; it ignores installed route, recipient, executor and implementation. `validateAssignments` checks key presence instead of exact current tuple equality. The key omits revision, recipient, route and executor. The typed tuple is not evidence that runtime matching enforces it.

Tests must distinguish valid registered tuples from wrong recipient/route/executor/implementation and conflicting installs. Enforce the already-approved full tuple and reject conflicting registration; do not simply add unused fields.

### 5. Final freshness and evaluator replacement

`evaluateSnapshot` issues an allow stamp after callback completion without running `liveMatches` or equivalent final full currentness check. Expiring binding/proof during a callback can yield `effect: allow` with an already-expired stamp. The plan requires evaluation to deny and later consumers to check again immediately before admission.

`installPolicyExtensionEvaluator` can overwrite a callback without advancing epoch/revision. A pending old callback can return allow after a deny replacement. Conflicting replacement must either be rejected atomically or invalidate pending/current results. Capture initial authority state across the whole evaluation, not a fresh epoch after each await.

### 6. Remaining explicit acceptance requirements

The independent report's missing tests still stand: mandatory ambiguity/exact selection/no fallback; every target proof/deadline/invalidation; whole-selector and entire projection capture before awaits; invalidation-overflow latch; copied and cross-host provenance; stale first projection item during second item's await.

Also exercise idempotent versus conflicting registration and finite per-entry/deadline validation. Current map caps alone do not bound arbitrary role/policy/route/proof/selector arrays. Duplicate mandatory selectors are selected using `.find` rather than rejected as required. Options are still consulted through the mutable `options` object; snapshot configured callback/deadline/policy references as planned.

## Next bounded step

Independent regression authoring only, while production remains frozen. Add new focused test files, preserve all existing tests, run only those suites, and report which tests fail for the intended reason versus setup errors. Real positive controls are mandatory. No implementation, shared API redesign, or P04. After reviewing that evidence, lead will authorize a single production writer for concrete corrections against the existing approved plan.

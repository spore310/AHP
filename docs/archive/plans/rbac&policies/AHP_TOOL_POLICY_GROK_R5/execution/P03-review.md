# P03 review — REVISE DESIGN / CHANGES REQUIRED

Candidate: base + accepted P01/P02 + submitted P03. Original 448-test gate passes but does not establish the required security invariants. P04 is blocked. This is a contract/ownership failure, not a request to patch individual assertions until green.

## Reproduced findings (all P1)

Orchestrator ran `pnpm exec vitest run src/tests/authorization/evaluateReview.test.ts`: exit 1, all seven tests failed.

1. Registered mandatory rules can be omitted: `evaluateSync` loops over request `input.mandatory`, not authoritative `resource.mandatory`. Passing [] bypasses provider denial.
2. Mandatory rules' requiredPermissions are never evaluated. Only the positive grant rule's permission callbacks run.
3. `projectAssignments` calls `evaluateSync`, which merely checks callback existence; a permission evaluator returning deny still yields a disclosed descriptor. Projection must use the same complete authorization pipeline.
4. A decision stamp remains valid after its contributing binding expires: stamp lifetime is arbitrarily now + challengeLifetimeSeconds.
5. The same stamp outlives required external proof expiry.
6. NaN/Infinity external validUntil are accepted; finite validity is not enforced.
7. `installBinding` retains caller-owned arrays; later mutation grants access without installation or revision bump.

Tests are in `src/tests/authorization/evaluateReview.test.ts`. All existing assertions must remain meaningful; switching projection to async may require awaiting existing tests but not weakening expected denials.

## Additional source-backed design gaps

- No authoritative resource/tool admission ceiling: RegisteredResource has no admitted policies/tool references/type+provider manifest; `EvaluateAccessInput.policyRef` and projection's `{contractId,policyRef,bindingId}` are caller choices. Any matching policy grant can be paired with any globally installed contract. P02 factory selection/admission is explicitly ignored. A policy grant alone is not an exact tool assignment.
- Only one scope record is inspected. Origin and every target's registered mandatory rules/provider/external requirements are not resolved and composed; a route's equality is not authority over its targets.
- Invocation disclosure uses invoke rule.reveal, not independent discover/reveal plus invoke assignment. Mandatory reveal/challenges are not correctly combined in projection; projected challengeRequired is hardcoded false.
- `executorKey` omits domain/subject/agent ID and only stores implementation ID without enforcing it against a selected exact contract. `installExecutor` is not enough to prove an executor is assigned the requested contract/resource/purpose. Direct evaluate(execute) substitutes executor actor for caller and then freshness compares to caller context, conflating the two identities.
- `matches` compares the route to itself, not current registered route. Current context/stamp inputs and result stamps are mutable borrowed objects. `installResource` shallow-copies nested owner/route/rules; owner() returns stored identity directly. Full snapshot capture and revision ownership are missing.
- owner/teardown are keyed only by instanceId across domains/resources. Accepted contract requires full instance identity; stale cross-domain cleanup must not touch another resource.
- tools/executors/external invalidations are unbounded; installTool overwrites by id without revision invalidation. Permission evaluator object lookup does not require own-key registration; mutable options are not captured. Domain extensions have no registered evaluator/validator path. Missing required evaluator must fail closed, not ignore extension data.
- Kernel imports toolPolicy assignment projector at runtime while toolPolicy schema helpers import authorization root, creating an avoidable reciprocal dependency. Keep authorization owning authority and toolPolicy owning descriptor assignment/projection; compose via narrow ports rather than a second unchecked synchronous path.

## Required revised plan before implementation

Propose a small coherent P03 design using existing P01/P02 contracts and helper-local additions. Required outcomes:

1. Authoritative immutable resource/type/provider admissions and exact canonical tool/implementation assignments installed by trusted host; requests are selectors only. No default binding, scope or tool admission.
2. Resolve the complete registered origin/target route and independently gather all mandatory restrictions. Derive mandatory refs from registries/compiler, never request omissions. One complete positive binding path remains intact; mandatory constraints do not synthesize grants.
3. One async evaluation path for permission/domain callbacks and projection; no synchronous allow shortcut. Projection may be async. Purpose-specific discover/invoke/execute checks, challenge/reveal accumulation, safe descriptor materialization.
4. Bounded immutable state and exact executor/resource keys. Validate/capture registration data; enforce explicit revisions and reject conflicting replacement. Requests/decision snapshots must not mutate across awaits.
5. Decision expiry is minimum of all relevant binding/external deadlines plus explicit decision TTL (not challenge lifetime by accident). Final synchronous admission verifies the actual captured context/route/executor/current revisions/expiry with no await. Error/timeout/missing evaluator/invalid result denies safely.
6. Clear dependency direction. No P01/P02 rewrite without exact amendment request; rejected P03 helper-local APIs may change now. Do not defer these P03 acceptance requirements to P06/P10.

Add regressions for each gap plus seven existing RED tests. An independent plan review will check the revised architecture before writer proceeds. No DB, host/session/work changes, children, model switches or production feature-completion claims.

## Documentation drift (within approved implementation docs)

`src/authorization/README.md` still says schema/type exports only and no evaluation although this patch adds an evaluator; later section contradicts it. New README claims about bounded/fresh authority are unsupported by current implementation. Update only affected module docs with the eventual accepted behavior. Do not mark P03 verified based on historical gate counts.

# P03 worker handoff

**Verdict:** IMPLEMENTED. Acceptance remains with w8:p2.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus accepted P01/P02 files and this P03 patch. No commit. No P01 type/schema edit. No P02 compiler edit.
**API:** `createReferenceAuthorizer({ policies, now, permissionEvaluators? })`.

Host administration, not issuance: `installResource`, `installBinding`, `installTool`, `installExecutor`, `teardown`, `invalidateExternal`. `owner(instanceId)` is unchanged by a binding. A second owner for the same resource throws.

`evaluate` requires one binding whose actor, full scope ref, and policy ref match together, plus every applicable mandatory rule. Compiler selection is not consulted and is not a grant. Direct-grant mode does not need a role. Empty role branches deny. `requiredPermissions` call registered evaluators and are not role labels. Missing evaluator, expired binding, expired or invalidated external proof, and a post-await epoch/revision mismatch deny. Deny codes: `missing-authority`, `expired`, `mandatory-deny`, `missing-evaluator`, `external-expired`, `external-invalidated`, `stale`, `evaluator-failed`.

`projectAssignments` is synchronous and ignores `harnessName`. Descriptors come only from installed contracts through `toAhpToolDefinition`. `reveal: true` does not disclose without an allow. Execute disclosure requires an approved executor record, not the caller identity.

`matches(stamp, actor)` is synchronous and does not call `FreshnessPort`. It compares actor, auth revision, connection, delegation, generation, grant revision, epoch, `validUntil` against `now`, and external invalidation. The stamp also stores the full route. Local `validUntil` is `now + challengeLifetimeSeconds`. No P01 amendment: the envelope is `LocalDecisionStamp`.

## Coverage

| ID | Test | Result |
| --- | --- | --- |
| A01 | `A01 no authority is the default` | passed |
| A02 | `A02 valid scope-specific grant plus all constraints` | passed |
| A03 | `A03 no grant-fragment synthesis` | passed |
| A04 | `A04 reveal never grants authority` | passed |
| A05 | `A05 caller and executor purposes are separate` | passed |
| A06 | `A06 reusable harness does not share authority` | passed |

Additional passed tests: `denies a replaced binding after an evaluator await`; `denies the same instance in another domain and an expired external proof`.

RED before implementation: `createReferenceAuthorizer is not a function`. One rule-path repair (`actors.user`, not `actor.user`) then green.

## Commands

Repository root. Integration DB variables unset. No live query.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run src/tests/authorization/evaluate.test.ts src/tests/toolPolicy/assignments.test.ts` | 0 | 2 files, 8 tests passed |
| `pnpm validate` | 0 | lint, typecheck, 58 files / 448 tests, docs:check 151, vite build. Log: `execution/P03-worker-validate.log` |

**Invariants:** installation is not P06 issuance. Owner remains separate from scoped roles. One exact binding path plus applicable mandatory rules. Explicit deny wins. External freshness is finite and locally invalidated, not advisory. Final admission does not await. P04 not started.

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.

# P03 repair handoff

**Status:** candidate for independent review. Not accepted. P04 is blocked.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus accepted P01/P02 files and this P03 repair. No commit. No P01 or P02 amendment.

## API

`createReferenceAuthorizer` in `src/authorization/helpers/evaluate/helpers.ts`. Registry caps are `DEFAULT_REFERENCE_CAPS` / `ReferenceRegistryCaps`, not `maxPolicyRefs`. `decisionTtlMs` defaults to `DEFAULT_DECISION_TTL_MS` (60_000). Permission and extension callbacks use `hookDeadlineMs` or `asyncHookDeadlineMs`.

Positive authority is the selector pair `bindingId` + `policyRef` on one binding. Request `mandatory` is ignored. Host `installResource.mandatory` and, when linked, `forSessionType` mandatory refs both apply. Every origin and target must be installed. External proofs are copied in-process adapter facts. `matches` re-reads live registration and does not call `FreshnessPort`.

`projectAssignments` awaits `evaluate` and returns frozen decisions and stamps. `projectAssignedDescriptors` in `src/toolPolicy/helpers/assignments/helpers.ts` calls `validateAssignments` and `toAhpToolDefinition`. Authorization does not import that helper.

## Tests

| ID | Test | Result |
| --- | --- | --- |
| A01 | `A01 no authority is the default` | passed |
| A02 | `A02 valid scope-specific grant plus all constraints` | passed |
| A03 | `A03 no grant-fragment synthesis` | passed |
| A04 | `A04 reveal never grants authority` | passed |
| A05 | `A05 caller and executor purposes are separate` | passed |
| A06 | `A06 reusable harness does not share authority` | passed |
| RED | seven tests in `evaluateReview.test.ts` | passed, including a real pre-expiry allow and a disclosure callback that ran |
| Repair | `evaluateRepair.test.ts` | passed: second policy is not a grant, missing target, target mandatory, short TTL, proof mutation, tool cap with `maxPolicyRefs: 1`, cross-domain teardown, missing extension evaluator, permission timeout |

## Gate

Repository root. Integration DB variables unset. No live query.

`pnpm validate` exit 0: lint, typecheck, 59 files / 462 tests, docs:check 152, vite build. Log: `execution/P03-repair-validate.log`.

## Limits

Invalidation overflow latches required-external decisions unavailable and does not evict old proofs. Identical binding installs do not bump revision; conflicting replacement throws. This candidate is not a shared-host privacy release.

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.

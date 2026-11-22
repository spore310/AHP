# P02 final narrow correction

**Verdict:** IMPLEMENTED. Acceptance remains with w8:p2.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus the existing P02 patch and this correction. No commit.
**Changed:** `src/toolPolicy/helpers/factory/helpers.ts` only. No test edit. No P01 or shared API change.

## Diff

Removed `OPERATION_TREE_DEPTH`, `operationPlainLimits`, and the unused `DIRECT_GRANT_ACTOR_KINDS` / `TOOL_OPERATIONS` import. `capturePolicy` now freezes `clonePlain(parsed.data.operations)` after schema acceptance. Unknown `extension` still goes through `detachPlain` and `extensionPlainLimits`. No second operation-tree counter and no raised guessed budget.

Operation bounds remain the parsed schema: strict operation keys, `maxRoles` on `anyOf` and `requiredPermissions`, and role-string limits.

## Commands

Repository root. Integration DB variables unset. No live query.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run src/tests/toolPolicy/factoryReview.test.ts -t "accepts every operation with its full configured role and permission arrays"` | 0 | 1 passed, 11 skipped |
| `pnpm exec vitest run src/tests/toolPolicy` | 0 | 3 files, 19 tests passed |
| `pnpm validate` | 0 | lint, typecheck, 56 files / 440 tests, docs:check 136, vite build. Log: `execution/P02-final-correction-validate.log` |

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash. P03 not started.

# P03 freshness slice handoff

**Status:** internal slice only. Not a completed P03 candidate. Not accepted. P04 is blocked.
**Changed:** `src/authorization/helpers/evaluate/helpers.ts`, `src/tests/authorization/freshnessReview.test.ts`, `src/authorization/README.md`.

## RED

`pnpm exec vitest run src/tests/authorization/freshnessReview.test.ts` exit 1 before the production edits. Log: `execution/P03-freshness-slice-red.log`. 4 failed, 1 passed. The borrowed deadline settled within 50 ms, conflicting extension registration did not throw, and a mandatory binding that expired inside its callback still allowed.

## Fixes

- `runCallback` uses the captured `hookDeadlineMs`, not `options.hookDeadlineMs`.
- `installPolicyExtensionEvaluator` treats the same callback as idempotent, including at capacity. A different callback throws `Conflicting extension evaluator.` before any registry or epoch change. A new registration still advances epoch.
- Before allow, every contributing binding in `bindingExpiries` is rechecked with `bindingExpired`. No await sits between that check and the allow return.

## GREEN

DB variables unset. No live query. Log: `execution/P03-freshness-slice-checks.log`.

| Command | Exit | Result |
| --- | --- | --- |
| freshness suite | 0 | 5 passed |
| `src/tests/authorization` and `src/tests/toolPolicy` | 0 | 75 passed |
| `tsc --noEmit` | 0 | no errors |

Full `pnpm validate` was not run. This slice does not close the remaining P03 review obligations.

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.

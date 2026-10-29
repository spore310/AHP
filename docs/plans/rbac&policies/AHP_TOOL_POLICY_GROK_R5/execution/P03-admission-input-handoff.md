# P03 admission/input slice handoff

**Status:** internal slice only. Not a completed P03 candidate. Not accepted. P04 is blocked.
**Changed:** `src/authorization/helpers/evaluate/{constants,types,helpers,index}.ts`, `src/authorization/index.ts`, `src/authorization/README.md`, new `src/tests/authorization/admissionInputReview.test.ts`.
**Untouched:** freshness logic, existing regression tests, P01 schemas, P02 compiler, descriptor helper.

## RED

`pnpm exec vitest run src/tests/authorization/admissionInputReview.test.ts` exit 1 before production edits. Log: `execution/P03-admission-input-red.log`. 3 failed, 2 passed. Namespace-only evaluation denied. Invalid input limits did not throw. An oversized route denied with the wrong code.

## Fixes

- `installAdmission` freezes direct refs plus `inspect().namespaces[].expanded` for the admitted namespaces. Unknown type/provider, unknown namespace, or unknown compiled policy throws before the map is updated. `select()` is not called.
- Evaluation accepts a selector only when it is in that frozen ceiling and the exact binding matches. Namespace membership alone is not a grant. A direct grant with no admission link is unchanged.
- `ReferenceInputLimits` is captured once. Defaults are 128. The absolute ceiling is 1024. These are not `maxPolicyRefs` or registry caps.
- Route, combined `external` plus `externalProofs`, mandatory selectors, and projection tools are counted before copy. Oversized evaluate and project results deny as `invalid-input` with an empty rejected route. Oversized installs throw and store nothing.
- Binding installation reuses `scopedPolicyBindingSchema`.

## GREEN

DB variables unset. No live query. Log: `execution/P03-admission-input-checks.log`.

| Command | Exit | Result |
| --- | --- | --- |
| new suite | 0 | 5 passed |
| authorization and toolPolicy | 0 | 80 passed |
| `tsc --noEmit` | 0 | no errors after the stamp-shape repair |
| `docs:check` | 0 | completed |

The first typecheck in that log failed on the rejected stamp shape. The final `tsc --noEmit` is exit 0. Full `pnpm validate` was not run.

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.

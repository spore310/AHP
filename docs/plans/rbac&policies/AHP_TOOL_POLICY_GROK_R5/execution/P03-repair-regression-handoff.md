# P03 regression authoring handoff

**Status:** tests authored. Production was not changed. Not an acceptance verdict. P04 remains blocked.
**Owned files:** `src/tests/authorization/evaluateFinalReview.test.ts`, `src/tests/toolPolicy/assignmentFinalReview.test.ts`, this handoff, and `execution/P03-repair-regressions.log`.

## Command

Repository root. Integration DB variables removed. No live query.

```sh
pnpm exec vitest run src/tests/authorization/evaluateFinalReview.test.ts src/tests/toolPolicy/assignmentFinalReview.test.ts
```

Exit 1. 2 files, 15 tests: 11 failed, 4 passed, none skipped. No import or type failure.

## Intended RED failures

| Test | Observed |
| --- | --- |
| rejects an authorization issued by another identically configured host | Allow control passed. Other host `validateAssignments` returned true. |
| keeps executor assignment capacity independent of tool assignments | `Authorization executor limit exceeded` after one tool assignment. |
| denies a mandatory policy whose own extension evaluator is missing | Decision was allow, not `missing-evaluator`. |
| retains the caller on a genuinely authorized execute stamp | Execute allow control passed. `authority.actor` was the agent executor, not the user caller. |
| denies a positive policy outside the linked admission ceiling | Effect was allow. |
| denies an uninstalled admission link | Effect was allow. |
| denies a binding scope that is not on the registered route | Effect was allow. |
| gives a target permission callback the target resource | Effect was allow. |
| does not disclose an invoke authorization when delivery purpose is execute | Discover control returned one descriptor. Execute delivery of the invoke authorization returned `read_file`. |
| rejects a conflicting assignment instead of overwriting the installed tuple | Second install did not throw. |
| does not disclose an assignment whose recipient does not match the caller | Matching-recipient control returned one descriptor. Bob's assignment was disclosed to Ada. |

## Passing locks

- Origin shorthand does not satisfy a required target, and a target-scoped proof allows.
- Ambiguous mandatory bindings deny, and the chosen deny path does not fall back.
- A deferred callback mutation does not retarget the captured selector.
- Invalidation overflow throws and a later required-external evaluate denies.

## Not encoded

Per-entry role, policy, route, and proof array ceilings were not given a concrete public limit separate from map caps. Those cases are omitted rather than guessed.

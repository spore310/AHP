# P01 final narrow correction

**Packet / design revision:** P01-final-narrow-correction. Not a new packet.
**Verdict:** IMPLEMENTED. Focused regression went RED before the patch and GREEN after. Full gate passed.
**Candidate:** `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe`. P01 sources remain untracked, so `git diff` against HEAD is empty. `nul` remains untracked and untouched.
**Owned paths actually changed:** `src/authorization/helpers/validation/helpers.ts`, `src/tests/authorization/contractReview.test.ts`, this handoff, and `execution/P01-final-correction.validate.log`.
**Contract amendments:** none. No clone, no second schema, no P01 API rename, no P02 work.

## Behavior

Ordinary-object capture now rejects a nonenumerable own data descriptor instead of skipping it. Accessors were already rejected. Array extra-name rejection is unchanged. `boundedExtensionSchema` still returns the input only when `capturePlainJson` accepts it, so a nonenumerable `toJSON` function no longer survives a successful parse and cannot be invoked by a later `JSON.stringify`.

Semantic diff in `capturePlainJson`:

```ts
if (descriptor.enumerable !== true) {
  return false;
}
```

Previously this branch used `continue`.

## RED reproducer

Child process had the same integration DB variables removed as P00. Values were not printed.

```sh
pnpm exec vitest run src/tests/authorization/contractReview.test.ts -t "rejects a nonenumerable toJSON function on an ordinary object without invoking it"
```

Exit 1 at 22:24:40. 1 failed, 10 skipped. Assertion: `expected true to be false` at `contractReview.test.ts:140` (`parsed.success`). The object was accepted before the patch.

## GREEN

Same command, same unset child environment. Exit 0 at 22:24:54. 1 passed, 10 skipped.

## Gate

`pnpm validate` in that child. Exit 0.

| Step | Result |
| --- | --- |
| lint | passed; chain continued |
| typecheck | passed; chain continued |
| test | 54 files passed (54); 421 tests passed (421); no skipped count printed |
| docs:check | passed, 130 source files |
| build | passed, 92ms |

Log: `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/P01-final-correction.validate.log`.

## Boundaries

No database query, migration, install, upgrade, deploy, or commit. Existing assertions were not weakened. README text was not edited; the earlier toolPolicy README sentence is still broader than this gate. Next eligible work is orchestrator acceptance, not P02.

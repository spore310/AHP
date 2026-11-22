# P03 Sol coverage handoff

**Status: bounded test work verified; NOT P03 acceptance. P04 remains blocked.**

The interrupted w8:p3 coverage assignment was transferred to this pane by the user. Lead w8:p2 retained all production ownership. Sol changed only:

- `src/tests/authorization/admissionInputReview.test.ts` (16 cases)
- `src/tests/authorization/completionReview.test.ts` (12 cases)
- `src/tests/toolPolicy/assignmentCompletionReview.test.ts` (20 cases)
- This handoff and `execution/P03-sol-coverage-checks.log`.

**These three test files are now frozen for lead integration and Luna's later read-only review.** No production, existing independent/freshness test, README, P01/P02, dependency, runtime, or database edits were made by Sol. No children, model switch, install, commit, reset, stash, or P04 work. The untracked plan bundle and `nul` were preserved. HEAD remains `22fa7955b8e43839e041228f647f26e00762ebbe`; the shared worktree is dirty, not a clean baseline.

## Evidence and failure classification

Log: `docs/plans/rbac&policies/AHP_TOOL_POLICY_GROK_R5/execution/P03-sol-coverage-checks.log`.

The interrupted `P03-coverage-completion-checks.log` was read and left unchanged: six runtime failures/nine passes in the owned suites, plus three TS errors. The missing `blocked` evaluator, proof-less projection, fabricated executor caller context, untyped policy helper, and unsafe indexed spreads were fixture/type defects, not reasons to weaken denial assertions. Fixtures now use `CompiledToolPolicy`, registered permission evaluators, real canonical tools/assignments, and the **original caller** for materialization/currentness. Executor fences remain separate.

This new log retains actual intermediate results:

- First rewritten coverage: **38 passed / 2 real RED**, plus seven temporary owned-test TS errors. TS setup errors were repaired in the next iteration.
- RED idempotence cases: identical resource reinstall invalidated a current stamp; identical admission reinstall at cap threw. Lead accepted and fixed both. Their assertions remain intact and now pass.
- Expanded execute regression: empty `implementationId` permitted descriptor delivery. It was reported immediately; lead fixed invalid registration using the existing schema and documented `P03-schema-import-amendment.md`.
- The invalid-implementation tests now explicitly require **registration rejection AND no later descriptor/authorization**, rather than requiring invalid state to be stored. Missing stored fence with a valid implementation remains a projection-denial case. Valid execute controls remain present.
- One intermediate all-suite failure was unowned `evaluate.test.ts` A06: it expected an allow projection without installing assignments. Lead corrected that fixture with exact Ada/Bob assignments, retaining its assertions. Sol did not edit it.
- A concurrent intermediate typecheck saw missing `relationshipRevisions` in lead-owned stamp construction. Final typecheck passes; no production edit was made by Sol.
- A single `-t` diagnostic run filtered unrelated cases (shown as skipped by Vitest). **No test uses `.skip`, weakened assertions, or suppressions; the final full owned/all-suite runs have no skipped tests.**

## Final checks

All commands ran in a child shell with `PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGDATA PGSERVICE PGSSLMODE DATABASE_URL AGENT_HOSTING_PROTOCOL_DATABASE_URL` unset. Values/secrets were not printed and no live DB was accessed.

| Command | Actual final result |
| --- | --- |
| `pnpm exec vitest run src/tests/authorization/admissionInputReview.test.ts src/tests/authorization/completionReview.test.ts src/tests/toolPolicy/assignmentCompletionReview.test.ts` | exit 0; 3 files, **48 passed** |
| `pnpm exec vitest run src/tests/authorization src/tests/toolPolicy` | exit 0; 15 files, **123 passed** |
| `pnpm run typecheck` | exit 0 |
| Owned command with `--reporter verbose` | exit 0; all 48 exact acceptance-case names recorded at the end of the log |

No full release gate or acceptance is claimed. Lead owns the final integrated rerun, documentation mapping, portable-import/contract gates, and independent final review.

## Acceptance mapping — A: input/admission

Below, **A** means `admissionInputReview.test.ts`. Parameterized names are actual expanded Vitest cases in the verbose log.

| Required boundary | Actual test name(s) and distinguishing evidence |
| --- | --- |
| Namespace closure + exact binding; outside compiled policy; no membership-only grant; resolver untouched | A: `allows namespace closure only with an exact binding and never calls the resolver` — inside allow, missing binding/outside ref exact `missing-authority`; resolver count stays zero. No mandatory-denial confound. |
| Unbound installation atomicity with matching authority; direct/no-namespace control | A: `fails unknown admission atomically with matching scope authority and preserves a direct control` — same exact binding/resource allows before linking failed admission, then denies `missing-authority`. |
| Unknown installed closure or compiled ref consumes no slot | A: `unknown-namespace admission installation fails atomically without consuming the cap`; `unknown-policy admission installation fails atomically without consuming the cap` — typed factory read-surface adapter simulates each missing fact, failed install denies, restoring the compiled fact permits installation at cap 1 and evaluation allows. No resolver/select call is introduced. |
| Permission setup is real, missing evaluator remains fail-closed | A: `preserves missing-evaluator denial rather than silently dropping a permission` — exact `missing-evaluator`; all valid limit fixtures register `blocked`, and counters prove the positive path invokes it. |
| Route custom at-limit/one-over; evaluate and projection entry paths | A: `evaluate: route at custom limit allows and one-over rejects before callbacks`; `project: route at custom limit allows and one-over rejects before callbacks` — limit 1 control, descriptor control for projection, limit 2 wider valid route, exact `invalid-input`, rejected stamp has empty targets, callback count unchanged. Mutating options after construction cannot widen the captured limit. |
| Combined shorthand/list proof budget, distinct resources | A: `evaluate: combined shorthand and distinct proof list enforce the captured proof limit`; `project: combined shorthand and distinct proof list enforce the captured proof limit` — origin shorthand plus required left proof allows at 2; adding a distinct registered right proof rejects at 3 before callbacks; a larger-budget host allows the same proof input. No duplicate-proof confound. Options mutation cannot widen it. |
| Mandatory selector budget | A: `evaluate: unique mandatory selectors allow at limit and one-over cannot skip rules`; `project: unique mandatory selectors allow at limit and one-over cannot skip rules` — exact valid bindings, unique selectors, registered obligations, at-limit positive/descriptor controls, exact one-over `invalid-input`, unchanged callback count, larger-budget allow. Mutable constructor option cannot widen it. |
| Projection-tool list | A: `projection tools deliver canonical descriptors at limit and reject one extra valid tuple` — actual canonical tool/assignment at 1 emits a descriptor; a second distinct installed tool rejects with `invalid-input`, no admitted tuples/callbacks; limit 2 emits both. Captured option mutation cannot widen the budget. |
| Resource/tool/executor installer route bounds, mandatory installer bound, atomicity | A: `resource, tool and executor route installers reject one-over atomically and preserve existing authority` — valid discovery and complete execute controls first; rejected resource/mandatory/tool/executor changes leave issued authorization current and both deliveries usable. |
| All constructor limit fields; lower custom/default/absolute bounds | A: `validates each limit independently, captures options, and exposes default128/absolute1024 boundaries` — each of four fields rejects 0, negative, fractional, NaN, Infinity, 1025; each accepts 1024; defaults equal 128. A: `allows 128 route targets by default and rejects target129 before callbacks or copying` adds a meaningful 128-target allow/129 rejection. |
| Binding schema reuse independent of lower factory/map budgets | A: `uses default binding schema budgets independently of a lower factory ref budget` — two policy refs install despite compiler `maxPolicyRefs=1`, malformed role rejects. Common rigs install multiple bindings/tools independently of that compiler ref budget. |

## Acceptance mapping — B: completion items 1–10

**C** = `completionReview.test.ts`; **T** = `assignmentCompletionReview.test.ts`.

| Item | Actual test name(s) and evidence |
| --- | --- |
| B1 two target proofs, minimum deadline, invalidating either, caller-proof mutation | C: `uses the earliest required target proof and invalidates left-proof without borrowing mutable proofs`; same name for `right-proof` — initial allow, `validUntil=start+500`, mutation cannot extend it, each captured revision independently invalidates currentness. |
| B2 proof expiry during deferred callback | C: `denies when a required proof expires during a deferred callback` — same valid request allows before expiry mode; controlled callback then advances clock and returns allow, final result exactly `external-expired`. |
| B3 exact target extension evaluator | C: `sends a mandatory extension evaluator the target scope and ignores an unrelated allow` — unrelated registered allow cannot satisfy missing evaluator (`missing-evaluator`); exact registration receives full target scope/ref/actor and permits the genuine control; unrelated evaluator is never called. |
| B4 mandatory ambiguity / alternatives / no fallback; duplicates separate | C: `allows one explicit mandatory alternative and denies the other without fallback` — omitted selector `ambiguous-authority`, explicit valid path allows, explicit denied path `mandatory-deny`. C: `rejects duplicate and conflicting mandatory selectors separately from ambiguous omission` — positive unique selector first, identical duplicate and conflicting duplicate both `ambiguous-authority`, missing selected binding `mandatory-deny`. |
| B5 copied-object provenance | C: `rejects a copied authorization object while the issued object remains valid` — genuine same-host authorization validates and emits its actual canonical descriptor; copy fails validation and emits none. |
| B6 whole-selector and whole-projection capture | C: `captures the whole selector before a callback instead of retargeting or denying all work`; T: `captures the whole projection and later tuple during a controlled first await` — explicit entered/release gates; mutate identity/auth revision, scope, route, positive pair, first/later tool selection; captured originals still allow and emit both correct descriptors; forged caller fails currentness/materialization. |
| B7 first-item teardown during later await | T: `emits no descriptors when the first resource is torn down while the second callback is pending` — waits for the second callback specifically; first decision allowed but is stale after teardown; second exact `stale`; no descriptors. Unrevoked two-tool control emits two. Public projection input has one shared resource/route, so teardown targets that first item's actual shared resource, not a fabricated per-item scope. |
| B8 complete execute + negative fences/delivery | T: `delivers execute for the exact registered tuple while retaining the original caller currentness`; ten `execute refuses a <field> mismatch instead of borrowing the registered tuple` cases for generation, registration, connection, identity, missing-executor, recipient, contract, resource, route, relabeled-item. Exact negative codes are asserted (`missing-authority` for wrong resource/route/identity or absent executor; `missing-assignment` for tuple/purpose/recipient mismatches). T: `never borrows execute delivery from the ordinary map or discovery delivery from the executor map`; `does not deliver an executor assignment without an approved implementation`; `does not deliver an executor tuple with missing-fence`; `does not deliver an executor tuple with invalid-implementation`; `rejects a stored noncanonical contract identity and proves permission denial invokes its callback`. Invalid/missing implementation throws before storing and subsequent projection has `missing-assignment`/no descriptors; missing fence denies. Changed implementation registration rejects as conflict in executor registry test below. Caller remains original; no fabricated executor context. |
| B9 idempotence/conflicts and finite registries | C: `keeps identical binding/tool/extension installs current at cap and rejects conflicts and one-over` (also constructor permission callback cap); `keeps an identical resource registration current at capacity and rejects a conflicting owner atomically`; `keeps identical admission installation current at capacity and rejects a second admission atomically`. T: `tool identical assignment stays current at cap; conflicting tuple and one-over reject atomically`; corresponding `executor` case (also rejects changed implementation/fence). Each uses a genuine allowed/current control and asserts the prior authority survives rejected mutations. |
| B10 retained invalidation/overflow latch | C: `keeps a revoked proof unusable after invalidation overflow` — real initial allow, revoke retained revision, deny that same proof before/after overflow and keep its issued stamp noncurrent; new fresh revision also denies after latch. |

### Public-surface limits (not hidden gaps)

`ProjectAssignmentsInput` has no independent caller-supplied implementation selector: the approved implementation is a host-installed tuple fact. Therefore wrong implementation is tested at registry replacement/rejection and invalid-install boundaries, not by inventing an API field or executor context. Canonical contract mismatch/materializer-purpose mismatch and provenance have boolean/no-descriptor APIs rather than public denial-code fields; their exact failure boundary is asserted directly. All applicable evaluation/projection negative codes are asserted where exposed.

No unresolved checklist blocker remains in the final tested source version. Final source acceptance still belongs to the lead/reviewer, not this report.

## Frozen candidate identity

SHA-256 of the three owned test files (also logged):

- A: `3560a51111b426c95a52833b4b011f91f0e894fc04065b7262b7015ed451ad56`
- C: `d91a32a274124600fe7014196c76ea58622d70049a10aab5c1a20cd987474831`
- T: `8ec204a72070a7c52ff87e91817b0e5888b1eaca05a56de24623e216ea3e2965`

Final gated source hashes were stable before/after the owned/all/typecheck sequence and are recorded in the log (including the approved schema-import amendment). Lead-owned evaluate helper hash: `6136341610a0b4452e1e9e60668774947f4950275edcc4921df4780148f4890e`. This identifies observed shared source, not a Sol production edit or a promise that the lead will make no later changes.

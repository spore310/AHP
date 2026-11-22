# Packet handoff

**Packet / design revision:** P01 repair 1 / R5 review P01-R1–R9
**Verdict:** IMPLEMENTED — focused review tests and `pnpm validate` passed. Acceptance remains with w8:p2.
**Candidate:** HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus the P01 patch. No commit.
**Owned paths actually changed:** original P01 files, `src/tests/authorization/contractReview.test.ts`, `src/authorization/helpers/validation/{types,helpers,index}.ts`, `src/toolPolicy/helpers/validation/{types,helpers,index}.ts`, this handoff, and `execution/P01-repair1-validate.log`.
**Lead review and ledger:** not edited.

## Commands and results

Repository root. Installed toolchain. Integration DB variables unset. No live query.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run src/tests/authorization/contracts.test.ts src/tests/authorization/contractReview.test.ts` | 0 | 2 files, 10 tests passed |
| `pnpm validate` | 0 | lint, typecheck, 54 files / 417 tests, docs:check 130, vite build. Log: `execution/P01-repair1-validate.log` |

The five reproduced review tests now pass. No assertion was weakened. The Buffer test still expects success while `Buffer` is unset and always unstubs.

## Coverage

| ID | Test | Result |
| --- | --- | --- |
| K01 | `K01 no built-in role or implicit grant` | passed |
| K02 | `K02 one typed portable contract boundary` | passed, fixture updated for the new executor and route stamp |
| K03 | `K03 malformed policy and config values fail deterministically` | passed |
| P01-R1 | `validates portable extension data without a Node Buffer global` | passed |
| P01-R2 | `rejects reserved identity selectors consistently in definitions and references` | passed |
| P01-R3 | `accepts the same application-defined role vocabulary in bindings and policy rules` | passed |
| P01-R4 | `rejects executable accessors without invoking them while validating plain extension data` | passed |
| P01-R5 | `bounds challenge redirect metadata before any continuation can retain it` | passed |
| R6/R9 | `keeps local grant commit and rollback synchronous` | passed |
| R8 | `applies lower and higher budgets without treating include depth as a count` | passed |

## Amendments

1. `capturePlainJson` replaces `Buffer` and `JSON.stringify`. It bounds visits before descending, rejects cycles, reserved keys, and accessors, and does not call getters or `toJSON`. It does not sandbox Proxies.
2. Definition ids and policy/namespace refs share `identifierSchema`. Binding roles and policy `anyOf` share `roleNameSchema`.
3. `GrantIssuer.commit` returns `ScopedPolicyBinding`. `rollback` returns `void`. `prepare` stays async. No grant engine.
4. `AuthorityRevisionStamp` now requires `actor` and `route` (`origin` plus `targets`). `resourceInstanceId` is removed. `ExecutorRevision` fences executor actor, connection, generation, and registration revision. `ToolActionContext.executor` uses that type.
5. `createAuthorizationSchemas`, `createToolPolicySchemas`, and `createChallengePresentationSchema` capture a validated `PolicyLimits` value. Default instances remain. `maxNamespaceIncludes` is the include-list count. `namespaceIncludeDepth` is not that count.
6. `POLICY_LIMIT_DEFAULTS`, `POLICY_LIMIT_ABSOLUTE`, and `RESERVED_OBJECT_KEYS` are frozen. New limit fields: `maxNamespaceIncludes`, `maxResourceIdLength`.

## Downstream impact

- P02 must call `createToolPolicySchemas` with a validated budget and must not treat include depth as include count.
- P03 must use `roleNameSchema` for both bindings and rules. Empty branches still deny.
- P05 and P06 must use synchronous `commit`/`rollback` after async `prepare`, keyed by the prepared instance id.
- P08 must read `ExecutorRevision` and `AuthorityRevisionStamp.route`, not a single `resourceInstanceId`.
- P13 may bound presentation with `createChallengePresentationSchema`. Scheme text is not redirect approval.

## Omissions

No factory, evaluator, dispatcher, or grant engine. `defineToolPolicyNamespace` is still not implemented. Freeze remains pending acceptance. P02 was not started.

**No-database/no-deploy boundary:** no query, migration, install, commit, reset, or stash.

# P01 orchestrator review — RESOLVED / PASS

Final disposition: all findings below resolved. See `P01-handoff.md` and the final 421-test orchestrator gate. Historical failed candidates remain documented below; they are not the accepted candidate.

Candidate: base `22fa7955b8e43839e041228f647f26e00762ebbe` + worker P01 files and tsconfig aliases. Original worker validation (410 tests) passed; it did not cover the regressions below. No P02 authorization until acceptance.

## Reproduced findings

Command (orchestrator): `pnpm exec vitest run src/tests/authorization/contractReview.test.ts`, exit 1; all five tests failed on the submitted candidate.

| ID | Priority | Location | Expected / observed | Regression |
| --- | --- | --- | --- | --- |
| P01-R1 | P1 | `src/toolPolicy/types.ts:extensionTooLarge` | Portable schema must not require Node Buffer. Without it, safeParse throws TypeError. | validates portable extension data without a Node Buffer global |
| P01-R2 | P2 | policy/namespace definition schemas | Definitions and exact refs must share safe identifier semantics. Definitions accept reserved names that their refs reject. | rejects reserved identity selectors consistently in definitions and references |
| P01-R3 | P2 | `roleNameSchema` vs binding roles | Application role strings must have consistent bounded validation. Bindings accept colon/Unicode roles while policies reject them using an arbitrary ASCII vocabulary. | accepts the same application-defined role vocabulary in bindings and policy rules |
| P01-R4 | P1 | extension bounds/plain-data check | Serializable config rejects executable accessors before invoking them. Current parse invokes getters and accepts the object as plain JSON. | rejects executable accessors without invoking them while validating plain extension data |
| P01-R5 | P2 | `challengePresentationSchema` | Presentation metadata must be finite. A 100,000-character redirect URL passes. Scheme validation alone is not trusted redirect approval (P13). | bounds challenge redirect metadata before any continuation can retain it |

## Source-inferred contract issues to correct before freeze

- P01-R6 (P1): `GrantIssuer.commit` returns Promise. A5/A8 require asynchronous preparation followed by synchronous instance/owner/binding commit before publication, without an await in the critical section. Define the local commit/rollback seam accordingly; an async external persistence adapter is not an atomic local commit.
- P01-R7 (P1): `AuthorityRevisionStamp` does not identify the actual actor or full resource route/targets, and `ToolActionContext.executor` is only an actor reference without executor connection/generation or exact registration revision. Make the shared contracts capable of fencing actual caller/executor/resource identities; do not treat a connection string or single resourceInstanceId as all-resource authority. No dispatcher implementation is requested.
- P01-R8 (P2): Limits accept overrides but exported schemas hardcode fallback limits. Establish one schema-construction seam for validated limits (default instances can remain convenient); demonstrate lower and allowed higher budgets. Namespace count is not include depth. Do not advertise tunable limits that cannot affect parsing.
- P01-R9 (P2): Exported fallback/absolute objects are mutable at runtime; extension bounds dereference them during validation. Capture/freeze immutable constants. Bound traversal before recursively inspecting the entire extension and avoid getter/toJSON execution.

## Repair 1 recheck

Original five regressions now pass. Synchronous commit/rollback, actor/route/executor stamps, frozen defaults and configurable schema constructors are present. Recheck found three remaining bounded validation failures (orchestrator command `pnpm exec vitest run src/tests/authorization/contractReview.test.ts`, exit 1: 7 pass / 3 fail):

- R9 follow-up: byte counter measures unescaped strings and omits nested delimiters/commas, so `{text: "\\u0000".repeat(10)}` passes a 32-byte ceiling despite serialized JSON exceeding it. Bound the actual JSON representation (including escapes and UTF-8) and stop scanning when over budget.
- R4/R9 follow-up: arrays inspect only indexed properties; a custom non-enumerable `toJSON` function survives plain-data validation. Reject extra own names/symbols/accessors on arrays without executing them.
- R5 regression: repair replaced URL syntax validation with only `startsWith`, accepting `https://`, `http://[` and invalid hosts. Retain syntax validation as well as length/scheme checks; trusted redirect approval remains P13.

These three regressions were added to the existing review test file without changing earlier assertions. Repair 2 is bounded to these findings; no new broad redesign is requested.

## Independent targeted review after repair 2

Worker `w8:p3` performed a fresh read-only check (no tests) to break the repeated repair assumptions. It confirmed ordinary-object nonenumerable data properties are skipped, allowing a nonenumerable `toJSON` function to survive the identity-returning extension schema. Later serialization could execute it and replace the budget-checked representation. This is an in-process plain-data contract breach, not a JSON.parse wire exploit. Arrays already reject this case. Shared-object aliases reject conservatively; no permissive bypass was found there. Proxy/prototype pollution remains trusted-host territory.

Narrow correction assigned to `w8:p3`: reject nonenumerable own object data properties rather than skipping them, with a RED/GREEN regression and full gate. No serializer redesign or new API requested. P02 remains blocked until that exact correction is inspected.

## Acceptance

Add targeted runtime/type regressions for corrected contracts and rerun full validation safely. Keep original assertions; do not weaken tests or introduce a second contract authority. Record amendments and downstream P02/P03/P05/P06/P08/P13 impact. The abstract action surface can remain a contract; no early runtime dispatcher is needed.

## Documentation scope

Module READMEs currently call these contracts frozen. Freeze is pending acceptance; worker should update its new module docs to match corrected APIs/limitations. Existing plan remains target-state. No unrelated documentation rewrite requested.

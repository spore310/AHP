# P02 worker handoff

**Packet / design revision:** P02. Decisions in `P02-preflight.md`.
**Verdict:** REPAIR 2 IMPLEMENTED, awaiting review. Not accepted; no P03.
**Candidate:** `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe` plus uncommitted P01 and these P02 files. No reset, stash, or commit. `nul` remains untracked and untouched.
**Owned paths actually changed:** `src/toolPolicy/helpers/namespace/{index,types,helpers}.ts`, `src/toolPolicy/helpers/factory/{index,types,helpers}.ts`, additive `src/toolPolicy/index.ts` and `README.md`, `src/tests/toolPolicy/factory.test.ts`, this handoff, and `execution/P02-worker.validate.log`.
**Contract amendments:** none. Shared P01 types, schemas, and limits were reused, not duplicated.

## APIs

- `defineToolPolicyNamespace(input)` captures a required `resolve` and detached policy data. It does not expand includes.
- `createToolPolicyFactory({ policies, namespaces, bindings, limits })` publishes one immutable registry or throws `ToolPolicyFactoryError` before return.
- `ToolPolicyFactory.getPolicy(ref)` returns a detached frozen policy or `undefined`.
- `ToolPolicyFactory.forSessionType(sessionType, providerId)` returns frozen `PolicyScopeRules` for that exact pair, or throws `binding-not-found`.
- `ToolPolicyFactory.select({ sessionType, providerId, context })` returns `PolicySelectionResult`.
- `ToolPolicyFactory.inspect()` returns a frozen callback-free view.
- Construction codes: `invalid-definition`, `conflict`, `cycle`, `unknown-reference`, `limit`, `binding-not-found`.
- Dynamic deny codes: `resolver-failed`, `resolver-timeout`, `resolver-output`, `out-of-admission`. A selected result is `{ effect: "selected", alternatives, mandatory }`, not an allow grant.

Direct policies need no resolver. Namespace `resolve` is required and stays in the private registry. Mandatory refs are copied from the host binding even when the resolver omits them. Unknown and out-of-admission resolver refs deny the selection. Identities are nested maps; opaque ids are not parsed. Budgets come from `policyLimitsSchema`. Policy data is accepted with `capturePlainJson`, then cloned and frozen. Unvalidated input is not passed to `JSON.stringify`.

## Tests

| ID | Name | Result |
| --- | --- | --- |
| N01 | compiles and resolves a direct policy with an empty namespace list | passed |
| N02 | rejects cyclic, conflicting, oversized, prototype-key and unknown namespace expansion | passed |
| N03 | does not treat opaque ids, suffixes or prefixes as roles, filesystems or providers | passed |
| N04 | keeps registered mandatory provider and session rules when a permissive resolver narrows selection | passed |
| N05 | keeps a compiled assignment unchanged after caller mutation and a later namespace revision | passed |
| budgets | uses a higher validated budget without treating include depth as a count | passed |

N02 also distinguishes equal duplicate revisions from conflicting revisions. N04 includes thrown output, unknown output, and a hanging resolver at `asyncHookDeadlineMs: 1`.

## Commands

RED, before implementation, integration DB variables removed: `pnpm exec vitest run src/tests/toolPolicy/factory.test.ts`. Exit 1 at 22:31:27. 6 failed. `createToolPolicyFactory is not a function` / `defineToolPolicyNamespace is not a function`.

One implementation repair: include-count overflow was classified as invalid configuration because the schema max ran first. The length check now runs first and throws `limit`. Focused suite then exited 0 at 22:34:46, 6 passed.

Lint repair: removed two unnecessary assertions and braced three void arrow callbacks. No test assertion was weakened.

`pnpm validate` in a child with the same DB variables removed. Exit 0. Lint and typecheck passed. 55 files / 427 tests passed; no skipped count printed. Documentation gate: 136 source files. Build passed in 97ms. Log: `execution/P02-worker.validate.log`.

## Repair 1

Addressed `P02-review.md` R1–R6 without a second schema or P01 edit.

- `select` unions admitted direct refs with namespace selections and deduplicates.
- Resolver output is accepted only by `capturePlainJson` plus own-data descriptors. Accessors are not invoked. Failures return `resolver-output` and do not publish the thrown value.
- `defineToolPolicyNamespace` freezes the declaration, policy array, include array, and include refs. `captureDeclaredPolicy` keeps the caller policy type after a full clone; it does not return a stripped base and claim the original subtype.
- Equality is local plain-data comparison. `@toolPolicy` does not import `node:util`.
- `CompiledToolPolicy.extension` is the detached captured value. `getPolicy` and `inspect().policies` return that type.
- Include expansion deduplicates includes first, memos by exact namespace and depth, checks the gray stack before reuse, and adds unique refs incrementally. The 11-node 8-repeat baseline was not executed. Post-fix coverage is an 8-node 6-repeat chain, a shared diamond, and a depth-keyed path that still rejects a too-deep include.

Focused `pnpm exec vitest run src/tests/toolPolicy` exited 0: 3 files, 13 tests. `pnpm validate` with integration DB variables removed exited 0: 57 files, 434 tests, documentation gate 136, build 96ms. Log: `execution/P02-repair1.validate.log`.

## Repair 2

P02-R7 separates budget domains. Extension depth, keys, and bytes apply only to extension data. Operation trees use a fixed depth of 8 and key/byte bounds derived from `TOOL_OPERATIONS`, actor branches, `maxRoles`, and `maxMetadataStringLength`. Resolver exact-ref arrays use depth 3 and `maxPolicyRefs * 3` plain-data keys so one ref's `id` and `revision` are not counted as extra references. Array length is still capped by `maxPolicyRefs`. Getter and prototype rejection remains.

API: `ToolPolicyFactoryOptions.policies` is `readonly CompiledToolPolicy[]`, so an inline extension is accepted and returned by `getPolicy`. `defineToolPolicyNamespace(input, limits?)` takes an optional validated `PolicyLimits` budget; omitted means the shared defaults. No P01 schema or interface was edited.

Focused `src/tests/toolPolicy` passed, 3 files / 18 tests. `pnpm validate` with integration DB variables removed exited 0: 57 files, 439 tests, documentation gate 136, build 88ms. Log: `execution/P02-repair2.validate.log`.

## Limitations

No caller authorization, grant evaluation, or host/session wiring. A timed-out resolver promise is not cancelled. `forSessionType` requires the exact session key, version, and provider id; it does not infer either from a policy id. Next step is orchestrator acceptance, not P03.

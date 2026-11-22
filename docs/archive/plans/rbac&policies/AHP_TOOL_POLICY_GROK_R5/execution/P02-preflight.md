# P02 preflight — awaiting P01 acceptance

Read-only preflight returned by worker `w8:p3`; no writes/tests performed by that worker. Orchestrator plan gate: PASS conditional on accepted P01 exports and validation. This does not start P02.

## Ownership and approach

One compiler under `src/toolPolicy/helpers/factory`; namespace declaration capture under `helpers/namespace`. Preserve existing catalogue conventions: atomic construction, exact revisions, detached immutable data, Map/own-key lookups. Do not edit tools/sessions or create another schema language.

Allowed P02 files: namespace and factory `{index,types,helpers}.ts`, targeted additive edits to `src/toolPolicy/index.ts` and `README.md`, and `src/tests/toolPolicy/factory.test.ts`. One writer after P01 resolves.

Definitions -> validated exact-ID/revision maps -> bounded pinned include closure -> session/provider admission plus independent mandatory refs -> bounded dynamic selection within admission. Compilation is not permission issuance. Serializable views contain no resolver callbacks.

## Decisions

- Shared identity/reference/rules/decision/limit contracts remain owned by P01. Missing shared definitions require an explicit amendment, never duplicate competing contracts. Factory-specific options/results/errors can live in its helper types.
- Namespace resolver is required; direct policies require neither a namespace nor a resolver.
- Reuse accepted validated shared defaults/limits; do not introduce divergent factory-only budgets.
- Provider bindings use exact host registrations, not inferred hierarchy or catalogue-name prefixes.
- Namespace selection chooses admitted alternatives. Mandatory refs are independently retained and evaluated; resolver output need not repeat mandatory refs. Omitting one from selected alternatives cannot remove it. Unknown/out-of-admission output and resolver failure/timeout fail closed.
- Static invalid configuration throws before publishing a partial registry. Dynamic failures use an explicit typed fail-closed result, never truthiness or a successful empty fallback.
- Store identities by exact id/revision (nested Maps or equivalently unambiguous keys); do not parse `@` or resource-like prefixes into authority.

## Acceptance cases

N01: direct policy compilation with no namespaces. N02: cycles, conflicting identities/revisions, expansion/depth limits, prototype selectors, unknown references. N03: opaque `workspace.review@pm` confers no role or resource relationship. N04: permissive selection cannot remove session/provider mandatory rules. N05: mutations of source declarations and later namespace revisions do not change captured compiled data or existing assignments.

P01 export integration, actual API names and test execution remain pending. No P02 implementation is claimed.

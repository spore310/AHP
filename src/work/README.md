# Work

Work submissions resolve an exact session and its canonical resources. The service captures immutable intent, prepares trusted admission and commits through the acquired host’s work repository. Through P2 the remote binding exposes the protected detail read. The command service is available in process.

## Files

| File | Responsibility |
| ---- | -------------- |
| `helpers/definitions/types.ts` | Work-kind descriptors, application parsers, and the captured kind contract. |
| `helpers/definitions/helpers.ts` | Capture registrations, validate declared manifests, and normalize input, result, and data. |
| `helpers/definitions/index.ts` | Work-kind registration and resolution exports. |
| `helpers/selections/types.ts` | Public locators, selector inputs, exact selectors, and graph limits. |
| `helpers/selections/helpers.ts` | Capture intent, resolve exact instances, and evaluate canonical containment membership. |
| `helpers/selections/index.ts` | Selection contracts and graph construction exports. |
| `helpers/reads/types.ts` | Trusted work read port, legacy view and session-owner contracts. |
| `helpers/reads/helpers.ts` | Domain- and owner-scoped canonical detail reads, send-time incarnation checks, and legacy reads. |
| `types.ts` | Public command, view, selector, status and error types. |
| `helpers/errors.ts` | `WorkError`: sanitized `invalid`, `not_found`, `unauthorized`, `conflict`, `stale`, or `exhausted` failures. |
| `helpers/helpers.ts` | Command factory and projection exports. |
| `helpers/commands/types.ts` | Trusted contexts, commands, service ports and projections. |
| `helpers/commands/helpers.ts` | Strict capture, type resolution, submission, data updates and settlement. |
| `helpers/commands/views.ts` | Detail and summary serializers. |
| `helpers/protocol/schemas.ts` | Strict V1 request shapes, canonical UUID capture, retry and data revisions, and bounded JSON. |
| `index.ts` | Public surface for the module. |

## Work kinds

An exact session-type revision owns each work kind. The registration can provide
synchronous input, result, data, and application-fact parsers. Declared input,
result, and data schemas accompany their corresponding parsers. Input and data
default to bounded JSON objects of up to 64 KiB, and results to 256 KiB. The
host captures the payload before invoking a parser and captures its result
before returning it. Retry budgets default to three attempts and accept 1–100.

## Resource selections

A locator names a kind and public ID and may pin an incarnation with
`instanceId`. A positive scope entry can identify its session through its
canonical parent. For a new submission, every scope and announcement entry must
resolve to an active resource in that same domain and session. An authorized
exact retry can recover the original work ID using its recorded retired anchor.
Identical duplicates collapse.
Conflicting rules for the same instance and purpose reject the submission.

Membership uses the nearest applicable containment rule. An exact match applies
to the resource itself. An ancestor match requires `includeDescendants`. A
nearer inclusion can reinclude a resource inside an excluded subtree. Grant
parents also affect availability, while containment determines membership.
Evaluating a stale graph revision returns false. An operation requiring the
whole scope must also verify all positive anchors remain active and perform
its ordinary authorization checks.

The default snapshot limits are 64 raw selectors per purpose, 256 resources,
and a graph depth of 32. Duplicate inputs and exclusions consume the selector
budget before normalization. Trusted overrides support up to 128 selectors,
4,096 resources, and a depth of 64 within the limits of the underlying store.

## Commands

Pass an acquired work repository, an exact session-type resolver and a trusted approval preparer to `createWorkService`. The preparer receives a detached, frozen copy of the facts. Its currentness check runs at storage admission and before the response returns. Each prepared approval has a release callback.

- `submit` resolves the scope and pins the actor, type configuration and signed 32-bit priority. An identical retry returns the original ID in every status, including after data changes or a lost commit acknowledgement. The unique key includes the session incarnation, kind and request key.
- `get` returns an authorized detail projection. The list summary contains identity, priority, status, revision and timestamps. Lease secrets and immutable submitted data are private storage fields.
- `updateData` replaces the whole data object at the expected revision. The work revision and data revision advance together. A stale command changes neither.
- `complete` and `fail` check the registration epoch, attempt, lease token, deadline and exact session before settlement. An optional final data update commits atomically. A failure records a generic summary. Direct execution requests must come from a matching trusted agent context.

The [durable lifecycle example](../../examples/durable-lifecycle.ts) submits work scoped to one child, updates its data and retries the original submission. The [shared work contract](../tests/persistence/conformance/work.ts) runs on both storage adapters. The [service](../tests/work/workService.test.ts), [settlement](../tests/work/data.test.ts) and [selection](../tests/work/selections.test.ts) suites cover the in-process entry points.

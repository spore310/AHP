# Work

Work submissions resolve an exact session and its canonical resources. The service captures immutable intent, prepares trusted admission and commits through the acquired host’s work repository. A configured protected host exposes V1 submit, claim, renew, complete, fail, cancel, updateData and get requests.

## Files

| File | Responsibility |
| ---- | -------------- |
| `helpers/authorization/types.ts` | Work operations, registered policies, callback facts, restrictions, and host ceilings. |
| `helpers/authorization/registration.ts` | Capture operation policy maps and validate compiler references at session registration. |
| `helpers/authorization/helpers.ts` | Prepare scoped canonical decisions, bound consumer restrictions, and check fresh approval cohorts. |
| `helpers/authorization/index.ts` | Work authorization factory and registration types. |
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
| `helpers/commands/facts.ts` | Detached, recursively frozen authority facts for trusted command and acquisition preparers. |
| `helpers/commands/helpers.ts` | Strict capture, type resolution, submission, data updates and settlement. |
| `helpers/commands/views.ts` | Detail and summary serializers. |
| `helpers/commands/failure.ts` | Bounded application failure formatter, generic fallback and callback settlement. |
| `helpers/claims/helpers.ts` | Priority candidate sweeps, private continuations, capacity admission, renewal and guarded claimant disclosure. |
| `helpers/claims/admission.ts` | Captures native revocation signals and framework-issued scheduling receipts for locked admission. |
| `helpers/executionGuard/helpers.ts` | Invalidates private work proofs before a mutation, including while its acknowledgement is pending. |
| `helpers/authorityLoss/types.ts` | Consumer decisions and captured facts for the affected attempt. |
| `helpers/authorityLoss/helpers.ts` | Paged authority checks, callback deadlines, retained capacity and fenced disposition. |
| `helpers/protocol/execution.ts` | Portable work ID, attempt and lease-token schema shared by private dispatch and work requests. |
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

Pass an acquired work repository, an exact session-type resolver and a trusted approval preparer to `createWorkService`. The preparer receives a detached, frozen copy of the facts. Claim and renewal use the locked scheduling receipts described below. Each prepared approval has a release callback.

- `submit` resolves the scope and pins the actor, type configuration and signed 32-bit priority. An identical retry returns the original ID in every status, including after data changes or a lost commit acknowledgement. The unique key includes the session incarnation, kind and request key.
- `get` returns an authorized detail projection. The list summary contains identity, priority, status, revision and timestamps. Lease secrets and immutable submitted data are private storage fields.
- `claim` returns a private lease, an empty queue, a capacity result or a retryable deferral. A call examines up to 128 candidates in pages of 32. Priority descends, then creation time and ID ascend. A private continuation resumes a denied prefix on the same identity and authority. A locked work item can be skipped.
- `renew` requires a current registration, attempt, token and unexpired deadline. The default identity cap is three across all sessions, kinds and binding epochs. A change to the cap affects the next acquisition. The default lease lasts 60 seconds.
- `cancel` requires the operation's explicit scoped policy. The durable update checks the exact session and work revision.
- `updateData` replaces the whole data object at the expected revision. The work revision and data revision advance together. A stale command changes neither.
- `complete` and `fail` check the registration epoch, attempt, lease token, deadline and exact session before settlement. An optional final data update commits atomically. The default failure summary is generic. A configured formatter may return an application-approved code and summary. Direct execution requests must come from a matching trusted agent context.

The [durable lifecycle example](../../examples/durable-lifecycle.ts) submits work scoped to one child, updates its data and retries the original submission. The [shared work contract](../tests/persistence/conformance/work.ts) runs on both storage adapters. The [service](../tests/work/workService.test.ts), [settlement](../tests/work/data.test.ts) and [selection](../tests/work/selections.test.ts) suites cover the in-process entry points.

Tagged execution requires an active lease bound to the caller's registration and epoch. The host checks each resolved target against the captured scope, using the origin for an empty target list. It converts the remaining database lease lifetime into a conservative local monotonic deadline. Application permissions and the work guard are rechecked before effects and disclosure.

An observed authority change schedules a bounded scan of active leases. Consumers can retain, requeue, fail or cancel the affected attempt. A missing decision, failure or timeout retains the lease until expiry. A timed-out callback occupies its slot through settlement. Every modifying decision checks the current revision, attempt and lease, and requeue also checks lifecycle, positive anchors and retry budget.

### Scheduling admission

The protected host prepares policy callbacks before entering the storage
transaction. At the locked mutation boundary it checks captured registry and
presence generations, allowed kinds, configuration, policy expiration and
revocation. Capacity-only changes affect new acquisition. Existing eligible
leases can still renew.

A custom work service that enables scheduling must supply
`scheduling.admission(caller, approval, operation, kind, configRevision)`.
Return a native `AbortSignal` that aborts synchronously when the prepared
caller, permission, or kind becomes ineligible. For a claim, also abort on a
configuration revision change. A decision with a deadline returns
`{ signal, validUntil }` with its epoch-millisecond expiry. Durable lease and registration checks still
run inside the storage transaction. The public caller and approval can use
their standard `isCurrent` methods for checks outside the locks.

An application narrowing receipt for claim or renewal must supply either
`signal` or `invalidation: "registry"` together with its normal `validUntil`,
`isCurrent`, and `release`. For registry-based invalidation, call
`registry.invalidateExternal(revision)` synchronously when the underlying
decision changes. A callback alone cannot revoke a decision during a row-lock
wait.

The protected connection's expiry and closure also guard a pending claim or
renewal. Its initial authority provider must report early withdrawal by
aborting the receipt's native signal or, when the receipt declares
`invalidation: "registry"`, synchronously calling `registry.invalidateExternal(revision)`.

# H6 — Committed events, ordering and reconciliation

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H6.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Extend existing publication and protected views across hosts without losing committed changes or weakening native ordering and disclosure rules.

## Prerequisites

- H5
- DECISION D06 resolved against the pinned Microsoft SDK

## Existing owners and source anchors

- `./src/work/helpers/events/helpers.ts`
- `./src/work/helpers/views/helpers.ts`
- `./src/sessions/helpers/sequence/helpers.ts`
- `./src/sessions/helpers/factory/helpers.ts`
- `./docs/technical/wire-contract.md`
- `./src/websocket/helpers/security/types.ts`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Extend the existing work/event/view contracts instead of creating a competing subscriber or client state system. distributedEventTransport is a delivery adapter, not an authority source or a replacement command API.
2. Write durable outbox records in the same transaction as the relevant committed state changes. Use PostgreSQL LISTEN/NOTIFY only as an optional wakeup; reconnect and periodic polling must recover from the durable source.
3. Define authenticated event scope, stable event identity, exact resource/session incarnation and per-entity revision. Do not reuse one revision field as an unexplained global ordering token.
4. Specify consumer fan-out, acknowledgement/progress, duplicate handling, bounded retention, slow-reader behavior and reset/reconciliation after retention loss. A competing-worker queue is not sufficient for every interested host to observe a change.
5. Inspect all native action producers and the installed Microsoft 1.0.0 client. Preserve actual serverSeq/fromSeq and connection-wide ordered delivery within the chosen namespace/connection scope.
6. Prefer extending the existing durable checkpoint/publication boundary to serialize the native action order required by the SDK. A database sequence alone is not proof of commit or delivery order; an outbox cursor must not skip a lower allocated ID that commits later.
7. Handle public root catalogue, counts, lists and snapshots across owners, with authorization filtering before pagination. A session absent from the local registry is not automatically absent from the namespace.
8. Keep native ordering separate from best-effort work hints. Reuse streamEpoch/reset and periodic work reconciliation; do not invent a native resnapshot action or new protocol fields.
9. Preserve allowGlobalSequence privacy and recipient-specific projection. Event delivery always rechecks appropriate current authority; private input, result, token or credential data is not broadcast.

## Decisions to resolve

- D06: precise native sequence scope, allocation/commit/publication order, snapshot watermark, outbox progress algorithm, retention/reset and failover semantics.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H6-01 | A crash after commit but before publication does not permanently hide a committed change. | Real PostgreSQL transaction plus killed relay/host; restart relay and reconcile the exact committed revision. |
| H6-02 | Rollback, conflict and idempotent replay do not publish a false new mutation. | Inspect outbox rows and public observations, not only callback counts. |
| H6-03 | Duplicate/reordered delivery converges without applying older entity state over newer state. | Inject reordered revisions and duplicate event IDs across a reconnect. |
| H6-04 | Every eligible consumer can recover changes without another consumer consuming them exclusively. | Two independent host subscribers and restart of one; verify each retained consumer's recovery contract. |
| H6-05 | Native clients never observe forbidden descending sequence order or an invalid snapshot watermark. | Two owners, multiple sessions/channels, stalled commits, root events and the actual pinned SDK; assert exact native behavior. |
| H6-06 | Outbox progress does not lose a later-committing record with a lower allocated identifier. | Hold transaction N, commit N+1 and advance a reader, then commit N; verify it is still observed or reconciled. |
| H6-07 | A snapshot/event race cannot permanently miss the intervening committed revision. | Subscribe/buffer, pause snapshot, commit elsewhere, finish guarded snapshot and verify eventual state. |
| H6-08 | Root catalogue/count/list views include all authorized namespace sessions and exclude unauthorized ones. | Sessions on two owners, denied rows before allowed rows, correct pagination and no hidden-count leakage. |
| H6-09 | Revoked recipients and recipients without global-sequence consent receive no unauthorized payload or cursor. | Revoke during projection/send; test cross-namespace subscription/cursor reuse. |
| H6-10 | Retention loss, slow listeners and disconnected consumers have bounded observable recovery. | Bound queues/storage and prove explicit reset/incomplete/reconciliation behavior without unbounded memory. |
| H6-11 | One native/client transport reader still serves tool and work adapters. | Run combined public client integration and existing shared-lifetime cleanup regressions. |

## Verification targets

- src/tests/host/events.integration.test.ts (proposed)
- src/tests/host/sequence.integration.test.ts (proposed)
- Existing work views/client reconciliation and protected native-view tests

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/events.integration.test.ts src/tests/host/sequence.integration.test.ts src/tests/work
```

For criteria that depend on database behavior, use the disposable environment in `docs/guides/postgresql.md`, verify actual applied migrations and ensure new conformance scenarios are wired into the executed entry point. Required database/multiprocess cases may not silently skip:

```sh
pnpm exec vite-node examples/postgresql-conformance.ts
```

Run the relevant public examples and the repository-required final gate for the integrated candidate:

```sh
pnpm validate
```

Use controlled concurrency barriers rather than timing-only sleeps. Preserve relevant existing regression suites. Source inspection, mocks, PostgreSQL checks and public SDK tests are separate evidence categories.

## Handoff required

Complete [the packet handoff](../handoffs/H6.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

No distributed native serving until the pinned-SDK ordering decision and the stalled-commit/cursor counterexample are closed.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


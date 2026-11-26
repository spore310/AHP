# H8 — Distributed agents, work claims and tool delivery

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H8.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Extend the existing agent/work/tool capabilities across hosts without duplicating identities, overallocating capacity or weakening caller/executor authorization.

## Prerequisites

- H7
- H5
- H2 authorization/currentness proof

## Existing owners and source anchors

- `./src/agents/helpers/directory.ts`
- `./src/agents/types.ts`
- `./src/websocket/helpers/host/work.ts`
- `./src/persistence/helpers/adapters/postgres/helpers/durableWork/scheduling.ts`
- `./src/work/README.md`
- `./src/tool/README.md`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Keep durable agent registration and executionEpoch semantics. Add the necessary distributed presence/connection-owner reference under existing agent contracts; each socket stays owned by one process.
2. Make reconnect/bind/disable atomic across hosts. Exactly one effective connection generation is current for an agent identity under its namespace/domain scope.
3. Refactor hosted work's local connection/presence lookups to the declared distributed authority model. A remote live worker must not be mistaken for a lost worker because it is absent from a local Map.
4. Preserve registration-wide capacity across all its sessions/hosts within one namespace. Continue counting unexpired old-epoch leases; cross-namespace aggregate capacity is an explicit future application decision.
5. Keep current SQL claim lock ordering, separate post-lock count statement, priority/tie order, attempt limits, fresh database expiry and exact token/attempt checks.
6. Coordinate authoritative capacity/config revisions so one stale pod cannot apply an older permissive cap or kind policy.
7. Route tool invocation, challenge/continuation where supported, cancellation and result delivery through the owning hosts. Preserve original caller, executor, exact assignment, resource scope, work restriction and final recipient guard.
8. Work tokens remain restrictive credentials and do not replace base application permission. Do not expose them to unrelated executors, events, chat projections or diagnostics.
9. Preserve existing authority-loss callback defaults and capacity bounds; stale callbacks cannot act on a successor attempt.

## Decisions to resolve

- Specify ownership and reconstruction/routing of tool assignments and challenge state; local weak-provenance objects are never the remote representation.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H8-01 | Concurrent binds on different hosts produce one effective execution binding. | Race two live sockets, then reconnect elsewhere; old generation cannot renew, settle or delete the successor. |
| H8-02 | Concurrent claims across hosts respect one registration's configured cap. | At cap 3, race at least ten claims across two processes/sessions; exactly three unexpired leases, verified from authoritative storage. |
| H8-03 | Old-epoch leases still consume capacity until expiry, and stale attempts cannot settle. | Reconnect, count, expiry and takeover races using real database barriers. |
| H8-04 | A remote live worker is not falsely classified as disconnected by authority-loss logic. | Worker socket on A, session owner on B; drop unrelated local presence and inspect callback dispositions. |
| H8-05 | Kind/capability/cap changes cannot be bypassed by a stale host configuration. | Apply a lower cap/removed kind while claims wait on locks; verify the documented current-revision behavior. |
| H8-06 | Cross-host tool execution preserves caller/executor separation and real resource restrictions. | Caller/owner/executor on distinct processes where practical; child-only work cannot authorize a session-wide operation. |
| H8-07 | Tool challenge, cancellation, disconnect and late completion retain exact correlation and cleanup. | Valid challenge flow and hostile replay; no second completion, stale assignment or leaked pending slot. |
| H8-08 | Foreign namespace or copied lease data cannot exercise another registration's authority. | Same subject/key in two namespaces and forged actor/epoch/token combinations; no data or outcome disclosure. |
| H8-09 | Renewal after a lock wait cannot revive an expired lease; lost commit acknowledgements stay uncertain. | Existing expiry/unknown-outcome regressions extended to multiple processes. |
| H8-10 | Client/work/tool shared-lifetime and bounded-view behavior survive a host-owner change. | Public client integration, reconnect to a different ingress and all handles/subscriptions/timers disposed. |

## Verification targets

- src/tests/host/agents.integration.test.ts (proposed)
- src/tests/host/work.integration.test.ts (proposed)
- src/tests/host/tools.integration.test.ts (proposed)
- Existing PostgreSQL scheduling and work-capacity/advanced examples

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/agents.integration.test.ts src/tests/host/work.integration.test.ts src/tests/host/tools.integration.test.ts
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

Complete [the packet handoff](../handoffs/H8.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Do not infer distributed agent correctness from durable registration rows alone or from two pools under one host.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


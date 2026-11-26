# H3 — Single-host and active-passive lifecycle

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H3.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Keep the default simple and add an operational active-passive mode with health, standby takeover and safe draining.

## Prerequisites

- H2
- Provider recovery/placement constraints from D08 are explicit

## Existing owners and source anchors

- `./src/websocket/helpers/server.ts`
- `./src/websocket/helpers/host/helpers.ts`
- `./src/sessions/helpers/recovery/helpers.ts`
- `./src/persistence/helpers/adapters/postgres/helpers/ownership/helpers.ts`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Define lifecycle/readiness behavior through the host API and portable health integration. Preserve existing default start/stop contracts; document any added standby behavior rather than changing Promise semantics silently.
2. Allow health/startup observation while a replica is waiting for ownership. A healthy standby remains alive and unready for public AHP requests instead of crash-looping on the expected ownership conflict.
3. Retain exactly one namespace/session controller in active-passive mode. Use bounded acquisition retry/backoff and release/takeover conditioned on current ownership.
4. Recovery must complete required validation and fresh authority installation before the active instance advertises readiness. Missing provider/driver/restoration authority stays unavailable with sanitized diagnostics.
5. Close admission synchronously when ownership is lost. On drain, stop new admission, become unready, settle or fence admitted work, release local handles and ownership, and terminate within configured bounds.
6. Use readiness to control new traffic; preserve explicit socket and in-flight-operation cleanup because changing readiness does not itself terminate an existing connection.
7. Document one stable hostId shared by replicas, distinct runtime instance IDs, and persistence/provider requirements across nodes. Replication provides availability; it does not multiply active session capacity.

## Decisions to resolve

- D08 must identify which provider resources can be recovered on another instance; do not advertise failover for process-local state without a supported recovery contract.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H3-01 | Default single mode remains compatible and needs no cluster credentials or transport. | Existing quickstart, advanced and durable-lifecycle examples through @host. |
| H3-02 | Two replicas of one logical host produce one active and one healthy standby. | Real-process startup race; public traffic denied at standby while health remains responsive. |
| H3-03 | The standby becomes active only after acquiring valid ownership and finishing recovery. | Kill/partition the active process; record epoch change, recovery completion and readiness order. |
| H3-04 | Ownership loss immediately fences new work and delayed sends. | Barrier-controlled pending requests and subscriptions while ownership connection is terminated. |
| H3-05 | Start, standby, drain and stop are bounded and idempotent. | Repeated/concurrent lifecycle calls, acquisition finishing late and callbacks that never settle; no duplicated teardown. |
| H3-06 | Healthy standby/dependency outage are not treated as process deadlock by default probes. | Health contract tests distinguish startup, liveness and readiness. |
| H3-07 | Graceful transfer releases local handles without retiring durable resources. | Compare stored sessions/work before/after rolling replacement and explicitly contrast retirement behavior. |
| H3-08 | Unsupported recovery storage/provider placement prevents an unsafe ready state. | Move to an instance without declared resource access and verify unready/suspended behavior and useful diagnostics. |

## Verification targets

- src/tests/host/lifecycle.test.ts (proposed)
- src/tests/host/replicated.integration.test.ts (proposed)
- Existing recovery, resourceLifecycle and public PostgreSQL lifecycle tests

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/lifecycle.test.ts src/tests/host/replicated.integration.test.ts src/tests/sessions
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

Complete [the packet handoff](../handoffs/H3.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Scenario B cannot be called complete on the basis of two database pools in one process.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


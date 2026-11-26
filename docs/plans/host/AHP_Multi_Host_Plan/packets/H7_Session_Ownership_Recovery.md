# H7 — Session ownership, recovery and transfer

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H7.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Run active sessions on multiple hosts in one namespace while preserving one authoritative owner per session and safe provider lifecycle.

## Prerequisites

- H6
- DECISION D08 resolved

## Existing owners and source anchors

- `./src/sessions/helpers/recovery/helpers.ts`
- `./src/sessions/helpers/factory/helpers.ts`
- `./src/persistence/helpers/durability/types.ts`
- `./src/persistence/helpers/adapters/postgres/helpers/resources/helpers.ts`
- `./src/authorization/helpers/resources/types.ts`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Extend existing session recovery to enumerate/acquire only sessions allocated to this instance; do not let every host restore the entire namespace.
2. Define acquire, ready, drain, transfer, recover, suspend and retire behavior using existing lifecycle concepts. Keep session ownership epoch distinct from session incarnation and work attempt.
3. All session/resource mutations and authoritative publication use the current ownership fence. Losing the lease prevents late local installation, output and cleanup that could affect a successor.
4. Rebuild trusted policy/resource installations and local handles from durable facts and current application authority; never copy registry tokens or preserve old connection/grant provenance across processes.
5. Preserve stable provider operation/provisioning keys and explicit recovery/ensure contracts. Record which external effects support idempotency, fencing and relocation.
6. Transfer only to eligible hosts with the required provider/driver/catalogue version and access to external state. A local directory, PTY or open process is not automatically portable because its metadata is durable.
7. Keep graceful ownership transfer separate from explicit resource retirement/destruction. Do not cancel all work or destroy external resources simply because a pod stops.
8. Choose a minimal placement policy. Any load-based placement must remain subordinate to security and capability eligibility; automatic live rebalance needs explicit tests and is otherwise deferred.

## Decisions to resolve

- D08: provider relocation/recovery capabilities, external fencing limits and supported placement/transfer policy.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H7-01 | Two hosts cannot both become authoritative owners of the same exact session. | Real-process acquire race; one successful owner epoch and no duplicate ready authority. |
| H7-02 | Different sessions in the same namespace are active on different hosts. | Public SDK operations routed through both ingress nodes; verify useful concurrent progress. |
| H7-03 | A host recovers only sessions it currently owns. | Populate multiple allocations, restart both processes and count provider restoration per exact session. |
| H7-04 | Transfer fences delayed mutations, callbacks and teardown from the old owner. | Pause each before/after admission and resume after takeover; stale cleanup cannot remove the successor's installation. |
| H7-05 | Crash between external provision and durable acknowledgement preserves idempotency where the provider supports it. | Recovery uses the same operation key; verify the backing resource count and separately document unsupported providers. |
| H7-06 | Incompatible or nonportable resources prevent unsafe placement/readiness. | Wrong driver/version, inaccessible local state and absent restoration approval produce suspension/denial. |
| H7-07 | Transfer preserves exact resource identity, data revisions, work history and current permission semantics. | Compare durable data, then authenticate fresh connections and verify old authority is not restored. |
| H7-08 | Retirement remains authoritative and distinct from drain/failover. | Race retirement, transfer and worker settlement; no resurrected resource or lost terminal history. |
| H7-09 | Uncertain COMMIT and hung lifecycle callbacks retain conservative fences and bounds. | Lost-ack and non-settling callback tests; no false success, duplicate capacity reuse or late ready publication. |

## Verification targets

- src/tests/host/sessionOwnership.integration.test.ts (proposed)
- src/tests/sessions/distributedRecovery.test.ts (proposed)
- Existing durableAdapter, publicLifecycle and resourceLifecycle tests

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/sessionOwnership.integration.test.ts src/tests/sessions/distributedRecovery.test.ts
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

Complete [the packet handoff](../handoffs/H7.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Scenario D remains incomplete until remote agents/tools and complete public flows are verified in H8/H9.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


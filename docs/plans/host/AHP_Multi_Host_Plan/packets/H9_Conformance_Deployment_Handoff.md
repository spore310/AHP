# H9 — A–D acceptance, deployment examples and final handoff

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H9.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Demonstrate each supported topology through public APIs and provide truthful operational documentation and deployment examples.

## Prerequisites

- H0–H8 verified for the integrated candidate
- All blocking decisions and findings closed

## Existing owners and source anchors

- `./docs/guides/postgresql.md`
- `./docs/guides/quickstart.md`
- `./docs/guides/advanced.md`
- `./docs/technical/wire-contract.md`
- `./package.json`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Create a bounded local multiprocess acceptance harness using the actual public host, real PostgreSQL and pinned Microsoft SDK. Give processes independent memory and connections; include an ingress/load-balancer fixture that can send reconnects to a different host.
2. Cover A single, B active-passive, C independent namespaces and D multiple active hosts in one namespace. Do not silently mark D out of scope if it remains difficult.
3. Provide minimal local and Kubernetes configuration examples. Default deployment has one replica; increasing replicas requires the documented mode and shared adapters/credentials.
4. Document stable host name, application-chosen namespaces, runtime instance identity, Secret-provider integration, readiness/startup/liveness, drain and termination behavior.
5. Do not require Kubernetes, Redis, a broker, a service mesh or server-side model execution for the SDK. Deployment examples are artifacts; applying them to a live cluster is outside this planning task.
6. State database-connection/pool budgets as host counts increase, conservative retry/timeouts, event retention bounds and supported provider placement. Measure representative multi-host paths before publishing capacity claims.
7. Keep native AHP behavior, private extension protocol version, package version and internal host protocol version distinct.
8. Update module READMEs, guides, public examples, migration/cutover instructions and remaining limitations to verified behavior. Resolve acceptance and review evidence for the exact final candidate.

## Decisions to resolve

- Declare the actual validated runtime/database/Kubernetes-manifest versions and known operational limits without inventing a production scale guarantee.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H9-01 | Scenario A works through the documented minimal public example with no distributed services. | Run the example and actual native/tool/work paths under the pinned toolchain. |
| H9-02 | Scenario B proves standby health, one active owner, failure takeover and safe rolling drain. | Real processes plus PostgreSQL; observe readiness, old-owner fencing and restart recovery. |
| H9-03 | Scenario C proves custom application namespaces and isolation under identical resource identifiers. | Two namespaces and multiple host IDs through the public API and trusted namespace selection. |
| H9-04 | Scenario D proves horizontal serving with per-session authority and shared-namespace host admission. | At least two active session owners; deliberately send public traffic to non-owner ingress and reconnect elsewhere. |
| H9-05 | The security matrix holds across network delays, revocation, dropped hints and host loss. | Run the cross-host negative proofs from H1/H2/H5/H6/H8, including zero effects and zero unauthorized disclosure separately. |
| H9-06 | Deployment examples are valid and their readiness/drain/identity settings match SDK behavior. | Validate manifests with available tooling and a local smoke environment when available; record any unexecuted deployment test explicitly. |
| H9-07 | Examples carry no secrets and impose no mandatory optional infrastructure on default consumers. | Inspect config imports/environment docs and run single mode without distributed dependencies. |
| H9-08 | Resource bounds and performance evidence are concrete and reproducible. | Record fixture sizes, process count, pool usage, retained queues, p50/p95 for measured paths and cleanup; no blanket production-throughput claim. |
| H9-09 | Migration and compatibility documentation matches the tested upgrade/cutover behavior. | Populated fixture upgrade, incompatible binary rejection, failure recovery and declared rollback support. |
| H9-10 | The final candidate passes required repository and PostgreSQL gates with reconciled evidence. | pnpm validate, actual migrated PostgreSQL conformance and applicable public examples; record exits and candidate identity. |
| H9-11 | Independent final review inspects the integrated tree and resolves all required findings. | Reviewer evidence, dispositions and targeted rechecks after fixes; no approval from checkbox count or author narrative alone. |
| H9-12 | Users and the next agent have a complete truthful handoff. | README/API mappings, ACCEPTANCE, packet handoffs and NOTEPAD agree on verified, pending and blocked scope. |

## Verification targets

- src/tests/host/topologies.integration.test.ts (proposed)
- Proposed examples for default, replicated, partitioned and distributed host configuration
- Existing examples/postgresql-conformance.ts and public SDK examples

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host
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

Complete [the packet handoff](../handoffs/H9.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Completion requires evidence for all A–D scenarios. A skipped database or multiprocess gate leaves the corresponding scenario unverified.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


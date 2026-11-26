# H4 — Namespace isolation and allocation

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H4.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Let applications allocate configured namespaces to hosts with complete isolation and a supported path to shared-namespace ownership.

## Prerequisites

- H2
- H3
- DECISIONS D01 and D05 resolved

## Existing owners and source anchors

- `./database/migrations/0003_durable_session_resources.sql`
- `./src/persistence/helpers/durability/types.ts`
- `./src/authorization/types.ts`
- `./src/agents/helpers/directory.ts`
- `./src/work/helpers/views/helpers.ts`
- `./src/sessions/helpers/recovery/helpers.ts`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Implement the reviewed namespace storage model through existing persistence ports. A dedicated database/schema binding may be the smallest first implementation; shared-table tenancy is optional only if all scoped keys/queries/constraints are designed and tested.
2. Bind the canonical namespace to storage and trusted host membership. Do not concatenate untrusted namespace strings into SQL identifiers, trust client headers as authority, or treat a URN prefix as isolation.
3. Audit session/resource uniqueness, registration identity, work idempotency, policy scope, ownership, caches, cursors, subscriptions, recovery, events and purge against the chosen namespace boundary.
4. Keep security domain separate from namespace. Define their relationship and preserve exact ResourceRef/session incarnations without rewriting native AHP URI formats.
5. When one process serves several namespaces, capture the selected namespace with each connection/request and keep its storage, sequence and security composition scoped. Never resolve a namespace from ambient mutable process state.
6. Permit explicit application allocations, one host in multiple admitted namespaces where configured, and multiple authorized host IDs in the same namespace. Do not introduce Kubernetes API dependency.
7. Default allocation is explicit and predictable. For dynamic placement, filter by membership, claims, readiness, provider/driver compatibility and storage access before balancing load; do not rebalance live sessions incidentally.
8. Create/delete/recreate namespace operations must have an explicit trusted administrative boundary. Deletion cannot silently delete active sessions, work or provider resources.

## Decisions to resolve

- Resolve whether namespace scope is carried by an adapter instance or by each operation; never mix both implicitly. Record all identifiers whose uniqueness remains global within a namespace.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H4-01 | Two namespaces can hold otherwise identical public identifiers without sharing data or authority. | Same session URI, agent key and request key in independent namespaces; authorized local success, cross-namespace denial. |
| H4-02 | A host admitted to one namespace cannot join, read, route or mutate another by changing request fields. | Public and internal hostile-input tests; verify no foreign counts/cursors/events or existence disclosures. |
| H4-03 | Multiple host IDs share one namespace only under the configured admission/allocation policy. | Allowed and denied membership/ownership combinations; no bypass by changing topology mode. |
| H4-04 | An explicitly configured host can serve more than one namespace without cache/key collisions. | Concurrent operations and cleanup for equal IDs in both namespaces; no global mutable currentNamespace. |
| H4-05 | Scoped pagination, subscription reset and retirement stay within the namespace. | Replay a cursor/token from another namespace; retire/recreate matching resource names and reject stale references. |
| H4-06 | Allocation excludes unready, draining, expired or incompatible members. | Competing allocations plus stale load reports; placement eligibility is authoritative even when load estimates are stale. |
| H4-07 | Namespace mapping remains stable over pod restart and host display-name changes. | Restart fixture; explicit reconfiguration never silently relocates existing durable data. |
| H4-08 | Namespace destruction/recreation follows the recorded lifecycle contract. | Active dependencies prevent destructive deletion; permitted recreation cannot accept earlier memberships or ownership tokens. |
| H4-09 | All namespace-sensitive storage and process-local key paths are covered by an inventory. | Source-backed key/query/constraint/caching table reviewed against the tests, including recovery and terminal-history purge. |

## Verification targets

- src/tests/host/namespaces.integration.test.ts (proposed)
- src/tests/persistence/conformance/namespaces.ts (proposed)
- Existing work views, exact-reference and incarnation tests

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/namespaces.integration.test.ts src/tests/work/views.test.ts
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

Complete [the packet handoff](../handoffs/H4.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Do not claim namespace isolation from configuration-only filtering or naming conventions.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


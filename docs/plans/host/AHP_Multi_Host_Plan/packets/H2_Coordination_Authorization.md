# H2 — Durable coordination and authorization freshness

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H2.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Extend the persistence and authorization boundaries so membership, ownership and current authority can be checked coherently across processes.

## Prerequisites

- H1
- DECISIONS D03, D04 and D05 resolved

## Existing owners and source anchors

- `./src/persistence/helpers/durability/types.ts`
- `./src/persistence/helpers/adapters/postgres/helpers/ownership/helpers.ts`
- `./database/migrations/0003_durable_session_resources.sql`
- `./src/authorization/types.ts`
- `./src/authorization/helpers/evaluate/helpers.ts`
- `./src/authorization/README.md`
- `./src/persistence/helpers/adapters/postgres/README.md`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Treat postgresCoordination as the PostgreSQL adapter for required shared behavior, not a replacement domain service or duplicate persistence framework. Keep SQL, pools, database clocks and lock behavior within the persistence adapter.
2. Specify durable membership identity, namespace admission/config revision, instance generation, expiry, draining status, and session ownership epoch. Use distinct existing epoch concepts rather than overloading work executionEpoch.
3. Define acquire/renew/release/replace transitions, conditional updates, stale no-op/error behavior, transaction isolation and one documented lock order across membership, session, resources and agent registration.
4. Put authoritative ownership and relevant membership/policy-generation checks in the same protected transaction boundary as the corresponding durable mutation. An earlier coordinator lookup followed by an unguarded write is insufficient.
5. Extend the existing authorization freshness/admission contracts. Choose a concrete authority model for mutable bindings, grants and revocation across owners: routing to an authoritative owner and/or a shared authoritative adapter. Reuse the canonical evaluator; do not create a second policy engine.
6. LocalDecisionStamp, weak-provenance binding tokens, callbacks and AbortSignals remain process-local. Remote processing must reauthenticate/reconstruct authority through trusted inputs and the selected authority model.
7. Specify the linearization boundary for revocation and admitted work. Preserve the existing distinction: an already admitted mutation can commit, while later success disclosure may be withheld. Never promise that revocation retracts sent bytes or reverses external effects.
8. Define fail-closed behavior for loss of currentness proof. Events accelerate invalidation but are not proof that a cached grant remains valid. TTLs, if used, must state their exact supported staleness contract and cannot silently weaken accepted revocation semantics.
9. Require compatible policy/catalogue/driver revisions across members; do not pretend a callback hash verifies arbitrary code or serialize callbacks into PostgreSQL.
10. Design forward migrations for existing durable data, old-binary admission prevention and rollback/cutover. Preserve migration history and existing exact resource/work identities.

## Decisions to resolve

- D04: authoritative authorization/currentness model, including grant changes and remote disclosure checks.
- D05: namespace storage binding, ownership schema, migration/cutover and mixed-version compatibility.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H2-01 | Membership acquisition is atomic across real processes and refuses duplicate/conflicting instance claims. | Two PostgreSQL clients/processes race the same identity; one effective membership and bounded cleanup. |
| H2-02 | An expired or replaced membership cannot renew or release its successor. | Pause old renew/release across takeover; condition on the captured generation/epoch and fresh database time. |
| H2-03 | An old owner cannot mutate after a replacement ownership epoch is effective. | SQL barriers before admission and inside admitted transactions; prove old late admissions fail and takeover respects already admitted writes. |
| H2-04 | A policy/grant revocation defeats new stale admissions even when all invalidation notifications are dropped. | Two real hosts, authoritative revoke and delayed mutation; verify zero disallowed mutation, not merely a denied reply. |
| H2-05 | Revocation after permitted admission follows the documented commit/disclosure boundary. | Observe committed state independently and verify that now-unauthorized success/details are withheld; distinguish bytes already sent. |
| H2-06 | Local proof objects copied across host/process boundaries confer no authority. | Serialize/forge stamps and installation tokens; remote receiver rejects them or reconstructs new verified local authority. |
| H2-07 | Loss of the coordinator/database closes admission without waiting for a readiness probe. | Partition/terminate ownership channel while requests queue; observe denied admission and bounded resource release. |
| H2-08 | Memory and PostgreSQL adapters implement the same advertised transitions. | Portable conformance plus real-SQL locking/expiry tests; reject distributed claims for unsupported adapters. |
| H2-09 | Migration preserves a populated P0–P5 fixture and rejects incompatible old writers. | Compare canonical references, revisions, immutable work intent and terminal history before/after; test declared cutover and rollback limitations. |
| H2-10 | A consistent lock order and bounded pool/transaction policy survive competing ownership, retirement and revocation operations. | Controlled lock contention/deadlock probes, sanitized diagnostics and no checked-out-client leaks. |

## Verification targets

- src/tests/persistence/conformance/hostCoordination.ts (proposed)
- src/tests/persistence/adapters/postgres/hostCoordination.ts (proposed)
- src/tests/host/authorization.integration.test.ts (proposed)
- Existing PostgreSQL p0Conformance and durableWork suites

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/authorization.integration.test.ts src/tests/persistence
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

Complete [the packet handoff](../handoffs/H2.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Shared-mode admission remains disabled until the authority model and the stale-owner/revocation races pass real PostgreSQL checks.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


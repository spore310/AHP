# AHP V1 — implementation handoff for P0–P5

**Prepared:** November 22, 2026.  
**Source baseline:** develop at `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Implementation checkout named by the user:** `GLM/agentIdentity`; reconcile its actual diff before editing.  
**Review status:** ready for implementation against the stated baseline after source/static review. No repository implementation, migration execution or runtime test result is included.

## Start here

Read [00_Shared_Contracts.md](00_Shared_Contracts.md), [01_Wire_and_Service_Contracts.md](01_Wire_and_Service_Contracts.md), and this handoff, then execute one packet at a time in order. [AHP_V1_P0_P4_Database_Schema_Plan.md](AHP_V1_P0_P4_Database_Schema_Plan.md) is the complete combined edition; its original filename is retained, and its contents now include P5. The split packets are the same plan in implementation-sized units.

The user's additional JSON requirement is pinned: canonical resources and work items each have bounded application-owned `data` with independent dataRevision CAS. Work also preserves immutable `submitted_data` for retry comparison. Neither bag becomes an authority source. Root session application data belongs to its canonical root resource.

P5 is included with a corrected ownership split: generic Client/connection/RPC in `src/client`, tool contracts/client/execution in singular `src/tool`, generic policy in authorization, protected session views in sessions. ToolClient remains the meaningful tool adapter name. All unreleased private contracts end at V1, with no production legacy fallback.

## Packet order and gates

| Packet | Outcome | Named checks | Required completion evidence |
| --- | --- | ---: | --- |
| [P0](P0_Durable_Sessions_and_Resources.md) | Durable exact identities, lifecycle/recovery hooks, state codec, host fence, data CAS | 24 | Real PostgreSQL lifecycle + restart + public SDK behavior |
| [P1](P1_Work_Contracts_and_Data.md) | Work intent, priority, exact selections, mutable data and immutable replay | 22 | Storage-neutral and real-SQL invariants; strict V1 fixtures |
| [P2](P2_Work_Authorization_and_Hooks.md) | Existing-auth extension, typed parties, work-scope guard and consumer callbacks | 23 | Adversarial policy/revocation/disclosure tests; remote mutation still closed |
| [P3](P3_Claims_Capacity_and_Diagnostics.md) | Atomic cap/priority claims, binding epochs, lease settlement, diagnostics | 21 | Real two-pool races, representative query evidence; then enable remote mutations |
| [P4](P4_Events_Snapshots_and_Chat_Projection.md) | Post-commit hints, bounded authorized reconciliation and replaceable chat projection | 22 | Snapshot/event races, dropped hints, memory limits and public binding test app |
| [P5](P5_Tool_and_Client_Boundaries.md) | Tool/client ownership cleanup and one supported private V1 tool shape | 19 | Real SDK boundary, portable runtime import/use and no legacy execution path |

There are **131 named acceptance checks**, plus the wire supplement's contract fixtures and the final `pnpm validate` gate. These are requirements, not claimed passing tests.

## Preflight for the coding agent

1. Read `.agents/AGENTS.md`, applicable task hooks, architecture/ownership instructions and `docs/CodingRules.md` in the actual checkout. Preserve current unrelated work.
2. Record branch, HEAD, status and the diff from the pinned baseline. The packet paths are source anchors; inspect post-baseline modifications before adapting them. Do not reset, switch or overwrite the user's working branch merely because this plan inspected develop.
3. Use repository-pinned Node/pnpm and the installed lockfile. At the inspected commit: Node 24.21.0, pnpm 10.34.6, TypeScript 5.9.3, Microsoft package 1.0.0. Record any deliberate dependency change separately; none is required by this plan.
4. Establish relevant baseline tests. A preexisting failure must be recorded and distinguished from a regression, not silently accepted as the new baseline.
5. Provision a disposable migrated PostgreSQL 17 database through the existing local test setup and `AHP_TEST_DATABASE_URL` loopback guard. Tests that need SQL must fail/mark the phase blocked when that environment is absent; they must not silently skip or use a production database.
6. Preserve the one authoritative host operating boundary. Two pools in one host are required for race tests; two concurrently active hosts for one logical store are intentionally rejected.

## SQL artifacts and migration policy

[AHP_V1_Target_Schema.sql](AHP_V1_Target_Schema.sql) is the complete **fresh empty-schema reference**, not an upgrade script. It declares 10 tables. Author forward `0003_durable_session_resources.sql` and `0004_work_policy_scheduling.sql` in the existing migration runner and test all four migrations on a fresh database. Keep 0001/0002 history unchanged.

The default 0003 preflight refuses nonempty old sessions/work/registration tables. Those rows lack trusted domain/incarnation/submitter facts. Do not invent ownership or drop data. A reset or application mapping is a separate explicitly authorized development-data action, not a compatibility layer required for released consumers.

[AHP_V1_Schema_Smoke.sql](AHP_V1_Schema_Smoke.sql) is an optional raw-DDL fixture test. It was authored and statically inspected here but **not executed**. It checks root consistency, composite FK boundaries, opaque instance IDs, positive-scope preservation/rekey, lease/result/data checks, sequential CAS and URI reuse, then rolls back its fixture. It does not test policy, concurrent transactions, adapter commit handling or provider recovery.

For an explicitly disposable empty database only:

```sh
psql "$AHP_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f AHP_V1_Target_Schema.sql
psql "$AHP_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f AHP_V1_Schema_Smoke.sql
```

The migration-conformance path should separately apply actual 0001–0004 and run the same invariants. Never apply both the fresh reference and the migrations into the same already-created schema.

## Definition of done for every packet

- Implement the documented behavior through the existing owners and strict runtime schemas; update all active callers, mocks, fixtures and the in-memory adapter.
- Add meaningful counterexample/concurrency tests from the packet; use controlled promises/SQL barriers rather than long sleeps.
- Run the focused suites and relevant test app, then `pnpm validate` under the repository's required gate. For SQL phases, also run real PostgreSQL conformance.
- Update current README/API documentation to implemented facts. Preserve proposed-vs-current labels for future phases; do not rewrite historical narratives as though they never existed.
- Record actual commands/results and remaining limitations in [03_Acceptance_Matrix.md](03_Acceptance_Matrix.md). A mock pass is not a database pass; an internal kernel fixture is not a public createAHPServer/pinned-SDK integration pass.
- Review authority bypasses, async gaps, commit uncertainty, lease races, late cleanup, bounds, import cycles and deletion semantics before moving to the next packet.

## Scope that stays outside these packets

No active/active hosts, SQL-backed authorization grant store, durable work event outbox, exactly-once external effects, model execution runtime, automatic native chat turns, background queue daemon, arbitrary JSON query/index system or published npm exports redesign. These are explicit operating limits, not missing implementation tasks disguised as completion.

## Handoff prompt

> Implement P0 from this accepted AHP V1 packet set in the existing authorized checkout. Read the shared contracts, wire supplement, pinned-source review and current repository instructions first. Reconcile branch drift without discarding existing work. Implement only P0 and the minimum P1-schema scaffolding explicitly required for buildability; keep remote work mutations closed until P3. Run the P0 test app, repository gate and real PostgreSQL acceptance, update the evidence ledger, and review the diff. Report concrete changes, test results and any blocked gate. Do not implement P5 early or replace consumer policy with owner-only shortcuts. Continue subsequent packets in order when the task's authorization covers them.

The overall user request authorizes this complete plan, not repository implementation by the planning assistant. The local coding agent can receive the full-stage implementation instruction separately, or use this per-packet prompt.

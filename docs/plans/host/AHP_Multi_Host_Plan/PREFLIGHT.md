# PREFLIGHT — Verify the previous plan, archive completed scope and close the design gate

**Mode:** local evidence review and scoped documentation execution. **Executed:** see [the preflight handoff](handoffs/PREFLIGHT.md). **Dependencies:** actual checkout and repository instructions.

## Outcome

Establish a trustworthy baseline for multi-host planning. Verify P0–P5 against their original scope, archive only the completed and validated scope, preserve proposed provider/client work, and make the next packet set concrete enough for review and execution.

## Read set

- AGENTS.md, .agents/AGENTS.md, applicable hooks, architecture-aware-delivery, documentation-drift and documentation skills, and docs/CodingRules.md in the actual checkout.
- docs/plans/plan.md, docs/plans/work/README_Codex_Handoff.md, shared/wire contracts, P0–P5 packet specifications, source review, acceptance ledger, manifest and schema reference artifacts.
- docs/plans/work/ProvidersPlan.md, its top-level pointer, active plan indices, docs/archive/README.md and archive file index.
- Relevant implementation, tests and gates referenced by the acceptance evidence; expand only along dependencies that affect the verdict.
- This plan's CURRENT_STATE, CONTRACTS, DECISIONS and all H0–H9 packet requirements.

## A. Establish the actual candidate

Record branch/HEAD, relevant working-tree changes, remote baseline and toolchain. The inspected feature/ahp-v1 SHA is a starting reference, not an instruction to reset or overwrite a newer checkout. Verify any newer descendant or divergence. Preserve unrelated edits; use an isolated worktree if useful and authorized, rather than stashing/resetting the user's work.
Use installed pinned Node/pnpm and lockfile. Inspect available local test/database setup before running it. If the ignored PostgreSQL helper is absent, follow the repository's documented manual disposable-database procedure; do not fabricate a successful harness invocation.

## B. Sweep the previous packet scope

Map every original acceptance ID to its current source, test and recorded result. Reconcile the 131 P0–P5 criteria, supplemental wire fixtures and required final gates. Inspect final-candidate review evidence and relevant deltas; a ledger status or test count is not sufficient by itself.
Run the applicable current verification: repository validation, required public examples and real PostgreSQL lifecycle/conformance checks. Verify actual applied migration versions. Recorded historical success and current execution are separate columns. Reuse one valid gate run for the same candidate; repeat only when inputs change or a required final gate demands it.
If a regression or an unproven requirement appears, keep that scope active and report the concrete failure. This task does not authorize silently repairing product source. Multi-host features excluded by P0–P5 are new scope, not evidence that P0–P5 failed.

## C. Make and execute a selective archive decision

Create a compact inventory in handoffs/PREFLIGHT.md: current path/scope, implementation verdict, evidence, archive/retain/superseded decision, destination or active pointer.
Follow the repository archive convention. A proposed destination for the completed packet bundle is docs/archive/plans/ahp-v1/; inspect existing names before choosing it. Move the completed P0–P5 packet/contracts/evidence/schema-reference material and the old execution plan only when justified. Do not move the still-proposed ProvidersPlan scope merely because it is in the same folder.
Preserve historical acceptance IDs, candidate identities, dates and manifests/checksums. If link repairs change archived bytes, record the move/link change and keep original checksum provenance tied to the original commit; never regenerate a historical checksum and pretend it is the original evidence.
Update scoped active-plan links, archive navigation and inbound references. Leave remaining work explicitly active and discoverable. Use tracked moves and inspect the complete diff; avoid broad unrelated documentation cleanup.

## D. Finalize this target plan

Inspect the current API/contracts and resolve D01–D08 with precise types, transitions, adapter ownership, SQL/migration requirements and test boundaries. The local orchestrator may revise this planning candidate where source evidence requires it, while preserving accepted intent and every required outcome.
Complete a reuse table for proposed API additions. Do not introduce a new authority engine, duplicate namespace concept, second session factory or unnecessary service just to match a diagram.
Review dependencies across H0–H9, fill any missing exact contract details and update the acceptance cross-reference. A packet remains blocked if its required authority/ordering/storage decision is unresolved. Keep safe independent plan work moving.

## E. Review and close out

Use authorized bounded subagents for independent evidence when useful; the lead integrates and owns all shared documents. Resolve findings with sources or counterexamples, not a vote. Respect the repository review policy and identify whether review was independent.
After authorized documentation changes, run the repository's required final gate for that candidate, check links and inspect the diff. Record exactly what passed or could not run. Stop at a truthful planning handoff; feature execution starts only under the selected execution authorization.

## Acceptance criteria

| ID | Required result | Proof needed |
| --- | --- | --- |
| PF-01 | Record the actual local branch, HEAD, staged/unstaged/relevant untracked changes and pinned toolchain. | Git/status evidence and an explicit choice of baseline; preserve unrelated work. |
| PF-02 | Inspect every P0–P5 acceptance requirement against implementation, tests and final-candidate evidence. | 131-row traceability inventory with current source/test locations and historic-versus-rerun evidence. |
| PF-03 | Verify the required current baseline gates in a disposable environment. | pnpm validate plus applicable public examples and real PostgreSQL conformance; prove actual migration versions. |
| PF-04 | Classify each previous-plan document before moving it. | Archive, still active, superseded, or validation incomplete; include mixed ProvidersPlan scope and reasons. |
| PF-05 | Archive only scope whose implementation and required evidence support closure. | Tracked moves, preserved ledger/candidate identities and updated active/archive navigation; no blanket folder move. |
| PF-06 | Preserve history and outstanding requirements. | Original manifests/checksums retain their meaning; unresolved scope has an active pointer and owner. |
| PF-07 | Close the terminology and reuse review. | Each proposed abstraction maps to an existing owner/contract or has a concrete reason existing ones cannot express the requirement. |
| PF-08 | Resolve or explicitly block all eight architectural decisions. | DECISIONS records chosen contract, rejected alternative, source evidence, failure semantics and proof; dependent packets cannot pass with unresolved blockers. |
| PF-09 | Review the integrated plan with authorized independent assistance when available. | Bounded reviewer report with file/criterion references, dispositions and targeted recheck; honestly identify missing independent review. |
| PF-10 | Produce coherent plan and handoff artifacts for the actual candidate. | PROMPT, README, HANDOFF, NOTEPAD, ACCEPTANCE, packets and packet handoffs agree; statuses are factual. |
| PF-11 | Keep planning/archival changes within their authorized scope. | Final diff contains scoped documentation/archive changes only; defects requiring source edits are reported for a separate authorized slice. |
| PF-12 | Satisfy repository gates for the final documentation candidate. | Run required final validation after changes, inspect links and source mappings, and record any unavailable gate rather than marking it passed. |

## Required outputs

- Updated root HANDOFF, NOTEPAD, DECISIONS and ACCEPTANCE.
- Completed handoffs/PREFLIGHT.md with source/test inventory, archive decision and actual commands/results.
- Reviewed H0–H9 packets and truthful per-packet handoff status.
- Scoped repository archive/index changes when evidence permits.
- A final verdict: PLAN READY, or PARTIAL/BLOCKED with the exact missing evidence and affected scope.


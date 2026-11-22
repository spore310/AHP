# AHP persistence refactor — GLM packet bundle

**Status: PLAN READY, not implemented.** Target branch: `agentIdentity`.
Source checkpoint: `f2804963129403e666a6e929db92beb9b2ab761d`.

The target is an ORM-like domain repository object, with database/ORM-specific
mechanics confined to `src/persistence/helpers/adapters/`. PostgreSQL is the
first adapter; no additional production database is added in this task.

## Start here

Read [TASKPLAN.md](TASKPLAN.md) for scope and sequencing, and
[CORE_CONTRACT.md](CORE_CONTRACT.md) for the frozen interface and invariants.
Give [GLM_EXECUTION_PROMPT.md](GLM_EXECUTION_PROMPT.md) to the existing authorized
runner, then assign [P00](packets/P00.md). Execute one packet at a time.

There are 14 packets, P00–P13. The packet graph in the task plan is authoritative.
Small scope, explicit write ownership, deterministic checks and a handoff make
progress resumable without needing the complete conversation in every context.

## Supporting material

- [Acceptance matrix](ACCEPTANCE_MATRIX.md): all implementation checks start NOT RUN.
- [Architecture plan review](reviews/REVIEW_1_ARCHITECTURE.md).
- [Correctness plan review](reviews/REVIEW_2_CORRECTNESS.md).
- [Source evidence](SOURCE_EVIDENCE.md).
- [Packet handoff](templates/HANDOFF.md).
- [Execution ledger](templates/LEDGER.md).
- [Delivery validation](DELIVERY_VALIDATION.md): artifact checks only.

## Suggested repository placement

Keep the folder together under
`docs/plans/persistence-agnostic-refactor/` so relative handoff links work.
Do not extract over application source. The bundle contains planning documents,
not a patch, executable hooks, dependencies or database migrations.

No repository writes, code-agent execution or live database tests were performed
while preparing this handoff. The two delivered plan reviews are honest sequential
self-reviews, not independent agent or double-blind evidence.

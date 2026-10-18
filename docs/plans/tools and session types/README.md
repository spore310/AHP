# Agent Hosting Protocol — Code-First Implementation Handoff

**Deliverable status: PLAN READY.** Repository checkpoint: `3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e`. No repository code was changed or implementation/reviewer agent launched while preparing this bundle.

## Start here

- [Master task plan](TASKPLAN.md) — the complete, long-form source-grounded contract, 12 packets, 100 acceptance scenarios, review procedure, and future-phase boundaries.
- [Goal-mode execution prompt](GROK_GOAL_EXECUTION_PROMPT.md) — paste into the user's existing authorized local runner; no assumed proprietary goal syntax.
- [Acceptance matrix](ACCEPTANCE_MATRIX.md) — test/gate inventory; all cases start NOT RUN.
- [Deferred persistence](FUTURE_PERSISTENCE.md) — keeps the five-table direction without authorizing its implementation.
- [Source evidence](SOURCE_EVIDENCE.md) — exact source checkpoint, primary references, and verification limits.

## Context-efficient execution

Open only the current [work packet](packets/WP-00.md) after reading the master architecture contract. `packets/WP-00.md` through `packets/WP-11.md` are generated from the exact master packet text, not independent competing plans. Use [one ledger](templates/TASK_LEDGER.md).

## Review materials

Use [the review protocol](review/REVIEW_PROTOCOL.md), [neutral requirements](review/NEUTRAL_REQUIREMENTS.md), [reviewer prompt](review/BLIND_REVIEWER_PROMPT.md), [report template](review/REPORT_TEMPLATE.md), and [adjudication template](templates/ADJUDICATION.md). A/B receive the same neutral package. The bundle does not contain completed independent reports.

## Installation / scope

These are handoff documents, not application source and not a plugin. Do not blindly extract over existing source or replace `.agents` instructions. Copy the master into an authorized planning location such as `docs/plans/ToolContracts-SessionTypes-CODE-FIRST.md`, or keep the bundle outside the checkout and reference it from the local task. Publish only scoped approved implementation/report artifacts in the repository; keep sealed reviewer identity mapping and scratch experiments private.

Application code first. No SQL, Redis, tool runner, model runtime, remote writes, or persistence implementation in this goal.

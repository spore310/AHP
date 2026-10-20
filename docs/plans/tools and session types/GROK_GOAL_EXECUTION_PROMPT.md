# Local Goal-Mode Execution Prompt

> **Historical prompt.** The code-first goal described here has already been
> implemented through `2f9900a`. Do not re-run this prompt as a current task.
> See [CURRENT_STATE.md](CURRENT_STATE.md) for current behavior and remaining
> deferred work.

Implement the code-first phase of `TASKPLAN.md` in the current `spore310/AHP` checkout. Use the existing repository's `.agents` workflow. The intended executor is the user's chosen Grok model, but do not assume a particular runner, command syntax, free quota, or subagent capability from that name.

## Goal

Deliver working versioned tool contracts, an in-memory exact-version tool catalogue, application session types with pinned tool assignments, normal AHP sessions created from those types, server-authored allowed-tool manifests, and atomic validation of typed client tool advertisements. Preserve the public-factory architecture so an application can compose this without writing JSON-RPC or WebSocket code.

## First actions

Read root `AGENTS.md`, `.agents/AGENTS.md`, `.agents/hooks/task-execution-review.md`, the architecture-aware-delivery skill, and `docs/CodingRules.md`. Inspect branch/HEAD and all relevant staged/unstaged/untracked changes. Do not reset or replace anyone's work. Read `TASKPLAN.md` sections 0–10, then `packets/WP-00.md`; use one task ledger for the rest.

The reviewed source checkpoint is `3eeb31eebb0498d4fb1f0a5de60ca3b5677f744e`. Reconcile changes since that checkpoint; it is not a checkout/reset instruction.

## Execution

Execute WP-00 through WP-11 in dependency order. Work one bounded packet at a time. Freeze shared contracts before editing consumers. Add a regression/counterexample before or with each meaningful behavior change. Use actual pinned SDK APIs and existing source conventions. Report unsupported harness features rather than inventing tools or command flags.

This task authorizes the scoped application code, tests, and documentation changes described in the plan, plus one exact schema-validator dependency if needed and verified under WP-01. It does not authorize broad dependency upgrades, unrelated refactors, external writes, purchases, new accounts, disabling safety/confirmation rules, or infrastructure provisioning. Follow the user's existing local commit permission; when commits are not authorized, leave an inspected diff and report it. Never push, merge, or deploy as part of this goal.

## Hard boundaries

No SQL, migration, ORM, Redis, replay journal, persistence repository, tool runner, Pi process, model API, MCP execution service, or additional deployment. Do not serialize live SessionRecord/activeClients state as a persistence shortcut. The future five-table direction is retained only as the next-phase design. Stop at the code-first completion boundary.

Do not fill `serverTools` with client-only catalogue definitions. Use the agreed namespaced application metadata and keep standard AHP method shapes intact. Catalogue inclusion is not authority to invoke a tool. Tool and type versions are exact and immutable. Native config selection must not bypass provider validation or create an untyped escape route in a typed host.

## Independent review

Use two real independent read-only reviewer assignments when supported and permitted. Follow `review/REVIEW_PROTOCOL.md`, give each the same `review/NEUTRAL_REQUIREMENTS.md` plus frozen candidate, and seal both reports before reveal. Keep max two concurrent subagents, no nested delegation, and the actual repository/harness assignment limits. Reuse reviewer assignments for targeted rechecks; do not hide extra launches under labels.

Prefer a neutral human/harness custodian for model/author anonymization and report sealing. If the harness cannot enforce those conditions, say so. Two self-review personas are not independent double-blind review. If independence cannot run, finish safe available implementation/checks and report `IMPLEMENTED / INDEPENDENT REVIEW PENDING`, not VERIFIED.

## Goal loop and termination

After each packet: run focused checks, inspect the diff, update the ledger, and identify the next dependency-ready packet. After a failure: capture the real output, revise one concrete hypothesis, make a bounded repair, and rerun the relevant check. After two unsuccessful repairs of the same criterion, obtain new evidence or isolate the blocker; do not keep generating random edits or weaken tests.

At compaction or quota exhaustion, checkpoint actual candidate, owned files, completed checks, unresolved findings, and next safe action. Do not switch to a billed model/account or continue beyond trial limits without permission.

Before completion, run `pnpm validate` and `git diff --check` on the final candidate, adjudicate the sealed reviews with source/test evidence, update scoped docs, and list remaining inherited limitations. Stop. `FUTURE_PERSISTENCE.md` is a later handoff, not the next packet of this goal.

## Final response required

Give candidate/base identity, implemented APIs and scope, exact checks/results, review condition and verdict, findings resolved/unresolved, public reuse proof, changed paths/dependency, and confirmation that persistence/execution infrastructure was not implemented. Use truthful incomplete statuses when any required gate is missing. Never claim a run, commit, reviewer, or successful test that did not occur.

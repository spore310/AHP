# Task Execution and Review Hook

**Kind:** instruction-driven lifecycle hook. **Version:** 1.0.

This file defines checkpoints the coding agent must follow when routed here by
`.agents/AGENTS.md`. It is not a Git hook, a native harness callback, a daemon,
or a security boundary. Merely creating this file does not register a callback.
Do not add a server runtime or invoke another model to execute this hook.

## Activation and mode

Activate for repository-specific task planning, implementation, debugging,
refactoring, test work, and explicit code/architecture/security/quality reviews.
Skip general explanations, casual discussion, and unrelated work.
A typo-only edit uses the skill's fast path, not a multi-agent ceremony.

Read [architecture-aware-delivery](../skills/architecture-aware-delivery/SKILL.md)
once for the task. Treat these as logical checkpoints, not SDK event names:

| Checkpoint | Required action | Condition to proceed |
| --- | --- | --- |
| Task intake | Identify mode, user authorization, baseline, risk, and owning module. | Scope and current-vs-target intent are explicit. |
| Before plan completion | Map affected boundaries, check the plan, and define acceptance evidence. | No unresolved blocking architectural conflict. |
| Before the first edit | Check file ownership, tests, and the current contract. | Execution is authorized and the plan gate passes. |
| Before delegation | Apply the delegation rules and issue a bounded work packet. | Tools, budget, isolation, ownership, and useful output are established. |
| After a coherent implementation slice | Run focused checks; inspect scope and contract changes. | Evidence supports continuing, or the slice is explicitly incomplete. |
| Before a completion claim | Review the actual final candidate and reconcile all acceptance criteria. | Required evidence exists for that exact candidate. |
| After compaction, a changed requirement, or an external edit | Refresh affected evidence and ownership; invalidate stale checks. | The next operation is based on current files and instructions. |

Mode is an authorization boundary:

- **Plan-only:** inspect and produce/revise the requested plan; do not implement it.
- **Review-only:** inspect and report; do not apply findings or commit changes.
- **Execute:** implement only the authorized scope; use the planning and review gates.

Writing a requested report or plan is allowed in its requested location. The
mode does not forbid tools needed to inspect evidence, but tests/builds that
write files or run services must respect the harness permissions and workspace.

## Gate results

Use `PASS`, `REVISE`, or `BLOCKED`, with a short evidence-based reason.
A gate is the agent's recorded judgment, not user approval or independent proof.
Do not ask the user to approve routine steps that are already authorized.
Pause only the unsafe/dependent work when a material decision or permission is
missing; finish safe independent work and report the exact blocker.

Maintain one task record, not one document per tool call. Reuse a supplied task
plan. Keep low-risk records in the conversation; for delegated/resumable work,
use a task artifact only when writing that artifact is authorized.

## Interaction with existing hooks

An explicit code review must invoke the existing
[documentation-drift skill](../skills/code-review-documentation-drift/SKILL.md)
once within that review's scope. Preserve its prompt preference and approval
rules. Do not spawn a separate documentation reviewer or make an extra model
call solely for documentation drift.

An execution close-out checks whether changed contracts have documentation
impact, but it does not turn every edit, test, or commit into an explicit
code-review trigger. Run the full existing drift procedure when the task
actually includes an explicit review. Only the lead presents any consolidated
documentation-update question; workers return evidence instead of asking it.

Prevent recursion: a reviewer evaluates the assigned plan/candidate; it does
not create a second full planning workflow. A delegated worker uses its packet
and scoped checks; it does not recruit a team. Recheck a gate only when its
inputs changed or new evidence requires it.

## Never do these things

Do not silently broaden scope, fabricate tool/test results or subagents, change
models or credentials without authorization, rewrite unrelated files, or
convert an instruction checklist into a claim of enforced access control.
Do not block a Git command through a new Git hook. Do not claim completion just
because another agent said “done” or because a Markdown checklist is checked.

---
name: architecture-aware-delivery
description: Plan, execute, debug, and review repository changes using architecture evidence, bounded task contracts, verification gates, and selective subagents. Use for implementation tasks, task plans, and explicit code or architecture reviews. Do not use for unrelated discussion or expand plan-only/review-only requests into implementation.
metadata:
  version: "1.0"
---

# Architecture-Aware Delivery

Deliver the smallest verified change that satisfies the user's task while
preserving the surrounding system. Prefer explicit boundaries and observable
evidence to broad prompts such as “consider the architecture” or “review it.”

This is a model-neutral development workflow. Role names below are assignments,
not model IDs. It neither starts agents nor grants additional tool permissions.

## Read only what this task needs

Always read the repository instructions and the directly relevant code, tests,
and accepted plan. In AHP, also read [AHP constraints](references/ahp-context.md).
Do not treat an old example or remembered review as current implementation.

| Situation | Additional resource |
| --- | --- |
| Nontrivial plan, unfamiliar boundary, or cross-module change | [Architecture checks](references/architecture.md) |
| Possible delegation or independent review | [Delegation rules](references/delegation.md) |
| Plan critique, explicit review, or final execution review | [Review procedure](references/review.md) |
| Cross-file, delegated, or resumable task | [Task record](assets/task-record.template.md) |
| A subagent will actually be invoked | [Assignment packet](assets/subagent-assignment.template.md) |
| Findings need a durable requested report | [Review report](assets/review-report.template.md) |
| Applying this workflow to the AHP stabilization work | [Worked example](assets/ahp-stabilization.example.md) |
| Evaluating this skill itself | [Behavioral scenarios](tests/SCENARIOS.md) |

Do not read every resource by default. The task record is a compact external
working record, not a transcript of private deliberation. Record conclusions,
constraints, source pointers, decisions, and evidence rather than reasoning logs.

## 1. Intake: distinguish permission from capability

State the mode: `plan-only`, `review-only`, or `execute`. Record the requested
outcome, explicit exclusions, and authorized files/actions. Preparing a future
plan does not authorize its implementation. Review requests do not authorize fixes.

Inspect branch/HEAD and the working tree before a meaningful task. Include
staged, unstaged, and relevant untracked files when identifying the candidate;
HEAD alone is insufficient in a dirty tree. Do not reset, stash, switch branches,
or overwrite other work to manufacture a clean baseline.

Record available read/edit/test tools, independent subagent capability, and
known spend/concurrency restrictions. Unknown subagent availability means no
delegation until verified. Do not install a harness, invoke a paid API, or switch
to a different model/account to bypass a missing capability or limit.

Choose the highest applicable risk tier:

| Tier | Trigger | Minimum workflow |
| --- | --- | --- |
| Fast | Local, obvious, reversible edit; no contract, state, security, or ownership change. | Tiny context note, scoped edit, relevant check, final diff check. No subagent by default. |
| Standard | Nontrivial behavior inside an established boundary. | Context brief, work contract, plan critique, small implementation slices, evidence-based final review. |
| Elevated | Concurrency/lifecycle, security/identity, public protocol/API, persistence/migration, cross-module ownership, or unresolved architecture. | Explicit invariants/failure cases and independent plan/final review when available and authorized. Otherwise label self-review and the missing independent check. |

For fast work, use three short lines: owner and boundary; intended edit and
invariant; verification and scope result. Do not copy the full templates.

## 2. Build a bounded architecture brief

Find the owning module, its public contract, direct callers, state/resources it
owns, outgoing dependencies, and relevant tests. Expand only along a dependency
that could change the task's outcome.

For each material fact, supply a current path + symbol/line range, or the exact
accepted user constraint. Separate `observed`, `target`, `assumed`, and `unknown`.
Do not claim a library's capability from its name, a type cast, or an old answer;
inspect the pinned API/types and primary documentation when needed.

Write a compact flow such as `entry -> validation -> owner -> state -> output`.
Add the relevant failure/cleanup path, not a diagram of the entire repository.
Name what must NOT change. If a critical uncertainty affects safety or design,
resolve it before the dependent edit or mark that part blocked.

## 3. Define the work contract and critique the plan

Reuse the user's plan. Add only missing ownership, acceptance, dependency, or
verification details; do not replace an accepted target with an easier target.

Every slice needs: one outcome, owned files, forbidden changes, preconditions,
important invariants, failure scenarios, exact checks, and a stop condition.
Map each acceptance criterion to evidence that would distinguish success from a
plausible but wrong implementation. For a bug, specify a reproducer/regression
that should fail on the defective behavior and pass after the fix.

Critique the plan before implementation using [review](references/review.md).
Check architecture, testability, failure handling, order, and missing consumers.
Record `PASS`, `REVISE`, or `BLOCKED` with short reasons. A passing plan gate
permits only already-authorized work; it is not permission from the user.

Default plan loop: draft -> critique -> targeted revision -> recheck changed
assumptions. After two revisions without new evidence or convergence, split the
task or escalate the specific ambiguity. Do not create endless reviewer debates.

## 4. Choose solo work or a small team

Solo is the default. Use a subagent only for a bounded output that is either
independently valuable review/evidence or genuinely parallelizable implementation.
Read [delegation](references/delegation.md) before invoking one.

Default ceiling: two concurrent subagents, three distinct subagent assignments
per task, no nested delegation. These are workflow limits, not permission to
spend; user and harness limits take precedence. Reduce the team when tighter
limits apply. The lead owns cross-cutting contracts and final integration.

A sequential review by yourself is not an independent subagent review. A worker
cannot approve its own patch merely by changing its role label.

## 5. Execute one coherent slice at a time

Only in execute mode: confirm the approved scope and ownership are current,
create the focused regression where feasible, make the smallest implementation
change, run focused checks, and inspect the diff for unintended changes.

Do not redesign a shared interface while workers implement against its old
version. Freeze the boundary, update the contract, invalidate affected evidence,
and reassign dependent work before continuing. A proposed new dependency,
backend deployment, or security policy change requires explicit justification
and the appropriate authorization, not opportunistic scaffolding.

On failure: capture the actual failing output, categorize the cause, update one
hypothesis, make a bounded repair, then rerun the relevant check. After two
failed repair attempts for the same criterion, stop repeating edits: obtain new
evidence, narrow the reproduction, or request a focused review. Never weaken
acceptance criteria, disable tests, or hide exceptions just to produce green output.

Before compaction/handoff, preserve the task revision, candidate identity, owned
files, unresolved findings, completed checks, and next safe action. On resume,
re-read changed boundaries instead of trusting the summary as current code.

## 6. Review the actual candidate, not the completion narrative

Use [review](references/review.md). Inspect the final integrated files and
relevant callers/tests. Reconcile findings to acceptance criteria. Tests prove
only what was exercised; a green suite is not evidence of every architectural
invariant. Reviewer agreement is not a substitute for runtime or source evidence.

For explicit code reviews, use the repository's existing documentation-drift
skill once within scope. For approved documentation edits, use its documentation
skill. Preserve current/target distinctions and do not issue repeated update prompts.

After a fix, rerun affected checks and re-review the changed candidate. Earlier
passing evidence is stale for changed behavior, dependencies, or test setup.

## 7. Close with honest evidence

Use these status labels:

- **VERIFIED:** applicable acceptance checks and required validation passed for
  the final candidate; required reviews have supporting evidence.
- **IMPLEMENTED / VALIDATION INCOMPLETE:** changes exist but required checks
  could not run, failed, or remain unverified. Not “done.”
- **PLAN READY:** the requested plan is source-grounded and reviewed; no feature
  implementation or runtime validation is implied.
- **REVIEW COMPLETE:** report delivered with scope, findings, and verification limits.
- **BLOCKED / PARTIAL:** identify missing permission/evidence/decision and the
  safe work already completed. Never claim a full completion from a partial result.

Report scope/candidate, changes or plan, checks with actual results, architecture
impact, review findings, and remaining limits. Give commit IDs only for commits
that exist. Do not push, merge, deploy, or make external writes unless authorized.

For AHP execute tasks, `pnpm validate` is the final repository gate on the pinned
toolchain. Report baseline failures separately; they do not magically become a
passing final gate. For plan/review-only tasks, report checks actually run; do
not invent a runtime pass for a document. Preserve any stricter repository gate.

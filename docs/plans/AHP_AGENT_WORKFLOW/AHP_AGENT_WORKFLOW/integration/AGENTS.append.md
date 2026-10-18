<!-- architecture-aware-delivery:begin -->
# Architecture-Aware Task Delivery

For repository task planning, implementation, debugging, refactoring, test work,
and explicit code/architecture/security/quality reviews, read
[the task execution and review hook](hooks/task-execution-review.md) and follow
[architecture-aware-delivery](skills/architecture-aware-delivery/SKILL.md).
Use its fast path for trivial edits; do not impose a large plan on every task.

Honor plan-only, review-only, and execute permissions. Identify module ownership,
current-vs-target state, invariants, and acceptance evidence before nontrivial
changes. Review the plan before implementing and the final candidate before
claiming completion. Delegate only when supported, authorized, bounded, and
worthwhile; do not invent subagents or silently change models/accounts.

This is an instruction-driven lifecycle hook, not a Git hook or automatically
registered native callback. It composes with the existing documentation-drift
review procedure without duplicating its trigger, prompt, or review scope.

Development subagents remain outside the AHP product: no server-side model
inference, Pi execution, or agent runtime is authorized by this workflow.
<!-- architecture-aware-delivery:end -->

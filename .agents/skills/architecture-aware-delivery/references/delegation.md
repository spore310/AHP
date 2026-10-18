# Selective Subagent Delegation

These rules concern the user's development harness. They do not add an agent
runtime, coordinator, model API, or worker service to the AHP application.

## The dispatch decision

Delegate only when all necessary conditions are true:

| Condition | Required evidence |
| --- | --- |
| Available and authorized | A real subagent tool/runner is present, permitted, and within the user's model/account/spend limits. |
| Bounded useful output | A concrete patch, test, counterexample, or review question—not “help with the task.” |
| Adequate context | Current contract, relevant source pointers, task revision, acceptance criteria, and forbidden changes fit a concise packet. |
| Independence | Either implementation can proceed without a moving shared contract, or a fresh read-only review addresses meaningful risk. |
| Safe ownership | Explicit write ownership/isolation; no concurrent edits to the same shared boundary. |
| Worth the overhead | Explain briefly what time, context, or risk is saved compared with doing it locally. Unknown benefit defaults to solo. |

Do not make a speculative numerical cost estimate. Capture actual usage when
reported by the harness; otherwise report that cost is unknown.

## Small-team patterns

| Work | Preferred arrangement |
| --- | --- |
| Small bounded edit | Lead works alone. |
| One risky state-machine change | One implementer; a read-only independent reviewer when permitted. |
| Two stable, disjoint modules | Lead freezes contracts; two workers in parallel; lead integrates; one reviewer after integration. |
| Unknown architecture | Lead or one read-only explorer investigates first; do not send workers to invent competing designs. |
| Shared interface, lockfile, entrypoint, or one common test file | Single owner or sequential execution. |
| Plan-only/review-only request | Read-only work packets; no implementation worker. |

Default limits: at most two concurrent subagents, three distinct subagent
assignments per task, and delegation depth one. Reusing an existing reviewer for
one targeted recheck is not a new assignment, but all retries count toward the
plan/repair budgets. User/harness caps may reduce these limits; larger teams need
explicit authorization and a concrete reason.

Do not create a worker, planner, critic, reviewer, and supervisor for each small
task. Do not delegate a question whose answer the lead already verified unless
independent verification is the explicit purpose.

## Ownership and isolation

Use separate worktrees/sandboxes when available and authorized. Otherwise only
parallelize disjoint writes whose shared resources are understood; serialize
when isolation is uncertain. Path instructions are not an access-control sandbox.
Use actual read-only/permission restrictions when the harness supplies them.

The lead alone owns shared contracts, dependency/lockfile changes, final plan
status, and integration unless the packet expressly delegates a specific item.
Shared process resources matter too: ports, test databases, output directories,
and generated files can conflict even when source paths do not.

Workers must not spawn children, push, merge, deploy, alter permissions, install
new dependencies, or change models/accounts without specific authorization.
Local commits are allowed only under the task's policy; otherwise return a diff.
Never commit other workers' unreviewed files or rewrite their changes.

## Work packet and result

Use `assets/subagent-assignment.template.md` from this skill. Pass just the
relevant task slice and evidence; do not forward entire chats, secrets, or an
unbounded repository dump. The packet's read set must include directly coupled
code needed to understand the write set.

A worker returns: exact candidate/base, changed paths, acceptance evidence,
commands/results, unresolved assumptions, and unexpected coupling. A reviewer
returns evidence-backed findings and limits, not edits or “LGTM” alone.

If a worker needs an unowned path or contract change, it stops that dependent
slice and returns a change request. The lead updates the contract/ownership and
reissues dependent work. Do not let multiple workers silently negotiate authority.

## Integration gate

Treat every returned patch and test claim as unverified until inspected. Confirm
base/task revision, review the actual diff and untracked outputs, resolve overlap,
and rerun affected tests on the combined tree. Old worker results do not validate
a later merged candidate. Record which checks were independently rerun and which
remain worker-reported.

An independent reviewer should first read requirements and source/tests, then the
author's explanation. Same-model agents can still share blind spots; resolve
disagreement with a reproducer, contract, or specific source evidence—not a vote.

## Unavailable capability or exhausted budget

Use a solo/sequential path and label self-review honestly. For elevated-risk work
that requires an independent check, report that check as outstanding rather than
fabricating another agent. Prepare a focused handoff to a human or authorized
reviewer; do not silently invoke a premium model or external inference API.

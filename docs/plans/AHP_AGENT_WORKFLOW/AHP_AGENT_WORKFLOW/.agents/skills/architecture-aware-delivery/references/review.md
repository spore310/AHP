# Plan and Implementation Review

Review is an evidence-producing step, not a confidence score. Report concise
rationales, counterexamples, source references, and test results—not private
reasoning transcripts. Never treat an attractive plan or a passing typecheck as
proof that the system behavior is correct.

## Plan review: before implementation

Read the task/invariants and current code evidence before the proposed approach.
Then evaluate these dimensions:

| Dimension | Question that must be answered |
| --- | --- |
| Scope | Does the plan solve the requested problem without executing a future milestone? |
| Architecture | Does behavior stay with its owning module and preserve client/server boundaries? |
| Contracts | Are changed inputs, errors, state transitions, and consumers identified? |
| Failure paths | Does it address cancellation, cleanup, retries, partial failures, and relevant races? |
| Verification | Can its acceptance criteria catch a plausible wrong solution? |
| Sequencing | Are prerequisites complete before dependent work begins? |
| Delegation | Are write sets disjoint and shared decisions owned by one lead? |

Return `PASS`, `REVISE`, or `BLOCKED`. Make each requested revision specific:
“add the stop-before-listening interleaving and define stop() completion,” not
“think harder about concurrency.” Recheck only changed assumptions after revision.

A plan review may be a separate pass by the author; identify it as self-review.
For elevated risk, prefer an independent reviewer if available and authorized.

## Implementation review: after a candidate exists

Pin the candidate using the commit plus working-tree changes, or an immutable
patch/worktree snapshot supplied by the harness. Account for staged, unstaged,
and relevant untracked files. A HEAD SHA alone does not identify uncommitted work.

Inspect in this order:

1. User outcome, exclusions, and acceptance criteria.
2. Public boundary and affected implementation, including directly coupled callers.
3. Tests: what was tested, what can escape, and whether assertions encode the contract.
4. Diff, unintended changes, public errors/diagnostics, cleanup, and state ownership.
5. Author's handoff and claimed evidence; verify them against the candidate.
6. Scoped documentation impact and, for explicit reviews, the existing drift skill.

Ask for a concrete counterexample on elevated-risk behavior. Examples include a
late callback after disposal, an unowned file changed by a worker, or a feature
marked shipped when only a plan exists. Do not invent a finding to satisfy a quota.

## Finding format

A finding contains: ID; priority; status; exact file/symbol/location; expected
contract; observed behavior; trigger/reproducer; impact; correction direction;
and verification needed. Label source-inferred risks separately from reproduced
failures. Keep hypothetical concerns out of the confirmed-bug count.

Priority means:

- **P1:** security/authority violation, lost state/resource, incorrect public
  contract, or an authorized task's blocking correctness failure.
- **P2:** meaningful edge-case, maintainability, or documentation problem within
  scope that needs action but is not a P1 blocker.
- **P3:** optional improvement; never hold completion hostage to stylistic preference.

The lead tracks `open`, `resolved`, `disputed`, and `deferred` findings. To resolve
a finding, name the correction and its supporting check. Disputed findings need
counter-evidence. Deferring a required acceptance criterion leaves the task
incomplete; an agent cannot grant itself an exception to the user's requirement.

## Verification levels

Record the highest evidence actually available for each claim:

| Evidence | What it supports |
| --- | --- |
| Source inspection | The logic and contracts visible in the inspected candidate. |
| Reproduced failure | A specific input/interleaving fails under a stated environment. |
| Focused test pass | The specified check passed for the identified candidate. |
| Repository validation | The actual configured validation command passed. |
| Integration proof | A real consumer/SDK exercised the stated path. |

These are distinct evidence categories, not a ladder where a higher category
proves all lower-level assertions or untested behavior. Record actual command,
working directory, relevant toolchain, exit/result, candidate identity, and a
small sanitized output excerpt/log pointer. “Tests exist,” “should pass,” and
“worker says green” are not your own executed test result.

After a patch or integration changes affected behavior, mark earlier evidence
stale and rerun the relevant gate. Preserve unrelated valid evidence only when
you can justify that the underlying code/dependencies/setup did not change.
Do not lower quality gates because the environment cannot run them.

## Documentation integration without recursion

The existing documentation-drift skill owns explicit-review activation, scoped
discovery, the claim/evidence/difference test, and update approval preferences.
Invoke it once when applicable, using the current review's context. Do not create
a documentation-only subagent. Workers return drift evidence to the lead; the
lead alone asks any permitted consolidated update question. An approved request
to update the specific docs already supplies that scope of authorization.

A target plan that is not implemented is not stale just because code differs.
If its design conflicts with a later explicit user constraint, report a target
conflict and required plan amendment, not “implementation already changed.”

## Convergence and outcome

Use `finding -> bounded correction -> focused rerun -> recheck` rather than a
complete fresh review after every line. Two failed repairs of the same criterion
trigger investigation/escalation; do not exhaust the budget rephrasing the same
approach. Reuse a reviewer for a targeted check when allowed.

Review verdict: `PASS`, `CHANGES REQUIRED`, or `BLOCKED / INSUFFICIENT EVIDENCE`.
Keep verdict separate from task mode: a completed review may correctly report
that implementation is not ready. Report review independence, checks actually
run, unresolved risks, and the exact candidate covered.

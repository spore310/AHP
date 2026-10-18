# Task Record: <task-id>

Use for nontrivial/delegated/resumable work. Omit irrelevant rows rather than
filling them with boilerplate. This is a task record, not permanent architecture
truth. For plan-only/review-only, write only where a report/plan is authorized;
otherwise keep the record in the conversation. Nothing below is evidence yet.

## Intake

- Mode: <plan-only | review-only | execute>
- Task revision: <1; increment on material scope/contract change>
- Request/outcome: <user's actual objective>
- Authority: <current request + relevant accepted plan>
- Exclusions: <features, files, actions explicitly not authorized>
- Baseline: <branch + HEAD>
- Candidate: <HEAD + staged/unstaged/relevant untracked changes; immutable ref/hash if available>
- Pre-existing work: <files to preserve and known baseline failures>
- Risk: <fast | standard | elevated; why>
- Tools/limits: <available tools, execution permissions, permitted model/account, spend/concurrency cap>

## Architecture brief

| ID | Kind | Fact or constraint | Current evidence |
| --- | --- | --- | --- |
| E1 | observed | <current boundary/owner> | <path + symbol/lines + candidate> |
| I1 | target | <user invariant> | <accepted request/plan section> |
| U1 | unknown | <material open question> | <resolution action or blocked dependency> |

Flow: `<entry -> validation -> owner -> state -> output>`
Failure/cleanup: `<relevant alternate path>`
Unchanged boundaries: <what this task must preserve>

## Acceptance matrix

| Criterion | Observable required behavior | Invariant | Check / expected result | Actual evidence | Status |
| --- | --- | --- | --- | --- | --- |
| AC1 | <behavior> | I1 | <specific command/reproducer/inspection> | NOT RUN / NOT INSPECTED | pending |

## Plan and ownership

| Slice | Outcome | Owned write paths | Read/dependency paths | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| T1 | <one coherent result> | <exact files or narrow globs> | <callers/contracts/tests> | <none or slice> | AC1 |

Shared files/resources and owner: <entrypoint, public types, lockfile, test outputs, ports>
Delegation decision: <solo or bounded team; real capability and benefit>
Budget: <concurrent/total assignments; repair/revision limits; stricter user cap>
Contract changes requiring replanning: <specific triggers>

## Plan review

- Reviewer: <self | actual independent agent | human>
- Candidate/task revision inspected: <ref>
- Gate: <PASS | REVISE | BLOCKED>
- Concrete findings/counterexample: <IDs + evidence>
- Revisions: <decision, affected slices, evidence invalidated>
- Pending material decisions: <none or explicit dependent work blocked>

## Execution and validation evidence

| Check | Candidate + cwd | Environment | Command or inspection | Actual result | Evidence pointer | Fresh/stale |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | <ref + path> | <relevant versions> | <exact check> | NOT RUN | <sanitized log/summary> | pending |

Do not paste secrets or full environment dumps. Record worker-reported checks as
worker-reported until independently rerun. Record failures as failures.

## Review findings

| ID | Priority | Evidence + impact | Owner | Resolution/check | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | <P1/P2/P3> | <file/symbol; trigger; source-inferred or reproduced> | <owner> | <pending or verified fix> | open |

## Documentation impact

- Mode: <explicit drift review | execution impact check | not applicable>
- Scope/evidence: <affected docs and current vs target distinctions>
- Approved edits: <specific authorization; none otherwise>
- Prompt owner/preference: <lead + existing preference, when applicable>

## Close-out / resume checkpoint

- Status: <VERIFIED | IMPLEMENTED / VALIDATION INCOMPLETE | PLAN READY | REVIEW COMPLETE | BLOCKED / PARTIAL>
- Final candidate and task revision: <ref>
- Acceptance: <each criterion's result; no implied passes>
- Architecture decisions: <concise conclusions and source/authority>
- Unresolved findings/limits: <IDs + exact missing evidence or decision>
- Subagent results integrated: <actual IDs/outputs; none when solo>
- Commits: <actual SHAs only; no commit when not authorized>
- Next safe action: <one bounded step; future milestones not started>

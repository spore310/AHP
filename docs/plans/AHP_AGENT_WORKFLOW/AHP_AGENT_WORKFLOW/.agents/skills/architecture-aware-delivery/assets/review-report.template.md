# Review: <task / candidate>

## Scope and evidence

- Mode: <plan review | implementation review | explicit code review>
- Reviewer: <self, actual subagent identifier, or human; do not simulate independence>
- Candidate/task revision: <exact inspected version, including working changes>
- Read scope: <files/contracts/callers/tests>
- Acceptance criteria: <IDs>
- Tests/checks actually run: <commands/results/environment, or NOT RUN>
- Limits: <missing files/toolchain/integration proof>

## Verdict

<PASS | CHANGES REQUIRED | BLOCKED / INSUFFICIENT EVIDENCE>

<One paragraph explaining the verdict in terms of scope and evidence. A report
can be complete even when the implementation needs changes.>

## Findings

### R1 — <specific failure or risk>

- Priority/status: <P1/P2/P3; open/resolved/disputed/deferred>
- Location: <file + symbol/line range + candidate>
- Contract: <expected behavior + authority>
- Observed: <actual source behavior; concise evidence>
- Trigger: <reproducer/interleaving; label hypothetical if not run>
- Impact: <concrete affected behavior>
- Suggested correction: <bounded direction, not an unrequested rewrite>
- Verification needed: <check that distinguishes fixed from plausible>
- Resolution: <actual fix/evidence, otherwise pending>

Do not add an empty or invented finding when none is confirmed. Say no confirmed
findings in the inspected scope and still disclose verification limits.

## Acceptance coverage

| Criterion | Evidence inspected/run | Status | Gap |
| --- | --- | --- | --- |
| AC1 | <actual evidence> | <pass/fail/not verified> | <none or missing check> |

## Documentation Drift

Include only when the existing explicit-review procedure finds a material
claim/evidence/difference. Preserve target-state plans. For each affected doc:

- Documented: <specific claim>
- Implementation: <source evidence at this candidate>
- Difference and impact: <factual discrepancy>
- Update authorization: <already approved scope or pending lead question>

For a target plan conflicting with current user intent, use a separate
**Target-plan conflict** label instead of claiming the plan describes shipped code.
No duplicate documentation prompts from delegated reviewers.

## Required next action

<Specific repair, missing evidence, or acceptance. No silent scope expansion.>

# Agent Work Adversarial Review Panel

- Status: ACTIVE
- Coordinator: `w3:p1` (principal lead)
- Independent worker/coordinator: `w3:p3`
- Scope: `src/agents/`, `src/work/`, `src/persistence/`, and `database/`
  (including direct coupling through `src/websocket/` where it affects the agent
  and work contracts).
- Base candidate: commit `7038a08a46321885f4a4c418f3f3cb5f7f87eb03` on branch
  `agentIdentity`. Local commits during repair may extend this; record the exact
  candidate in each report.
- Review mode: read-only. Fix ownership is coordinated below.

## Rules

1. All persistent findings go here as dated round files:
   `round-XX-name.md`.
2. Blind reviews never read the other agent's findings before filing their own
   report.
3. A reviewer must return one of:
   - `PASS`
   - `CHANGES REQUIRED`
   - `BLOCKED / INSUFFICIENT EVIDENCE`
4. Findings use `P1`, `P2`, `P3` and status `open`, `resolved`, `disputed`, or
   `deferred`.
5. Hypothetical risks are separately labeled. A passing grade must not be based
   on invented findings or on state not present in the candidate.
6. Bug fixes run at least the focused affected test command. Before considering
   all work complete, `pnpm validate` must pass on the final integrated tree.
7. Database acceptance is still blocked by the user's instruction not to apply
   SQL scripts. Do not execute migrations. Do not claim a database test passes.
8. No worker/subagent may push, deploy, spawn nested agents, install
   dependencies, or commit unless explicitly authorized.

## Review matrix

The target definition of done is:

- Two fresh, independent, source-inspecting subagent reviews for each panel
  member. They do not know each other.
- Each coordinator independently judges its own two subagent reports.
- Both coordinators must arrive at `PASS` for the corrected candidate.
- All blocking findings are corrected or disputed with source evidence, and the
  relevant checks are rerun.

## Ownership

- `w3:p1` owns coordination for side A and integration ordering.
- `w3:p3` owns coordination for side B.
- Before code edits: coordinators declare the shared write set in the active
  round file. Edits are serialized through that file.
- Only the named owner patches a finding; reviewers stay read-only.

## Round log

Round entries are added as files, not edited to hide conclusions.

- `round-01-a1.md`
- `round-01-a2.md`
- `round-01-b1.md`
- `round-01-b2.md`

A panel report may be finalized only after A and B independently record two
passing reviews, or the conflict is explicitly resolved.

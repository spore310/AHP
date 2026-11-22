# Round 01 — Side A launch record

- Coordinator: `w3:p1`
- Candidate: `7038a08a46321885f4a4c418f3f3cb5f7f87eb03`
- Status: side-A blind reviewers launched in background.

## Side-A assignment split

- **A1 — identity/authorization/adversarial:**
  - Reads `src/agents/`, `src/work/`, direct work/transport coupling, and tests.
  - Does not read A2 or B-side reports.
- **A2 — persistence/PostgreSQL/database/contract adversarial:**
  - Reads `src/persistence/`, `database/`, persistence ports, and relevant tests.
  - Does not read A1 or B-side reports.
  - Explicitly read-only; no SQL execution or migrations.

## Expected outcome

Each reviewer returns an independent `PASS`, `CHANGES REQUIRED`, or
`BLOCKED / INSUFFICIENT EVIDENCE` verdict plus concrete, source-backed findings.
Side A will defer source edits until both reports are integrated with side-B.

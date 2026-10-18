# Blind Adversarial Reviewer Assignment

You are one independent reviewer of a frozen Agent Hosting Protocol feature candidate. You are not an implementation worker. Use the anonymous label supplied by the custodian; do not infer a quality ranking from the label.

Read `NEUTRAL_REQUIREMENTS.md`, the necessary repository instructions, the pinned SDK contracts, the relevant baseline/candidate source and tests, and scoped documentation. Inspect the actual code before considering any supplied test result. You must not receive or request the implementer's confidence narrative, author/model identity, or the other reviewer's findings before submitting your report.

Your goal is to identify evidence-backed ways the proposed plan or code violates a requirement or makes the public API misleading. Do not invent findings to sound adversarial. Cover version pinning, deep ownership, schema preservation, typed/untyped selection, application/provider config separation, atomic creation and client admission, native protocol semantics, private rejection delivery, lifecycle generation, public reuse, and persistence/runtime separation.

You may run safe focused tests only in your permitted isolated scratch copy. You may create temporary counterexample tests there, never edit the working candidate or its lockfile, invoke actual tools/models, fetch arbitrary schemas, use production credentials, or recruit subagents. Reuse installed dependencies under the harness policy. Record what you ran and what you could not run.

Return a sealed report using `REPORT_TEMPLATE.md`. Identify the exact candidate content hash and review round. For each finding provide a violated requirement ID, path/symbol, trigger, expected/observed behavior, severity, evidence level, impact, and narrow corrective direction. For a no-finding result, list meaningful scenarios checked and limits. Submit before seeing the other report; do not revise the original report after reveal.

Verdict values: PASS, REVISE, or BLOCKED. A passing report means no unresolved material defect was found within the inspected scope and evidence limits, not a proof of correctness or security. Missing isolation or unavailable tests must be stated explicitly.

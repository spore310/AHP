# Single orchestrator prompt — Agent Hosting Protocol multi-host plan

Use this as the one entry point. The plan directory may be supplied as an attachment or copied into the repository under docs/plans/host/. Resolve relative references from this file; do not assume a scratch filesystem path from the authoring session.

## Your assignment

You are the single local orchestrator for the Agent Hosting Protocol multi-host support phase. Use the accepted requirements in this plan as the product intent and the actual repository code as current truth. Read README.md, HANDOFF.md and NOTEPAD.md first, then PREFLIGHT.md, CONTRACTS.md, CURRENT_STATE.md, DECISIONS.md, ACCEPTANCE.md, EXAMPLES.md and the packet index.
On the first run, execute the previous-plan evidence sweep and selective archival, then finalize/review the detailed host packets. This is plan/documentation work plus authorized local verification. Do not begin H0–H9 feature implementation during that initial planning run. If the user explicitly selects implementation later, use the execution workflow below without creating a second prompt file.

## Requirements you must preserve

1. Default to one simple host and namespace; optional adapters support A single, B active-passive, C partitioned namespaces and D multiple active hosts within one namespace.
2. Introduce the requested src/host / @host composition boundary by moving/extending existing behavior. Reuse current terminology, modules, factories, types and validation where correct; justify every new abstraction.
3. Let consuming applications choose their namespaces. Use a stable app-style logical host name and a convenient derived default; allow explicit shared namespace identity across different host IDs and configured membership in multiple namespaces.
4. Keep network bind host, logical host identity, runtime instance, policy namespace, security domain, connection generation, session incarnation and work epoch semantically distinct. Preserve existing durable IDs and native AHP URIs.
5. Authenticate host membership with application-configured credentials and enforce namespace/host claims through the SDK. A secret, namespace name, internal network location or host claim never bypasses application actor authorization.
6. Keep one authoritative owner per session, server-authoritative permissions, exact resource identities, durable admission fences, caller/executor separation, one native SDK receive owner and external agent/model execution.
7. PostgreSQL coordination, internal request transport and distributed event delivery are replaceable capabilities. Avoid mandatory brokers, Redis, service meshes or Kubernetes dependencies in the SDK.
8. Prove behavior under contention, revocation, loss, replay, transfer and shutdown. Do not mark any requirement complete using only a typecheck, a checklist, source comments or another agent's assertion.

## Local repository and authority

Read the actual AGENTS.md/.agents instructions and relevant skills before work. Verify local branch, HEAD, staged/unstaged/relevant untracked changes and pinned toolchain. The inspected remote baseline is feature/ahp-v1 at 324fd60634e3d93aa4af59da98263c1cac0deb3b; do not overwrite newer or unrelated work to match it.
Writing this plan, required evidence handoffs and scoped archive/navigation updates is authorized. Source implementation, dependency changes, destructive database operations, pushes, merges and live deployment are not part of the initial planning run. Surface a required product fix as a separate bounded task rather than applying it silently.
Do not claim or change billing, model, account or harness permissions. Use the selected local environment. Do not launch a separate cloud coding job or external paid model API unless separately authorized.

## Delegation permission

You may deploy bounded subagents in the authorized local harness when they save useful review or investigation work. Follow the actual repository limits; the inspected policy permits up to two concurrent subagents, three distinct assignments per task and no nested delegation. The lead owns shared contracts, final decisions, all plan integration and status.
Recommended assignments, used only when helpful:
- Prior-plan evidence reviewer: read P0–P5 specifications, source/tests and ledger; return archive/retain findings with exact evidence. Do not edit source or archive files.
- Authorization/namespace reviewer: inspect trust roots, existing terminology, shared freshness, fencing and migration boundaries; return concrete failure cases and minimum contract changes.
- Final plan reviewer after integration: inspect the complete plan against source and accepted intent independently; report omitted consumers, impossible guarantees, untestable acceptance or unnecessary abstractions.
Give each worker the exact base/candidate, bounded read set, question, forbidden writes and required result. Do not spawn a planner/critic chain for every section. Workers return source locations, counterexamples, actual checks and limitations; they do not recruit others. If tools are unavailable, work sequentially and mark independent review outstanding rather than inventing it.

## Initial planning workflow

1. Execute PREFLIGHT A/B: verify the old packet scope and actual current evidence. Do not infer completion from 131 populated rows or historic test totals.
2. Classify and selectively archive proven completed scope using PREFLIGHT C. Retain proposed provider/client work and any unverified requirement; preserve evidence and update scoped navigation.
3. Resolve D01–D08 using the actual code and pinned SDK. Prefer extending current capabilities; include concrete protocol/type/transaction/lifecycle decisions and the tests that prove them.
4. Revise H0–H9 where needed so each has exact prerequisites, scope, source owners, acceptance proof and stop conditions. Add missing counterexamples; never silently reduce A–D support.
5. Review the integrated plan and resolve findings. Record PASS/REVISE/BLOCKED for the planning gate, distinct from runtime acceptance.
6. Update HANDOFF, NOTEPAD, ACCEPTANCE and handoffs/PREFLIGHT.md. Run required final repository/documentation gates for changed files, inspect the final diff and report the result.
7. Stop at PLAN READY only when the planning requirements are fulfilled. If a necessary decision or verification environment is unavailable, finish independent work and report precise remaining blockers. Do not mark feature criteria PASS.

## When feature execution is subsequently authorized

Work in dependency order, one coherent packet at a time. Read its packet and handoff, refresh changed evidence, confirm its decision prerequisites and review the implementation slice before editing.
Keep a single writer for shared interfaces, migrations and configuration. Use explicit file ownership or isolated worktrees for any parallel implementation. Do not let subagents invent competing contracts.
Implement through the owning modules. Run focused counterexample tests, actual PostgreSQL/multiprocess/public-SDK proofs where required and pnpm validate. Verify applied migration versions. Preserve the old invariant tests unless an explicit accepted contract changes.
Review the integrated candidate after the final fix, record source/commands/results for every criterion in the packet handoff, update ACCEPTANCE and the root handoff/notepad, and only then advance. Follow any stricter repository review requirement. A changed candidate invalidates affected earlier evidence.
If a packet is blocked, do not hide it by weakening a test, replacing PostgreSQL with a mock, reclassifying shared mode as single mode, or claiming unsupported provider guarantees. Record the exact failed contract and safe next action.

## Handoff discipline

HANDOFF.md is the overall resume point. NOTEPAD.md records the current task revision, candidate, completed checks, open findings, decisions and next safe action. Packet handoffs carry detailed evidence. ACCEPTANCE.md is the canonical status index; link to evidence rather than copying transcripts everywhere.
Before compaction or stopping, update those files. After resuming or an external change, reread the actual affected files and mark stale evidence explicitly.
Final report: candidate and mode; archive/retained scope; decisions and reuse choices; files changed; actual commands/results; reviewer findings/dispositions; remaining blockers; and the next packet or action. Do not present targets as shipped features.


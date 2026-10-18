# AHP Project Constraints

**Purpose:** task-planning guardrails, not a live implementation inventory.
**Authored against:** `spore310/AHP`, `develop` at
`1c5f4fc3572f1af9797a59d59d1b3f915761f178`, 2026-10-18.
Re-read current instructions, code, and accepted task plans before execution.

## Established user direction

The application is one model-runtime-free AHP server. Pi runs independently on
client machines. Do not add server-side inference, model credentials, Pi SDK
execution, Pi child processes, prompt execution, or agent tool ownership.

Development subagents used to edit/review this repository are separate from the
AHP product architecture. A development workflow does not authorize adding an
orchestrator, model router, or runtime to the product.

Server responsibility: validated protocol operations, connections, authoritative
session/channel state, subscriptions and authorized access. Future coordination
must be explicitly designed; native session state is not an automatic
agent-to-agent inbox. A Pi extension and its model-context injection run on the
client side. Packaging and custom coordination contracts require explicit scope.

Existing mock `SessionProvider`/`SessionBackend` code is scaffold/test evidence,
not permission to install a real model backend. Do not remove legitimate mock
fixtures merely because the target server must remain inference-free.

## Preserve repository conventions

Read `.agents/AGENTS.md` and `docs/CodingRules.md` as current authority for
conventions. At the authoring baseline they require:

- Capability-oriented modular monolith; no speculative distributed infrastructure.
- `index.ts` for public exports, `types.ts` for contracts/runtime schemas,
  `helpers.ts` or `helpers/` for behavior, and optional `constants.ts`.
- Tests under `src/tests/`; use configured aliases at cross-folder boundaries.
- Strong runtime validation and server authority; no sensitive error/log leakage.
- Exact versions from the manifest/lockfile; do not silently upgrade dependencies.
- `pnpm validate` for final execution validation on the pinned toolchain.
- Focused commits using `feat|fix|chore|scaffold|note|cdci: title` plus description,
  only when commits are within the task's authorization.

The code defines current behavior; explicit accepted goals define target state.
Do not downgrade a plan to current code or describe a target as already shipped.

## Stabilization and ProvidersPlan boundary

The provided stabilization task plan authorizes lifecycle fixes, narrow
sequencing-readiness checks, and preparation of `docs/ProvidersPlan.md`.
It does not authorize implementing that future plan's feature milestones.

Reverify which original findings are still present. Do not undo newer fixes to
match an older review. In particular, do not describe a sequence allocator alone
as implemented replay or infer working client initialization from session types.

## Scope-sensitive review questions

Does this change confuse connection ID, client ID, session URI, and authenticated
principal? Does it mistake client intent for authority? Does it treat a local
promise resolving as proof of completed cleanup? Does it add a client runtime to
the server? Does it introduce overlapping state owners or claim SDK conformance
from shape-only tests? Examine only the questions relevant to the current task.

## Provenance

- Current-task user direction: Pi clients execute locally; the server has no model runtime.
- Repository rules: `.agents/AGENTS.md`, `docs/CodingRules.md` at the stated baseline.
- Existing review integration: `.agents/skills/code-review-documentation-drift/SKILL.md`.
- User-provided task artifact: `AHP_STABILIZATION_AND_PROVIDERS_PREP_TASKPLAN.md`.
  This filename identifies a supplied handoff, not an assumed repository path.

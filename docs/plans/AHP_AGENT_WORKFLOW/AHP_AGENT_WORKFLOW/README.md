# AHP Agent Workflow — Architecture-Aware Delivery

A repository-local skill and instruction hook for architecture-aware planning,
bounded execution, evidence-based review, and selective development subagents.

**Version:** 1.0, authored 2026-10-18.
**Repository reference:** `spore310/AHP`, `develop` at
`1c5f4fc3572f1af9797a59d59d1b3f915761f178`.
**Integration status:** installed in this working tree under
`.agents/hooks/task-execution-review.md` and
`.agents/skills/architecture-aware-delivery/`, with the router merged into
`.agents/AGENTS.md`. This source bundle is retained as provenance. The workflow
has not been exercised in a local agent harness or benchmarked on any model.

The policy is model-neutral. Use the authorized model selection and bounded
workers permitted by the active harness, without hardcoded model names or API
identifiers.
The workflow makes architectural obligations explicit; it does not guarantee
reasoning quality or turn a weaker model into an architect.

## Files

```text
AHP_AGENT_WORKFLOW/
├── README.md
├── integration/
│   └── AGENTS.append.md
└── .agents/
    ├── hooks/
    │   └── task-execution-review.md
    └── skills/
        └── architecture-aware-delivery/
            ├── SKILL.md
            ├── references/
            │   ├── architecture.md
            │   ├── delegation.md
            │   ├── review.md
            │   └── ahp-context.md
            ├── assets/
            │   ├── task-record.template.md
            │   ├── subagent-assignment.template.md
            │   ├── review-report.template.md
            │   └── ahp-stabilization.example.md
            └── tests/
                └── SCENARIOS.md
```

| File/group | Responsibility |
| --- | --- |
| `integration/AGENTS.append.md` | Small marked section to merge once into the existing `.agents/AGENTS.md`. Its relative links resolve from that destination. |
| `.agents/hooks/task-execution-review.md` | Activation, mode permissions, logical lifecycle checkpoints, and existing-hook composition. |
| `SKILL.md` | Main procedure and progressive loading map. |
| `references/` | Focused architecture, delegation, review, and AHP guardrails; read only as needed. |
| `assets/` | Copyable work/review contracts and a clearly labeled AHP example. |
| `tests/SCENARIOS.md` | Twenty behavioral evaluation scenarios; no tests or agent calls run automatically. |

## What the hook is—and is not

This is an **instruction-driven lifecycle hook**, matching the current AHP
repository's review-hook pattern. Root `AGENTS.md` already points to
`.agents/AGENTS.md`; the insertion section routes applicable tasks to the new
hook and skill. It is not a registered native Pi/Codex callback, a Git hook, an
executable guard, an AHP capability, or a permission sandbox.

```text
Root AGENTS.md
   -> .agents/AGENTS.md (existing rules + small insertion)
      -> task-execution-review.md (when and which mode)
         -> architecture-aware-delivery/SKILL.md (how)
            -> only the needed reference/template
```

Skill discovery and instruction following are different things. Discovery makes
the skill available; the instruction router asks the agent to apply its gates.
An agent may still skip or misapply instructions. Use explicit invocation and
the included behavioral scenarios to verify the local setup. Strong access
control belongs in the actual harness/sandbox, not Markdown path allowlists.

No callbacks are registered just because a file lives in `.agents/hooks/`.
A future native adapter would need the installed harness's documented events,
authorization model, version checks, and tests. That adapter is not included.

## Install without overwriting existing instructions

The steps below record the installation procedure for another checkout. They
have already been applied to this working tree; do not repeat them here.

1. Extract this bundle into a staging directory. Inspect the files, including
   hidden `.agents/`, before copying them into a trusted project.
2. Check the current checkout and any uncommitted work. The reference SHA is
   provenance, not an instruction to reset your branch to that version.
3. Copy only the new `.agents/hooks/task-execution-review.md` and
   `.agents/skills/architecture-aware-delivery/` tree into the repository,
   preserving existing files. If those destinations already exist, compare and
   merge instead of blindly replacing them.
4. Read the current `.agents/AGENTS.md`. Merge the complete marked section from
   `integration/AGENTS.append.md` once, preferably before `# Agent Workflow`.
   If the marker already exists, update that section rather than duplicating it.
5. Preserve root `AGENTS.md` and its existing pointer. Do not replace either
   instruction file with the insertion snippet or remove existing skills/rules.
6. Verify the new links and skill metadata. Reload/restart the local harness as
   its installed version requires, then explicitly invoke the skill on a small
   authorized task. Confirm the agent identifies the mode and reads the skill.
7. Follow the repository's validation/commit policy for the actual changed
   files. Do not claim `pnpm validate` passed unless it really ran successfully.
   Do not push or start the stabilization implementation as part of installation.

The install modifies agent guidance only. It does not implement the AHP
stabilization example, change `docs/plans/ProvidersPlan.md`, install dependencies,
change model/account settings, or create an agent runtime in the server.

### Installation prompt for your local coding agent

```text
Install the AHP_AGENT_WORKFLOW bundle into this repository as guidance only.

Read the current root AGENTS.md, .agents/AGENTS.md, and docs/CodingRules.md.
Preserve all existing instructions, skills, and unrelated working-tree changes.
Copy only the new .agents/hooks/task-execution-review.md and
.agents/skills/architecture-aware-delivery/ files. Merge the marked section
from integration/AGENTS.append.md into .agents/AGENTS.md exactly once.

Do not implement the bundled AHP example or ProvidersPlan milestones.
Do not add a runtime, native callback, Git hook, dependency, model API call,
or new model/account configuration. No subagents are needed for installation.

Inspect links and frontmatter, follow the repository's validation policy, and
report the exact added/modified paths plus actual checks and limits. Explain
that activation is instruction-driven, not enforced by an executable callback.
Do not push or merge. Create commits only if separately authorized.
```

## 5-minute usage

In a harness that supports skill discovery, the main skill is named
`architecture-aware-delivery`.

Pi's current documentation supports `.agents/skills/`, explicit
`/skill:name` invocation, and `/reload` after editing skills [S2]. For example:

```text
/skill:architecture-aware-delivery Review the WebSocket lifecycle fixes on the current candidate. Review-only; do not edit source. Report actual verification and remaining risks.
```

Codex's current documentation supports repository `.agents/skills/` and explicit
`$skill-name` invocation [S3]. For example:

```text
$architecture-aware-delivery Prepare a plan for the session-disposal race. Do not implement it. Identify current state ownership, callers, legal transitions, regression tests, and unresolved decisions.
```

For another harness, use its supported skill loader, or explicitly ask it to
read `.agents/skills/architecture-aware-delivery/SKILL.md`. Do not assume a
particular slash command or subagent API exists there.

These are prompts for your authorized local harness. Creating this bundle has
not run them. Actual agent execution and delegation use that harness's normal
usage/billing; no free-execution guarantee is implied.

## Intermediate usage: stabilization with selective workers

```text
Use architecture-aware-delivery for the approved AHP stabilization task.
First inspect the current branch and preserve any newer fixes. Follow the
provided stabilization task plan; do not execute future ProvidersPlan features.

Keep the server model-runtime-free and Pi entirely client-side. Build a compact
architecture brief and review the work contract before editing. Use at most two
parallel workers only when the real harness supports authorized delegation and
the WebSocket/session write sets and shared resources are independent. Keep
shared decisions and plan documentation with one lead. Use a read-only reviewer
for the integrated candidate when available; otherwise disclose self-review.

Add the relevant race regressions, preserve current accepted behavior, run
focused checks and final pnpm validate on the pinned toolchain, and report
actual evidence. Do not call validation complete when required checks were
not run. Do not push or merge.
```

## Workflow defaults

| Policy | Default |
| --- | --- |
| Routine work | Solo; fast path for genuinely trivial changes. |
| Nontrivial changes | Architecture brief -> bounded plan -> plan critique -> slices -> final review. |
| Elevated risk | Explicit invariants/failure cases; independent review when available/authorized. |
| Concurrency | At most two subagents at once. |
| Total delegation | At most three distinct assignments; no nested delegation. |
| Plan iterations | After two revisions without convergence/new evidence, narrow or escalate. |
| Repair iterations | After two failed repairs on one criterion, investigate/narrow/escalate. |
| Documentation drift | Existing scoped explicit-review procedure, one lead-owned prompt when applicable. |
| Completion | Evidence for the actual final candidate, not a worker's assertion. |

These are adjustable workflow ceilings, not benchmark-derived optimal values.
Stricter user/harness limits override them. More agents or a stronger model must
not be selected silently. A task can continue safely without subagents while
clearly identifying any independent review still required.

## Verification and limits

The delivery's structural check covers frontmatter constraints, internal file
links, relative integration links at their intended destination, balanced code
fences, duplicate activation markers, and ZIP integrity. See the separately
provided validation report for the actual checks performed.

Behavioral reliability, runtime hook enforcement, model-specific performance,
repository `pnpm validate`, and a real local harness run are **not** established
by those structural checks. The included scenarios are a plan to measure real
behavior, not claims that the workflow has passed them.

## Sources and compatibility notes

[S1] [Agent Skills specification](https://agentskills.io/specification): portable
`SKILL.md` metadata and on-demand references/assets. This bundle uses required
`name`/`description` plus string metadata; it avoids harness-specific tool grants.

[S2] [Pi skill documentation](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md): discovery and explicit skill commands.

[S3] [OpenAI skill documentation](https://developers.openai.com/codex/skills/):
repository skill locations and invocation.

[S4] [OpenAI AGENTS.md documentation](https://developers.openai.com/codex/guides/agents-md/):
instruction discovery. The existing AHP root pointer is retained rather than
assuming `.agents/AGENTS.md` is discovered by itself.

[S5] [AHP repository instructions at the reference SHA](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/.agents/AGENTS.md)
and its [existing documentation-drift skill](https://github.com/spore310/AHP/blob/1c5f4fc3572f1af9797a59d59d1b3f915761f178/.agents/skills/code-review-documentation-drift/SKILL.md).

[S6] User-provided `AHP_STABILIZATION_AND_PROVIDERS_PREP_TASKPLAN.md`: accepted
server-only constraints, scoped lifecycle work, and future-plan preparation.

External documentation was checked on 2026-10-18. Verify the locally installed
harness's capabilities and permissions before relying on discovery or subagents.

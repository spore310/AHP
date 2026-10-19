# Read Before Working

Use the smallest relevant instruction set.

| Source                                                    | Responsibility                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `.agents/AGENTS.md`                                       | Repository-wide invariants, architecture, validation, commits      |
| `docs/product-direction.md` (not yet created)                               | Accepted product direction and pending product design              |
| `docs/CodingRules.md`                                     | TypeScript/module/file-organization conventions                    |
| `.agents/skills/code-review-documentation-drift/SKILL.md` | Required instruction-driven procedure for explicit code reviews    |
| `.agents/skills/documentation/SKILL.md`                   | Documentation creation and updates                                 |
| `.agents/memory/documentation-review.md`                  | Tracked project setting for the documentation-update prompt        |
| `docs/gates/`                                             | Gate descriptions and dated validation evidence                    |
| `docs/plans/`                                             | Plans; honor the status and scope declared by each document        |
| `docs/architecture/`, `docs/technical/`                   | Cross-cutting architecture and verified technical behavior         |

Read relevant documentation before changing an affected capability.

---

# Current Stack

Established:

- TypeScript 5.9.3
- pnpm 10.34.6
- Node.js 24.x
- ESLint 10.11.0
- Vite 8.3.4
- Vitest 5.0.5
- vite-node 6.0.0
- Zod 4.6.5
- @microsoft/agent-host-protocol 1.0.0

The manifest and lockfile are authoritative for exact dependency versions.

Pin newly added or deliberately updated dependency versions. Do not silently upgrade major versions.

---

# Architecture

## Modular Monolith

Agent Hosting Protocol begins as a capability-oriented modular monolith.

Module boundaries may evolve.

Do not introduce microservices, brokers, distributed transactions, Kubernetes,
service meshes, or additional backend deployments without demonstrated need.

Logical separation comes before physical distribution.

## Capability Ownership

Libraries implement application capabilities; libraries do not define the domain.

Create abstractions when they establish meaningful ownership, policy, behavior, or portability.

Avoid wrappers that merely rename a library call.

## Server Authority

The server is authoritative for security-sensitive and business-sensitive behavior.

The client submits intent.

Never trust client-supplied:

- identity
- ownership
- roles
- permissions
- other authoritative state

---

# Engineering Invariants

Prefer:

- simple systems
- explicit ownership and dependencies
- small meaningful modules
- secure defaults
- least privilege
- deterministic behavior
- idempotency where repeat execution is possible
- testable boundaries
- least-invasive changes
- backward-compatible migrations where practical

Avoid:

- speculative infrastructure
- unnecessary abstraction
- hidden side effects
- global mutable state
- framework leakage
- premature distributed architecture

Security, privacy, maintainability, and auditability are first-class concerns.

Do not log credentials, tokens, secrets, or unnecessary sensitive user information.

Detailed coding conventions live in `docs/CodingRules.md`.

# Source of Truth

The **codebase is authoritative for current implementation behavior**.

Documentation describing current behavior must follow the code.

An explicit user-defined goal or accepted plan may define a future target state.

Therefore:

```text
code             = current truth
accepted plans   = intended target state
documentation    = factual description of its declared scope
Git              = history
```

Do not rewrite target-state plans merely because implementation has not reached them.

Do not make current-state documentation claim planned functionality already exists.

---

# Documentation

Use **module** for an encapsulated code boundary.

Use **feature module** when emphasizing its public/API boundary or user/system capability.

A module may contain:

```text
feature/
├── README.md
├── index.ts
├── types/
├── helpers/
├── constants/
├── schemas/
└── ...
```

`index.ts` defines the intended public surface.

Detailed rules belong to [the documentation skill](skills/documentation/SKILL.md).

Do not duplicate them here.

Every source file under `src/` and `env/` must be mapped by its module
`README.md`; the documentation gate enforces this. See
[`../docs/gates/documentation.md`](../docs/gates/documentation.md).

---

# Code Review Documentation Drift

The native Copilot hooks in `.github/hooks/ahp-agent-workflow.json` inject the
workflow at session start and run `pnpm validate` before stopping when the
worktree has changes. They do not mechanically review plans or replace the
instruction-driven checkpoints below. Every explicit production, security,
quality, architecture, maintainability, performance, API, feature, contract,
or general code review must use the
[documentation-drift review skill](skills/code-review-documentation-drift/SKILL.md).

Documentation inspection inherits the review scope.

Never perform a repository-wide documentation crawl unless explicitly requested.

Prompt suppression is controlled by the tracked
[project setting](memory/documentation-review.md). Session suppression remains
only in the active conversation.

Suppression never hides material security, production, or factual-drift findings.

---

# Decision Status

Use:

- **Established** — explicitly adopted
- **Proposed** — seriously considered
- **Experimental** — intentionally being tested
- **Unknown** — not decided
- **Deprecated** — deliberately abandoned

Never silently convert a proposal into an established decision.

<!-- architecture-aware-delivery:begin -->
# Architecture-Aware Task Delivery

For repository task planning, implementation, debugging, refactoring, test work,
and explicit code/architecture/security/quality reviews, read
[the task execution and review hook](hooks/task-execution-review.md) and follow
[architecture-aware-delivery](skills/architecture-aware-delivery/SKILL.md).
Use its fast path for trivial edits; do not impose a large plan on every task.

Honor plan-only, review-only, and execute permissions. Identify module ownership,
current-vs-target state, invariants, and acceptance evidence before nontrivial
changes. Review the plan before implementing and the final candidate before
claiming completion. Delegate only when supported, authorized, bounded, and
worthwhile; do not invent subagents or silently change models/accounts.

This is an instruction-driven lifecycle hook, not a Git hook or automatically
registered native callback. It composes with the existing documentation-drift
review procedure without duplicating its trigger, prompt, or review scope.

Development subagents remain outside the AHP product: no server-side model
inference, Pi execution, or agent runtime is authorized by this workflow.
<!-- architecture-aware-delivery:end -->

# Agent Workflow

Before a meaningful change determine:

1. Which capability owns it?
2. Which layer should contain it?
3. Does an existing abstraction already solve it?
4. Does it introduce unnecessary coupling?
5. Does it affect security, auditability, or data ownership?
6. Can framework-specific behavior remain at the system boundary?

Inspect existing conventions before creating new ones.

Prefer extending established patterns over creating competing ones.

---

# Commits

Use:

```text
feat|fix|chore|scaffold|note|cdci: title

description
```

Commits must:

- contain one coherent unit of work
- use descriptive titles
- avoid unrelated changes
- accurately describe staged changes
- include useful descriptions when appropriate
- inspect staged changes before committing.

---

# Validation

Run `pnpm validate` before considering a change complete. It runs lint,
typecheck, tests, the documentation gate, and the production build, in that
order:

```text
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run docs:check && pnpm run build
```

The documentation gate (`pnpm docs:check`) fails when a `src/` or `env/` source
file is not mapped by its module `README.md`. See
[`docs/gates/documentation.md`](../docs/gates/documentation.md).

# Guiding Principle

Build the smallest system capable of proving Agent Hosting Protocol.

Control where dependencies enter the application.

Frameworks serve the application; the application should not become a collection of framework features.

Preserve boundaries that make successful capabilities easier to evolve.

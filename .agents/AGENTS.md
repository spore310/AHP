# Read Before Working

Use the smallest relevant instruction set.

| Source                                                    | Responsibility                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `.agents/AGENTS.md`                                       | Repository-wide invariants, architecture, validation, commits      |
| `docs/product-direction.md`                               | Accepted product direction and pending product design              |
| `docs/CodingRules.md`                                     | TypeScript/module/file-organization conventions                    |
| `.agents/skills/code-review-documentation-drift/SKILL.md` | Required instruction-driven procedure for explicit code reviews    |
| `.agents/skills/documentation/SKILL.md`                   | Documentation creation and updates                                 |
| `.agents/memory/documentation-review.md`                  | Tracked project setting for the documentation-update prompt        |
| `docs/gates/`                                             | Gate descriptions and dated validation evidence                    |
| `docs/plans/`                                             | Plans; honor the status and scope declared by each document        |

Read relevant documentation before changing an affected capability.

---

# Current Stack

Established:

- TypeScript 5.9.3
- pnpm 10.34.6
- Node.js 24.x
- ESLint 10.11.0
- Zod 4.6.5

The manifest and lockfile are authoritative for exact dependency versions.

Pin newly added or deliberately updated dependency versions. Do not silently upgrade major versions.

---

# Architecture

## Modular Monolith

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
- moderation authority
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

Security, privacy, accessibility, moderation, maintainability, and auditability are first-class concerns.

Use native HTML semantics before ARIA where practical.

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

---

# Code Review Documentation Drift

This repository has no executable agent lifecycle callback registry. Instead,
the root instructions require every explicit production, security, quality,
architecture, maintainability, performance, API, feature, contract, or general
code review to use the
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

# Agent Workflow

Before a meaningful change determine:

1. Which capability owns it?
2. Which layer should contain it?
3. Does an existing abstraction already solve it?
4. Does it introduce unnecessary coupling?
5. Does it affect security, auditability, accessibility, or data ownership?
6. Can framework-specific behavior remain at the system boundary?

Inspect existing conventions before creating new ones.

Prefer extending established patterns over creating competing ones.

---

# Commits

Use:

```text
feat|fix|chore|scaffold|note|cdci(AHP): title

description
```

Commits must:

- contain one coherent unit of work
- use descriptive titles
- avoid unrelated changes
- accurately describe staged changes
- include useful descriptions when appropriate

## Inspect staged changes before committing.

# Guiding Principle

Build the smallest system capable of proving Agent Hosting Protocol.

Control where dependencies enter the application.

Frameworks serve the application; the application should not become a collection of framework features.

Preserve boundaries that make successful capabilities easier to evolve.

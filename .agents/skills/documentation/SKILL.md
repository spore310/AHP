---
name: documentation
description: Create or update scoped repository and module documentation using code as current-state truth while preserving explicitly labeled target-state plans.
---

# Documentation Skill

## Purpose

Maintain documentation that accurately explains the repository without competing with the code as the source of truth.

Documentation exists to make implementation, architecture, contracts, conventions, and feature behavior easier for humans and agents to understand.

## Authorization

Use this skill when the user explicitly requests documentation work or approves
a scoped documentation update identified during review. Detecting drift alone
does not authorize an edit. In a code review, follow the documentation-drift
review skill and obtain approval before changing affected documentation.

Documentation must remain concise, factual, safe, and useful.

---

# Authority

## Current State

The **codebase is authoritative for current implementation behavior**.

Documentation must follow the code.

If existing documentation disagrees with implementation, inspect the code and update the documentation.

## Target State

Explicit user-defined goals and accepted plans may describe behavior that does not exist yet.

These represent the intended destination, not current implementation.

Never rewrite current-state documentation as though planned work has already shipped.

Clearly distinguish:

- current behavior
- planned/target behavior
- unresolved proposals

---

# Documentation Levels

There are two primary documentation scopes.

## Repository Documentation

Use:

```text
./docs/
```

for concepts spanning multiple files, modules, layers, routes, pages, or architectural boundaries.

Examples include:

```text
docs/
├── architecture/
├── conventions/
├── gates/
├── plans/
├── security/
├── frontend/
└── technical/
```

Appropriate topics include:

- authentication strategy
- authorization and RBAC
- application architecture
- UI theme/styling rules
- component creation conventions
- API conventions
- security boundaries
- engineering gates
- cross-layer feature behavior
- accepted implementation plans

If understanding a subject requires following behavior across several modules or layers, prefer `docs/`.

---

## Module Documentation

A module or feature module may contain a colocated:

```text
README.md
```

Example:

```text
auth/jwt/
├── README.md
├── index.ts
├── types/
├── helpers/
├── constants/
└── schemas/
```

Use the README to explain that specific module rather than the entire system.

---

# Module README Structure

Prefer this structure when applicable:

```md
# Feature or Module Name

Short explanation of what the module does and why it exists.

## Files

| Path         | Purpose                      |
| ------------ | ---------------------------- |
| `index.ts`   | Public API.                  |
| `types/`     | Contracts and shared shapes. |
| `helpers/`   | Supporting behavior.         |
| `constants/` | Stable module-owned values.  |

## API

### `functionName(...)`

Short explanation.

#### Arguments

| Argument | Type     | Purpose                  | Example     |
| -------- | -------- | ------------------------ | ----------- |
| `foo`    | `string` | Meaning and constraints. | `"example"` |

#### Returns

Describe the meaningful return contract.

#### Caveats

Describe important limitations, edge cases, security rules, side effects, or ownership boundaries.

## 5-Minute Usage

Smallest correct usage example.

Explain why it works.

## Intermediate Usage

More realistic usage including relevant configuration, validation, error handling, composition, or integration.

Explain the additional behavior.

## Advanced Usage

Optional.

Include only when the API genuinely supports complex or specialized usage.

## Related Documentation

Link relevant repository documentation.
```

Do not force sections that provide no value.

---

# File Tables

Keep file descriptions short.

Prefer:

| Path                | Purpose                        |
| ------------------- | ------------------------------ |
| `index.ts`          | Public exports for the module. |
| `types.ts`          | JWT contracts.                 |
| `helpers/verify.ts` | Token verification behavior.   |

Avoid documenting implementation line-by-line.

The source code owns implementation detail.

Documentation explains ownership, intent, contracts, and usage.

---

# Arguments and Examples

Argument documentation should explain semantics the type system cannot communicate by itself.

Prefer:

| Argument | Type     | Purpose                                                                                    | Example           |
| -------- | -------- | ------------------------------------------------------------------------------------------ | ----------------- |
| `token`  | `string` | Encoded JWT received from an untrusted caller and requiring verification before claim use. | `"eyJ...example"` |

Avoid:

| Argument | Type     | Purpose         |
| -------- | -------- | --------------- |
| `token`  | `string` | A string token. |

Examples must improve understanding rather than merely repeat the type.

---

# Sensitive Data

Documentation must never leak:

- credentials
- access tokens
- refresh tokens
- API keys
- private keys
- secrets
- real cookies
- passwords
- connection strings containing credentials
- PII
- production identifiers
- sensitive environment values

Do not copy real values from `.env`, deployment configuration, logs, or runtime output into documentation.

Use clearly fake placeholders:

```text
DATABASE_URL=<configured-through-environment>
JWT_SECRET=<secret>
USER_ID=user_example_123
example@example.invalid
```

Do not document a configuration value as a constant when it should be supplied through an environment variable or secret-management system.

Examples should teach the contract without exposing operational data.

---

# Progressive Examples

## 5-Minute

Required when an API benefits from examples.

Show the smallest correct path.

Answer:

> How do I use this correctly right now?

Keep it easy to copy and explain what the important lines do.

---

## Intermediate

Include when the feature has meaningful real-world nuance.

Possible topics:

- validation
- error handling
- configuration
- dependency composition
- request context
- multiple options
- framework integration
- common failure handling

Answer:

> How would I normally use this inside the application?

---

## Advanced

Optional.

Only include when the feature genuinely has advanced behavior.

Possible topics:

- extension points
- unusual integrations
- complex composition
- performance behavior
- lower-level control
- specialized security constraints

Do not invent complexity simply to create an advanced example.

---

# Caveats

Caveats are mandatory when meaningful.

Pay particular attention to feature documentation covering:

- routes
- pages
- authentication
- authorization
- middleware
- persistence
- client/server boundaries
- asynchronous behavior
- state synchronization
- external integrations

These features often involve behavior that is not obvious from one file.

Relevant caveats may include:

- invalid input behavior
- thrown errors
- partial failures
- retry behavior
- idempotency
- security assumptions
- authorization requirements
- side effects
- network or database I/O
- authoritative ownership
- async behavior
- ordering requirements
- caching
- concurrency
- performance implications
- unsupported use cases

Do not manufacture irrelevant caveats.

---

# Documentation Impact

Documentation may require review when implementation changes:

- public contracts
- arguments
- return values
- error behavior
- caveats
- use cases
- public exports
- module ownership
- feature behavior
- configuration
- security assumptions
- routes
- pages
- cross-layer behavior
- architectural boundaries

A change does not need to alter the function name to require documentation updates.

For example:

```text
implementation change
      ↓
different retry behavior
      ↓
existing arguments unchanged
      ↓
README caveat is now incorrect
      ↓
documentation impact
```

Contract changes should receive particularly careful review.

---

# Avoid Documentation Noise

Do not request documentation work for every commit.

Usually no documentation action is needed for:

- formatting
- lint fixes
- typo fixes
- internal renaming with no semantic change
- equivalent refactors
- test maintenance
- dependency cleanup that does not change behavior
- implementation details invisible to consumers

Documentation checks should focus on **meaningful changes to understanding or usage**.

---

# Feature Documentation

Features spanning routes, pages, modules, or layers deserve additional scrutiny.

A feature document should explain the flow rather than duplicate every participating file.

Example:

```text
Browser
   │
   ▼
Route
   │
   ▼
Validation
   │
   ▼
Authentication
   │
   ▼
Application behavior
   │
   ▼
Persistence
```

Document:

- ownership
- important boundaries
- authoritative behavior
- contracts between layers
- expected flow
- meaningful failure states
- relevant caveats

Then link to colocated module documentation for lower-level APIs.

---

# Factual, Not Historical

Documentation describes the system **as it exists now**.

Avoid statements such as:

> We recently changed this function to accept an options object.

Prefer:

> The options object controls verification constraints.

Git history, commit messages, ADRs, or changelogs own historical context.

Documentation should not become an implementation diary.

---

# Guiding Model

Use this ownership model:

```text
docs/
    explains the system and cross-cutting concepts

module/README.md
    explains the module and its public usage

source code
    defines implementation truth

Git
    records history

accepted plans
    define intended future state
```

Keep those responsibilities separate.

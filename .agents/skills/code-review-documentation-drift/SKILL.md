---
name: code-review-documentation-drift
description: Extend explicit code-review tasks with a scoped semantic check for factual drift in relevant documentation, including prompt preferences and approved-update routing.
---

# Code Review Documentation Drift

## Purpose

Run a documentation-drift check as the final phase of every explicit code review. Reuse the review's existing semantic context; do not call another model, external analysis service, or repository-wide crawler.

This is an agent lifecycle extension. It is not a Git hook and must never block a commit, push, build, or test command.

## Activation

Activate when the user explicitly requests any code review, including:

- production readiness;
- security;
- code quality;
- architecture;
- maintainability;
- performance;
- API, contract, feature, route, or page review; and
- general code review.

Do not activate merely because files changed, tests ran, a build completed, or a commit was created.

## Required Lifecycle

For an activated review:

1. resolve the code-review scope;
2. perform the primary code review;
3. discover documentation relevant to that same scope;
4. compare factual documentation claims with current implementation evidence;
5. classify only confirmed, meaningful differences as drift;
6. place one aggregated `Documentation Drift` section after primary findings when drift exists;
7. resolve the documentation-prompt preference;
8. ask one consolidated update question only when confirmed drift exists and prompting is enabled; and
9. update only approved, scoped documentation through the repository documentation skill.

Never update documentation before the user approves the update.

## Authority

The codebase is authoritative for current implementation behavior.

An explicit user-defined goal or accepted plan may describe a target state. Treat that material as future intent, not stale current-state documentation. Do not rewrite a target-state plan back to the current implementation and never make ordinary documentation claim planned behavior has shipped.

Use Git only as historical evidence. Do not treat history as the current behavior contract.

## Scope Resolution

Documentation inspection inherits the review scope. It may follow behavior across directly participating layers when the reviewed unit is a feature, route, or page, but it must not expand into a repository-wide audit.

Start from source files, modules, features, routes, pages, public contracts, or explicit paths named by the user. Include directly coupled files needed to understand the reviewed behavior. Exclude unrelated modules even when their documentation is visibly stale.

When scope is ambiguous, use the narrowest boundary that fully represents the requested review and state that boundary in the review.

## Documentation Discovery Order

For every scoped source file or participating feature, inspect documentation in this order:

1. **Colocated module documentation.** Walk upward to the nearest meaningful module or feature-module `README.md`. Stop after a clear module boundary; do not continue into unrelated parents.
2. **Explicit references.** Follow documentation links from the relevant module README when they describe the reviewed behavior.
3. **Cross-cutting documentation.** Include documents under `docs/` only when the review task and implementation evidence show that they describe the reviewed feature, contract, security boundary, route/page flow, or behavior.
4. **User-provided documentation.** Include every document explicitly supplied or referenced by the user.

Do not inspect unrelated documentation merely because it is nearby or contains a similar word.

## Semantic Drift Test

Documentation drift is confirmed only when all three elements are available:

1. a specific factual documentation claim;
2. corresponding current implementation evidence; and
3. a concrete factual difference between them.

If any element is missing, do not label the issue confirmed drift. Relevant uncertainty may be reported as uncertainty in the primary review, but it must not produce a documentation-update prompt.

### Contracts

Compare documented and implemented:

- arguments and their meaning;
- return values and types;
- public interfaces and exports;
- schemas and DTOs;
- request and response contracts; and
- meaningful public component props.

### Errors and Caveats

Compare documented failure and operational behavior even when signatures are unchanged, including:

- returned failure values versus thrown errors;
- retry and partial-failure behavior;
- idempotency and state mutation;
- I/O and asynchronous behavior;
- authentication and authorization requirements;
- ordering and concurrency assumptions;
- caching and performance behavior; and
- introduced or removed edge cases.

### Use Cases and Examples

Confirm that documented examples and supported uses remain valid. A new request context, caller obligation, validation step, or unsupported input can create drift even when the function name is unchanged.

### Security and Trust Boundaries

Pay special attention to authentication, authorization, RBAC, claims, token validation, permissions, sensitive configuration, secret handling, and client/server authority.

A material security or production mismatch remains a review finding even when documentation prompts are suppressed.

### Routes, Pages, and Features

For feature-level documentation, compare the complete relevant flow rather than isolated files:

```text
Page -> Component -> Route/API -> Validation -> Authentication -> Application Logic -> Persistence
```

Include only layers participating in the reviewed behavior.

### File Tables

Report meaningful stale entries caused by renamed or deleted files, newly public/supporting files, or changed ownership. Do not require every internal file to appear in a README table.

## Non-Drift Changes

Do not prompt solely for:

- formatting or lint changes;
- typo or comment fixes;
- private variable or helper renames;
- equivalent internal refactors;
- test-only maintenance;
- dependency cleanup with no behavior change; or
- implementation details invisible to consumers.

## Review Output

Primary review findings come first. When confirmed drift exists, append one section using this shape:

```text
Documentation Drift

1. path/to/document.md

Documented:
<specific factual claim>

Implementation:
<current behavior with source evidence>

Impact:
<why the contract, caveat, example, or understanding is stale>
```

Aggregate all affected documents into this one section. Do not interrupt individual primary findings with documentation questions and do not ask once per file.

When prompting is enabled, ask once:

```text
Documentation drift was detected within this review scope.

Affected documentation:
- <path>

<one-sentence summary of the factual changes>

Would you like the scoped documentation updated?
```

Do not prompt when no confirmed meaningful drift exists.

## Prompt Preference Resolution

The prompt preference controls only the update question. It never hides evidence or findings.

Resolve preferences in this order:

1. an explicit current user instruction to re-enable prompts;
2. session state in the active conversation;
3. the project preference in `.agents/memory/documentation-review.md`; and
4. the default value `enabled`.

Allowed states are:

```text
documentationReviewPrompt = enabled
documentationReviewPrompt = disabled_for_session
documentationReviewPrompt = disabled_for_project
```

### Update Documentation

For `yes`, `update them`, `fix the docs`, or equivalent approval, follow `.agents/skills/documentation/SKILL.md`. Update only documents identified by the current drift analysis unless the user explicitly expands scope.

Use code as current-state truth, preserve accepted target-state plans, refresh stale examples and argument tables, and use clearly fake placeholders. Never insert credentials, secrets, tokens, environment values, PII, or production identifiers.

### Decline Current Review

For `no`, `not this time`, `skip the docs`, or equivalent decline, make no documentation change and persist nothing. A future review may prompt again.

### Suppress Current Session

For `don't ask again this session` or equivalent, retain this ephemeral state only in the active conversation:

```text
documentationReviewPrompt = disabled_for_session
```

Do not write session suppression to the repository or durable memory. Continue reporting material drift. A new session defaults to the project preference. The user may re-enable prompts within the session.

### Suppress Project

For `don't ask me again for this project`, `disable documentation prompts globally`, or equivalent, update `.agents/memory/documentation-review.md` to:

```text
documentationReviewPrompt = disabled_for_project
```

Here, `global` means project-wide. Continue reporting material drift, including security and production mismatches, without asking the update question.

### Re-Enable Project

For `ask me about documentation again`, `enable documentation review prompts`, or equivalent, update the same project memory file to:

```text
documentationReviewPrompt = enabled
```

Clear any session suppression when the user explicitly re-enables prompts for the active session.

## Approved Documentation Updates

When approval exists:

1. follow `.agents/skills/documentation/SKILL.md`;
2. keep changes inside the review scope;
3. make current-state documentation factual rather than historical;
4. preserve and clearly label accepted target state;
5. update stale examples, argument tables, returns, failures, and caveats; and
6. do not perform unrelated documentation cleanup.

## Completion Checklist

Before finishing an activated review, verify:

- the documentation boundary does not exceed the code-review boundary;
- colocated and explicitly linked documentation was considered in order;
- cross-cutting documents have a direct relationship to the reviewed behavior;
- every drift finding includes a claim, implementation evidence, and factual difference;
- target-state plans were not treated as current-state claims;
- trivial/internal changes did not produce prompts;
- all drift is aggregated after primary findings;
- the prompt preference was resolved without suppressing material evidence; and
- no documentation was changed without approval.

## Prohibited Implementations

Do not add or invoke a Git hook, repository-wide crawler, AST framework, application database/service, or separate model/API call for this lifecycle check.
Do not block commits because documentation is stale.
Do not automatically update documentation.
Do not rewrite plans to match incomplete current behavior.
Do not broaden the user's review request.
Do not make documentation historical.

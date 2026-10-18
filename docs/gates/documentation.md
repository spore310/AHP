# Gate: Documentation Coverage

A gate every change to `src/` or `env/` must pass. It keeps module documentation
aligned with the code so humans and agents can find what they are changing.

## Why

Source files were undocumented, so the only way to learn a module was to read it
in full. This gate makes documentation coverage a structural property instead of
an occasional cleanup: every source file must be reachable from its module's
`README.md`.

## Rule

For every `*.ts` file under `src/` (excluding `src/tests/`) and `env/`:

1. The nearest ancestor directory that contains a `README.md` is that file's
   **owning README**. (`src/jsonrpc/`, `src/sessions/`, `src/sessions/createSession/`,
   `src/websocket/`, `src/` for `src/index.ts`, and `env/` each have one.)
2. The file's path **relative to that README's directory** appears somewhere in
   the README — normally as a row in its `## Files` table.

There must be no `*.ts` file whose nearest README does not mention it.

## How it runs

```bash
pnpm docs:check
```

It is also part of `pnpm validate`, so it runs before the production build:

```bash
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run docs:check && pnpm run build
```

The check exits non-zero and lists every unmapped file:

```text
Documentation gate failed: every source file must be mapped by its module README.
See docs/gates/documentation.md.
  - src/foo/bar.ts: no ancestor README.md covers this file
  - src/foo/baz.ts: not referenced in src/foo/README.md
```

## How to satisfy it

- **New file in an existing module:** add a row to that module's `## Files`
  table using the module-relative path (for example
  `helpers/errors/helpers.ts`).
- **New module:** create `<module>/README.md` following
  [`.agents/skills/documentation/SKILL.md`](../../.agents/skills/documentation/SKILL.md),
  including a `## Files` table that lists every file in the module.
- **Removed file:** remove its row so the map does not point at nothing.

Adding a `README.md` to a subdirectory (for example
`src/sessions/createSession/README.md`) makes that directory the owning README
for files beneath it; its `## Files` table must then cover those files.

## Scope and exclusions

- Tests under `src/tests/` are excluded; they are documented per module in each
  README's `## Testing` table.
- Generated output (`dist/`, `coverage/`, `node_modules/`) is excluded.
- The gate checks **coverage** (each file is referenced), not prose quality.
  Prose quality is governed by the documentation skill and code review.

## Evidence

The gate is deterministic and runs in `pnpm validate`. Record dated evidence in
this file when a baseline run is relevant to a decision, for example:

```text
2026-10-18 — introduced with pnpm docs:check; pnpm validate green.
```

## Related Documentation

- [`.agents/skills/documentation/SKILL.md`](../../.agents/skills/documentation/SKILL.md)
  — module README structure and rules.
- [`scripts/check-docs.ts`](../../scripts/check-docs.ts) — the implementation.
- [`../architecture/capabilities.md`](../architecture/capabilities.md) — where
  the owning READMEs live.

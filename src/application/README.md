# Application composition

This module builds typed session catalogues and example policies. The host uses
the catalogue at creation time to resolve the session type, validate its config,
and pin allowed tool revisions. Session providers, identity, and executor grants
are supplied by the embedding application.

## Files

| File | Responsibility |
| --- | --- |
| [constants.ts](constants.ts) | Stable revision IDs and session-type keys. |
| [helpers.ts](helpers.ts) | Baseline catalogue, direct and namespace policy examples, and the in-memory host action. |
| [index.ts](index.ts) | Public application exports. |

## Five-minute example

```sh
pnpm exec vite-node examples/quickstart.ts
```

The script creates a `code-review@1` session on a loopback host, checks that its
mock provider reached `ready`, and shuts down. The trusted in-process create
call is the smallest useful application path. [Walkthrough](../../docs/guides/quickstart.md)

## Advanced example

```sh
pnpm exec vite-node examples/advanced/index.ts
```

Follow the same review session through authenticated SDK connections, scoped
tool execution, challenge handling, a projected host result, proposal and
artifact delivery, and a work lease. `-- --direct` runs the same example with
direct policy admission. [Walkthrough](../../docs/guides/advanced.md)

## Public factories

| Factory | What it gives the host |
| --- | --- |
| `createBaselineSessionApplication()` | Fresh `code-review@1` and `coding@1` types. Review lists read and search contracts. Coding also lists write. Application language configuration stays separate from the mock provider config. |
| `createScopedToolPolicyExample(mode)` | A policy factory for `direct` or `namespace` admission, application role names, and example actors. Bindings and assignments start empty. |
| `createExamplePolicyAdmission(mode, definitions)` | The admission and namespace configuration used by the runnable application with the supplied definitions. |
| `createInMemoryEchoRegistration()` | `example.echo@1` with host-controlled input/output schemas and a bounded text echo. It can become callable when the host installs its exact registration and independent grants. |

### In-memory host action

Pass the echo registration in `serverToolExecution.registrations`. Give the
exact revision a host-executor assignment and authorize callers separately.
The [advanced example](../../docs/guides/advanced.md#follow-one-review) also
projects one successful result into the title using its own resource operation.

## Session configuration

An application selects a type with the server-authored `x-ahp-session-type`
string. Protected factories use independently verified actors and resource
bindings. In a protected SDK connection the tool manifest is projected through
private assignment views. [Session composition](../sessions/README.md) ·
[Authorization](../authorization/README.md) · [Tool client](../toolClient/README.md)

## Verification

- [Application tests](../tests/application.test.ts) cover fresh catalogues,
  separate config, independent hosts, and terminal stop.
- [Policy example tests](../tests/applicationPolicyExamples.test.ts) exercise
  both admission modes, empty initial grants, and real namespace loopback.

[Documentation index](../../docs/README.md)

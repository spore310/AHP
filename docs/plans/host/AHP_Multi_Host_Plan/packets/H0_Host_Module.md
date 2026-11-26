# H0 — Extract host composition without changing behavior

**Status:** implemented on the candidate in [HANDOFF](../HANDOFF.md). Per-criterion status is in the handoff. **Evidence:** [handoff](../handoffs/H0.md). **Shared rules:** [CONTRACTS](../CONTRACTS.md).

## Outcome

Move composed server ownership into src/host while preserving the existing single-host behavior and public integration paths.

## Prerequisites

- PREFLIGHT archive decision recorded
- Terminology and ownership map reviewed

## Existing owners and source anchors

- `./src/websocket/helpers/host/helpers.ts`
- `./src/websocket/helpers/host/types.ts`
- `./src/websocket/helpers/host/work.ts`
- `./src/websocket/index.ts`
- `./src/index.ts`
- `./src/client/index.ts`

Read the public exports, direct callers, relevant module README and tests for these anchors. Source paths name the inspected baseline; resolve moves before editing. Proposed tests listed below do not exist merely because they appear in this plan.

## Required changes

1. Create the requested @host boundary using the repository's index.ts, types.ts, helpers/ and README conventions. Move createAHPServer composition and its types rather than introducing a second server builder.
2. Keep WebSocket framing/listeners in @websocket, session lifecycle in @sessions, authorization in @authorization, work in @work, and driver-specific code in @persistence.
3. Plan a compatibility export for current imports only if it can avoid a circular barrel dependency. @host must consume the lower transport entry point, not an entry point that re-exports @host.
4. Preserve AHPServerOptions.host as the network bind address. Reuse the existing durable hostId identity where compatible; do not reinterpret it as a pod ID or silently change stored identity.
5. Keep existing security composition identity checks, local admission/disclosure guards, one SDK receive owner, and terminal single-flight shutdown behavior.
6. Update actual callers, aliases, module README mappings and examples together. Add no dependency or published-package redesign just for the extraction.

## Decisions to resolve

- Specify the low-level transport import path and compatibility-export lifetime after inspecting the current import graph.

## Acceptance and required proof

| ID | Required result | Proof that must be recorded |
| --- | --- | --- |
| H0-01 | Existing createAHPServer single-host examples and public pinned-SDK tests behave the same before and after extraction. | Compare actual native initialization, dispatch, work and tool integration through old and new imports; no extra reader or authority path. |
| H0-02 | The resolved runtime import graph is acyclic across @host and @websocket. | Inspect the resolved graph/build; deliberately detect the tempting @host -> @websocket barrel -> @host cycle. |
| H0-03 | Security composition continues to reject mismatched canonical registries and policy factories. | Run existing incoherent-composition regressions through @host. |
| H0-04 | Concurrent start/stop, failed startup and repeated shutdown retain current completion guarantees. | Controlled pending acquisition and cleanup tests; count cleanup and late publications. |
| H0-05 | Portable client entry points remain free of server/PostgreSQL imports. | Existing portableEntries and Buffer-absent checks against actual resolved modules. |
| H0-06 | All moved source files, public exports and active callers are mapped accurately. | Typecheck, docs:check, build, scoped rg for stale imports, and final diff review. |

## Verification targets

- src/tests/host/composition.test.ts (proposed)
- Existing src/tests/websocket/ public-host suites
- Existing src/tests/client/portableEntries.test.ts and lifetime.test.ts

Focused command template after the proposed test files are implemented; reconcile paths with the checkout and record the command actually used:

```sh
pnpm exec vitest run src/tests/host/composition.test.ts src/tests/websocket src/tests/client
```

Run the relevant public examples and the repository-required final gate for the integrated candidate:

```sh
pnpm validate
```

Use controlled concurrency barriers rather than timing-only sleeps. Preserve relevant existing regression suites. Source inspection, mocks, PostgreSQL checks and public SDK tests are separate evidence categories.

## Handoff required

Complete [the packet handoff](../handoffs/H0.md) with the exact candidate, changed files, per-criterion evidence, actual commands/results, review dispositions, compatibility/documentation impact and next action. Update the root acceptance/status documents. No criterion is satisfied merely by adding its test.

## Stop condition

Stop after equivalent composition is proven. No distributed mode is enabled by this extraction.

Any required gate that fails or cannot run leaves the packet FAIL/BLOCKED/validation incomplete as appropriate. Finish safe independent work, state the concrete limitation and do not enable a dependent mode prematurely.


# Current Implementation State — Tool Contracts, Typed Sessions, Client Tool Invocation

Status: **Current behavior.** Verified against `2f9900a65386f8ebc03feebc694c2c61c2b3c332`
(`develop`, 2026-10-18). The other documents in this directory are the
original plan-ready handoff and remain useful as historical design input, but
they are not the current work ledger.

## Implemented

| Area | Current behavior | Primary location |
| --- | --- | --- |
| Tool contracts | Immutable exact `{ key, version }` revisions, explicit stable UUIDs, bounded JSON data, JSON Schema profile, atomic in-memory catalogue, detached descriptor projection. | `src/tools/` |
| Session types | Exact type revisions resolve exact tool revisions. A type may have zero tools. Hidden/disabled creation policy is captured at construction. | `src/sessions/helpers/sessionTypes/` |
| Typed creation | The typed default is `code-review@1`; `coding@1` selects a larger visible set. The native selector is the **string** header `config["x-ahp-session-type"]`, not the object selector proposed in the original plan. | `src/sessions/helpers/application/` |
| Visible-tool policy | Tools are `standard` or `admin`. The role is server-derived and defaults to `anonymous`; admin tools are omitted from the manifest unless the server supplies `admin`. Authentication does not exist, so the wire path cannot promote itself. | `src/sessions/helpers/application/constants.ts` |
| Manifests and admission | Session snapshots carry visible contracts under `_meta["x-ahp-application"]`. A client advertises an exact subset through `session/activeClientSet`; revision, name, full input schema, output-schema presence, and nested client identity are checked atomically before the reducer. | `src/websocket/helpers/ahp/`, `src/sessions/helpers/application/manifest.ts`, `admission.ts` |
| Client tool invocation | The namespaced `x-ahp/tools/*` extension routes calls only to the unique connected client advertising the exact contract. Local client handlers execute; the server validates input/output and never runs a tool. | `src/websocket/helpers/ahp/toolInvocation.ts`, `src/toolClient/` |
| Baseline application | `createBaselineSessionApplication()` supplies inert `code-review@1` and `coding@1` policies. No filesystem or model implementation is bundled. | `src/application/` |

## Verification at this checkpoint

- `pnpm test`: **31 test files, 230 tests passed**.
- `APPLICATION_CAPACITY.md` records a full `pnpm validate` pass at this
  checkpoint: lint, typecheck, tests, documentation mapping, and production
  build.
- Real `AhpClient` / `WebSocketTransport` tests cover typed creation, matching
  manifests for two clients, exact advertisement acceptance and rejection,
  invocation/result round trips, observer privacy, forged/stale executors,
  disconnect cleanup, capacity, and large manifests.
- No sealed two-reviewer audit was performed. `APPLICATION_CAPACITY.md`
  records within-team implementation/review feedback instead.

## Deliberate non-goals at this checkpoint

- No authentication, authenticated principals, or comprehensive session
  authorization.
- No presence leases or automatic stale-advertisement cleanup.
- No persistence runtime or database integration: no database adapter, ORM,
  durable writes, applied migrations, event journal, Redis, or
  reconnect/replay. SQL schema work is separate and does not by itself make
  persistence implemented.
- No server-side filesystem tools, model inference, Pi runtime, or agent
  process management.
- The original 100-case acceptance matrix is a target inventory. It has not
  been executed row-by-row as a formal ledger, and its proposed test paths do
  not all match the implemented test files.

## Divergences from the original plan bundle

1. **Selector shape.** The original plan proposed an object under
   `config["x-ahp-session-type"]` with `key`, `version`, and nested `config`.
   The implementation uses a server-authored **header string** and applies the
   remaining config keys through the type's parser.
2. **Access policy.** The implementation adds `standard` / `admin` visible-tool
   grants and a server-derived role. These were not part of the original
   declarations-only plan.
3. **Client execution.** An authorized follow-up added the `x-ahp/tools/*`
   invocation extension and `@toolClient` adapter, beyond the plan's
   declarations-and-admission boundary.
4. **Test layout.** Actual coverage lives in files such as
   `src/tests/sessions/toolManifest.test.ts`,
   `src/tests/sessions/typedCreation.test.ts`,
   `src/tests/websocket/sessionTypeCapacity.test.ts`,
   `src/tests/sessions/toolAdmission.test.ts`, and
   `src/tests/websocket/toolInvocation.test.ts`. The matrix's proposed paths
   are historical.

## Where to read next

- [Application capacity follow-up](APPLICATION_CAPACITY.md) — implemented flow
  and final evidence.
- [createApplicationSession](CREATE_APPLICATION_SESSION.md) — current public
  typed-creation surface.
- [Tool client README](../../../src/toolClient/README.md) — invocation
  extension and its limits.
- [Capability map](../../architecture/capabilities.md) — module ownership.
- [Wire contract](../../technical/wire-contract.md) — protocol-facing rules.
- [Future persistence](FUTURE_PERSISTENCE.md) — deferred SQL target; not
  implemented in this repository.

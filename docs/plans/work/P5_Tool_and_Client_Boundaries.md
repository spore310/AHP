# P5 — coherent tool ownership and a genuine general client

**Decision:** include P5 after P4. The user's cleanup goal is justified; the existing ToolClient cannot simply be renamed Client because its behavior is tool-specific.  
**Outcome:** tool capabilities live under singular `src/tool`, generic client connection/RPC behavior lives under `src/client`, and general session/security responsibilities remain with their owners.  
**Scope:** ownership/portability refactor plus the explicit private-protocol V1 label correction below. No new execution permissions or server model runtime.

## 1. What the source actually contains

At the pinned baseline:

- `src/toolClient` is only a re-export compatibility facade.
- The actual client lives in `toolExecution/helpers/client`. It initializes Microsoft's AhpClient, immediately negotiates private tool capabilities, subscribes/looks up assignments/advertises handlers, and executes or coordinates tools.
- Its `.client` property is the actual Microsoft AhpClient, which is more general than the containing ToolClient.
- `examples/advanced/work.ts` imports ToolInvocationTransport solely to call agents/work extension RPC. This is a concrete reason to extract general client transport.
- `toolExecution/helpers/client/helpers/broker` is server-side remote-tool dispatch/authority, despite its client-directory location.
- Shared private wire schemas are nested beneath the client subtree.
- `toolPolicy` contains generic role/direct-grant policy compilation and namespace selection already used by resource operations/session creation.
- `toolExecution/helpers/views` implements protected session/root snapshots and catalogue projection, not tool execution.
- ReferenceAuthorizer owns canonical tool-assignment authority; that ledger must not be duplicated or moved merely to tidy names.

P5 corrects these boundaries. It does not turn ToolAction into a generic server request abstraction.

## 2. Final entrypoint and file map

These are repository TypeScript aliases. The package is currently private and has no npm exports map; do not claim this is a published multi-package SDK.

| Current capability | Target files | Public alias |
| --- | --- | --- |
| Tool definitions/catalogue/trusted compilation | `src/tool/{index,types,constants}.ts`; `helpers/{contracts,catalogue}/` | `@tool`, `@tool/contracts` |
| Shared private tool DTOs + portable descriptor comparison | `src/tool/helpers/protocol/{index,types,helpers}.ts`; `helpers/descriptors/` beneath it | `@tool/protocol` |
| Client local tool implementations/advertisement/artifact handling | `src/tool/helpers/client/` | `@tool/client` |
| Tool action/dispatcher/calls/challenge/projection/artifacts | `src/tool/helpers/execution/` | `@tool/execution` |
| Host tool actions and authoritative remote-tool proxy | `src/tool/helpers/execution/helpers/{server,remote}/` | `@tool/server` |
| Tool-specific admission/proposals/assignment projections/binding types | `src/tool/helpers/policy/` | `@tool/policy` |
| Portable execution-binding schema/types only | `src/tool/helpers/policy/helpers/binding/` | `@tool/policy/binding` |
| Generic connection/framing/extension-RPC/lifecycle | `src/client/{index,types,helpers}.ts`; `helpers/transport/` | `@client`, `@client/transport` |
| Generic policy definitions/compiler/namespaces | `src/authorization/helpers/policies/` | `@authorization/policies` |
| Neutral resource authorization route | Existing authorization contract owner | `@authorization` or narrow policy entry |
| Protected session/root view projection | `src/sessions/helpers/views/` | `@sessions/views` |
| Shared bounded JSON values | P0's `src/jsonrpc/helpers/value/` | `@jsonrpc/value` |
| Transport authentication, socket queues, routing | Existing `src/websocket/` | Unchanged |
| Work scheduling/data/events | Existing `src/work/` | Unchanged |
| App-specific policy examples and composition | Existing `src/application/`, `examples/` | Unchanged |

Delete production `src/toolClient`, old `src/tools`, `src/toolPolicy` and `src/toolExecution` after all active consumers migrate. No compatibility export directories remain for unreleased consumers. Move nested helpers according to CodingRules; do not create operation-named standalone files merely for this reorganization.

Keep `@tool` small. Portable `@tool/client` and `@tool/protocol` must not traverse a root barrel that evaluates Ajv, Node ws, pg, host dispatch or application composition.

## 3. General Client and ToolClient are separate capabilities

### Target `./src/client/types.ts`

```ts
import type { AhpClient, AhpTransport } from "@microsoft/agent-host-protocol/client";

export type ClientConnection =
  | { readonly transport: AhpTransport; readonly ownership: "owned" }
  | { readonly transport: AhpTransport; readonly ownership: "borrowed";
      readonly detach: () => void | Promise<void> };

export interface ClientOptions {
  readonly clientId: string;
  readonly displayName?: string;
  readonly protocolVersions: readonly string[];
}
export interface ExtensionRpcOptions {
  readonly timeoutMs?: number; // default 5,000; finite integer 1..35,000
  readonly signal?: AbortSignal;
}
export interface ExtensionRpcClient {
  request(method: string, params: unknown,
    options?: ExtensionRpcOptions): Promise<unknown>;
  notify(method: string, params: unknown,
    options?: ExtensionRpcOptions): Promise<void>;
  onNotification(method: string, listener: (params: unknown) => void): () => void;
}
export interface ClientLifetime {
  readonly signal: AbortSignal;
  // Synchronous owned cleanup; rejects attachment after the lifetime has ended.
  // The returned function unregisters this cleanup before partial-setup rollback.
  addCleanup(cleanup: () => void): () => void;
}
export interface Client {
  readonly protocol: AhpClient;
  readonly rpc: ExtensionRpcClient;
  readonly lifetime: ClientLifetime;
  shutdown(): Promise<void>;
}
```

`connectClient(connection, options)` initializes native AHP only. It sends zero `x-ahp/tools/*` methods and works with a native endpoint lacking the tool extension.

The portable core accepts the declared transport-bearing ClientConnection. Update callers of the old string/URL shortcut to construct the pinned SDK's WebSocketTransport explicitly in their environment-specific example/application and pass it as owned. Do not make portable client imports load the SDK's Node WebSocket entry merely to retain an unreleased shortcut. Capture bounded extension params with the shared portable JSON helper before awaiting/sending; preserve the existing frame and correlation limits.

`createToolClient(client)` attaches the tool-specific behavior to an already initialized Client, negotiates the private V1 tool capability and returns ToolClient. `connectToolClient(connection, options)` remains a convenience composition of these two operations. It creates one native client and one reader; failure during negotiation shuts down the owned logical Client.

`createToolClient(existingClient)` failure instead rolls back only its partial adapter attachment; the caller's existing work/native users retain their connection. Register cleanup and exclusive notification handlers before the first negotiation await. Reject duplicate tool attachment and attachment to an ended lifetime. Unregister every partial handler/cleanup on failure; abort that adapter's local controller. A successfully attached tool adapter is owned by the connection until its shutdown.

ToolClient keeps its meaningful name and tool methods. Expose `connection: Client`; native operations become `tools.connection.protocol`. Its shutdown delegates to that same Client. Client owns extension cleanup and endpoint release; there is no independently closing second transport. An independently detachable tool adapter while keeping an advertised endpoint alive is not introduced in this packet.

Borrowed means the logical endpoint's supplied detach callback is invoked; the generic client must not close the shared physical carrier itself. All shutdown paths share one promise and one logical release.

Explicit shutdown, native protocol shutdown, remote EOF, receive failure and fatal send failure all end the same lifetime exactly once. Mark it closed and abort its signal before running a snapshot of registered synchronous cleanup callbacks. Isolate callback exceptions; cleanup cannot return an asynchronous operation or postpone closure. Tool cleanup aborts controllers, drops advertisements and queued invocations, rejects pending joins/poll delays and suppresses late completions. Work cleanup cancels requests, observers and reconciliation timers. Do not await a noncooperative local execute callback to release the endpoint; retain its occupied execution accounting until it actually settles.

`request` and `notify` share the bounded send owner (64 in-flight sends); requests retain the existing 64-correlation cap. `notify` writes a notification with no request ID and resolves when its send settles, not on a remote acknowledgement. Timing out or aborting retires the caller's response correlation/timer/listener, but an already started send retains its send-capacity slot until actual settlement. It does not cancel remote work or prove that a command was not accepted. Use the lifetime signal plus a per-operation signal; do not close the shared Client merely because one work view is disposed.

### Target `./src/tool/helpers/client/types.ts`

```ts
export interface ToolCallOptions {
  readonly work?: WorkExecutionRef;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
// Add options?: ToolCallOptions to dispatchTool(channel, contract, input, options)
// and callTool(channel, ref, input, options). Preserve their existing result types.
```

P2 introduces the optional work tag on the old client path; P5 carries that same contract to its new owner. `dispatchTool` places the tag beside input in the caller-to-host request. `callTool` forwards it once at dispatch and uses one overall deadline (default 35 seconds), passing the remaining bounded budget and cancellation signal to assignment, dispatch and status requests and polling delays. The host extracts the tag into its private restrictive guard. It never enters a remote tool invocation, completion, ordinary execution context, result, advertisement or view. Existing challenge continuation/status/projection paths retain the host-side guard and recheck it; they cannot detach a resumed call from its original work authority.

## 4. Extract transport carefully

Move generic behavior from ToolInvocationTransport:

- Bounded extension request IDs/correlation/timers and safe error mapping.
- Text, binary and parsed frame handling, including invalid UTF-8/oversize behavior.
- Bounded sends and retaining capacity until actual send settlement.
- Native frame forwarding to the single AhpClient receive owner.
- EOF/error/disposal, owned/borrowed release, and pending-reader termination.
- P4's work-notification observer seam and extension shutdown hooks.

Keep tool behavior in the tool adapter:

- Assignment generations, staged advertisements and exact acknowledgements.
- Local tool implementation lookup/validation/execution.
- Invocation correlation/tombstones, cancellation and late completion suppression.
- Tool artifact loading and challenge/continuation behavior.
- Tool notification parsing and projection.

Register recognized private notification methods with one owner each. Restrict extension interception to explicit `x-ahp/` methods; native protocol messages are forwarded unchanged. Duplicate handler ownership rejects. Work's one adapter can fan out to its bounded work subscriptions. Do not introduce a generic plugin manager, multiple recv loops or reconnect/redispatch policy.

Generic extension request IDs must not collide with the native SDK's requests, and responses must only resolve their exact pending owner. Unrecognized/malformed frames follow the existing safe forwarding/drop contract, verified by tests.

## 5. Policy/view extraction without moving authority

Move the generic policy factory, namespace and role/direct-grant contracts to authorization:

- ToolPolicyFactory → PolicyFactory.
- createToolPolicyFactory → createPolicyFactory.
- ToolPolicyNamespace → PolicyNamespace.
- ToolExecutionPolicyBase → PolicyDefinitionBase.
- ToolOperation → PolicyOperation, preserving the existing closed seven-purpose vocabulary.

Move the schema/error names consistently. Do not introduce arbitrary operation strings or change missing-operation denial. P2's work operation map remains separate from the basic policy purpose. Preserve challenge-required denial for work and the existing tool challenge flow.

Create a neutral ResourceAuthorizationRoute type for canonical route, external proofs and mandatory binding selectors. Protected session views and tool policy consume that contract instead of views importing ClientToolRoute. Replace tool-owned Awaitable imports with local standard promise unions where appropriate.

Preserve exact compiler object identity and usesPolicyFactory checks across ReferenceAuthorizer, session creation/restoration, work, views and dispatchers.

Keep canonical tool contracts, assignment/executor authority and proof-cohort validation in ReferenceAuthorizer for this stage. It uses runtime `defineToolContract` and `toolExecutionBindingSchema`, not only types. Put the latter's pure schema/types in the portable `@tool/policy/binding` leaf; that leaf must not evaluate the admission/assignment policy barrel. The relocated generic compiler uses authorization-local validation/constants leaves. Do not route the authorizer through `@tool/server` or `@tool/client`; do not claim authorization has become completely tool-free. A separate assignment-ledger extraction would require its own security design and is not authorized by a folder cleanup.

Move session/root views to sessions, preserving proof/cursor binding, projection whitelist, excluded-row basis, URI reuse and final-send freshness. The websocket delivery queue stays in websocket; P4 work projection stays in work.

## 6. One unreleased V1 private tool protocol

Current code uses `z.literal(2)` and top-level `version:2` in its private tool extension. The user explicitly wants all unreleased work to remain V1. P5 therefore changes the **one supported private wire shape** to top-level `version:1` on both server and client, retaining the current fields/semantics plus already accepted P2 scope restriction support.

- Update private tool schemas, capabilities, request/reply/notification constructors and exact tests together.
- Rename the active `toolProtocolV2.test.ts` suite/current documentation to V1.
- Reject version 2 after the change; do not negotiate/fallback between historical private versions.
- Do not change JSON-RPC `"2.0"`, Microsoft protocol versions, package versions, tool contract revision/version values, policy revisions or a legitimate tool definition with version 2.
- Remove production legacy-shape handling rather than keeping it for old internal fixtures: the old `x-ahp/tools/call` route/request schema, the completion-schema union and shape branch, optional `expectedContractId` invocation fallback, and native active-client metadata used as an execution advertisement. Preserve ordinary native session metadata and current private advertisement/invalidation.
- Migrate useful legacy correlation/capacity/lifecycle scenarios to strict V1 using the real public binding, or retire redundant tests after mapping their coverage. A historical fixture may remain only if genuinely independent of removed production behavior. Do not copy an old kernel into tests or retain a production fallback merely to make legacy tests pass.

This is an intentional unreleased private wire label change, not merely moving files. Verify it at both producer and consumer ends.

The producer inventory includes `toolExecution/helpers/client/helpers/protocol/types.ts`, request constructors in client helpers, `websocket/helpers/ahp/helpers/toolProtocol/helpers.ts`, host invocation envelopes in `websocket/helpers/ahp/toolInvocation.ts`, and retained status DTOs in `toolExecution/helpers/calls/helpers.ts`, followed by their moved paths. The inspected fallback is selected by message shape/call path, not a numeric `version === 2` branch. Changing only `z.literal(2)` will not remove that fallback. Preserve `ToolInvocationContext.version = invoke.contract.version`; explicitly test private envelope version 1 carrying a legitimate tool contract version 2.

## 7. Migration order within P5

1. Refresh the post-P4 import/caller map and establish the behavior tests before moves.
2. Relocate generic policy contracts/compiler and neutral route types; update coherent consumers in one slice.
3. Extract generic Client/transport with existing tool/work adapters still functioning through it.
4. Move tool-owned source and shared DTOs to singular tool; relocate the remote broker under server execution ownership.
5. Move session/root views into sessions and finish shared value-helper imports.
6. Apply the one-shape V1 wire relabel across server/client/tests in a distinct reviewable slice.
7. Update every active caller, fixture, alias and README source map; remove obsolete facades.
8. Review the final dependency graph and run all existing behavior/acceptance gates.

Update tsconfig paths and docs/CodingRules aliases. Vite already reads tsconfig paths; no resolver plugin/dependency is needed. Do not edit unrelated archived narratives to pretend historical versions did not exist.

## 8. Required tests

Reuse the real-SDK `src/tests/toolExecution/clientBoundary.test.ts` cases under the new owners. It covers framing, exact ack, queued joins, send/read failures, ownership and teardown; do not replace it with a mock that returns expected values from the same new helper.

| ID | Evidence |
| --- | --- |
| P5-01 | Generic connect initializes/pings/subscribes to an endpoint with no private tool extension and emits zero tool methods |
| P5-02 | Native SDK requests, agents/work RPC and work notifications share one receive owner without correlation loss |
| P5-03 | Tool attachment still negotiates, assigns, advertises and executes exactly once; failed connectToolClient convenience creation releases its new logical endpoint once |
| P5-04 | Owned/borrowed shutdown, EOF, failed sends and nonsettling handlers preserve capacity and stop late completions |
| P5-05 | `examples/advanced/work.ts` imports `@client`, no tool transport |
| P5-06 | Final `@client`, `@tool/client`, `@tool/protocol` portable imports do not evaluate Node-only/server/application modules |
| P5-07 | Execute descriptor equality/ack validation with Buffer absent and Unicode/budget cases; import mocks alone are insufficient |
| P5-08 | Host and remote dispatch preserve caller/executor separation, challenge flow, exact assignment/lease restrictions and projection guards |
| P5-09 | A moved policy factory remains the same instance everywhere; a tool grant still cannot authorize unrelated work/resource effects |
| P5-10 | Session/work views preserve revocation, excluded-row, cursor, retirement and URI-reuse behavior |
| P5-11 | Private server/client packets all use top-level version 1; version 2 rejected; JSON-RPC/tool-contract versions unchanged |
| P5-12 | No active production/example/config/current-doc imports point to deleted aliases; historical fixtures remain clearly test-only |
| P5-13 | A local executor sends exactly one correlated completion through `rpc.notify`; send timeout does not free an unsettled send slot |
| P5-14 | Generic shutdown/EOF with tool and work adapters attached aborts handlers, requests, poll delays and timers; repeated calls release once |
| P5-15 | Partial/duplicate/closed attachment cleans up deterministically without closing an existing caller-owned Client |
| P5-16 | A near-deadline status request uses the remaining budget; disposing one work view cancels its request without closing other connection users |
| P5-17 | Work-tagged SDK dispatch reaches the host guard, enforces effective-target scope and never exposes its token to a remote executor |
| P5-18 | Old call/completion/invocation envelopes reject; migrated correlation/capacity tests cover the supported V1 public path |
| P5-19 | Private envelope version 1 with tool contract version 2 executes with context.version equal to 2 |

There is a source-backed portability risk: `src/tools/helpers/protocol/helpers.ts` uses `Buffer.byteLength` inside canonicalJsonEqual. The client executes it. Use TextEncoder or the already verified shared portable byte counter only after matching Unicode and budget behavior; an import-only test will miss a free Buffer global.

Retain and migrate serverExecutor, pipeline, cleanup, challenge, artifacts, resultProjection and clientDispatch suites. Preserve public websocket tool protocol, serverTools integration, tool capacity/proposals/artifacts and protected egress suites, plus all P0–P4 tests.

`websocket/sdk.test.ts` and `toolInvocation.test.ts` currently substitute the internal kernel; their current pass would not prove public binding compatibility. Migrate their useful tool scenarios and retain valid native scenarios against the supported boundary. The real public-binding/SDK suites must remain separate. Inventory references to `src/tests/websocket/legacyToolClient/`, then remove the fixture if no independent historical test needs it. No executing test may rely on the production fallback deleted above.

## 9. App and final gate

Run:

```sh
pnpm exec vitest run src/tests/client src/tests/tool src/tests/authorization src/tests/sessions src/tests/work src/tests/websocket
pnpm exec vite-node examples/quickstart.ts
pnpm exec vite-node examples/advanced/index.ts
pnpm exec vite-node examples/durable-lifecycle.ts
pnpm exec vite-node examples/work-capacity.ts
pnpm exec vite-node examples/work-events.ts
pnpm exec vite-node examples/postgresql-conformance.ts
pnpm validate
```

The new test paths are the migrated targets. Update commands to exact final filenames only when moving tests; do not skip an existing suite because its old folder disappeared.

**Exit gate:** the generic client is genuinely independent from tool negotiation; all tool-owned capabilities have one clear home; authorization/state ownership and prior acceptance behavior are intact; private protocol is consistently V1; no active compatibility facades or hidden server imports remain.


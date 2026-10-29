# P07 read-only preflight — one client runtime, explicit transport ownership

**PREFLIGHT ONLY. No implementation authorization, test result or P07 PASS.** Only this report was written. No source/test/config/package changes, tests/build/services, web/package lookup or DB access. P06 is under Luna's independent plan review; its moving authorization/session internals and plan were not inspected/revised. P07 implementation remains blocked on **P06 acceptance + its own reviewed plan/API/ownership/write-set authorization**.

## 1. Evidence and current boundary

Read `packets/P07.md`, CONTRACT_CARD, INTEGRATION, EXECUTION (especially E3/E9), P00-inventory and the current client files, three named client suites, relevant INTERNAL broker tests, installed SDK declarations/runtime, aliases and owning READMEs. Predecessor P05 acceptance is coordination evidence, not P07 behavior proof. P00 describes the original baseline: its legacy/privacy statements must not be mistaken for the accepted protected host's current behavior.

| Exact observed file/symbol | Current fact / implication |
| --- | --- |
| `src/toolClient/index.ts:connectToolClient` | One implementation; eagerly imports SDK `/ws` and runtime `SESSION_URI_PREFIX` from the broad `@sessions` barrel. Connects wire, wraps transport, constructs AhpClient, connects and initializes with root initialSubscription. Initialization failure shuts down SDK while preserving the primary failure. |
| Same file: joinSession/joinSessionOnce | Per-channel promise chain serializes joins, recovers after previous failure, removes only its own latest map entry. Subscribe/read manifest; match local implementations by exact id+key+version; reject duplicate identities; descriptors derive from issued manifest, not local definitions. |
| Same file: waitForDispatchAcknowledgement/sameToolList | Start an independent events iterator before dispatch; require same channel, action type, origin clientId/clientSeq, activeClient clientId and exact descriptor list. Rejection/mismatch/closed stream/5s timeout fails. Compare descriptors individually under existing canonical JSON budgets, not an aggregate one-definition budget. Iterator/timer cleaned on exit. |
| `src/toolClient/transport.ts:ToolInvocationTransport` | Sole interception/local execution class. UUID-prefixed call request IDs, response correlation, 35s client timeout, send-failure cleanup and close/null rejection. Active and token-staged handler maps; early invocations queued only when no matching active implementation, at most64 queue entries. Activate/discard flushes through current handlers. |
| Same class: recv/execute | Only text extension frames intercepted. Request-shaped/wrong-version invokes pass through; valid notification executes local handler and sends completion. Exceptions become generic execution error. Non-text SDK frames currently pass through untouched. Executions run asynchronously, not awaited by recv/close; no action pipeline, cancellation or draining executor guarantee exists here. |
| `src/toolClient/types.ts` | LocalToolImplementation, ToolInvocationContext, ToolClientOptions and ToolClient. Options contain clientId/displayName/protocolVersions only. ToolClient exposes actual SDK client, joinSession, callTool, shutdown. No existing default export. |
| `src/toolExecution/{index,types}.ts` + README | Separate accepted action/challenge contracts; no client/server/dispatcher implementation yet. Do not turn the neutral policy/action root into a client/server runtime barrel. |
| `tsconfig.json` | Existing `@toolExecution`, `@toolExecution/*`, `@toolClient`, `@toolClient/*`. Wildcard alone does NOT make `@toolExecution/client` point to helpers/client. |
| `vite.config.ts` | `resolve.tsconfigPaths: true` serves Vite/Vitest. Node test environment; SSR build is `src/index.ts`, not a browser library build. No second hand-maintained alias table observed. |
| `package.json` | Private source project; pinned SDK1.0.0 and toolchain. No package export-map redesign is necessary/authorized by this move. |

Scoped import scan found executable client consumers only in `src/tests/websocket/toolInvocation.test.ts`, `src/tests/toolClient.test.ts`, `src/tests/toolClient/{transport,connection}.test.ts`, plus the client implementation itself. README examples use the old entry. No application source caller needs migration to preserve the old URL API. This is a scoped source/known-wire-doc search, not an assertion about unpublished consumers.

## 2. Installed SDK evidence — reuse, not guessed API

Local `node_modules/@microsoft/agent-host-protocol/package.json` declares **1.0.0**, exports `.`, `/client`, `/hosts`, `/ws`. P00's seam is confirmed against current installed files:

- `dist/client/transport.d.ts`: AhpTransport `send(JsonRpcMessage|string): void|Promise<void>`, `recv(): Promise<TransportFrame|null>`, `close(): void|Promise<void>`. Frames are text, binary Uint8Array or pre-parsed protocol message. No receive cancellation/detach/ownership method.
- `dist/client/client.d.ts` and `.js:139–169,452–489`: AhpClient takes an AhpTransport; connect starts one receive loop. Shutdown tears down SDK pending requests/subscriptions/events, calls/awaits transport.close best-effort, THEN waits for the receive loop. A no-op close with a permanently pending recv can therefore hang shutdown. The client does not add a cancel-read mechanism.
- `dist/ws/transport.d.ts` and `.js:38–72`: WebSocketTransport.connect(url,{protocols?}) uses **globalThis.WebSocket**, no `headers` overload. This is not a Node `ws`-package adapter; its current JS imports transport/error helpers, not Node WebSocket/server modules. fromSocket wraps an already-open global-WebSocket-shaped socket. It does not authenticate a host or attach arbitrary browser headers.
- SDK `/client/index.js` exports client/state/transport helpers, not `/hosts` or `/ws`. Its ordinary transport interface is suitable for a neutral source entry; default socket construction can be lazy and separate from injection.

Do not “fix” browser credentials with query tokens, URL userinfo, guessed initialize auth fields or invented native methods. No authenticate call is evidenced by a type named AuthenticateParams. A trusted app can establish an authenticated transport through its own platform adapter and supply it; P11 owns later credential/client migration. SDK constructor failure text can incorporate underlying error messages; existing code is NOT evidence of comprehensive URL/error sanitization. New code must not append/log a credential URL or serialize adapter secrets, and an injected adapter must supply safe error semantics. Rejecting existing URL shapes/changing all errors needs an explicit plan decision, not a stealth rename change.

## 3. Exact prospective move/shim/import/alias/README set

Recommended layout, **proposal not authorized edits**:

| Destination | Origin / responsibility |
| --- | --- |
| NEW `src/toolExecution/helpers/client/index.ts` | Exports only: connect function and public client types. No executable implementation in index. |
| NEW `.../client/types.ts` | Move old client types; add reviewed SDK transport-source/ownership contract. No server/session/runtime imports (type-only imports erase). |
| NEW `.../client/helpers.ts` | Move old index implementation: connection construction, joins, manifest decoding, exact acknowledgements. URL default lazily loads SDK `/ws`; supplied transport path never loads it. |
| NEW `.../client/helpers/transport/{index,types,helpers}.ts` | Move sole ToolInvocationTransport to helpers; private InvokeParams/types beside it; export-only nested index. Keep routing separate from connection/manifest/ack logic. |
| `src/toolClient/index.ts` | Compatibility named/type re-exports to NEW client entry, no initializer/wrapper/fallback logic. |
| `src/toolClient/transport.ts` | Compatibility re-export of the SAME class constructor from new transport entry. Preserve one-argument constructor's existing owned-close default. |
| `src/toolClient/types.ts` | Type-only compatibility re-exports. No copy of contracts drifting from their owner. |
| `tsconfig.json` | Add exact aliases `@toolExecution/client -> ./src/toolExecution/helpers/client/index.ts` and `@toolExecution/client/transport -> ./src/toolExecution/helpers/client/helpers/transport/index.ts`. Keep old aliases/wildcards. Do not add a misleading client wildcard unless every advertised subpath is real. |
| `src/toolExecution/README.md` | Map six new production files; distinguish action root/client runtime/default lazy socket and transitional protocol behavior. |
| `src/toolClient/README.md` | Map shims, show new owner entry, preserve old URL example source form and document explicit ownership/injection/trust limitations. Do not describe an unconfigured protected-host tool roundtrip as currently supported. |
| NEW `src/tests/toolExecution/clientBoundary.test.ts` | M01–M03 import identity/neutrality/fake transport/ack/ownership tests. |

This is **13 prospective paths**: six new production files +three shims +tsconfig +two READMEs +one new test. No existing test changes are inherently required: leave old imports to exercise compatibility and add new-entry coverage in the boundary suite. If import-only corrections become necessary in the packet's three named client suites, enumerate them at the plan gate and retain every assertion/body. Do NOT edit the INTERNAL `websocket/toolInvocation.test.ts` suite or its private-kernel mock to manufacture public authorization evidence.

No modification proposed to root `toolExecution/index.ts`/types, P01 contracts, session/authorization internals, websocket broker/private kernel, @tools contracts, packages/lockfile, Vite build shape or technical wire docs. If a new wire-doc factual update is necessary, request its exact scope; INTEGRATION's broad target map does not grant it automatically.

### Runtime import closure to fix while moving

- Replace runtime `SESSION_URI_PREFIX from @sessions` with existing `@sessions/constants` leaf (already used for the action constant). The sessions root currently re-exports factory/application code; loading it for one string is unnecessary server-capability reachability. Do not inspect/change moving session internals to solve this.
- Keep SessionToolManifest import TYPE-only; no runtime manifest/application factory dependency. Keep LocalToolImplementation's ToolContractDefinition TYPE-only.
- Prefer existing `@tools/constants` and `@tools/helpers/protocol` value exports for schema dialect/equality/descriptor conversion. `@tools` root also re-exports catalogue/contract validation that reaches Ajv; unnecessary for descriptor transport. Do not copy those helpers.
- Keep the one `parseUnknownJson` boundary via @jsonrpc (its inspected barrel/helpers contain protocol errors/JSON/schema code, no server socket); no second JSON.parse bypass.
- New implementation must NOT import through @toolClient compatibility paths or the root @toolExecution barrel; shims point inward only. No eager `/ws`, SDK `/hosts`, Node `ws`, @websocket, @application, @persistence, pg or process composition from the neutral client entry. A dynamic SDK `/ws` import executes only on the URL branch.

Import sentinels must prove actual module evaluation isolation, not rely on type erasure by assertion or on tree-shaking. Source aliases do not by themselves certify a browser bundle. Current tsconfig has Node types/ES2024 and the production build is SSR; universal browser/package support is NOT a P07 claim.

## 4. Suggested transport injection and shutdown contract

An additive, minimal surface to take to the P07 plan gate is an overload of the SAME named function:

```ts
connectToolClient(url: string | URL, options: ToolClientOptions): Promise<ToolClient>;
connectToolClient(connection: ToolClientConnection, options: ToolClientOptions): Promise<ToolClient>;

type ToolClientConnection =
  | { readonly transport: AhpTransport; readonly ownership: "owned" }
  | { readonly transport: AhpTransport; readonly ownership: "borrowed";
      readonly detach: () => void | Promise<void> };
```

These are proposed project types, NOT SDK exports. No existing default export exists to preserve; “old default” means the existing URL call source form, ordinary options and default socket behavior. New and old imports re-export the exact same connect function/class, not two adapters with different policy behavior. URL mode constructs an owned SDK transport lazily, then calls the same neutral assembly path. An authenticated/custom factory can be awaited by the application before supplying the resulting descriptor; a third connect-factory overload is not required merely to support injection.

The supplied transport must be an **already wire-connected, exclusively leased, not-yet-AHP-initialized endpoint**, not an AhpClient already driving its own recv loop. The new ToolClient owns its SDK client, extension state, request timers and join/event iterators. It must never start two readers on an endpoint or silently initialize a second identity on an existing SDK conversation.

### Ownership behavior that must be specified/tested

| Path | Required release behavior |
| --- | --- |
| URL/default or supplied owned | Wrapper shutdown rejects its pending extension requests, retires staging/queued work, ends its own recv locally; closes underlying owned endpoint exactly once. Initialization failure does the same while preserving the initialization failure. Repeated ToolClient/client shutdown must not double-close or double-clean up. |
| Supplied borrowed | Do NOT call underlying transport.close/destroy the supplier's physical connection. Locally stop requests/joins/execution delivery and invoke the REQUIRED captured detach once to retire the exclusive logical endpoint/reader and remote routing ownership. Initialization failure detaches too, preserving its primary error. Caller remains owner of physical transport. |
| Underlying EOF/fatal read/send failure | Reject/clear exactly this wrapper's pending requests/timers; propagate ordinary SDK closure/error semantics. Never close an unrelated/shared transport owner by accident. |
| Pending local execution resolves after shutdown/detach | Existing handler work is not forcibly terminated. It may settle late; no new completion may be emitted on a still-open borrowed endpoint after detachment. No claim that SDK shutdown waited for all local implementations or executed E3 cleanup hooks. |

**Important open constraint:** merely skipping inner.close is NOT a correct borrowed implementation. SDK shutdown waits recv; racing a local closed-promise can finish the wrapper, but leaves an uncancellable underlying recv consuming a future frame. This can steal a successor's frame. Leaving a raw WebSocket open can also leave its old advertised executor identity registered on the host. The pinned SDK has neither cancel-recv nor uninitialize/lease retirement. Therefore borrowed must mean a supplier-provided logical endpoint lease whose detach contract actually releases pending reads AND retires its protocol/routing ownership without closing the physical carrier. A raw SDK WebSocketTransport cannot be promised safely shareable/hot-reusable just because ownership="borrowed" was typed.

Recommended gate choice: require the explicit detach port above and document/test exclusive lease semantics; custom in-memory/multiplexed adapters can satisfy it. If the lead prefers borrowing a raw SDK endpoint with no extra port, report that shutdown/handoff is unsupported until a reviewed alternative exists; do not ship a no-op-close shortcut or fabricate SDK cancellation. P07 does not implement a general transport multiplexer. The adapter's actual termination guarantee is trusted-contract evidence, not sandboxed proof.

Wrapper close should have a synchronous closed barrier and local recv termination, reached before calling reentrant close/detach. Recheck the barrier after recv/await, before execute and before sending late completion; queued calls cannot activate after shutdown. Join chains queued before shutdown must reject rather than stage/advertise afterward. The supplier's detach/owned-close completion can itself be uncooperative: do not claim bounded physical shutdown or invent a new timeout/retry contract silently. Retain original failure over cleanup failure. Contract details for such draining/diagnostics require the P07 plan, informed by E3; they are not implemented by relocation.

## 5. Preserve behavior, do not smuggle later execution/security work

Carry unchanged: exact UUID response correlation; valid notification-only invocation; generic executor errors; 35s extension call timeout;5s advertisement acknowledgement; per-descriptor comparison; per-channel join serialization/recovery; local contract matching by id+key+version; stage token identity; activation only after exact accepted acknowledgement; rejection discards candidate, leaving prior active handlers; successful empty set removes availability; early queued invocation behavior and64 queue bound. Do not relabel the server's existing64 in-flight/30s limit as a client admission limit: client request map/local execute concurrency are not bounded by that server cap in the inspected code.

Do not change subscription/manifest format, legacy x-ahp/tools/call/invoke/complete methods, same-socket completion ordering, assignment semantics, action cleanup pipeline or auth/privacy wire. This move remains transitional: private assignment projections/dispatch/challenge/executor enforcement are later packets. The INTERNAL broker suite explicitly mocks the public binding to the private kernel; its compatibility roundtrip is not proof that the accepted protected public host admits legacy clients. Source compatibility must never introduce a public raw-kernel fallback.

One transport-choice issue needs approval: supplied AhpTransport admits binary and parsed frames, but existing interception handles text only. Ordinary frames of all three kinds must continue to pass correctly. The later plan must either (preferred) normalize all three legal frame kinds for extension matching while retaining original ordinary-frame forwarding and exact notification validation, with explicit bounded decoding tests, OR explicitly limit the extension endpoint to a documented text-framing adapter. Do not claim universal injected transport support while silently losing extension responses/invocations from parsed/binary frames. This is a targeted new injection-surface decision, not permission for wider parser/security changes.

## 6. Bounded M01–M03 acceptance controls (future, not run)

| ID | Existing evidence and new distinguishing controls |
| --- | --- |
| **M01 — one runtime** | New boundary test asserts legacy/new connect function and transport constructor identity. Source/import check finds exactly one connect/ack/local invocation implementation, old files only re-exports. Type imports preserve all old names and URL/options call form. Throwing module sentinels on Node/server/default socket modules: importing new client/legacy shim and exercising supplied fake transport never evaluates them. Root action entry stays separate. |
| **M02 — staging survives** | Retain existing UUID/notification tests and actual initialize-failure socket-close test. Add fake-SDK/server-scripted exact positive acknowledgement, wrong origin/sequence/channel/action ignored, rejection/mismatched descriptors/stream-close/5s timeout fail and preserve prior active handler set. Successful empty set removes handlers; staged invocation only executes accepted candidate, failed candidate never activates. Concurrent SAME-channel joins serialize even after first failure; different-channel progress remains independent. Owned shutdown closes once, settles pending requests/timers/joins and blocks late activation/completion. |
| **M03 — injection/ownership** | Scripted supplied fake AhpTransport completes real SDK initialize/subscribe/ack without loading SDK/ws or Node/server modules. Owned init failure/close count vs borrowed detach count/inner.close=0; borrowed pending recv terminates without stealing successor frames and its logical endpoint retires. No-op detach negative must not be described as successful handoff. Reentrant/double shutdown and late handler resolution cannot emit on borrowed carrier. Include ordinary text/binary/parsed pass-through + approved extension frame policy. Sent messages/URLs/errors never acquire synthesized auth headers/query token/userinfo; injected credentials remain in supplier adapter, no logging fixture prints values. |

Current three named client suites cover UUID correlation/valid invoke notification/request-shaped rejection and actual socket closure on init failure. They do NOT directly prove mismatched/rejected descriptor acknowledgements or concurrent JOIN serialization. The INTERNAL `websocket/toolInvocation.test.ts` adds large multi-tool descriptor acknowledgement, empty registration, real call/response, wrong-output/input, stale executor/forged completion, same-socket concurrent CALL ordering, host stop/disconnect/URI reuse and server64 capacity. Concurrent calls are NOT evidence of concurrent joins. Keep all these assertions intact and add missing move/injection controls in the new boundary file rather than copying/weakening the broker harness.

Later authorized checks: packet-focused typecheck +new boundary/three client suites; unchanged INTERNAL broker compatibility regressions; docs mapping; full DB-safe pnpm validate with retained output. No such checks ran in preflight. Use controlled promises/fake timers for5s/35s failures rather than waiting or deleting timeouts; no skipped or vacuous “file missing” pass.

## 7. Decisions / dependency handoff

P07 own plan must ratify: (1)13-path move and exact aliases, (2) additive connection descriptor +borrowed detach/remote endpoint retirement contract, (3) all-frame extension normalization vs explicit text endpoint, (4) close/draining/error behavior within behavior-preserving scope and (5) exact new tests/import-only amendment scope. If any needs another source/helper/fixture, request that exact path before writing.

P06 acceptance is required by packet order, but no P06-shaped assumptions are baked into this preflight: no new grant reader, CAS, lifecycle API or assignment protocol was imported/implemented. Recheck changed client-facing contracts after P06 acceptance, not its live internals during review. This report supplies actual current SDK/import/lifecycle evidence; it does not authorize construction, assert P07 ready-for-execution, certify browsers/shared-host privacy, or advance P08.

**Only `execution/P07-preflight.md` written. Actively notify `w8:p2`, then stop.**

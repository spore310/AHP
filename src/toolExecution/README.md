# Tool execution contracts

R5 action/challenge contracts and a local action dispatcher. Importing this module does not load a transport, database or platform executor. There is no artifact verifier or challenge continuation store. The local dispatcher is trusted host wiring; public transport admission remains separate.

The existing `ToolAction` class and presentation schemas remain the contract. Optional `prepare` means `execute` receives `TPrepared | undefined`. Validation has one canonical input, not a separate validated argument. `executor` is an `ExecutorRevision`, not only an actor ref.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Action, challenge, and artifact contracts. `challengePresentationSchema` rejects non-HTTP redirects. |
| `index.ts` | Public exports. |
| `helpers/client/index.ts` | Separate client entry exports; root action entry does not import it. |
| `helpers/client/types.ts` | Local implementation, invocation context, options, client and transport ownership contracts. |
| `helpers/client/helpers.ts` | SDK connection, manifest selection, serialized joins and exact advertisement acknowledgement. |
| `helpers/client/helpers/transport/index.ts` | Client transport wrapper export. |
| `helpers/client/helpers/transport/types.ts` | Internal extension invocation shape. |
| `helpers/client/helpers/transport/helpers.ts` | Sole local invocation router, staged handlers, UUID request correlation and endpoint cleanup. |
| `helpers/action/index.ts` | Action registration exports and the existing ToolAction class. |
| `helpers/action/types.ts` | Trusted schema/action registration and internal JSON capture contracts. |
| `helpers/action/helpers.ts` | Captured schema/implementation registration and bounded immutable JSON copying. |
| `helpers/dispatcher/index.ts` | Local dispatcher public boundary. |
| `helpers/dispatcher/types.ts` | Ports, limits, safe outcomes, lifecycle handles and runtime context schemas. |
| `helpers/dispatcher/helpers.ts` | Ordered gates, draining ownership, output budgets, cleanup and bounded shutdown. |
| `helpers/client/helpers/broker/index.ts` | Neutral client policy/proxy dispatcher exports. |
| `helpers/client/helpers/broker/types.ts` | Trusted client registration, resource resolution and transport proxy ports. |
| `helpers/client/helpers/broker/helpers.ts` | Canonical assignment authorization and remote proxy action lifecycle. |
| `helpers/views/index.ts` | Neutral resource-view exports. |
| `helpers/views/types.ts` | Explicit resource-read policy consent, trusted source and recipient fences, issued view proofs. |
| `helpers/views/helpers.ts` | Canonical read decisions, structured metadata projection, aggregate freshness and bounded opaque pagination. |

## Public names

Types: `Awaitable`, `ValidationResult`, `ToolPreparationHooks`, `ToolActionContext`, `ToolAction`, `ChallengePresentation`, `ChallengeContinuation`, `ChallengeProof`, `ChallengeVerification`, `ChallengeStatus`, `ChallengeAdapter`, `ArtifactDescriptor`.

Values: `ToolAction`, `challengePresentationSchema`, `createChallengePresentationSchema`, `createToolActionRegistration`, `createToolDispatcher`, `createResourceViews`.

Registration/dispatcher types: `ToolActionRegistration`, `ToolActionRegistrationOptions`, `ToolDispatchFacts`, `ToolDispatchPorts`, `ToolDispatchLimits`, `ToolDispatchPhase`, `ToolDispatchFailureCode`, `ToolDispatchOutcome`, `ToolDispatchHandle`, `ToolDispatchRequest`, `ToolDispatcherOptions`, `ToolDispatcher`.

`ToolActionContext` keeps caller, executor revision, origin, targets, contract revision, implementation binding, call id, `AbortSignal`, and an authority stamp separate. Redirect text is length-bounded and must be a syntactically valid `http` or `https` URL. That check is not approval.

## Omissions

No challenge store, artifact transport, public wire dispatcher integration or server executor adapter. The separate client entry below remains transitional. Root imports do not load a transport or session factory; resource-view cursors use Node crypto.

## Protected resource views

`createResourceViews` is the policy-aware embedding service. `ResourceViewOptions`
requires the canonical registry/compiler, explicit admitted resource-read policy
refs and trusted full-route resolution. Selected discover/reveal with an actual
binding and no challenge authorizes resource content, including authored text.
Tool assignments alone do not authorize this seam. Mandatory route constraints
remain canonical. All native metadata requires separate global-sequence consent
from the transport recipient adapter.

`ResourceViewSource` supplies canonical records, snapshots and catalogue rows.
Its captured resource/catalogue fences and the recipient's final fence are pure
owned-state checks: no clocks, resolvers or user hooks may run inside them. Ordinary
source and setup callbacks run before the final aggregate canonical clock check.
Proofs retain issued stamps, exact incarnation and local mutation fences.

Shared application metadata is empty; active-client/server tool arrays and
customizations are empty. Supported native action projections match the pinned
SDK reducer; unsupported transitions close the transport view. This is structured
metadata privacy, not text redaction. Root agents are empty without independent
provider-catalogue authority. Lists filter before paging, retain at most 128 opaque
30-second cursors, and reject foreign/stale cursors. Views cap 128 catalogue rows,
64 active preparations, 2 MiB captured values, and a 5-second caller deadline;
unsettled preparations keep their admission slot. Dispose/forget release retained
cursor ownership; already transmitted data cannot be recalled.
List publication rechecks liveness and proof freshness after awaits; disposed or
timed-out work cannot recreate cursor ownership when its resolver settles later.

## Host client-executor proxy

The neutral broker helper captures host-approved client registrations separately from
tool contracts: exact implementation, registration revision and approved source
id/revision. These are registry facts, not remote code attestation. Its trusted
resource resolver supplies the full route and optional external/mandatory selectors;
it cannot grant permission. Factory selection is intersected with canonical bindings
and exact assignments. One complete positive path suffices; mandatory restrictions
remain required. Unknown registrations, challenge requirements and stale proofs deny.

`createClientToolDispatcher` runs a fresh host proxy through the local dispatcher.
It independently checks caller invoke, executor advertisement and executor receive
permission, retaining genuine authorization objects and complete freshness stamps.
The final owned-fence port runs after authority callbacks. `send` settles only on
remote protocol completion; cancellation settles the caller wait but retains bounded
draining capacity until that completion. A lost connection can leave unresolved work
through shutdown. The host cannot prove remote cleanup or undo admitted side effects.
The WebSocket adapter supplies final enqueue/reply admission checks. Its public facade
still denies tool routes pending private assignment/projection integration.

## Client entry and ownership

`@toolExecution/client` exports `connectToolClient` and `LocalToolImplementation`,
`ToolInvocationContext`, `ToolClientOptions`, `ToolClientConnection`, `ToolClient`.
The old `@toolClient` imports re-export these exact values/types.
`@toolExecution/client/transport` exports the same `ToolInvocationTransport`
class as the old transport import. Its one-argument constructor owns its endpoint;
its optional release callback replaces physical close with supplier cleanup.

`connectToolClient(url, options)` lazily imports the pinned SDK WebSocket adapter,
which uses `globalThis.WebSocket`. A supplied descriptor avoids that import:

```ts
const client = await connectToolClient({ transport, ownership: "owned" }, options);
// Or an exclusive logical lease, supplied by a trusted adapter:
const leased = await connectToolClient({ transport: endpoint, ownership: "borrowed", detach }, options);
```

Each supplied SDK `AhpTransport` must be wire-connected, exclusively leased and
not yet initialized with an SDK identity or receive loop. The client owns its
SDK client, extension maps and timers. Owned shutdown closes the endpoint once.
Borrowed shutdown calls the captured `detach` once and does not call physical
`transport.close`. Detach must release any pending underlying receive and retire
the endpoint's remote identity/routing while preserving its supplier-owned carrier.
A no-op detach is insufficient: it can steal a successor's frame or leave a remote
executor registered. A raw SDK WebSocket transport has no general uninitialize or
cancel-read API and is not thereby safely shareable. No multiplexer is implemented.

Local closure synchronously rejects pending extension requests, clears staged and
active handlers/queued invocations, and terminates wrapper reads. Repeated closure
shares one release operation. EOF and fatal read/send failures also retire the
wrapper. Initialization failure preserves its primary error during cleanup.
SDK shutdown is best effort; ToolClient.shutdown additionally awaits wrapper
release even if the SDK is already closed. Cleanup may fail or remain pending;
there is no bounded physical shutdown guarantee. Detach must not await its own
enclosing shutdown promise. Already running user code may settle later, but its
completion is not sent after closure. This is not the later action cleanup/draining
pipeline, cancellation of arbitrary user code, or proof of remote behavior.

## Client behavior and limits

Joins serialize per channel and select implementations by exact contract
id/key/version. Descriptors come from the issued manifest. Handlers activate only
after matching channel, origin, sequence, action, client identity and exact
descriptor acknowledgement; rejection/mismatch preserves the prior active set.
An accepted empty list clears it. Unacknowledged registration times out after
5 seconds. Up to 64 early invocations wait for staged activation; overflow follows
the existing unavailable-handler response. Calls use isolated UUID identifiers
and a 35-second response timeout. These are client behavior, not server authority.

The wrapper intercepts valid JSON-RPC 2.0 notification-only invocations and its
own correlated responses in text, binary and parsed SDK frames. Text preserves
the existing JSON parser semantics. Binary interception decodes valid UTF-8 only
up to a 2 MiB envelope; oversized/invalid binary and other ordinary frames pass
unchanged to the SDK. That limit does not enforce underlying transport admission.
Parsed frames are trusted SDK adapter objects with supplier-owned framing/size
admission; no hostile getter/proxy sandbox is claimed. The adapter also owns
authentication and safe error semantics. The runtime does not synthesize auth
headers/query tokens or log credential URLs. URL adapter errors are not promised
to be sanitized by this layer.

The client remains transitional: private assignment projection, protected
dispatcher enforcement and public protected tool execution are later R5 packets.
Import isolation is tested with throwing module sentinels and the real SDK over
fake transports in `src/tests/toolExecution/clientBoundary.test.ts`. The existing
URL initialization-failure test exercises the actual socket adapter. These checks
do not certify a browser bundle or universal package portability; the project
build remains SSR. Implementation/source binding is not remote code attestation.

## Local action dispatcher

`createToolActionRegistration` captures a trusted contract definition, exact implementation binding and action factory. It reuses the existing draft-07 compiler. Schemas remain serializable; executable factories are separate host registrations. Generic input/output types are the host's schema/action pairing, checked against schemas on every invocation. Missing output schemas accept bounded JSON. Constructors must be inert: factories and supplementary authentication/validation are not privileged preparation.

`createToolDispatcher` owns aggregate capacity across registrations. Trusted per-call ports resolve context/resources, check coarse access, return full policy decision/authority, and check currentness synchronously. These ports are not client JSON, self-reported grants or public authentication. The host must retain complete invocation-specific freshness evidence privately; AuthorityRevisionStamp alone lacks LocalDecisionStamp expiry/external evidence. Initial authority is provisional. Prepare/execute receive the captured full-decision authority.

Order: bounded immutable input/schema; resolved initial context/coarse access; fresh action instance; optional authenticate/validate; recaptured and schema-checked normalization; resolved target route; full policy; prepare; execute; bounded output/schema; cleanup; current result delivery. Caller/auth/connection, executor, origin incarnation, contract and implementation stay pinned. New normalized targets require fresh resolution and authorization. Challenges fail closed until P13. Every action object can be used once per dispatcher, including sequential calls; weak tracking does not strongly retain completed instances.

Input/output/context facts are copied as bounded plain JSON without invoking getters. Constructor/prototype keys remain data. Cycles, nonfinite numbers, non-JSON prototypes and accessors reject. This is not a hostile-proxy sandbox or control of arbitrary trusted hook CPU/external effects. Prepared callbacks/handles remain local and are not copied or serialized. The dispatcher supplies AbortSignal.

`dispatch` returns `result`, `settled`, and `cancel()`. Success waits for cleanup/final currentness. Cancel/deadline may settle result early; settled waits for actual work and cleanup. Capacity and retained output bytes stay owned while draining. Late preparation may register cleanup until prepare actually settles; its returned handle reaches cleanup even after timeout. Action cleanup precedes registered LIFO callbacks, each registration once, with all attempted after failures. Registration after prepare settles rejects.

Failures expose only fixed code, phase, effectPossible and cleanup failure count. EffectPossible means prepare or execute was admitted, not that an effect is proven. Primary errors survive cleanup errors; successful work followed by cleanup failure returns cleanup-failed. No automatic retries. Early results cannot contain future cleanup diagnostics; settled supplies the final safe outcome. No completed replay cache exists here; caller retention and wire request reuse belong to caller/transport ownership.

Default/maximum limits: in-flight64/1024; input/output1MiB/16MiB; JSON depth64/128 and keys131072/1048576; retained output16MiB/256MiB; overall timeout30s/120s, hook timeout5s/60s, shutdown wait5s/60s. Context capture separately bounds2MiB/depth64/131072keys. Overrides are positive safe integers. The injected clock must stay finite and nondecreasing. Shutdown stops admissions, cancels, waits its drain budget and reports remaining calls. Unsettled work stays owned and cleans up later. Shutdown cannot forcibly terminate code or undo effects.

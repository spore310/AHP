# Tool execution contracts

R5 action and challenge contracts. The P01 contract boundary is accepted; later changes require an explicit amendment. Importing this module does not load a transport, database, or executor. There is no dispatcher, cleanup runner, or artifact verifier here.

Current behavior is the `ToolAction` type contract and presentation schemas. Optional `prepare` means `execute` receives `TPrepared | undefined`. Validation has one canonical input, not a separate validated argument. `executor` is an `ExecutorRevision`, not only an actor ref.

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

## Public names

Types: `Awaitable`, `ValidationResult`, `ToolPreparationHooks`, `ToolActionContext`, `ToolAction`, `ChallengePresentation`, `ChallengeContinuation`, `ChallengeProof`, `ChallengeVerification`, `ChallengeStatus`, `ChallengeAdapter`, `ArtifactDescriptor`.

Values: `ToolAction`, `challengePresentationSchema`, `createChallengePresentationSchema`.

`ToolActionContext` keeps caller, executor revision, origin, targets, contract revision, implementation binding, call id, `AbortSignal`, and an authority stamp separate. Redirect text is length-bounded and must be a syntactically valid `http` or `https` URL. That check is not approval.

## Omissions

No action pipeline, challenge store, output validator, artifact transport or server executor. The separate client entry described below is implemented. Root policy/action imports remain free of server and framework imports.

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

# Tool execution contracts

R5 action/challenge contracts and a local action dispatcher. Importing this module does not load a transport, database or platform executor. The dispatcher owns bounded in-memory challenge continuations. Approved artifact delivery uses an explicit source, publisher check, verifier, and client runtime loader.

The existing `ToolAction` class and presentation schemas remain the contract. Optional `prepare` means `execute` receives `TPrepared | undefined`. Validation has one canonical input, not a separate validated argument. `executor` is an `ExecutorRevision`, not only an actor ref.

## Files

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Action, challenge, and artifact contracts. `challengePresentationSchema` rejects non-HTTP redirects. |
| `index.ts` | Public exports. |
| `helpers/action/index.ts` | Action registration exports and the existing ToolAction class. |
| `helpers/action/types.ts` | Trusted schema and action registration contracts. |
| `helpers/action/helpers.ts` | Captured schema and implementation registration. |
| `helpers/artifacts/index.ts` | Approved artifact exports. |
| `helpers/artifacts/types.ts` | Exact approved metadata, byte bounds, source, and loader contracts. |
| `helpers/artifacts/helpers.ts` | Immutable trusted registration, bounded source reads, exact byte verification, and explicit loader handoff. |
| `helpers/challenge/index.ts` | Internal challenge coordinator exports. |
| `helpers/challenge/types.ts` | Bounded adapter options, ownership handles and strict result schemas. |
| `helpers/challenge/helpers.ts` | Atomic one-attempt continuation, presentation approval, deadlines and adapter draining. |
| `helpers/projection/index.ts` | Optional authorized result projection exports. |
| `helpers/projection/types.ts` | Trusted mapping and final authority admission contracts. |
| `helpers/projection/helpers.ts` | Captured output mapped to one registered owning-service action. |
| `helpers/dispatcher/index.ts` | Local dispatcher public boundary. |
| `helpers/dispatcher/types.ts` | Ports, limits, safe outcomes, lifecycle handles and runtime context schemas. |
| `helpers/dispatcher/helpers.ts` | Ordered gates, draining ownership, output budgets, cleanup and bounded shutdown. |
| `helpers/policy/index.ts` | Shared canonical executor-policy exports. |
| `helpers/policy/types.ts` | Location-bound registration, trusted resolution and issued proof contracts. |
| `helpers/policy/helpers.ts` | Exact registration capture, route validation and canonical assignment cohorts. |
| `helpers/server/index.ts` | Separate public server executor entrypoint. |
| `helpers/server/types.ts` | Explicit host identity, local action registration and dispatch contracts. |
| `helpers/server/helpers.ts` | Captured host actions, independent caller/executor authorization and shared dispatcher integration. |
| `helpers/remote/index.ts` | Neutral client policy/proxy dispatcher exports. |
| `helpers/remote/types.ts` | Trusted client registration, resource resolution and transport proxy ports. |
| `helpers/remote/helpers.ts` | Canonical assignment authorization and remote proxy action lifecycle. |
| `helpers/calls/index.ts` | Host private call-retention exports. |
| `helpers/calls/types.ts` | Connection-lease ownership, receipts, status proofs and retention budgets. |
| `helpers/calls/helpers.ts` | Bounded TTL/count/byte retention independent of dispatcher draining capacity. |

## Public names

Types: `Awaitable`, `ValidationResult`, `ToolPreparationHooks`, `ToolActionContext`, `ToolAction`, `ChallengePresentation`, `ChallengeContinuation`, `ChallengeProof`, `ChallengeVerification`, `ChallengeStatus`, `ChallengeAdapter`, `ChallengeContext`, `ArtifactDescriptor`.

Values: `ToolAction`, `challengePresentationSchema`, `createChallengePresentationSchema`, `createToolActionRegistration`, `createToolDispatcher`.

Registration/dispatcher types: `ToolActionRegistration`, `ToolActionRegistrationOptions`, `ToolDispatchAdmission`, `ToolDispatchFacts`, `ToolDispatchPorts`, `ToolDispatchLimits`, `ToolDispatchPhase`, `ToolDispatchFailureCode`, `ToolDispatchOutcome`, `ToolDispatchHandle`, `ToolDispatchRequest`, `ToolDispatcherOptions`, `ToolDispatcher`.

`ToolActionContext` keeps caller, executor revision, origin, targets, contract revision, implementation binding, call id, `AbortSignal`, and an authority stamp separate. Redirect text is length-bounded and must be a syntactically valid `http` or `https` URL. That check is not approval.

## Approved artifact delivery

The host creates `createApprovedArtifactSource({ approve, read })`, registers the
exact contract, source revision, publisher and artifact metadata, and supplies it
as `toolExecution.artifacts`. A published client proposal can use this binding
when the host registers its approved artifact against the exact proposal source
before the session selects that implementation. The source uses an opaque local
reference and returns at most 256 KiB of decoded bytes.

`loadApprovedTool(channel, contract, loader)` uses a current private assignment
to request delivery. The server verifies the assigned recipient, publisher
approval, and digest. After delivery the SDK client verifies the contract, source,
implementation, runtime/platform, SHA-256 digest and application verifier before
calling the loader with the verified bytes. The resulting handler uses the normal
advertise, challenge, invoke and result validation lifecycle. The host records
delivery on the exact view before accepting its advertisement. The application
owns artifact format, trust and runtime isolation. The binding establishes
approved delivery and local SDK verification, with remote runtime attestation
outside this contract.

`loadApprovedTool` advertises a single handler and uses the same per-connection,
per-session replacement semantics as `joinSession`.

## Private protocol

The browser-safe `@tool/protocol` boundary validates strict V1
DTOs after a bounded immutable plain-JSON capture (2 MiB, depth 64, 131072 keys).
Requests contain selectors rather than authority. Required payload fields reject
undefined; unknown versions/fields reject. Schemas describe private assignment,
advertisement, dispatch, status and exact execution correlation. Capabilities
declares continuation support when a challenge adapter is configured. The public host and client negotiate these DTOs;
legacy public call/completion envelopes fail closed.

`helpers/calls` owns private result retention for an exact trusted connection lease.
It does not authorize policy access. A host adapter must freshly authorize reads and
apply both currentness and trailing pure fences before send. Limits default to
256 records, 1 MiB per output, 16 MiB retained and 60 seconds from start; maximums
are 1024 records, 16 MiB per output, 256 MiB retained and 120 seconds. Expiry runs
on access and bounded timers. Immutable status proofs invalidate when their status
or record changes. Foreign leases and absent/expired records have the same absence.
Cancel/expiry/disposal request cancellation without pretending remote work settled;
only the dispatcher owns and releases draining execution capacity. A custom retention
clock requires a separate pure `fenceNow` reader in the same clock domain. Its final
check follows authority callbacks, rejects deadline crossing and clock rollback,
and cannot invoke application hooks. The default captures the platform clock.
Repeated identical status updates preserve the issued status identity. No retries occur.

The existing client proxy dispatcher now exposes admission before remote completion
and an internal `refresh(signal)` operation for retained-result authorization.
Refresh rechecks the captured input, original full route and selected executor with
isolated proofs; it neither executes again nor replaces execution proofs. The
private WebSocket adapter bounds refresh concurrency to 64 and deadlines to 5 seconds;
unsettled refresh work retains its slot. Invoke/advertise/execute freshness uses the canonical actor-aware cohort
check at a shared time, followed by the owned connection/resource fence. Discovery
requires a genuine discover assignment with reveal. Source approval remains distinct
from remote code attestation.

## Host client-executor proxy

The neutral broker helper captures host-approved client registrations separately from
tool contracts: exact implementation, registration revision and approved source
id/revision. These are registry facts, not remote code attestation. Its trusted
resource resolver supplies the full route and optional external/mandatory selectors;
it cannot grant permission. Factory selection is intersected with canonical bindings
and exact assignments. One complete positive path suffices; mandatory restrictions
remain required. Unknown registrations and stale proofs deny. Required invoke/execute challenges suspend before effects; no configured verifier denies.

`createClientToolDispatcher` runs a fresh host proxy through the local dispatcher.
It independently checks caller invoke, executor advertisement and executor receive
permission, retaining genuine authorization objects and complete freshness stamps.
The final owned-fence port runs after authority callbacks. `send` settles only on
remote protocol completion; cancellation settles the caller wait but retains bounded
draining capacity until that completion. A lost connection can leave unresolved work
through shutdown. The host cannot prove remote cleanup or undo admitted side effects.
The WebSocket adapter supplies final enqueue and reply admission checks for
negotiated private V1 requests.

## Local action dispatcher

`createToolActionRegistration` captures a trusted contract definition, exact implementation binding and action factory. It reuses the existing draft-07 compiler. Schemas remain serializable; executable factories are separate host registrations. Generic input/output types are the host's schema/action pairing, checked against schemas on every invocation. Missing output schemas accept bounded JSON. Constructors must be inert: factories and supplementary authentication/validation are not privileged preparation.

The client broker compiles fail-fast validators when policy issues an immutable
registration. Calls reuse those validators and each gets its own action, signal,
and authority checks. Validation is synchronous.

`createToolDispatcher` owns aggregate capacity across registrations. Trusted per-call ports resolve context/resources, check coarse access, return full policy decision/authority, and check currentness synchronously. These ports are not client JSON, self-reported grants or public authentication. The host must retain complete invocation-specific freshness evidence privately; AuthorityRevisionStamp alone lacks LocalDecisionStamp expiry/external evidence. Initial authority is provisional. Prepare/execute receive the captured full-decision authority.

Order: bounded immutable input/schema; resolved initial context/coarse access; fresh action instance; optional authenticate/validate; recaptured and schema-checked normalization; resolved target route; full policy; prepare; execute; bounded output/schema; cleanup; current result delivery. Caller/auth/connection, executor, origin incarnation, contract and implementation stay pinned. New normalized targets require fresh resolution and authorization. Challenges fail closed until P13. Every action object can be used once per dispatcher, including sequential calls; weak tracking does not strongly retain completed instances.

Input/output/context facts are copied as bounded plain JSON without invoking getters. Constructor/prototype keys remain data. Cycles, nonfinite numbers, non-JSON prototypes and accessors reject. This is not a hostile-proxy sandbox or control of arbitrary trusted hook CPU/external effects. Prepared callbacks/handles remain local and are not copied or serialized. The dispatcher supplies AbortSignal.

`dispatch` returns `result`, `settled`, and `cancel()`. Success waits for cleanup/final currentness. Cancel/deadline may settle result early; settled waits for actual work and cleanup. Capacity and retained output bytes stay owned while draining. Late preparation may register cleanup until prepare actually settles; its returned handle reaches cleanup even after timeout. Action cleanup precedes registered LIFO callbacks, each registration once, with all attempted after failures. Registration after prepare settles rejects.

Failures expose only fixed code, phase, effectPossible and cleanup failure count. EffectPossible means prepare or execute was admitted, not that an effect is proven. Primary errors survive cleanup errors; successful work followed by cleanup failure returns cleanup-failed. No automatic retries. Early results cannot contain future cleanup diagnostics; settled supplies the final safe outcome. No completed replay cache exists here; caller retention and wire request reuse belong to caller/transport ownership.

Default/maximum limits: in-flight64/1024; input/output1MiB/16MiB; JSON depth64/128 and keys131072/1048576; retained output16MiB/256MiB; overall timeout30s/120s, hook timeout5s/60s, shutdown wait5s/60s. Context capture separately bounds2MiB/depth64/131072keys. Overrides are positive safe integers. The injected clock must stay finite and nondecreasing. Shutdown stops admissions, cancels, waits its drain budget and reports remaining calls. Unsettled work stays owned and cleans up later. Shutdown cannot forcibly terminate code or undo effects.


## Verified challenge continuation

Configure createToolDispatcher({ challenge: { adapter } }) or the public host's
 toolExecution.dispatcher.challenge. The adapter implements begin(context) and
verify({ continuationId, proofRef }); optional cancel is called on invalidation.
Optional adapter status never authorizes execution. begin receives the frozen
trusted caller/executor, complete route/authority/contract/implementation and
SHA-256 inputDigest of the canonical captured input. It returns a private adapter
ID, finite ISO expiresAt and presentation. The wire gets a separate random UUID.
Proof references and adapter metadata are bounded; neither inputs nor authority
can be replaced by resume. Adapter IDs and failure codes stay private.

Bare { kind: "wait" } is the default permitted presentation. Any message or
redirect requires approvePresentation(presentation) returning exact true after
strict capture. HTTP(S) syntax alone is insufficient; URL credentials reject even
with approval. Applications must approve safe display text and exact redirects.

The handle's admission promise returns ready, denied or challenge-required with
continuation metadata. result/settled retain their existing ownership semantics.
resume(proofRef) consumes one attempt before awaiting trusted verification; only
fresh exact authorization can admit the first prepare/execute hook. The pure
challenge deadline fence follows callback-bearing guards immediately before that
first effect. Once preparation begins, the challenge is consumed; subsequent work
is governed by the dispatch deadline and current permissions. A custom dispatcher
clock requires a paired callback-free fenceNow in the same domain when challenges
are configured. No automatic retries or connection rebinds occur.

The proxy's structured admitted receipt reports ready only after the trusted send
port calls onEnqueued for a successful exact enqueue. Its separate resume result
also waits for that signal; remote completion is a different promise. Call retention
keeps waiting status for challenges and updates it once after successful resume.
Foreign, expired, consumed and unknown continuation IDs return the same safe denial.
Pending status authorization checks the original route even before execution.

Default/maximum challenge limits: host pending64/1024, per actor16/256, captured
metadata4096/16384 bytes, proof1024/4096 bytes, lifetime30/120 seconds and adapter
hook5/60 seconds. Lifetime is also clamped to the dispatcher deadline and adapter
expiry. Timers and access checks both enforce expiry. Registry invalidation,
disconnect, session destruction and shutdown cancel pending calls; restart loses
all in-memory continuations. Timed-out begin/verify/cancel promises retain their
slots and dispatcher cleanup ownership until actual settlement. Late work cannot
execute or reopen an ID. The socket adapter also cancels resume on its 5-second
request work deadline. These trusted callbacks are not a JavaScript sandbox.

MFA does not change an agent into a user or fabricate delegation or human consent.
All independent grant/provider/approval requirements remain mandatory on resume.
Discovery may show the sole safe condition "challenge-required" without running
the adapter. It still needs actual discover/reveal authority; advertised execution
remains subject to independent invoke and executor receive permissions.

Initial challenge replies also require continuationCurrent() after the final host
callbacks and retention fence. This pure check rejects expiry or cancellation
before publication. Generic invocation challenge aggregation uses invoke and
execute proofs; an advertise-only challenge does not run the invocation adapter.

## Optional result projection

`createToolResultProjection({ resources, project })` maps frozen validated output
and captured action context to one bounded `{ target, operation, payload }`, or
undefined for no action. Configure it as `ToolDispatcherOptions.projection`.
Projection runs once after successful output validation and cleanup, before
sensitive delivery. Target must belong to the original full route. The resource
service independently authorizes the operation and delegates mutation to its owner.
Executor output alone never becomes a trusted state action.

A configured projector requires `ToolDispatchPorts.admitProjection(context,
authority)`. This trusted port combines original invocation assignment proofs with
the resource-operation decisions using the same registry's
`validateAuthorityCohort`. Missing guard denies. The client broker supplies this
joint check for its original invoke/advertise/execute cohort and pure host fences.
The dispatcher checks cancellation and its pure deadline after admission callbacks;
a custom clock with projection requires paired `fenceNow`.

Rejected mapping, unsupported operation or stale authority produces safe
`projection-failed` in phase `projection`, with `effectPossible: true` and no output.
Execution is never retried or claimed rolled back. Cancellation/timeouts retain
job/output ownership until pending projector/authorization work actually settles,
using the resource handle's separate `settled` promise even after ticket timeout. Native
mutation uses the owner's action schema, reducer and sequence allocation. A
durable owner checks the same synchronous admission callback at the repository
write boundary. Projection awaits the owner's commit before reporting success.

## Host-controlled actions

Import `createServerToolRegistration` and `createServerToolDispatcher` from
`@tool/server`. Registration compiles exact input/output schemas and
captures a server/host implementation, positive registration revision and source
id/revision. Supply a local `ToolAction` factory; no grants are created.

`ServerToolBrokerOptions` requires the canonical registry/compiler, registrations,
a trusted full-route resolver and explicit executor `{ context, generation,
current, fence }`. The host-owned identity is independent of the caller and is
not a client credential or an administrative default. Install exact execute
assignments for that identity separately from caller invoke assignments. The
resolver and mandatory provider constraints apply to both.

Both adapters use the existing lifecycle. Initial target resolution is provisional;
trusted action validation may normalize input. Full authorization pins canonical
input and route for execution, continuation, projection and retained-status refresh.
Every later check must keep those values and the captured host identity. Callback
checks precede one canonical proof cohort; pure owned fences follow it.

Use `AHPServerOptions.serverToolExecution` for public protocol composition. It
shares one dispatcher with optional `toolExecution`; overlapping contract IDs
reject, and two supplied dispatcher option objects must be the same instance.
No client advertisement can select a host action. Private host rows offer
discover/invoke only; no local result can be completed by a client notification.
Server-only hosts are supported. The same call retention, challenge resume,
cleanup, cancellation/draining and projection rules apply. A host handle reports
ready at local full admission; a client proxy waits for actual remote enqueue.

The server adapter supplies joint invoke/execute plus resource-operation authority
for projection. Validated output alone never changes state. Source metadata binds
the trusted local registration; it is not remote code attestation. Importing the
root or client entrypoint does not eagerly import the server entrypoint.

See [the inert application example](../../../application/README.md#in-memory-host-action)
for a bounded local action that installs no runtime or permissions.

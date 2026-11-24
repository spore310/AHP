# P2 — work authorization, typed participants, scoped execution and consumer hooks

**Outcome:** consumers define work policy through the existing authorization/type-registration system; AHP enforces it consistently from submission through execution, settlement, data access and delivery.  
**Depends on:** P0 exact durable resources and P1 immutable work contracts.  
**Default:** no registered operation/grant means deny.

## 1. Extend the existing boundaries

Modify:

- `src/sessions/helpers/creation/{types,helpers}.ts`: capture `work` and `restoration` alongside creation, with bound callbacks and immutable data.
- `src/sessions/helpers/sessionTypes/` and `helpers/application/define.ts`: carry work-kind definitions and policies through every definition/catalogue/resolution path.
- `src/work/{types.ts,helpers/helpers.ts}`: accept `WorkRequestContext`/`WorkAgentContext`; own operation authorization and disclosure.
- Add `work/helpers/{authorization,authorityLoss,executionGuard}/{types,helpers,index}.ts`.
- `src/agents/`: bind canonical actor identity to durable registration and live presence. Existing `SecurityComposition.actors` remains the actor-classification authority.
- `websocket/helpers/host/`, `helpers/ahp/agentWork.ts`: pass actual protected connection context; remove owner-only shortcuts at every affected path.
- Existing client/server tool brokers and strict dispatch request schemas: add the narrow optional work-restriction seam.
- Existing resource-operation wrapper: combine work guard with the current synchronous final guard. Do not change `ResourceOperations.commit` to async.

No new role database, general permission engine, external authorization service or serialization of grants is required. Remote mutations remain disabled through P2 and open only after P3 proves mandatory database fences; P2 tests may wire them in isolated test hosts.

## 2. Session and application work policy

Use `SessionWorkPolicyRegistration` from shared contracts. Put it on `SessionTypePolicyRegistration.work`. Add host/application work ceilings to `AHPServerOptions.agentWork` using existing `PolicyScopeRules` and an explicit allowed-kind set. The same canonical registry/compiler instance must own creation, work, tools and views.

A helper for the application's default policy can package a finite operation map and typed kind registrations; it must not automatically assign roles or grants. Example intent:

```ts
// Target configuration inside ./src/application/helpers.ts or a consuming app.
const workPolicy: SessionWorkPolicyRegistration = {
  operations: {
    submit:     { purpose: "invoke",   policies: [reviewSubmitPolicy] },
    read:       { purpose: "discover", policies: [reviewReadPolicy] },
    claim:      { purpose: "execute",  policies: [reviewExecutePolicy] },
    renew:      { purpose: "execute",  policies: [reviewExecutePolicy] },
    complete:   { purpose: "execute",  policies: [reviewExecutePolicy] },
    fail:       { purpose: "execute",  policies: [reviewExecutePolicy] },
    cancel:     { purpose: "invoke",   policies: [reviewCancelPolicy] },
    updateData: { purpose: "invoke",   policies: [reviewDataPolicy] },
    announce:   { purpose: "publish",  policies: [reviewAnnouncePolicy] },
  },
  prepare: async (facts, signal) => applicationWorkRestriction(facts, signal),
};
```

Those references must be installed/admitted through the existing policy compiler and actual scoped bindings. The object alone grants nothing. Work has no challenge-continuation flow here. Reject statically known challenge-required work or mandatory policy refs at registration; at runtime require every evaluated cohort member to be allow with challengeRequired=false. A dynamic mandatory challenge denies work rather than being ignored. Consumers may reuse a policy intentionally; the SDK does not infer work authority from a generic tool invoke grant.

The effective decision requires all of:

1. A trusted current connection/actor or an explicitly trusted in-process server capability.
2. Exact session/type/provider/resource incarnation, operational where execution is required.
3. Host/application ceiling and session-type enablement for the work kind and operation.
4. Genuine scoped canonical bindings and mandatory constraints on the relevant routes.
5. Requested scope/announcement containment rules.
6. Optional consumer restriction freshness.
7. For executor operations, exact enabled registration, live connection, execution epoch, allowed kind, active attempt/token/deadline.
8. For acquisition, attempt budget and capacity.

Missing work registration, missing operation, empty refs, unknown refs, absent evaluator, invalid callback output, callback failure/timeout and stale proofs all deny. An omitted optional consumer restriction is simply no additional restriction.

## 3. Typed participant flow

| Participant | Source | What it may decide |
| --- | --- | --- |
| Submitter | TrustedRequestContext.actor captured on first submission | Stable provenance; no automatic execution/read rights |
| Owner | Exact canonical session owner in durable/live facts | Input to consumer policy; no client-writable owner |
| Eligible executor | Trusted agent actor mapped to registered identity and configured kinds | May be evaluated for claim; capability advertisement does not grant |
| Active executor | Registration + current execution epoch + exact lease attempt | Renew/settle only while current and authorized |
| Announcement recipient | Current protected connection and canonical recipient bindings | Receives only currently permitted projection |

Keep the existing canonical actor resolver. A client `agentKey` cannot upgrade a user into an agent or choose a privileged agent identity. For the default bridge, a work-capable connection must already resolve to `actor.kind="agent"`; its requested key must match the trusted actor ID. A consumer may register an explicit trusted mapping from actor ID to agentKey/registration ID when these namespaces differ. Capture that mapping with the agent configuration and validate principal/domain equality. Do not assume canonical agentId is a registration UUID.

Registration remains an authenticated request; assigning execution identity remains application-owned. A user client can submit when its policy allows but cannot obtain worker authority merely by calling agents/register. Update the advanced sample to use a distinct trusted worker actor and show at least one explicitly granted cross-principal execution case.

Preserve existing static-token/identity adapters as optional explicit adapters where still useful, but remove the protected work service's dependence on a second subject-only authenticator or a universal same-owner lookup. All protected decisions use the same `SecurityComposition`. Untyped in-memory native session fixtures may remain; a remotely enabled work service requires coherent protected setup.

## 4. Operation policy matrix

| Operation | Mandatory checks beyond current canonical permission |
| --- | --- |
| submit | Active exact session; registered kind; all positive anchors valid; all selection refs same root/domain; announcement publishing permission; immutable replay provenance |
| read/get | Exact work/session instance; current read projection permission; no token; no inferred right from submission |
| list/snapshot | Read decision for every included row; no hidden row IDs/counts or transferable cursor authority; bounded opaque continuation semantics are defined in P4 |
| claim | Agent binding/epoch/kinds, target eligibility, positive scope anchors, current work policy, cap/retry budget |
| renew | Same active attempt/token/epoch, live presence and current policy; cannot revive expiry |
| complete/fail | Same fences; completion input/result validation; optional data CAS atomic with settlement |
| cancel | Separate cancellation permission; no automatic same-principal shortcut |
| updateData | Separate permission + expectedDataRevision; executor path also needs exact lease |
| announce | Submission-side permission to choose target plus recipient-side current read/delivery permission |

Ordinary read requires an available authorization representation, not an executable backend. A restored failed session can be inspectable under an approved read-only representation while execution denies. Retired-history export remains a trusted retention/admin capability in this slice; do not revive old grants to expose it.

## 5. Async preparation and local admission

Current resource/tool final-commit semantics are synchronous. SQL is asynchronous. Keep those facts visible in types.

```ts
// Internal trusted persistence seam, not a wire DTO.
export type SynchronousAdmission<TLocked = unknown> = (locked: TLocked) => undefined;

interface PreparedWorkCandidate {
  readonly id: string;
  readonly revision: Revision;
}
interface PreparedClaimInput {
  readonly host: HostOwnershipFence;
  readonly session: ResourceRef<"session">;
  readonly agent: RegisteredAgentIdentity;
  readonly executionEpoch: Revision;
  readonly candidates: readonly PreparedWorkCandidate[];
  readonly maxActiveClaims: number;
  readonly allowedKinds: readonly string[];
}
interface WorkRepository {
  claimPrepared(
    input: PreparedClaimInput,
    admit: SynchronousAdmission<LockedClaimSnapshot>,
  ): Promise<WorkClaimResult>;
}
```

`LockedClaimSnapshot` includes actual locked work/session/registration rows, selector/graph revisions and the captured DB time. The work service owns genuine prepared proofs in a private map/closure. The adapter verifies the exact captured candidate, then invokes admission exactly once immediately before mutation. It rejects Promise/thenable/non-undefined returns and maps an owned denial distinctly from a database failure.

Admission performs no SQL or asynchronous application hook. Prepare all callback-capable evaluation first; then verify canonical proof cohorts and callback-free fences. Scope/identity/property values from wire JSON cannot construct the private receipt.

After commit, sensitive disclosure rechecks current authority and connection ownership. A claim accepted before a disconnect may exist in SQL while its response is suppressed; the lease still counts until a fenced disposition or expiry. Do not leak token/input/data to the new connection automatically.

After final local admission and before handing a mutation to SQL, mark the exact affected work/attempt guards settling and unusable. Track operation ownership so a late settlement cannot clear another operation's fence. Known rollback permits fresh proof preparation; confirmed commit installs current facts. An unknown outcome stays unavailable. Discard the suspect database client, then reconcile by acquiring the same row/session locks before rereading: those locks wait for the original transaction to finish, unlike an unlocked read that might run too early. For new submissions, reconcile under the session/key boundary.

For a storage failure with unknown COMMIT result, return the documented uncertain storage outcome and reconcile through idempotency/get. No success event is emitted from an unconfirmed commit; missed hints are recovered in P4.

## 6. Work scope during actual resource/tool calls

The host must enforce scope on operations explicitly executed for a work item.

### Existing seams to extend

- `toolExecution/helpers/dispatcher/types.ts`: async resolve/authorize, sync current and projection admission already exist.
- `toolExecution/helpers/client/helpers/broker/` and `helpers/server/`: combine a prepared restriction with canonical route proof checks.
- `websocket/helpers/ahp/toolInvocation.ts` and private dispatch DTO schemas: allow a sibling `work?: WorkExecutionRef`.
- `authorization/helpers/resources/`: retain sync commit; a host wrapper supplies the combined final admission callback.

Add one optional per-request restriction adapter to the server/client broker request. Its async prepare receives the **resolved canonical route**, caller and captured input; it returns private current/fence/release methods. This is a restrictive extension seam, not another grant source. The host wires `work.prepareExecutionGuard` into it.

Effective operation targets are the resolved route targets when nonempty; if targets is empty, the origin must itself be in scope. If a trusted operation also affects its origin alongside child targets, it declares origin among those targets. This avoids both a vacuous empty-target allow and forcing a chat-only task to include a session used merely as an authorization origin. The guard verifies work membership for every effective target, plus the actual operation's canonical permission. For operations using a granted parent route, verify both the route facts and specific target membership; do not merely check that the session root is in scope.

Private lease proofs must:

- Bind exact work ID, attempt, token, registration, execution epoch and session instance.
- Be bounded by the authoritative database deadline, translated conservatively to the local monotonic clock using sampled DB time and elapsed I/O time.
- Be invalidated by every host lease cancellation/reassignment/retirement/epoch change.
- Be rechecked at the existing synchronous side-effect and projection boundaries.
- Remain independent from ordinary tool-call IDs and opaque tool executor assignments.
- Never run hidden async SQL inside `current()` or `fence()`.
- Never include the lease token in ToolActionContext, forwarded remote executor messages, logs or work views.

Expose the accepted caller path in ToolClient: dispatchTool/callTool accept an optional typed options object containing work?: WorkExecutionRef and forward it only in caller-to-host private dispatch. Preserve this option through P5. A schema that accepts a work tag without a client capable of sending it is incomplete.

Already executed external effects are not rolled back when a proof later expires. Existing result publication still requires current proof; no false exactly-once claim.

## 7. Consumer authority-loss callback

### Target: `./src/work/helpers/authorityLoss/types.ts`

```ts
export type WorkAuthorityLossDecision =
  | { readonly action: "retainUntilExpiry" }
  | { readonly action: "requeue" }
  | { readonly action: "cancel" }
  | { readonly action: "fail"; readonly code?: string };

export interface WorkAuthorityLossContext {
  readonly work: AuthorizedWorkFacts; // bounded captured facts; no token
  readonly executor: RegisteredAgentIdentity;
  readonly attempt: number;
  readonly reason:
    | "policy-changed" | "connection-lost" | "registration-disabled"
    | "resource-unavailable" | "authority-expired";
  readonly signal: AbortSignal;
}
export interface WorkServiceHooks {
  onLeaseAuthorityLost?(context: WorkAuthorityLossContext):
    WorkAuthorityLossDecision | Promise<WorkAuthorityLossDecision>;
}
```

A canonical registry invalidation is only a recheck signal. Install a **synchronous** listener that enqueues/coalesces bounded work. Current ReferenceAuthorizer removes listeners that return promises, so `onInvalidate(async () => ...)` is incorrect.

Queue steps:

1. Capture candidate active leases in bounded pages; re-evaluate their actual authority and distinguish unchanged permissions from real loss.
2. Freeze sanitized callback facts for the exact attempt. Keep token/epoch/revision in a private fence.
3. Invoke the callback outside SQL locks. Default/missing/error/timeout/unknown decision means retainUntilExpiry.
4. Apply the decision only if the same attempt/token/epoch/version remains current. A later attempt or data-dependent policy change requires fresh evaluation, never applying an old response.
5. Requeue only if retry budget remains and the session/resource is eligible to accept queued work; otherwise fail/cancel according to the explicit lifecycle reason.
6. Retain merely preserves the lease row until expiry; it never authorizes renew/complete or grants a new permission.
7. Timeout ends the response wait but retains the occupied callback slot until the underlying promise settles. Abort is cooperative.
8. Shutdown aborts callbacks and closes admission. Late responses cannot revive work or mutate a replacement host/instance.

Explicit resource/session retirement uses P0's hard cancellation boundary, not a callback that can vote to keep the deleted resource operational.

## 8. Test requirements

| ID | Required counterexample / result |
| --- | --- |
| P2-01 | Missing work field, op, grant, kind/evaluator, false callback or invalid output denies independently |
| P2-02 | Policy capture through defineApplicationSession → catalogue → factory retains callbacks/work/restoration and freezes data |
| P2-03 | Allowed submitter, distinct owner and cross-principal executor operate only with explicit scoped policies |
| P2-04 | An ordinary tool invoke/execute grant does not imply work submit/claim/updateData |
| P2-05 | Claimed wire actor/domain/role/owner/capacity/epoch fields reject; user registration cannot become agent authority |
| P2-06 | Duplicate actorId/agentKey in another domain/principal does not inherit overrides or leases |
| P2-07 | Policy/connection changes during async preparation or lock wait cause zero durable mutation |
| P2-08 | Revocation after admission may commit but response/delivery is withheld; test documents this exact guarantee |
| P2-09 | A thenable admission callback rolls back; no Promise-as-true acceptance |
| P2-10 | Unknown commit outcome does not emit success or claim rollback; retry/read recovers |
| P2-11 | Tagged in-scope operation with base permission succeeds; either missing base permission or missing scope denies |
| P2-12 | Excluded descendant/cross-session route/retired incarnation cannot be accessed by a tagged tool call |
| P2-13 | Work token never reaches different executor/action context/log/projection; untagged calls retain independent policy |
| P2-14 | Stale private work proof fails after lease rotate, expiry, cancellation, data-dependent restriction change, disconnect or restart |
| P2-15 | Invalidation without actual permission loss invokes no disposition; async listener is never installed |
| P2-16 | Callback timeout/throw defaults retain and holds settlement capacity; a stale callback cannot alter a new attempt |
| P2-17 | Consumer requeue respects maxAttempts, current lifecycle and exact attempt; callback cannot supply a grant |
| P2-18 | Read/list/announce separation prevents exposing another submitter's input/data/result |
| P2-19 | Resource-data and work-data updates use current policy and CAS; a work read grant alone cannot mutate data |
| P2-20 | Policy expiry at final send suppresses a prepared success reply/announcement without leaking underlying payload |
| P2-21 | Empty route targets require origin scope; an operation affecting both origin and child declares/checks both |
| P2-22 | Mandatory challenge requirements deny work; unrelated tool challenge behavior remains intact |
| P2-23 | Unknown cancel/complete/data COMMIT makes prior work guards unusable until locked reconciliation; a late callback cannot clear a newer settling fence |

Add mirrored authorization/work tests and extend public `websocket/agentWork.*` integration suites. Use controlled promises/gates, not long sleeps. Preserve single-clock/cohort authorization and current tool projection tests.

## 9. App integration and exit gate

Update the advanced application to declare explicit submit/read/execute/cancel/data/announce policies; demonstrate a worker selected by trusted ActorResolver and configured registration mapping. Keep example roles fake and application-defined.

Run work/agents/session-policy suites, protected websocket/egress/tool-dispatch suites, the advanced sample, tagged work tool/resource flow and `pnpm validate`. P3 must still prove database concurrency; P2's policy tests are not that proof.

**Exit gate:** every work entrypoint and tagged execution path uses one coherent canonical authorization system; no subject-only owner bypass remains; callback/admission/disclosure semantics are tested and documented. Keep remote mutations closed until P3 passes its real-database epoch/capacity gates, then enable the V1 work handlers.


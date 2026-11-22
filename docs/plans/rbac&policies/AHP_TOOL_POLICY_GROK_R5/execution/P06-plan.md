# P06 plan — canonical bounded delegation and revocation

**REVISED PROPOSAL ONLY — R1/R2/R3 narrow independent recheck and execution authorization pending.** This file is the entire current write permission. No P06 source, tests, runtime gates, P01 signatures, P03/P05 APIs or limits have been changed. P05 is ACCEPTED. Luna's `P06-plan-review.md` REVISE and lead's `P06-lead-revisions.md` govern this revision; the separate-dimension limit table is ratified in principle, not implemented. P07 preflight is resolved/read-only, not implementation scope.

## 1. Boundary, evidence and acceptance gates

Baseline: HEAD `22fa7955b8e43839e041228f647f26e00762ebbe` plus accepted predecessors. P05's106-entry `P05-accepted.sha256` has SHA **`97f8c95f904c9357ee4c8b89fc5d53ee261fc603d2c4bc8e418d78aec7252121`**. Lead reports post-review106 hashes verified, Luna correction PASS and independent72 files/684 tests/163 mapped sources (`P05-handoff.md`, `P05-acceptance-integrity.json`, `P05-correction-lead-validate.log`). Those are predecessor evidence, NOT P06 test results. No runtime command/test/build/service was run for this plan.

Inputs: `packets/P06.md`, `CONTRACT_CARD.md`, AUTHORITY A2–A9, DELIVERY_WIRE D4, `P06-preflight.md`, `P06-lead-notes.md`, accepted P05 handoff/correction and targeted current source reads. Risk: elevated (authority, lifecycle, revisions, public composition). No children or model/account changes. Lead owns authorization/integration; Luna independently reviews. Sol may later execute only an explicitly approved write set.

Observed, rather than assumed:

| Current source | Consequence |
| --- | --- |
| P03 `evaluate/helpers.ts`: private `bindings: Map<string, ScopedPolicyBinding>`, resources, tuples, epoch/grantRevision; `bump`, exact `removeBinding`, `teardown`, `findBinding`, `liveMatches` | Extend this authority source. Currently no scoped reader/parent-incarnation/CAS/events. Do not invent a second grant cache. |
| `installBinding` is idempotent for identical data and rejects conflicting replacement; `installResource` advances relationship revision on change | Retain these semantics. Revision advancement of a binding is removal/reinstallation, not an unreviewed upsert. |
| P05 `SessionFactoryAuthorization`: create/getResource/disposeSession/isSettling | getResource/owner existence does NOT prove ready. Failed records retain resource/owner; non-ready must deny. |
| P05 creation: UUID bootstrap IDs, revision1, real creator/full ref; receipts private; failed startup calls exact removeBinding before failure action; dispose calls teardown | Reader must discover actual bootstrap records; canonical cascade must also cover these existing cleanup entrypoints. No bootstrap mirror or new receipt export. |
| `SessionRecord.state.lifecycle`, backend handle, current registry record; factory stopping/settling closures | Readiness must project these existing facts, not copy lifecycle into another map. |
| P05 corrected `installAdmissions`, maxAdmissionInstalls128/1024; actual outstanding prepare count | Capture bounded cohorts before callbacks; validate aggregate capacity before mutation; cancellation is not work settlement. Preserve both corrections. |
| P01 `BindingResolver.read({actor,scope,grantRevision})`; GrantIssuer async prepare/revoke, sync commit/rollback; delegated authority only parentGrantId | Preserve portable signatures; trusted binding context and canonical-only metadata supply missing fences. |
| `agents/helpers/directory.ts`, `work/types.ts` | Full actor/domain/agent identity, presence/generation and read-only owner projection remain separate. Work equality/leases are read-only. |

Flow: **bounded intent + trusted bound issuer -> canonical rule/basis capture -> bounded trusted target/control approval -> final synchronous guards -> exact factory readiness -> internal canonical CAS -> inert receipt + queued invalidation hint**. Failure releases only owned preparation resources; stale completion never installs authority.

Implementation is blocked until lead approves §§2–8, revised20-path future scope (§9, including the explicit existing-test forwarding request), and P03/P04/P05 amendments after Luna's narrow recheck. P05 acceptance satisfies dependency only; this proposal is not execution permission. If the accepted boundary changes, refresh only affected assumptions and review before execution.

## 2. Ownership and minimal API proposal

Keep P01 `src/authorization/types.ts`, schemas/constants and P02 unchanged. Add authorization-owned service/types under `helpers/grants/`; canonical facts/atomic mutation stay in P03's existing registry. No RPC/ToolOperation, transport/private-kernel edits, UI, DB or persistence/restoration.

### 2.1 Proposed public P03 additions (explicit amendment required)

```ts
// New authorization-owned shapes, NOT amendments to portable P01 shapes.
interface CanonicalBindingToken {
  readonly bindingId: string;
  readonly scope: ResourceRef;
  readonly revision: number;
  readonly incarnation: string; // SDK-issued opaque installation identity
}
interface ScopedBindingSnapshot {
  readonly actor: PolicyActorRef;
  readonly scope: ResourceRef;
  readonly epoch: number;
  readonly grantRevision: number;
  readonly bindings: readonly ScopedPolicyBinding[];
  readonly tokens: readonly CanonicalBindingToken[]; // aligned with bindings
}
// ReferenceAuthorizer additions:
readBindings(query: { readonly actor: PolicyActorRef; readonly scope: ResourceRef }): ScopedBindingSnapshot;
isBindingSnapshotCurrent(snapshot: ScopedBindingSnapshot): boolean;
createGrantService(options: GrantServiceOptions): GrantService;
subscribeInvalidation(listener: (notice: LocalInvalidation) => void): () => void;
drainInvalidations(): void;
```

Snapshots/tokens are immutable, per-registry SDK-issued objects with weak provenance; matching JSON/cross-registry snapshots are invalid. `readBindings` returns only exact actor + full-scope live bindings, including actual P05 bootstrap IDs/revisions, and captured global revision. Its private snapshot basis retains resource-installation identity, relationship and ancestor/binding installation tokens/expiries, including a negative/empty read's resource/revision fence. Missing canonical resource/invalid query is unavailable; a valid resource with no bindings returns an empty snapshot. No unscoped enumeration.

**R2 concrete predicate:** `isBindingSnapshotCurrent(snapshot)` rejects unknown/cloned/foreign receipts, first samples the captured application clock (which may reenter), then performs bounded expiry processing and checks current epoch/grantRevision, resource installation/relationships and all relied-on lineage/expiries. No application callback/clock occurs AFTER its final internal comparison. It returns exact boolean and cannot install/issue authority. Snapshot mutation cannot refresh its basis. Missing event delivery is irrelevant.

`createGrantService` installs ONE captured immutable rule catalogue/service per registry. Repeated construction with a different composition rejects before effects; no second pool can bypass host quotas. A disposed service is terminal on that registry; reconstructing/binding another context cannot reset draining occupancy. Rule catalogue is configuration, not a live-grant store. No rule hot replacement API in P06; disable/revoke through explicit revocation or terminal service disposal. A future replacement API needs its own revision/cascade amendment.

```ts
interface GrantService {
  readonly bindings: BindingResolver;
  issuer(bound: BoundGrantContext): GrantIssuer;
  sweep(): void; // bounded maintenance, not authority timing
  dispose(): void; // terminal: cancel pending, atomically invalidate its issued grants
}
```

`BoundGrantContext` captures: immutable actual `TrustedRequestContext`, exact connectionId/positive connectionGeneration, finite validUntil, AbortSignal and synchronous isCurrent; exact registered rule ref; issued issuer-basis token; full target scope; and, for revoke, an issued exact target token. Context connectionId must agree. Agent generation/registration comes from the trusted adapter, never absence-of-agent inference. Bound handles allocate no independent grant cache or work pool.

The `BindingResolver` adapter calls the SAME registry reader, requires `query.grantRevision === snapshot.grantRevision`, runs exact-root readiness BEFORE `isBindingSnapshotCurrent(snapshot)` as the last canonical check, then returns bindings or rejects unavailable/stale. No role/owner fallback or synthesized bootstrap IDs. P01 query stays unchanged. This read is NOT the prepared connection's fence: §2.4 supplies the concrete InitialAuthoritySource closure and narrow real P04 ordering amendment. No network route or wire shape reopens.

### 2.2 Private canonical CAS port (not a second public admin API)

The registry passes a private `CanonicalGrantPort` to its SDK service builder:

- `captureMutation(bound, normalizedIntent)` runs BEFORE target/approval awaits and returns a frozen SDK-issued basis: registry/service/catalogue identity, epoch/grant revision, exact issuer/basis and revoke-target tokens, complete parent tokens, resource installation + relationship revisions, admitted exact refs, rule ref, derived depth and expiry ceiling. Intent actor is a selector only; the later target resolution must match it exactly and cannot refresh an old basis into new authority.
- `commitAssignment(basis, normalizedCandidate, sampledTime)` and `commitRevocation(basis, sampledTime)` synchronously validate that basis, liveness, counts and all tokens against current private maps, then apply one canonical mutation/one bump. They return success/stale; no callbacks/await, schema getters or application clock inside the final comparison/apply section.
- `disposeIssued` and `sweepExpired` use the same staged closure deletion operation. Provenance/currentness cannot be supplied as `isCurrent: true` by a caller.

No externally callable raw CAS bypass is added. Existing trusted install/remove methods remain privileged administrative ports, not policy-aware issuance. Trusted replacement ports must honor the contract; TypeScript does not sandbox dishonest application JavaScript.

### 2.3 R1 + R3: actual factory and composed-host capabilities

Add required methods to the existing SDK factory capability:

```ts
usesRegistry(registry: ReferenceAuthorizer): boolean;
isReady(expected: ResourceRef<"session">): boolean;
```

Capture the ORIGINAL registry object before P05's bound-method wrapper is built; usesRegistry is a pure strict identity predicate, unchanged even after shutdown. Reject factory/registry mismatch before resolvers/effects. Preserve usesPolicyFactory, atomic admissions and draining creation occupancy.

`isReady` projects the actual current record: full ref matches, lifecycle ready, backend present, not settling/stopping AND its retained resource-installation token is CURRENT (§4.1). Equal ResourceRef text alone cannot make an old record ready after canonical reinstall. Read any custom session registry first, perform SDK flags/lifecycle checks, then the canonical installation predicate last; no clock/app callback afterward. No lifecycle cache or owner-role/serverSeq shortcut. Scopes remain one session or a registered descendant in its tree; unsupported/unrooted/cross-session relationships deny.

`getResource(uri)` is also installation-owned: return the record's stable immutable resource OBJECT only while its retained resource token is current; otherwise undefined. A failed record with its own still-current installation remains inspectable/owned (not ready). An old record behind a canonical same-full-ref reinstall returns undefined. No lookup of an arbitrary matching nominal installation may reacquire ownership.

**Supported host forwarding:** add `src/websocket/helpers/host/helpers.ts`. Capture actualAuthorization and bind original usesRegistry/isReady/getResource immediately after factory construction, BEFORE ownerLookup/work-service construction; initialize the host terminal flag early enough for those closures, not through a temporal-dead-zone reference. hostedAuthorization forwards BOTH required methods, not optional members. Hosted usesRegistry delegates pure identity; hosted isReady returns `!stopped && capturedIsReady(expected) === true && !stopped`, with the terminal flag rechecked after delegated reads. Its unavailable/stopped result is false; other existing host terminal behavior remains. A bare factory may be reused after dispose; the composed host remains terminal even if that SAME bare factory later becomes ready again.

**Owner projection fence:** retain canonical owner, not another owner map. Return unavailable if host stopped. Capture `ref = capturedGetResource(uri)`, obtain `owner = canonicalOwner(ref)`, then require `capturedGetResource(uri) === ref` before projecting configured-domain subject. The second getter includes installation ownership and current record identity; a reentrant owner lookup/reinstall or same-URI replacement cannot return another installation's owner through an old record. This is an SDK stable-reference contract, not nominal sameResource equality. No work service/lease/persistence change.

All ordinary external guards/clock calls precede final SDK readiness; internal CAS immediately follows with no callback/await. If actual ports need a larger fence, STOP for approval. Revocation/cleanup can remove authority on non-ready targets; readiness is not a prerequisite to cleanup.

### 2.4 R2: concrete trusted InitialAuthoritySource + final P04 order

No websocket/agent runtime type enters neutral authorization. The integration is a typed application-composition fixture in NEW freshness.test.ts and an example in authorization/README; InitialAuthoritySource/PreparedInitialScopes signatures stay unchanged. Bind the SAME registry's reader/predicate and service BindingResolver once. The trusted scope selector receives ACTUAL context/fence/signal and returns only explicitly permitted full refs, finite deadline, captured identity/application guard/release and independent cursor permission. Bound scope/binding counts before copying. No client role/URI claim selects authority.

Concrete closure (local typed fixture/example helpers, NOT new production paths):

```ts
const initialAuthority: InitialAuthoritySource = {
  async prepare({ context, fence, signal }) {
    const selection = await selectPermittedScopes({ context, fence, signal });
    const selected = captureBoundedSelection(selection); // data + bound guard/release
    const snapshots = selected.scopes.map(scope =>
      canonicalRead({ actor: context.actor, scope }));
    assertOneCanonicalRevision(snapshots);
    let released = false;
    return {
      scopes: snapshots.map(s => ({ scope: s.scope, grantRevision: s.grantRevision })),
      validUntil: selected.validUntil,
      allowGlobalSequence: selected.allowGlobalSequence === true,
      isCurrent: () => {
        if (released || signal.aborted || selected.appCurrent() !== true) return false;
        if (!selected.roots.every(root => hostedIsReady(root) === true)) return false;
        // ALL application/identity/readiness callbacks precede this group.
        return snapshots.every(s => canonicalCurrent(s));
      },
      release: () => { if (!released) { released = true; selected.release(); } },
    };
  },
};
```

captureBoundedSelection validates/copies refs, finite deadline and exact boolean permission, captures methods once and derives exact session roots; assertOneCanonicalRevision rejects differing epoch/grantRevision across snapshots. They are fully typed local fixture/example functions, not authority caches. Empty scopes require an explicit cursor-only selector branch/permission; they are NOT fallback after a scoped read fails/stales. P04 retains full actor/fence/resource checks. For real-host construction, an initially unavailable closure may be set to the real hosted capability before start; no non-null assertion or allow-all placeholder.

composition.bindings is the SAME service BindingResolver: its read receives the snapshot-seeded grantRevision and real bootstrap IDs. The source closure retains issued snapshots after that await. Mutation/revoke thereafter invalidates PreparedInitialScopes, PreparedConnectionSetup and supported native admission WITHOUT FreshnessPort/event delivery. Domain freshness remains its separate external contract.

**Narrow P04 amendment:** add `src/websocket/helpers/security/helpers.ts`. Replace final `current() && now() < validUntil` with one deadline-aware check: (1) read internal release/abort; (2) sample now, reject non-finite/expired against seed/final deadline, recheck internal release/abort after that potentially reentrant clock; (3) call captured prepared-source isCurrent LAST, exact true only; (4) only internal flags may be read afterward. Intermediate checks use seedDeadline; returned isCurrent uses computed validUntil. No app clock AFTER the source/canonical predicate. Preserve all other P04 bounds, identity/resource/fence/freshness/release and exact allowGlobalSequence behavior. No connection/ahp/transport implementation change.

The canonical predicate itself samples its clock BEFORE internal comparisons. All snapshots share one registry/revision: a later predicate's reentrant clock/expiry mutation makes that snapshot stale too, rather than silently invalidating an earlier check. No event or async FreshnessPort call enters this final closure.

## 3. Explicit assign/revoke authority (not tool use)

`RegisteredGrantControlRule` is captured, validated immutable configuration with exact opaque id/positive revision. Separate optional `assign` and `revoke` branches; absent branch denies. Required narrowing approval callback `prepare` receives SDK-frozen exact request/basis and AbortSignal. No callback can widen the static rule, parent rights, admission or mandatory tool restrictions.

A rule specifies:

- issuer kinds and a **single complete canonical issuer basis**. Root mode requires that one binding's host-policy authority matches an exact registered authorityPolicy, required exact policy refs are on that same binding, and either a nonempty explicit role gate passes or an explicit direct-basis branch is enabled. No empty role branch, fragment union, invoke/owner/creator/default-admin inference;
- delegated mode requires the issuer's own canonical binding to carry SDK-issued permission to redelegate under this exact control-rule catalogue/ref. A portable `authority.kind: delegation` string alone is insufficient;
- assign target kinds; exact role/policy subsets; same scope or explicitly registered descendant scope; finite max lifetime; depth ceiling; explicitly permitted child control-rule refs (empty means no redelegation);
- revoke issuer basis independently, plus allowed target relation: direct issue/descendant of this exact basis, or explicitly any grant in the exact authorized scope. Ownership alone is never enough.

Target resolution is a trusted injected `resolveTarget(intentActor, signal)` port returning the verified full actor, finite validity/currentness and owned release. It must match bounded intent exactly; it cannot substitute an owner, service account or a human for an agent. Missing/stale registration/classification rejects. The approval returns exact SDK request identity, exact `effect: allow`, finite bounded validity, synchronous currentness and idempotent owned release; unknown effects/throws/Promise-valued boolean/malformed or stale output deny. External freshness is bounded by these adapter validity/currentness/invalidation promises, not claimed instantaneous remote revocation.

Grant issuance always derives from an existing binding basis. Host-policy roots remain explicit trusted install/P05 bootstrap work, NOT a new service operation. Service children get `authority: {kind: delegation, issuer: actualIssuer, parentGrantId: basis.id}`. Root depth0, child depth parent+1. Root issuance derives its delegable roles/policies from the explicit registered ROOT control rule, not from an assumption that the issuer's own tool-use roles confer issuance. Such a rule may deliberately allow assigning a role the root issuer does not hold. For a DELEGATED issuer, requested roles/policies must additionally be subsets of its parent issued binding and every effective ancestor control ceiling; no implicit role transformation. Child control capabilities cannot exceed the parent's effective rule-chain bounds. Actor-kind/scope/duration/depth restrictions intersect along the whole chain. Every child policy must be admitted on the target canonical resource; no namespace expansion as grant and no admission mutation.

P01 `GrantIssueRequest.issuer/authority/delegationDepth` remain required compatibility fields but are ONLY assertions checked against those derived facts; mismatches reject, never select a broader basis. The trusted adapter can construct these from its issued basis token/rule. Actor/roles/policies/expiry express bounded intent. Absent expiry derives a finite value from preparation start + maxGrantLifetime, rule and ALL ancestor expiries; supplied expiry must be no later. Preparation receipt deadline is separately bounded by caller validity/hook deadline, not a new grant lifetime source. No extension of lifetime after a slow callback.

P01 `PreparedGrant` is SDK-issued/frozen/single-use: fresh UUID, target instance, revision1, normalized derived request. Private issued-object provenance ties it to bound issuer, service, basis and slot; copying/reconstructing/editing it fails. `commit` returns the canonical immutable binding, not a reusable permission token. `rollback` closes only its exact pending receipt; idempotent, never undoes committed authority or deletes a later grant. `revoke` validates request issuer/id/instance against bound context and exact full token (including revision/incarnation), prepares separately, then CAS-deletes. An authorized already-absent target is an idempotent no-op; a reused same-ID token is stale, never deleted. No P01 signature change is required.

Assignment does not auto-install a tool tuple, executor, owner or new admission. Later tool use still requires the exact P03 tuple, selected complete policy path and every mandatory host/provider/resource rule. A deny/challenge at tool evaluation is not overridden by grant-control approval.

## 4. One canonical map, lineage and relationships

Replace the binding map VALUE with an internal envelope, not another map of grants:

- immutable portable binding;
- fresh opaque installation incarnation on every new install (identical reinstall keeps it);
- optional SDK-issued grant-control facts: service/catalogue/rule identity, exact parent token, derived depth, permitted redelegation refs and captured resource/relationship basis.

Every child stores full expected parent scope + ID + revision + incarnation. Portable parentGrantId remains a serialization-free description, not a sufficient internal link. A trusted administrative delegated install must resolve/capture a real current parent and validate bounded acyclic lineage; it cannot install a dangling delegated record as an implicit root. It gains no SDK redelegation permission without registered control facts. Audit existing fixtures before touching any assertion; if an accepted fixture genuinely depends on dangling delegation, request exact test/contract scope instead of bypassing lineage.

`installBinding` identical no-op/conflicting replacement rejection is preserved. Remove/reissue, even the SAME ID/revision/full scope, mints a new incarnation. An advanced revision also cannot match the old parent token. No ever-growing tombstone/serial-by-ID map is needed. Expired/missing/mismatched ancestors cannot revive a descendant after reissue or URI reuse.

For real descendant grants, propose one narrow P03 resource amendment: optional **`grantParent?: ResourceRef`** in `installResource`/RegisteredResource, stored in that SAME canonical resource record. This is a declared control relationship, not inferred from route membership, URI prefix, label or owner. Parent must exist, same domain/session-rooted tree, no cycles, depth within the separately captured maxGrantResourceDepth; cross-session-parenting is unsupported. Resource-tree depth is not the P01 delegation-depth limit. Default absent means exact-scope only. Capture parent chain + relationship revisions. Existing route/admission/mandatory semantics remain independent. Each new resource-map installation also has a private incarnation token; identical registration preserves it, changes advance existing relationship revision. Remove/reinstall of even identical full-ref text cannot ABA-match an old captured relationship basis.

All access paths (`readBindings`, grant capture, selected/mandatory binding lookup, final matches/validateAssignments) use the same bounded canonical lineage predicate. Include all relied-on ancestor expiries in existing stamp expiry tracking and clamp validUntil to the earliest expiry. No need to alter P01 AuthorityRevisionStamp or invent parent revision fields in portable GrantAuthority. Existing epoch/grantRevision plus canonical incarnation checks make stale positive AND negative receipts unusable.

### 4.1 R3: preknown single-use installation ownership — exact APIs

A return-only install receipt is INSUFFICIENT: an existing adapter applies install then throws before returning. Add SDK-issued immutable ResourceInstallationToken/BindingInstallationToken with weak per-registry provenance/state. Neither is a caller-supplied UUID nor a query for the current nominal row. ResourceRegistration means the existing installResource input plus reviewed grantParent, not a P01 edit.

```ts
prepareResourceInstallation(input: ResourceRegistration): ResourceInstallationToken;
prepareBindingInstallation(binding: ScopedPolicyBinding,
  resource: ResourceInstallationToken): BindingInstallationToken;
installResource(input: ResourceRegistration, installation?: ResourceInstallationToken): void;
installBinding(binding: ScopedPolicyBinding, installation?: BindingInstallationToken): void;
isResourceInstallationCurrent(installation: ResourceInstallationToken): boolean;
isBindingInstallationCurrent(installation: BindingInstallationToken): boolean;
removeInstalledBinding(installation: BindingInstallationToken): boolean;
teardownInstalledResource(installation: ResourceInstallationToken): boolean;
```

Prepare captures complete normalized input/resource association and mints identity BEFORE any instrumented install. It changes no canonical map/revision. Binding token may be prepared against the matching preknown resource token before resource attachment; it cannot attach to another installation.

State: **prepared -> consumed-installed OR consumed-failed -> retired**. Tokened install first validates SDK provenance/kind/prepared state and claims that single use before remaining payload/capacity/ownership validation. A failed claimed attempt is consumed-failed, not retryable; a successful one is consumed-installed. Exact payload, matching current resource ownership (binding), no incumbent and capacity are all checked BEFORE applying; publication stores its installation identity in the SAME canonical envelope. Reuse rejects even if payload is identical. Owned install cannot adopt an existing identical row. Legacy no-token identical installs remain no-op and do not strip ownership. Always call captured installResource/installBinding ports; no hidden direct-map bypass around instrumented mutation.

Installation-current predicates test ownership/association, not grant-use authority (an expired binding can still be cleanup-owned). Owned cleanup retires unused/failed tokens without touching incumbents and deletes only matching installed incarnation plus full closure. Binding cleanup compares its own envelope identity even if its resource is already absent/replaced or its grant expired; it must not demand usable authority and leak the old owned row. Repeated cleanup is no-op. Same-ID/scope/revision binding or same-full-ref resource successor never matches. Legacy privileged removeBinding({bindingId,scope,revision})/teardown(resource) remain explicitly NOMINAL admin APIs; never use them for delayed SDK compensation. Weak provenance + bounded live maps, no ever-growing tombstones/ID history.

**Exact P05 attach/catch:** capture new methods before callbacks, with original registry identity. Construct complete registration plus PREKNOWN resource/binding tokens before sessions.add or install calls. Hold all tokens locally even if calls throw. Invoke instrumented installResource(input,resourceToken) and each installBinding(binding,bindingToken). Before publication verify all installation tokens still current and actual record/factory epoch. Never recover ownership by querying matching owner/readBindings/nominal records after a fault. Catch deletes the record only if still THAT record, attempts conditional cleanup/retirement for ALL preknown binding tokens and resource token, and preserves primary failure while attempting remaining owned cleanup. Install-then-throw is compensated with the token already held; an intervening successor is not owned. No publication/backend starts after failed attachment.

**Record receipt persists:** weak value becomes `{resource: ResourceInstallationToken, bootstrap: readonly BindingInstallationToken[]}` for EVERY attached protected record, including no-bootstrap. withdraw(record) calls removeInstalledBinding on exact bootstrap tokens and clears ONLY bootstrap after successful withdrawal; NEVER delete resource receipt. On withdrawal throw retain resource and outstanding bootstrap handles and preserve existing creating/quarantine behavior. Later failed-record dispose/global teardown uses teardownInstalledResource(resourceToken), not bare record.resource, plus exact record-object checks. Resource receipt lasts through backend waits/withdrawal until record teardown. No competing owner/lifecycle store; §2.3 getResource/readiness/owner projection use this same ownership.

**ONE extra existing TEST path requested:** src/tests/sessions/policyCreation.test.ts, exactly four narrow adapter edits (accepted line numbers approximate; test names authoritative):

1. S03 second bootstrap install failure (~174): `(binding, installation)` forwards BOTH to registry.installBinding. Keep second-call throw/count and every rollback/reuse assertion.
2. S03 record/resource attach-fault loop (~560): `(resource, installation)` forwards BOTH to registry.installResource BEFORE its existing post-effect throw. Keep record-add fault and every owner/list/events/backend/reuse assertion.
3. S05 unexpected bootstrap withdrawal failure (~507): retarget fault to `removeInstalledBinding: () => { throw new Error("withdraw fault"); }`, rather than obsolete nominal removeBinding. Same throw/no-failure-publication/retained-owner/creating assertions; never bypass this instrumented cleanup.
4. S03 incumbent full-ref collision (~581): retarget existing teardown spy property to `teardownInstalledResource: teardown`; retain exact no-call assertion, collision preload and zero approval/backend controls. Otherwise the spy would no longer watch the SDK cleanup path.

installedFor's `[binding]` extraction remains unchanged; spy may observe extra token argument. No old assertion/test deletion, skip, weakened fault, or wholesale fixture migration. New binding-after-effect and ABA controls stay in the two NEW suites. This explicit TEST-only request is NOT yet authorization.

### Removal, expiry and cleanup

A common canonical deletion primitive computes the full dependent closure BEFORE deleting anything: at most N current bindings and D grant ancestors per binding, N=`maxBindings`<=1024, D<=32. Resource-basis checks additionally traverse at most R=maxGrantResourceDepth<=32; worst-case combined validation is bounded by N*D*R plus existing tuple caps, not advertised as a constant-cost operation. Use the canonical envelope, not a persistent reverse-authority cache. Stage all affected IDs, then delete their bindings and matching caller/executor tuples, retain owner/resource/admission unless this is resource teardown, and bump once. No subscriber/await during partial removal. Failure/stale expected root leaves all maps/currentness untouched.

Route BOTH legacy nominal removeBinding/teardown and owned removeInstalledBinding/teardownInstalledResource through this primitive; delayed P05 cleanup uses ONLY owned ports (§4.1). Bootstrap withdrawal removes dependent authority before creationFailed while retaining resource receipt/owner/failed record. Exact-installation teardown removes relationship-dependent grants in other scopes; unrelated installations/successors survive even same-full-ref reuse. Per-bootstrap calls may advance several revisions; each removes a complete closure atomically, not the entire receipt loop as one batch.

Expiry is authority loss on ACCESS, never timer-dependent. After a sampled clock and before reading/admitting, a bounded canonical access pass identifies expired roots and removes their closures atomically (one bump); final CAS compares after this pass and rejects an older basis. This also invalidates negative stamps at expiry, not just positive child decisions. `matches` must return false once its sampled time crosses a relied-on ancestor expiry even if maintenance has not run. Access pruning must never emit observer callbacks inside the admission critical section.

Maintenance `sweep` scans at most N candidates, selects at most maxCleanupRoots, and computes ONE union closure pass (not an N*roots repeated cascade); unswept expired grants remain unusable. Cascade/deletion is always complete and bounded by N/D and existing tuple caps, not truncated to the maintenance root batch. No per-grant timer, indefinite tombstone, unbounded fanout traversal, SQL or restart restoration. Restart loses transient grants/receipts.

## 5. Async lifetime, draining and final sync commit

One registry-owned shared slot pool covers assign AND revoke, across all bound issuers/connections. Reserve before scheduling ANY target/approval work. Each slot records actual actor and owns at most one sequential target-resolution and one approval invocation, one prepared receipt and one idempotent cleanup chain. No unbounded background queue. Derive per-actor occupancy by scanning this bounded pool; changing generation/domain context cannot reset host occupancy.

Caller abort, timeout, rollback, issuer/instance change or service disposal promptly closes the visible attempt and rejects its caller, but the slot is not reclaimed until **all actual adapter work and any returned async release finish AND the receipt is closed**. Never reset/evict this occupancy on disposal, reuse or a new bound handle. A permanently uncooperative adapter can saturate the pool; it cannot manufacture free slots. Late allow is released once and cannot produce a live receipt; late rejection is observed. Cleanup failure retires the attempt without authority; an unresolved cleanup retains occupancy. Synchronous throw is settled work. Prepared-but-uncommitted receipts retain bounded capacity until commit/rollback/deadline. At most one cancellation/deadline timer per occupied slot; no periodic polling or detached cleanup queue.

Final `commit`/revoke completion sequence:

1. Validate issued receipt identity/state; no consumption by a different issuer/service. All request/config/callback references were captured before awaits.
2. Invoke ordinary trusted issuer/target/approval/external-currentness guards, exact true only; observe rejected/Promise results and fail closed. Read application clock LAST among those ordinary callbacks.
3. Call captured SDK `isReady` on the one exact session root LAST for assignment. For cleanup/revocation, verify canonical exact identity without requiring ready. No external callback follows this point before mutation.
4. Internal CAS: process bounded expiry, verify issued basis and current epoch/grant/rule/catalogue, full parent/resource incarnations and relationship revisions, actual actor/generation/auth facts, abort/deadline, target subset/lifetime/depth and aggregate binding/actor/fanout counts. SDK-owned data only; no callback/await. Stage/prevalidate complete candidate before mutation. Mark receipt single-use/install or remove closure/bump as one local action. On stale basis deny, do not automatically retry against wider authority.
5. Only AFTER canonical publication, owned cleanup and queued observer delivery may run. Reentrant cleanup/observer may revoke the new grant; returned binding is inert and all later use rechecks canonical state. A cleanup/observer failure does not roll back published authority or revive revoked authority.

This is local admission, not distributed atomicity. A disconnect after commit cannot recall effects already admitted; pending/invocation/output consumers must still recheck before their own boundaries in later packets.

## 6. Finite limits — ratified in principle, implementation still gated

Do not change P01/P03/P05 accepted limits. Reuse existing P01 per-item roles32/256, refs64/512, identifiers128/256 and delegation depth8/32. Exact canonical selectors honor the captured compiler's validated budget. Reuse **existing maxBindings128/absolute1024** for ALL stored bindings including roots; do NOT introduce a duplicate active-grant cap. Existing resource/tuple caps bound scans. New service-specific dimensions below are distinct purposes, captured/validated before effects:

| Proposed limit | Default / absolute | Meaning |
| --- | --- | --- |
| maxRegisteredRules | 32 /128 | Entire immutable raw config cohort before copy; duplicate rule refs reject; no sequential partial installation. |
| maxMutationInputBytes | 64KiB /1MiB | Complete assign/revoke plain-data capture; reject cycles/accessors/reserved keys/coercion, fixed depth8 and finite key budget derived from item caps before adapters. |
| maxPendingMutations | 64 /1024 | Host occupied slots including prepared, cancelled/draining and cleanup; assign+revoke combined. |
| maxPendingPerActor | 8 /64 | Same full actual actor across contexts, counts draining slots too. |
| maxBindingsPerActor | 32 /256 | Issuance checks count ALL canonical bindings for full actor, no second actor-grant cache. Privileged trusted install still has existing global cap. |
| maxChildrenPerParent | 32 /256 | Count canonical children of exact parent incarnation before effects/again at CAS. No persistent fanout authority index. |
| maxGrantLifetimeMs | 3,600,000 /86,400,000 | Separate grant-control lifetime; NOT alias of bootstrap/challenge TTL. Rule/ancestor may narrow. |
| prepareDeadlineMs | 5,000 /60,000 | One whole attempt, clipped by caller/adapter validity; cannot reset per await. |
| maxCleanupRoots | 32 /128 | Expired roots selected per maintenance pass; complete union cascade still bounded by canonical N/D/R. |
| maxGrantResourceDepth | 8 /32 | Proposed captured ReferenceAuthorizerOptions field for explicit resource-parent traversal, independently of grant delegation depth. |
| maxInvalidationListeners | 16 /64 | Proposed captured ReferenceAuthorizerOptions field, global active+running/draining observer occupancy. |

All integers positive finite within absolutes; constructor mutation after capture cannot change them. Child/depth/actor/global limits are independent, not min-clamped aliases. Reserve before adapters; recheck capacity atomically after asynchronous work. No optimistic reservation is an authoritative grant; rolled-back attempts consume no binding slot. Rules/requests individually have finite arrays/strings; the complete bounded catalogue is captured/validated before publishing it, using the P05 cohort lesson. Existing admission API/input cap stays exactly as accepted.

## 7. One invalidation seam; hints never authorize

Route every canonical `bump` (install/remove binding, resource/relationship/policy-binding/tuple change, external invalidation, expiry/cascade/teardown) into one SDK-owned **coalesced one-notice outbox** containing latest epoch/grantRevision and bounded cause, no grants/roles/owners/IDs. Service configuration/disposal affecting its control authority also advances that same canonical revision. Unchanged/idempotent operations do not manufacture invalidations.

Never call observers from inside a partial attach/CAS/cascade or `bump`. Schedule at most one SDK microtask for a completed synchronous turn, or explicitly `drainInvalidations`; dispatch at most one bounded listener cohort per drain. During notification, nested mutations replace the single pending notice; no recursive delivery or automatic requeue spin. A nested pending hint waits for the next outer mutation/explicit drain. Hints are explicitly BEST-EFFORT, not guaranteed delivery for every revision. SDK owner: the grant service calls drainInvalidations after its completed canonical mutation/cleanup path and at the end of sweep; P05 legacy/owned mutations also queue the bounded native microtask, never notify inside attach. An observer-triggered residual can wait indefinitely if no next operation occurs. Reads/authority rely on canonical revision predicates, NOT delivery, event history or subscriber cooperation.

Throwing observers are isolated/quarantined; other observers continue. Async/thenable returns violate the synchronous listener contract: retire/observe them, but retain their listener occupancy until actual settlement (unsubscribe cannot free still-running work). No unbounded observer/cleanup queue or unlimited fresh subscriptions over draining listeners. Unsubscribe is idempotent; event payload/callback references are captured and immutable. Consumers invalidate both positive/negative caches, assignment views and future continuation stamps by captured revision; no continuation/transport implementation or assignmentsChanged wire method is added here. Tests prove the canonical invalidation fence, not P10 delivery/reducer certification.

## 8. G01–G06 verification contract (proposed tests, NOT passes)

Put every NEW scenario in `delegation.test.ts`/`freshness.test.ts`; existing684 assertions remain. The ONLY existing-test changes requested are the four token-forwarding/fault-retargeting adapters in §4.1; no assertion/body weakening. Reuse real P02 compiler + P03 registry + P05 protected factory with explicit registered creation approval/bootstrap. Read server-minted bootstrap ID via canonical reader; never hardcode/synthesize it. Start a real controlled backend to obtain ready; parked/failing backend produces actual lifecycle negatives. Use controlled promises/injected clock, bounded fixtures and genuine selected tool tuple/policy evaluation. Approval mocks only implement named external port facts; they are not an allow-all replacement engine.

| ID / proposed test names | Distinguishing evidence |
| --- | --- |
| G01 `registered control issues exact tool grant; use/owner/role alone cannot assign or revoke` | First prove genuine invoke for non-issuer/owner. Denied grant attempts have zero adapter/backend/mutation effects. Positive explicit root control basis creates bounded child; separately registered revoke succeeds, missing revoke branch denies. Direct policy role=[] works ONLY with explicit direct branch. |
| G02 `one complete basis; parent bounds and cycles` | Positive real root->agent->child chain, admitted policy and mandatory pass. Reject mixed basis fragments, target kind/domain/classification mismatch, unadmitted refs, role overreach, expiry after any ancestor, depth/fanout/actor/global cap, false descendant or cycle. Correct grant plus mandatory deny/challenge still denies/challenges tool use. Failures preserve stamp/revision/capacity. |
| G03 `root removal, advance/reuse, expiry and teardown never revive descendants` | Begin with actual child allow and exact caller/executor tuples. Exact remove revokes entire closure/tuples and old stamp immediately; wrong scope/revision/token is no-op. Reinstall same ID/scope/revision and then higher revision: old children stay absent/unusable. Advance time past root expiry WITHOUT sweep: access/final matches deny; bounded sweep then frees storage. Include resource same-full-ref reinstall/relationship ABA. |
| G04 `revoke during awaited target/control/policy evaluation fails final admission` | Stable positive first; park adapter/evaluator, remove ancestor/change relationship/auth/generation, release and prove no commit/dispatch test spy. isCurrent/clock callback reentrantly removes basis: final CAS catches it. Exceptions, timeout, malformed allow/currentness and cloned/double-use receipt deny; rollback-after-commit cannot revoke successor. |
| G05 `same harness/role/URI is not actor or resource identity` | Independent positives for two actual users/agents sharing harness. Deny token/stamp/receipt sharing across domain, subject, agentId, connection/generation/auth, registry, scope and same-URI new instance. Mixed compiler/store/factory composition rejects before effects. BindingResolver reads actual bootstrap at exact revision and rejects stale revision. |
| G06 `tool delegate remains non-owner for work` | New fixture grants a genuine tool operation to junior in senior-owned session, then invokes unchanged WorkService with junior's ACTUAL principal and read-only canonical owner lookup; work still denies. Run existing work owner/lease/presence tests unmodified; no owner-subject substitution or repository change. |

Additional cross-cutting named groups (R1–R3 are mandatory narrow-recheck evidence):

- **R1 `composed host forwards strict identity and exact ownership-ready state`**: real createAHPServer ready positive; creating/failed/settling/stopped/stale-instance negatives; wrong registry false. Retain the actual bare factory through a test-only observing constructor wrapper that still invokes the genuine factory. After host.stop, legitimately reuse that SAME bare factory to become ready: bare isReady true, hosted isReady false. No fake always-ready capability/public-kernel fallback.
- **R2 `real P04 setup retains canonical bootstrap snapshot after read`**: actual P05 bootstrap + typed source closure (§2.4) + real createConnectionSetupAdapter/BindingResolver. Prove scoped read and stable prepared/native initialize positive first. Change/revoke canonical revision during awaited setup or after successful read with domain freshness unchanged/events absent; prepared source/setup/currentness and supported native admission deny. Clock callback revokes on the pre-guard deadline sample and must deny. Separately instrument the GENUINE canonical predicate and record callback order: fail on any application clock AFTER its successful comparison (the old current()&&now() order); arm that rogue post-check clock to revoke and assert it can never produce current=true with the canonical receipt stale. The corrected stable control has clock-before-canonical order and remains genuinely current. Include cloned/cross-registry snapshot rejection, same-full-ref reinstall, no-sweep ancestor expiry, and distinct explicit empty-scope cursor-only positive. Do not claim shared views/SDK certification.
- **R3 `preknown installation tokens survive after-effect throws and ABA`**: genuine installResource AND installBinding adapters invoke original with token then throw. Verify exact candidate rollback/no publication/backend, existing assertions and successful URI reuse. Additional adapter removes owned install, puts a successor with SAME nominal binding tuple/full resource text, then throws: compensation retains successor and no stamp/capacity change from stale owned cleanup. Consumed tokens cannot reinstall, unused cleanup cannot claim incumbents, nominal admin removal remains distinguishable. Resource receipt survives bootstrap withdrawal; failed-record later disposal removes its own resource but not canonical same-full-ref successor. Stale record is not ready/getResource/owner projection; reentrant owner projection invalidates safely. Retain all four old instrumented tests via exact forwarding request (§4.1), not a new direct-map shortcut.

- `actual lifecycle, not owner presence`: creating, failed (owner retained), settling, stopping, stale/unrooted scope deny assignment; ready positive. During actual P05 creationAdded publication/bootstrap presence, capture a pending attempt, then fail backend; existing removeBinding withdrawal invalidates pending basis and dependent entries before creationFailed. Since creating can never commit participant grants, no manufactured ready state is used to create an impossible startup child. Separate canonical parent-remove control proves descendant cascade shared by that failure path.
- `max1 uncooperative slot survives timeout/abort/dispose`: never/late-allow/late-reject target and approval; prompt caller rejection, no second invocation/capacity leak, safe late release, recovery only on actual settlement. Async release never settles: cleanup keeps capacity. Per-actor cap includes draining; new bound context cannot reset it.
- `cohort and capture are atomic`: catalogue invalid-later/conflict/over-cap inputs leave no published service/grants/stamp change; callback/options/request mutation cannot widen captured intent. Per-call bytes/list bounds and all limit defaults/absolutes tested independently, no unchecked partial install.
- `hints are lossy, canonical state is not`: throwing/reentrant observer, promise-returning never-settling observer, listener cap/unsubscribe/drain; bounded one-cohort delivery, no spin, exact canonical stale-positive AND stale-negative denial even with no observer or failed hint.
- `cleanup under saturation`: deep/max-fanout closure complete in one canonical mutation, owner/admission survive revoke, unrelated successor intact, maintenance work bounds measured, no timer-dependent authority.

## 9. Exact proposed future write set / amendment impact

**NOT authorized by writing this plan.** Request these20 future source/test/README paths: original17 + required host/security helpers + ONE precisely bounded existing test path. Limits are ratified in principle; exact APIs/shared amendments/extra test scope still need authorization.

1–2. `src/authorization/helpers/evaluate/{helpers,types}.ts`: same-map envelopes, reader + isBindingSnapshotCurrent/private CAS, exact optional-token install/current/conditional-cleanup APIs, expiry/removal/bump integration and named resource-depth/listener options. No existing cap/default rewrite.

3–5. `src/authorization/helpers/bindings/{types,helpers,index}.ts`: lineage/basis/binding installation token types, bounded ownership/liveness/closure helpers and exports.

6. `src/authorization/helpers/resources/types.ts`: ResourceRegistration/ResourceInstallationToken, explicit grantParent and resource basis types.

7–10. NEW `src/authorization/helpers/grants/{types,constants,helpers,index}.ts`: registered control contracts/runtime schemas, ratified bounds, service/slot/reader adapter; no opaque helper files elsewhere.

11–12. `src/authorization/{index.ts,README.md}`: deliberate new public exports, trust/lifetime/canonical/event caveats and source maps.

13–15. `src/sessions/helpers/creation/{types,helpers}.ts`, `src/sessions/README.md`: capture original registry, required usesRegistry/isReady, installation-owned getResource; preknown tokens passed through captured instrumented installs, local rollback and persistent record receipt/owned withdrawal/teardown. Preserve P05 approval/admission/draining/lifecycle publication semantics; this R3 ownership plumbing is an explicit P05 amendment, not a claim of zero attach/cleanup changes.

16–17. NEW `src/tests/authorization/{delegation,freshness}.test.ts`: G01–G06 + R1/R2/R3 typed composition/real-host/rollback/ABA controls; no additional shared fixture path.

18. `src/websocket/helpers/host/helpers.ts`: captured forwarding BOTH methods, terminal host readiness, ownership-fenced canonical owner projection only; no work/lease changes.

19. `src/websocket/helpers/security/helpers.ts`: narrowly sample/check seed/final deadlines BEFORE final prepared-source predicate; no subsequent application clock. Other P04 guards untouched.

20. `src/tests/sessions/policyCreation.test.ts`: ONLY four forwarding/fault-retargeting edits enumerated in §4.1. This extra TEST path is separately requested, not yet granted. Every assertion/count/throw and instrumented mutation remains; new scenarios belong in16–17.

`context/helpers.ts` remains read-only: reuse actual full-identity equality; no need to invent the currently absent context/types.ts just because the packet listed it. P01 public `types.ts`, validation and constants remain untouched. P03 evaluator constants/index need no new export/change: new service/event default values live in grants/constants; new options referenced by existing exported types. No work source/types/README, SQL/persistence, root package/config/env, agents, other websocket/connection/transport/ahp/kernel/security-type source, P05 catalogue/application/factory/backend source or eight legacy/public suite edits. If actual compile/integration proves another path necessary, stop and request an exact amendment, not silent scope growth.

Dependent impact: P03 adds explicit SDK ownership ports and optional install token args while preserving legacy nominal admin signatures; lineage/expiry and issued snapshot currentness share canonical state. P04 actual InitialAuthoritySource composition and final clock ordering gain the executable canonical fence without a wire/type change. P05 cleanup now carries preknown ownership through attach/rollback/backend failure/disposal and host projection, plus required forwarded methods. Structural wrappers need EXACT token forwarding, not bypass. P07–P10 hints/fences remain future consumers; P12 owns SDK/privacy certification. No P01 amendment proposed; any additional wrapper/test/path conflict stops for exact approval.

## 10. Later execution slices, checks and stop

1. **Gate:** Luna narrow R1/R2/R3 recheck + lead approves revised APIs20-path scope/shared amendments and the separate four-edit existing-test request; limits ratified in principle, active sole-writer ownership still required. Verify accepted106 hashes still current; preserve all dirty/untracked predecessor artifacts and nul.
2. **RED:** create the two new test files with genuine bootstrap/ready control; capture G01/G02 wrong-implementation RED, actual scoped-reader/lineage/async/draining failures. Missing API alone is not sufficient semantic evidence.
3. **Canonical slice:** envelope/token reader/private CAS, explicit relationships, common cascade/expiry. Prove positive current grants plus exact stale/ABA negatives and unchanged administrative no-ops.
4. **Service slice:** immutable rule cohort/context/target/approval/receipts and bounded draining lifecycle; sync commit/rollback and revoke. No parallel writer against moving APIs.
5. **Integration slice:** owned P05 cleanup/after-effect rollback, BOTH host capability forwarders/terminal flag/projection, concrete P01 InitialAuthoritySource snapshot closure and narrowly reordered P04 guard; bounded best-effort hints and lifecycle/work controls. Apply only separately approved old-test forwarding, preserve all assertions. Scoped READMEs/maps then full regression.
6. **Verify/freeze:** final exact candidate hashes, P03/P04/P05 superseding paths and historical manifests preserved, no unaccounted source/test paths. Record actual REDs/failures, focused/full gates and named G01–G06 mapping in P06 handoff; lead/Luna own review/acceptance. Notify `w8:p2` and STOP, never advance P07 automatically.

Planned commands ONLY after execution authorization (not run for this document): `pnpm typecheck`; `pnpm exec vitest run src/tests/authorization/delegation.test.ts src/tests/authorization/freshness.test.ts src/tests/work/workService.test.ts`; broader existing authorization/toolPolicy/sessions and all eight compatibility/public regressions; `pnpm docs:check`; final **`pnpm validate`**. Preserve existing assertions/skips/thresholds, pinned dependencies and DB-safe unsetting of PG*, DATABASE_URL, AGENT_HOSTING_PROTOCOL database/auth/provider variables, AHP_TEST_DATABASE_URL, Supabase/Postgres URLs without printing values. No live DB, package install, commit/reset/stash/worktree, model/account change or children.

After TWO failed repairs of the same criterion, retain exact reproducer and blocker and stop; no weakening claims/limits/tests. Any public amendment, unforeseen fixture migration, additional path, ownership conflict or stale predecessor invalidates its dependent execution gate.

## 11. Self-check / decisions requested

Self-check only, not independent approval: one binding/resource authority source; no grant/lifecycle shadow map; parent/relationship incarnation prevents ABA; actual work/cleanup/event draining retains occupancy; source-grounded minimal readiness+coherence; callbacks before final internal CAS; mandatory/tool/work boundaries preserved. Smaller alternatives rejected: a service-local grant map (split authority), parentId-only checks (resurrection), owner/getResource as readiness (failed-owner leak), evaluate(assign) (invented ToolOperation), cancellation frees slots (P05 defect), event callbacks as currentness (missed/throwing hints), broad P01 rewrite (unnecessary signature churn).

R1/R2/R3 self-check: actual host forwards both required methods and adds terminal state; canonical issued snapshots reach a concrete prepared-source closure and final P04 guard with clock-before-canonical ordering; preknown consumed-once ownership reaches instrumented install/after-effect rollback, retained failed-record resource cleanup, readiness/getResource/owner projection. No return-only receipt or matching-nominal recovery remains. Lead/Luna narrow recheck must approve exact token APIs,20-path scope and four existing-test edits; separate-dimensional limits are ratified in principle. Broader control/lineage/CAS/hint design remains as proposed, not accepted implementation. No unresolved implementation work has been transferred to another executor. **This proposal alone changes no runtime authority.**

# P05 bounded integration preflight

**Mode: read-only preflight; not a P05 plan acceptance or implementation. P04 must be accepted before P05 implementation.** This report is based on the accepted P05 target/contracts and stable session/work/P03 boundaries; no actively changing P04 websocket/agents implementation paths were inspected. No source/test edits or runtime/DB commands were made.

## Outcome and smallest integration

The smallest compatible design is a two-phase, session-owned creation transaction with one canonical owner/resource fact:

```text
trusted connection context + exact selected registered session type
 -> reserve URI (not a usable session record)
 -> async create-authorization/bootstrap preparation
 -> synchronous no-await attach: SessionRecord(instance) + P03 resource/owner/bindings
 -> publication
 -> backend lifecycle
 -> expected-instance cleanup on rollback/disposal
```

Keep existing session factory responsibilities (type/config/provider validation, record registry, lifecycle/reducer) in `@sessions`; pass trusted P04 context and a bounded creation authority adapter from the host. Do not let request JSON choose actor, owner, roles, admission, or bootstrap. The session-type's exact revision carries policy admission, mandatory refs, and an **optional** host-approved creator-bootstrap template. That template is not itself evidence that this caller may create the type.

### 1. Type registration and tool catalog remain separate

Current `ApplicationSessionType.definition` contains serializable `{id,key,version,providerId,configSchema,tools}` (`src/sessions/helpers/sessionTypes/types.ts`); `createSessionTypeCatalogue` captures exact revisions and resolves only registered exact refs (`.../helpers.ts`). `SessionApplicationOptions` adds one global `role` and `authorizedTools` (`src/sessions/helpers/application/types.ts`); `prepareSessionCreation` uses role-based visibility (`.../application/helpers.ts`). The new session policy admission must be a separate field, captured/frozen with the registered exact type revision. Preserve `tools` / `authorizedTools` as the contract/tool ceiling only where still needed for catalogue structure; they must not become policy grants. The global `role` cannot remain a protected authority source or be inherited as creator/participant role. Prefer rejecting conflicting legacy protected configuration or make legacy visibility inert under the new typed security composition, with an explicit compatibility migration decision.

At host setup, register the type/provider admission with the P03 authorizer using `installAdmission`. At resource attach, pass that same type/provider association to `installResource`. Keep P03's direct policy ceiling and mandatory refs, and its trusted `owner: SecuritySubjectRef`, distinct. Session-type selection must resolve exact version/provider and be captured before any creation policy decision. A failed or disabled selection stays before any record, owner, binding, catalogue event, or backend call.

### 2. Async prepare, URI reservation, synchronous attach, rollback

The existing factory has a useful atomic boundary but not the required preparation seam:

- `executeCreateSession` parses params, resolves type/provider/config, checks URI uniqueness, builds a `SessionRecord`, `sessions.add(record)`, calls synchronous `onRecordCreated(sessionUri)`, then emits `root/sessionAdded`, then starts the backend (`src/sessions/createSession/helpers.ts`). If the hook throws, it deletes the new record before publication.
- `SessionsFactory.createSession` exposes only `createSession(params, onRecordCreated?: (sessionUri) => void)` (`src/sessions/types.ts`). The callback receives neither the actual record/instance nor a rollback token. It runs after registry insertion and cannot await an authority decision.
- `SessionRecord` has no authorization resource instance ID (`src/sessions/types.ts`). The current session registry keys by URI. `executeCreateSession` and backend settlement compare record object identity to prevent a late backend from attaching to a replacement, but that does not fence P03 owner/binding cleanup without an instance ref.

P05 needs an additive **internal factory creation hook contract** with a bounded async `prepare` and synchronous `attach`/rollback/removal hooks. Exact naming can be chosen in the P05 plan, but preserve these semantics:

1. Validate selected type/provider/config before asking creation authority; reserve the client-selected URI synchronously before the first await. The reservation is not a usable record, is not returned by snapshot/list, and ensures a second concurrent create cannot pass uniqueness while the first policy decision is parked.
2. Mint a server-owned full `ResourceRef`/instance ID for this attempt before prepare. Pass trusted actor/context, exact selected type/provider and candidate scope to an application creation-authority seam. It returns a frozen prepared result containing the exact resource/admission, immutable owner subject, optional explicit binding template(s), captured revision/deadline and synchronous `isCurrent()`; it must not return request-derived roles or invoke P06's general grant issuer.
3. Resolve all async decisions before entering attach. Since the new resource is not yet live, the creation authority must be an explicit registered creation/bootstrap decision over the trusted candidate/type/provider, not a call pretending `ResourceResolver.resolve` can resolve a not-yet-attached instance. The exact decision source is a **remaining P05 plan-gate question** (below).
4. Before attach, recheck reservation ownership, factory/host not stopping, freshness/currentness and expiry. With no intervening await, add the record carrying the new instance ref, call `installResource`, then install only the explicitly approved exact bootstrap bindings. If any attach step throws, remove only this record and call `authorizer.teardown(expectedFullResourceRef)` so partial bindings/resources are rolled back before catalogue/backend publication. Do not call URI-wide cleanup or tear down a pre-existing/successor resource.
5. Keep the URI reservation through async preparation and attach, release it in all failure/terminal paths. A factory dispose/host stop while prepare is parked invalidates the reservation; late prepare results are released/discarded and can never attach. This is required because current `createSessionsFactory.dispose()` clears live records/listeners but has no in-flight creation preparation registry.
6. Publish only after resource/owner/bindings are committed synchronously. Backend startup remains afterward, preserving existing ordering. A start failure remains an inspectable failed record per the current lifecycle; bootstrap grants on that failed record are not settled by existing code and require the explicit S05 decision below.

A single no-await attach hook can call `sessions.add` + P03 installs synchronously; rollback uses exact record/resource identities. Do not add a database transaction or await inside this critical section. Do not treat `installBinding` itself as creator issuance: the only bindings attached are exact values already approved by the typed creation policy/template and host registration.

### 3. Canonical owner fact and work compatibility projection

Current `SessionOwnerRegistry` is a writable `Map<sessionUri, subject>` (`src/work/types.ts`, implementation `src/work/helpers/helpers.ts`). The host creates it separately in `createAHPServer`, AHP binds it at record attach, and disposal unbinds by URI (`src/websocket/helpers/host/helpers.ts`, `src/websocket/helpers/ahp/helpers.ts`). `WorkService` reads owner subject and compares it with `principal.subject` and `DurableSessionInput.ownerPrincipalSubject`; it does not need the role or grant registry (`src/work/helpers/helpers.ts`). This is the correct subject-only legacy boundary, but the host map cannot remain an independently writable owner source under AUTHORITY A8.

In P05, make the **P03 resource registration's immutable `SecuritySubjectRef` the canonical owner**. Supply work with a read-only compatibility projection that resolves the current session record's full resource ref and returns exactly its canonical `owner.subject`, only within the host's configured legacy work identity domain. It must not accept a different subject through `bind`, derive owner from actor roles, or promote a participant to owner. The creator's actor and owner fact are related but distinct.

Separate lifecycle settling from ownership. Current `agentWork` disposal deliberately keeps the old owner-map value while the record is absent and backend disposal is parked; `isSettlingSession` blocks URI recreation until settlement, and tests cover failing/successful disposal, same-owner recreate, stale create, foreign disposal, and successor ownership (`src/tests/websocket/agentWork.disposal.test.ts`). A read-only projection of live records would otherwise return no owner as soon as a record is removed and lose this settling signal. Use a bounded pending-disposal/reservation marker keyed by URI **and expected instance** (or an equivalent factory lifecycle callback), not a second owner map. Reject same-URI create while the old disposal is settling if preserving current behavior; clear only the exact lifecycle marker at settlement. Owner projection for `WorkService` remains absent when no live record exists, so work submission remains fail-closed. Late cleanup for old instance must never clear a successor's canonical resource/owner.

Smallest type boundary: narrow the `WorkService` dependency to a read-only `SessionOwnerLookup.owner(uri)` (or equivalent) and retain the existing writable `SessionOwnerRegistry` only for standalone legacy tests/adapters if needed. Remove host `bind/unbind/clear` as authority mutations; route lifecycle installation/teardown through the session record's full resource ref. If retaining the broad interface for compatibility, its host adapter's mutation methods must be removed from supported host flow, not silently treated as canonical writes.

A8 also limits subject-only durable work: when agentWork/work is composed, verify P04's single configured work domain and preserve exact subject equality. Do not concatenate domains, substitute the session owner for a participant, modify WorkService/repository subject semantics, or claim shared multi-domain work compatibility.

### 4. Expected-instance teardown and backend behavior

P03 exposes `teardown(resource: ResourceRef)` and `owner(resource)` over full instance identity (`src/authorization/helpers/evaluate/types.ts` and implementation). Teardown removes exact-resource bindings and assignments, and a resource ref includes `{domainId,kind,id,instanceId}`. P05 should store that full ref on the `SessionRecord` (or an equally authoritative attached record) and use only it for rollback and removal. Do not derive cleanup from a URI or current URI lookup after an await.

Existing lifecycle constraints:

- `startBackend` stores a backend only if the current registry record is the exact object; a late old start disposes its backend and publishes no ready action (`src/sessions/createSession/helpers.ts`). Preserve this.
- `disposeSession` deletes the record and emits removal before awaiting backend disposal (`src/sessions/helpers/factory/helpers.ts`). The AHP owner cleanup runs in `finally` after that await. Preserve typed failure and settle-window behavior while changing cleanup to full instance identity.
- `factory.dispose()` clears records synchronously and skips still-starting backends; late starts self-dispose. It must also synchronously invalidate each exact resource/binding and cancel/release pending create preparations before listeners disappear.
- A same-URI successor gets a different instance. Old backend completion, old prepare resolution, old owner projection read, or old teardown must not attach to, authorize, unbind, or delete that successor.

### 5. Explicit remaining plan-gate questions

P05 implementation should not start until the lead settles these narrow contract items:

1. **Creation authorization API:** No current `ToolOperation` is `createSession`; `SecurityComposition` has `PolicyEvaluator` with arbitrary operation strings, but P03 `ToolExecutionPolicy` operations are discover/invoke/execute/etc. Session type's existing `role` is not suitable authority. Which already-trusted application seam authorizes a principal to create this exact type/provider and approves the optional bootstrap template? Choose an explicit, bounded creation-policy callback/port or a recorded P01/P03 operation extension; do not invent a role, assume admission implies creator permission, or call `GrantIssuer` without issuer authorization. The callback must return a denial or a prepared exact bootstrap decision tied to context/type/provider/candidate instance and currentness.
2. **Bootstrap on backend start failure:** P05 S05 says “without granting on startup failure,” while AUTHORITY A5 permits an inspectable failed session after provider startup failure and requires no ownerless/privilege-leaking record. Decide whether the owner fact remains but bootstrap bindings are revoked on failure, or whether another explicit safe behavior applies. Add a failure test that separately asserts inspectable lifecycle, owner projection, and absence/presence of tool bindings; do not let startup failure silently imply grants.
3. **Pending creates vs disposal:** Add synchronous URI reservation and a terminal generation/cancellation rule to prevent duplicate async authorization and post-dispose late attach. State whether stop waits only to bounded preparation deadline or cancels immediately; in either case no unbounded wait and every prepared reservation is released once.
4. **Owner projection interface:** Confirm a read-only URI-to-live-resource lookup path in the session factory and a separately owned exact-instance settle marker, or select another structure that cannot become a second owner store. Keep current work API subject-only and owner-only.
5. **Scope of application callback:** Type-specific creation/bootstrap declarations must be captured immutably when the session application is built. Clarify whether the policy evaluator's generic string operation is authorized for creation or whether the app callback is the intended separation. No broad P06 issuance engine belongs in this packet.

## S01–S05 distinguishing test controls

These are proposed evidence obligations, not passes. Reuse `src/tests/sessions/createSession.test.ts`, `sessionTypes.test.ts`, `applicationHost.test.ts`, and `src/tests/websocket/agentWork.disposal.test.ts`; add `src/tests/sessions/policyCreation.test.ts` per P05. Keep each positive control valid and each failure isolated.

| ID | Required control pairs and evidence |
| --- | --- |
| **S01 ownership vs participant role** | Create as senior Alice with explicitly authorized creator bootstrap; install/inject a distinct junior Bob scoped binding through a trusted bounded fixture, not a P05 issuance engine. Both evaluations use their own actor/subject; Bob gets only his scoped operation. Canonical `owner(resource)` and work projection remain Alice. `WorkService.submit({subject: Bob})` stays unauthorized while Alice succeeds. Never copy Alice's subject into Bob's authority context. |
| **S02 explicit bootstrap authorization** | Missing auth, create-denied actor, unknown/disabled type, provider mismatch, and sensitive type with no authorized bootstrap each deny before record insertion, owner/resource/binding install, catalogue notification, or provider start. Positive control: exact registered type/provider and explicit creator authority + template attach only intended bindings. Verify no role/namespace default. |
| **S03 atomic attach/rollback** | Positive attach observes the exact record, full instance resource, owner and all intended bindings before first catalogue event/backend start. Inject resource install failure and failure on a later binding after an earlier install; assert no record, event, backend start, owner view, or residual exact-ref binding/resource remains. Reuse same URI successfully afterward. Assert no cleanup of another instance. |
| **S04 instance and same-URI races** | Park async authorization, race a second same-URI create and assert only one reservation/prepare may attach. Dispose/stop while prepare is parked, release old result, and assert no late record/authority/event. Park old backend start, remove/dispose old record, recreate the same URI with different instance and owner; settle old backend/teardown and prove successor record/owner/bindings remain. Repeat for old failed/successful disposal settlement. |
| **S05 backend lifecycle/work projection** | Successful backend preserves `creating -> ready`, ordering and owner projection. Rejected backend start emits the existing sanitized `creationFailed` and inspectable failed record but no forbidden bootstrap grant (per gate decision); owner fact behavior is explicit. Dispose backend success/failure preserves current errors/settle-window and removes exact resource/bindings; work owner projection continues to match subject-only owner semantics and does not grant participants. |

Existing exact regressions worth retaining: `createSession: attach hook` live attach and throwing hook no record; `createSession: lifecycle` ready/failure event order and sanitized errors; the websocket disposal suite's “denies mid-window recreates,” “stale detached create,” “answers conflict for a create disposed mid-start,” “protects live in-flight create against foreign disposal,” and “failing settlement unbind” cases. P05 should adapt these to resource-instance assertions, not replace them with a fast-path-only fixture.

## Scoped Documentation Drift

No confirmed current-state drift is asserted here. `src/sessions` documents current type/config creation and record/backend lifecycle; `src/work` documents subject-only owner checks; `src/websocket` documents current owner registry behavior. P05 documents target behavior. After P05 is authorized and implemented, update only affected session/work/websocket module docs and source maps to describe the actual canonical owner projection, admission/bootstrap, rollback, and lifecycle boundary. Do not update docs in this preflight.

## Gate status

**Preflight ready for a later P05 plan gate; implementation blocked pending P04 acceptance and the five decisions above.** No P05 plan or implementation is approved by this report. The exact API should preserve current provider/backend lifecycle, session-type/tool contracts, P03 instance-specific cleanup, and subject-only work ownership while avoiding a second owner map and any role/global-admin inheritance.

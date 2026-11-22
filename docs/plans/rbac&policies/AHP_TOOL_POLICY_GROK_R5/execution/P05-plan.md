# P05 plan — explicit creation capability, exact-instance bootstrap and canonical owner

**Status: EXECUTION AUTHORIZED by lead in P05-authorization.md; P04 ACCEPTED.** Read with binding `P05-plan-amendment.md` (PASS recheck), which supersedes historical proposed/no-authorization wording below. Sol is sole production/test/owning-README writer. Both narrow P03 additions are approved: strict captured-compiler identity `usesPolicyFactory` (no epoch/effects) and exact conditional `removeBinding`. Compiler coherence is enforced before admissions/resources/effects. Network create requires successful same-connection ready initialize plus live exact-true global-sequence permission AND separate creation approval; contextual trusted in-process create does not require native cursor permission. Candidate ResourceRef uses the accepted default schema (URI max512) before reservation/callbacks. Creation input default AND absolute ceiling are 1MiB; no 16MiB path. User sequence authorization is established; P06 remains blocked until P05 acceptance.

**Goal:** authorize exact registered session-type/provider creation independently of tool invocation; atomically attach record/resource/owner/approved bootstrap; preserve inspectable backend failure while withdrawing only that bootstrap; give work a read-only canonical owner projection and separate exact-instance lifecycle exclusion.

**Evidence read:** P05 packet, Luna preflight, P05 lead decisions, AUTHORITY A3–A9 and INTEGRATION; stable session type/application/factory/create/backend sources; work types and owner-check implementation; accepted P03 installation/teardown APIs; frozen P04 **types only** for dependency mapping. No P04 implementation review/rework, runtime/test/DB commands, package changes, models, children or commits occurred in this plan turn.

## 1. Current facts and chosen integration

- `SessionTypeCatalogue` resolves registered `{key,version}` and stores definition/parser/provider/enabled state. Runtime parser objects are currently borrowed; protected policy/parser/provider callbacks must instead be captured once.
- `prepareSessionCreation` currently extracts the existing header-enum selector, resolves a revision, parses type config and applies global role/tool visibility. That role path cannot authorize protected creation or bootstrap.
- `executeCreateSession` adds a record, synchronously invokes `onRecordCreated(uri)`, publishes `root/sessionAdded`, then starts the backend. A throwing hook deletes the record. The hook has no instance, async preparation or rollback receipt.
- Factory disposal deletes records before awaiting backend cleanup; late backend start already checks exact record-object identity. Keep that protection. Add reservations/instance cleanup rather than replacing the backend lifecycle.
- Work uses `sessions.owner(uri)` only for lookup and compares exact subject strings. Its standalone writable registry can remain for legacy/internal tests; a protected host must not use that map as a competing owner store.
- P03 owns immutable full-resource owner facts and scoped bindings but has no narrow binding removal. `teardown()` would also erase the owner, so it is wrong for startup failure of an inspectable record.

Chosen flow:

```text
trusted P04 current context + registered exact type/provider/config
 -> private finite URI reservation + fresh candidate ResourceRef
 -> bounded type-specific creation/bootstrap prepare callback
 -> validate exact approval/template/compiled admission + final currentness
 -> NO AWAIT: record + canonical resource/owner + exact bootstrap bindings
 -> publish canonical creation event, then existing backend lifecycle
 -> ready OR withdraw exact bootstrap before creationFailed (owner retained)
```

No invoke-as-create, namespace-as-grant, synthetic host/root resource, unscoped binding read, `GrantIssuer.prepare/commit`, general delegation engine, or owner impersonation. A declaration/template alone cannot authorize a caller.

## 2. Exact proposed local contracts

These are session-owned additions, not edits to accepted P01 security ports or ToolOperation. New types belong in `src/sessions/helpers/creation/types.ts`; type registrations import them with type-only edges.

```ts
interface SessionCreationCapabilityRef {
  readonly key: string;       // opaque application creation capability, NOT ToolPolicyRef
  readonly revision: number;
}
interface CreatorBindingTemplate {
  readonly key: string;
  readonly purpose: "admitted" | "mandatory";
  readonly roles: readonly string[];
  readonly policies: readonly PolicyRef[];
  readonly authority: { readonly kind: "host-policy"; readonly policy: PolicyRef };
  readonly maxLifetimeMs: number;
}
interface CreatorBootstrapTemplate {
  readonly id: string;
  readonly revision: number;
  readonly bindings: readonly CreatorBindingTemplate[];
}
interface SessionTypePolicyRegistration {
  readonly rules: PolicyScopeRules; // alternatives and mandatory refs kept separate
  readonly creatorBootstrap?: CreatorBootstrapTemplate;
  readonly creation: {
    readonly capability: SessionCreationCapabilityRef;
    prepare(input: {
      readonly request: SessionCreationFacts;
      readonly signal: AbortSignal;
    }): Promise<SessionCreationApproval>;
  };
}
```

Add optional `policy?: SessionTypePolicyRegistration` to **ApplicationSessionType / ResolvedSessionType / StoredSessionType**, and `policy?` to `defineApplicationSession`'s trusted input/registration output. Do **not** put callbacks/templates in `SessionTypeDefinition`, canonical wire metadata, a manifest or a snapshot. A type without this explicit policy cannot be created through the protected path.

```ts
interface SessionCreationContext {
  readonly context: TrustedRequestContext;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly validUntil: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
interface SessionCreationFacts {
  readonly attemptId: string;
  readonly caller: TrustedRequestContext;
  readonly connectionGeneration: number;
  readonly candidate: ResourceRef<"session">;
  readonly type: {
    readonly id: string; readonly key: string; readonly version: number;
    readonly providerId: string;
  };
  readonly capability: SessionCreationCapabilityRef;
  readonly rules: PolicyScopeRules;
  readonly bootstrap?: CreatorBootstrapTemplate;
  readonly config: Readonly<Record<string, unknown>>;
  readonly workingDirectories: readonly string[];
}
type CreatorBootstrapApproval =
  | { readonly kind: "none" }
  | {
      readonly kind: "template";
      readonly id: string;
      readonly revision: number;
      readonly bindings: readonly { readonly key: string; readonly lifetimeMs: number }[];
    };
type SessionCreationApproval =
  | { readonly effect: "deny"; release(): void }
  | {
      readonly effect: "allow";
      readonly request: SessionCreationFacts;
      readonly bootstrap: CreatorBootstrapApproval;
      readonly validUntil: number;
      isCurrent(): boolean;
      release(): void;
    };
```

The callback must explicitly approve **creation plus the whole declared template**. If no template was registered, only explicit `kind:"none"` is valid. If a template exists, `kind:"template"` must name its exact ID/revision and every binding key exactly once; missing/duplicate/additional keys deny the whole attempt. This intentionally avoids a partial-template/default-bootstrap policy language.

`allow.request` must be the exact SDK-created frozen `request` object supplied to this callback (`===`), not a copied/replayed approval for another attempt. This is an in-process callback/guard contract, not a wire DTO or public grant token. An external IAM adapter retains that request object around its own await and returns it only after its explicit decision. Request facts contain actual caller/fence/candidate/type/provider/capability and immutable normalized intent. They do not contain a live socket or bearer credential.

The result cannot choose owner, recipient, actor, resource, roles, policy refs, authority, binding IDs or revisions. Strict validation rejects such extra result fields. The SDK materializes only fixed template entries:

- owner = actual `caller.actor.principal`, including domain; an agent stays an agent while its canonical principal owns the resource;
- binding actor = the actual creator actor, not an inferred owner/user/admin;
- binding scope = this candidate full ref only;
- UUID binding IDs are minted once per attempt, revision 1, never reused;
- roles/policies/host-policy authority come from the captured template;
- requested lifetime is positive/bounded by its entry and host cap; expiry is calculated from captured preparation time, not extended by delayed attach;
- final attach must occur before approval/context/each new binding expiry. No grace on stale approval.

This is the narrowly authorized **creator bootstrap** path, not P06 general assignment/delegation. It cannot add an invited participant, issue another scope, transfer ownership, or delegate.

### Registry/capture and admission validation

`createSessionTypeCatalogue` captures/freeze-clones definition, policy rules, template, capability and config schema; binds parser/creation functions once into private runtime registration. `list()` still returns serializable definitions without policy code/template inventory. Protected factory capture builds its own immutable map of exact resolved registrations, including `enabledForCreation`; later mutation of caller arrays, provider objects, callback properties, type IDs/versions/config/template or tool refs cannot widen an in-flight attempt.

Capture provider ID/info, config parser/schema and `startSession.bind(provider)` at construction for protected use. Dynamic application facts belong in the approval's explicit synchronous currentness guard, not mutable registration rewiring.

Proposed factory configuration:

```ts
interface SessionCreationSecurityOptions {
  readonly registry: ReferenceAuthorizer; // canonical resource/owner/binding registry
  readonly policies: ToolPolicyFactory;  // same compiled source used by that registry
  readonly prepareDeadlineMs?: number;
  readonly maxPendingCreates?: number;
  readonly maxSettlingSessions?: number;
  readonly maxBootstrapBindings?: number;
  readonly maxBootstrapLifetimeMs?: number;
  readonly maxCreationInputBytes?: number;
}
// SessionsFactoryOptions: readonly creationSecurity?: SessionCreationSecurityOptions
```

`registry`/`policies` form one explicit trusted coherent composition, not alternative authorities. Construction first requires `registry.usesPolicyFactory(policies) === true`, strict identity against the registry's captured compiler, before any admissions, registry allocation, host resource acquisition or other effects. Equivalent separately constructed compilers reject; the predicate invokes no callback and changes no epoch. Then compare each captured `policy.rules` with `policies.forSessionType(exactRef,providerId)`; reject mismatch/missing link, unknown compiled refs/namespace revisions or invalid template. Build exact direct-plus-expanded closure with `inspect().namespaces`; never call `select()` or use namespace prefixes. Then `registry.installAdmission({sessionType: exactRef,providerId})` uses the canonical registry's own compiler. Resource attach links the same exact type/provider and preserves all explicit mandatory refs, so a second narrower check cannot remove canonical mandatory restrictions.

Template `purpose:"admitted"` refs must be within that alternatives closure. `purpose:"mandatory"` entries may reference only the declared mandatory set: they satisfy a required rule but cannot become an admitted positive alternative. Every authority ref is an exact compiled ref included in its binding's fixed policies. The union is not silently promoted into the positive ceiling. Ordinary post-create operations remain subject to P03's exact positive path and every mandatory restriction.

Protected configuration rejects explicit `SessionApplicationOptions.role` **and** the old role-bearing `authorizedTools` filter. The immutable session type's canonical tool refs remain a structural ceiling, not per-recipient permission. Legacy fields remain only on unprotected trusted-kernel factories for existing internal compatibility, never as protected fallback. A policy-bearing type without `creationSecurity` is rejected at configuration; it cannot silently take the legacy path. Protected selection of a type with no policy/approval denies before mutation.

### Exact registered type identity — no guessed header versions

Keep existing native CreateSessionParams/header-enum intent, not a new invented SDK method/version. Resolve the existing `SESSION_TYPE_SELECTOR_KEY` string via the captured registry's **exact registered key table**, selecting only a uniquely enabled registered revision. Zero or multiple enabled revisions denies. Do not split `@revision`, infer “latest,” derive provider/roles from a suffix, or treat an arbitrary string as an authorized type identity. An explicit captured `defaultType:{key,version}` is resolved exactly when no header was supplied; it does not override a conflicting supplied selector.

The callback receives the **resolved registered** `{id,key,version,providerId}`, not a reconstructed wire header. Provider intent, when supplied, must equal that registration. Disabled/unknown/ambiguous type, missing policy, provider mismatch, invalid config or forbidden creation-time advertisement fails before callback/reservation/record effects. Header lookup can remain a private snapshot-registry helper; no new public catalogue resolver API is required. Trusted `createApplicationSession` may accept a third optional `SessionCreationContext`; with it, use the protected capability below, without it use the existing trusted-kernel method (which rejects if protection is configured).

## 3. Factory and public creation surface

Add an optional **SDK-owned output capability**, not an input `canCreate`/allow-all callback or mode flag:

```ts
interface SessionFactoryAuthorization {
  createSession(params: unknown, caller: SessionCreationContext): Promise<void>;
  getResource(sessionUri: string): ResourceRef<"session"> | undefined;
  disposeSession(expected: ResourceRef<"session">): Promise<boolean>;
  isSettling(sessionUri: string): boolean;
}
// SessionsFactory: readonly authorization?: SessionFactoryAuthorization
// SessionRecord: readonly resource?: ResourceRef<"session">
```

Optional preserves old structural factory/record fixtures. The actual protected SDK factory creates/freeze-captures this capability; legacy factories have no such capability. Its `createSession` always runs the one validated creation pipeline; setting a boolean/property does not authorize anything. `getResource` returns only the current attached record's immutable full ref, not a pending reservation or owner cache. `disposeSession(expected)` cancels/removes only that exact pending/attached instance; missing/stale returns false with no successor mutation. Trusted URI disposal captures the current exact ref synchronously and delegates to it before any await; missing URI keeps the established top-level typed error.

When `creationSecurity` exists, legacy `factory.createSession(params,onRecordCreated)` rejects missing trusted context; it cannot create an ownerless protected record or run an arbitrary legacy hook inside the protected attach transaction. Existing unprotected trusted factory behavior remains for old internal tests. No network path selects it as fallback.

After P04 acceptance, the public AHP facade's **createSession only** may map the actual connection into `SessionCreationContext` and call `factory.authorization.createSession`. It must run only after the existing canonical beforeDispatch confirms successful ready initialization on this same connection, and require captured `allowGlobalSequence` to remain exactly true, the real P04 snapshot/currentness callback, matching actual connection ID/generation/auth context and nonexpired deadline. Failed/unattempted initialize has zero creation effects. Cursor permission is protocol-only, never creation authority; trusted in-process contextual creation has no cursor/initialize requirement. A close listener aborts the request. Its guard compares the same actual snapshot/fence to the live connection, not the snapshot to itself. JSON actor/owner/roles/bootstrap/currentness fields are never consumed. Missing capability/context denies, never calls legacy `factory.createSession`.

On success return existing native `null` only. **Do not add subscriptions, root/list/count/session snapshots, raw tool metadata/advertisements or legacy calls.** P04 protected-output deferral remains. Provider failure is still an inspectable canonical failed record, not a raw failure snapshot broadcast to an unauthorized client. P10/P12 own actual views/SDK evidence.

Host composition reads only `options.sessions.creationSecurity` as the creation configuration (no parallel second registry option). Protected host construction requires P04 `security`; reject mismatched/conflicting creation/owner sources before resource acquisition. Host `.sessions.authorization` forwards the SDK capability with the existing terminal-stop fence. Protected host `.sessions.createSession` cannot bypass it; trusted callers use the contextual capability. Host stop remains terminal even though a bare factory may be reusable after dispose.

## 4. Reservation, commit, rollback and backend lifecycle

### Before any creation await

1. Validate/capture bounded wire intent; resolve registered exact type/provider and both normalized configs with captured synchronous parsers; retain only the established first working directory behavior.
2. Verify real caller context/fence/currentness and protected configuration. Reject unknown/disabled/provider mismatch/legacy-role conflict before authority effects.
3. Ensure no live record, pending create or disposal-settle marker occupies the URI. Reserve synchronously in a factory-owned finite map. Mint fresh attempt token and `ResourceRef{domainId:caller.principal.domainId,kind:"session",id:uri,instanceId:UUID}`. Reservation is not a SessionRecord and is invisible to snapshots/lists/work owner lookup.
4. Record factory epoch, opaque reservation token, exact ref and a combined AbortController for request close/cancel, factory shutdown/expected-instance disposal and one overall preparation deadline. Invoke only the captured exact registered creation callback.

An approval/copy for another attempt, expired/nonfinite result, missing template approval, thrown/unknown result or callback rejection denies. Validate list limits before deep copy. Capture result data/functions once; synchronous guards must return **true**, not truthy promises; throwing guards deny. Release is synchronous/idempotent and invoked once by orchestration on all paths. A denied result also has a release hook; a throwing callback owns its pre-return temporary resources.

Cancellation rejects the pending create promptly, removes only its own reservation, aborts its signal and observes the original promise. A late fulfilled result is released once; late rejection is observed. Do not wait forever for a cooperative adapter. Factory dispose synchronously advances epoch and cancels all pending attempts before clearing live records/listeners. Reusing a bare factory after disposal cannot revive old callbacks.

### No-await attach

After all async work, run approval and connection guard callbacks, then recheck SDK-owned reservation token/epoch/not-stopping/no-incumbent/marker absence/full candidate/expiry. Recheck local invariants after guards so a reentrant guard cannot dispose/recreate and then return true to an obsolete check. No more awaits or externally invoked preparation callbacks before commit:

1. Build SessionRecord with its immutable full resource ref and exact type binding.
2. Add this record; install canonical resource with owner=actual principal, self route, exact type/provider admission link and mandatory refs.
3. Install only SDK-materialized exact approved bootstrap bindings. No executor/tool assignments are inferred.
4. Retain an internal receipt of expected binding IDs/full scope/revisions and exact record/resource identity for failure cleanup. This receipt is not a second owner/grant authority store and is not returned on the wire.
5. Only after all installs succeed, mark committed, remove the reservation and detach request-cancellation preparation listeners. Publish then begin the captured backend lifecycle. A disconnected creator after commit does not silently erase an already published session or transfer ownership.

If any install/add step throws: delete only `registry.get(uri)===thisRecord`; call `authorizer.teardown(candidateFullRef)` only for the attempt's newly attempted resource; remove exact bootstrap remnants; release preparation and reservation. No catalogue/backend effects. Check fresh candidate has no pre-existing owner before attempting installation, so an accidental nonce collision cannot cause cleanup of an incumbent. Never perform URI-wide teardown or delete a successor after an await.

Default in-memory registry/P03 operations are synchronous local mutations. Custom registry ports must honor that no-callback/no-await ownership contract; SDK rechecks record identity on rollback. Existing `onRecordCreated(uri)` remains only on the legacy trusted path, not a hook that can publish a half-installed protected record.

### Backend readiness/failure

Preserve current normal `creating -> ready`, sanitized creationFailed, sequence and catalogue ordering, and detached late-backend disposal diagnostics. After publication, if a synchronous observer already removed/replaced the record, do not start/attach a backend onto the successor. Long backend startup remains the existing session-owned lifecycle, not an unbounded creation-authorization reservation.

On startup rejection for **this still-current exact record**, synchronously withdraw the receipt's newly installed bootstrap bindings using section 5, mark bootstrap withdrawn internally, then apply/publish creationFailed. **Keep the failed record, resource, admission association and immutable owner.** Do not teardown/reinstall ownership. Never target another revision/actor's grant or resource. Previously issued bootstrap decisions must be stale before failure is observable.

On a late old backend result/error, exact record/full-instance checks prevent any successor mutation or failure publication. Released/removed receipts are idempotent; do not repeat teardown on an already-cleaned old ref and invalidate unrelated successor decisions. Future P06/P09 issuance/dispatch must reject failed/unavailable sessions based on lifecycle plus expected instance; `owner(ref)` alone is not readiness. P05 introduces no participant/general issuer.

### Exact-instance disposal and separate settle state

Protected individual disposal captures the full ref and reserves a bounded settle token **before** removing the record. Then detach this record, synchronously teardown this full P03 resource/bindings/assignments, emit removal, await only its captured backend, and clear the settle marker in `finally` **iff the same resource+token still owns it**. Backend failure still throws the existing sanitized error; a stale completion cannot clear a later marker.

A settle entry contains URI/full ref/token/state only—**no owner subject**. Owner lookup is absent as soon as no live record exists. New same-URI creates fail while its old backend disposal is settling. A still-starting backend has no attached handle; removal can complete immediately, and its later resolution self-disposes using existing record-object fencing. The permitted successor has a fresh instance/owner/grants; late old cleanup is a no-op on it.

Expected-instance disposal of a pending candidate cancels just that reservation, without SessionRemoved/backend/owner effects. Top-level trusted URI operations capture the intended ref at entry; after work dependency awaits the host uses the **captured expected ref**, not a fresh URI lookup. Public native dispose remains deferred in this packet. Global factory disposal cancels preparations and tears down all captured records synchronously before awaiting backends; its existing global disposal barrier blocks new creates without needing unbounded settle markers.

## 5. Exact proposed P03 amendment — conditional bootstrap withdrawal

**Approved by P05-authorization.md**, together with `usesPolicyFactory` from the binding amendment. Only evaluator types/helpers and owning README may change; other P01–P03 files stay immutable. Add this evaluator-local method to `ReferenceAuthorizer`:

```ts
removeBinding(expected: {
  readonly bindingId: string;
  readonly scope: ResourceRef;
  readonly revision: number;
}): boolean;
```

- Validate bounded ID/full scope/positive revision before mutation with existing leaf schemas/local checks.
- Lookup current binding. Missing ID, different revision, or any full scope field mismatch returns **false atomically**: no deletion, assignment change, epoch/revision bump, owner change or partial effect.
- Matching input deletes that one binding and all tool/executor assignment records referring to that binding ID. The ID is unique within the host; dangling mismatched-resource tuples referencing that ID must not survive either. Other binding IDs/resources/owners/admissions remain untouched.
- Advance the existing local epoch/grant revision exactly once after a real deletion, invalidating issued positive/negative/currentness snapshots (including mandatory-rule contributions). No await, callbacks, tombstone map, general policy reevaluation or new limit getter.
- Do not call `teardown`, remove owner/resource or reinstall owner. Multiple receipt entries are removed synchronously before failure publication; false means already withdrawn/stale, not permission to remove a replacement.
- P05 uses fresh UUID IDs once per attempt, revision 1, never reused. This primitive does not solve identical-ID/identical-revision ABA reissuance: P06 must use fresh IDs or advancing revisions when reissuing. No unbounded historical-ID store is introduced.
- Valid SDK-captured tokens follow a no-callback, nonthrowing normal deletion path; unexpected trusted-store failure is surfaced/quarantined, never reported as successful withdrawal or “fixed” with owner teardown/reinstallation. Do not publish a successful cleanup claim if it did not complete.

New distinguishing `src/tests/authorization/bindingRemoval.test.ts`: real allow/descriptor positive; exact removal makes old stamps/provenance stale and removes tuple delivery; owner/admission unchanged; repeat removal false; wrong revision/actor-independent ID/full domain/kind/id/instance scope false with preexisting current stamps unchanged; same URI successor survives stale expected removal; unrelated binding still reevaluates correctly. Cover both assignment registries and a removed mandatory binding, including at-cap freed capacity. These are conditional administrative primitives, not a P06 grant-issuance engine.

## 6. Canonical read-only work owner projection

Type-only work change:

```ts
interface SessionOwnerLookup { owner(sessionUri: string): string | undefined }
interface SessionOwnerRegistry extends SessionOwnerLookup {
  bind(sessionUri: string, principalSubject: string): void;
  unbind(sessionUri: string): void;
  clear(): void;
}
// WorkServiceOptions.sessions: SessionOwnerLookup
```

Export the lookup type. **Do not edit WorkService owner equality, lease/presence logic, repositories, rows, SQL or subject projection formats.** Existing writable registries remain assignable for standalone legacy tests.

Protected host lookup does this on every read: current `factory.authorization.getResource(uri)` -> `registry.owner(fullRef)` -> return `owner.subject` only if `owner.domainId===configured P04 workDomainId`. Otherwise undefined. No second owner map, concatenated domain+subject string, role-to-owner conversion or creator substitution. Failed-but-live record still projects its canonical owner; no live record projects nothing even while a settle token exists.

AHP work-extension owner dependency can narrow to `SessionOwnerLookup` (import/type only; same owner comparisons). The private kernel gets a separate `ownerLookup` option for work reads while its old `sessionOwners` mutable option remains solely for legacy/internal mechanics. Public/protected composition rejects both/conflicting owner inputs when the factory has the SDK authorization capability; protected creation never invokes the kernel's legacy owner bind hook. Host supplies the projection only, not shim `bind/unbind/clear` methods.

Protected host creation/disposal checks use `factory.authorization.isSettling(uri)`, not `owner(uri)!==undefined && snapshot===undefined`. Keep the old `isSettlingSession` owner-map probe only for legacy/internal fixtures. Do not infer lifecycle from ownership or retain an owner subject in a disposal marker. Host stop clears no canonical “owner map”; factory exact teardown owns canonical removal.

## 7. Proposed bounded source/API write set

This exact bounded write set is **authorized by P05-authorization.md**, including both narrow P03 additions and the binding amendment.

| Paths | Exact scope |
| --- | --- |
| `src/sessions/helpers/creation/{types,constants,helpers,index}.ts` (new) | Session-owned types/validation/capture, finite reservation/receipt lifecycle helpers, approval/template materialization. No IAM/delegation framework. |
| `src/sessions/{types,index}.ts`, `createSession/{types,helpers,index}.ts` | Optional record resource/output authorization capability, protected context pipeline, backend receipt withdrawal and expected-instance cleanup. Existing native params type remains SDK-conformant. |
| `src/sessions/helpers/application/{types,define,helpers,index,host}.ts` | Trusted policy registration input, protected exact registry selection, immutable capture, reject global-role/legacy filter conflicts, contextual application helper. No role-based protected authority. |
| `src/sessions/helpers/sessionTypes/{types,helpers,index}.ts` | Capture runtime policy/parser privately; exact enabled identity table; keep public serializable definition free of callbacks/templates. |
| `src/sessions/helpers/factory/helpers.ts` | URI reservations/epochs/abort/deadlines, no-await attach/rollback, exact resource lookup/disposal/settle tokens and shutdown cancellation. |
| `src/websocket/helpers/host/{types,helpers}.ts`, `src/websocket/helpers/ahp/{types,helpers}.ts` | After P04 acceptance only: contextual public create/null response, canonical lookup/host capability forwarding and stop fencing; no other protected native route reopens. |
| `src/websocket/helpers/ahp/agentWork.ts` | Owner lookup import/type narrowing only; no work handler/schema/owner comparison changes. |
| `src/websocket/helpers/ahp/helpers/kernel/helpers.ts` | Narrow option plumbing: work reads use lookup, legacy internal owner hooks remain internal. No raw export or duplicate creation implementation. |
| `src/websocket/helpers/settling.ts` | Only if needed to segregate legacy probe from protected exact-marker caller; prefer protected callers using factory capability directly, leaving this legacy helper unchanged. |
| **`src/work/{types,index}.ts` only** | Read-only lookup interface/export and WorkServiceOptions type narrowing. `src/work/helpers/helpers.ts` and all persistence/lease code remain read-only. |
| **`src/authorization/helpers/evaluate/{types,helpers}.ts`**, owning authorization README | Only reviewed conditional removal from section 5 AND strict captured-compiler identity predicate from the binding amendment; no P01 types/constants/schemas/compiler change. Root export changes unnecessary if input type stays inline. |
| `src/tests/sessions/policyCreation.test.ts` (new), `src/tests/authorization/bindingRemoval.test.ts` (new) | New distinguishing S01–S05/removal evidence. |
| `src/tests/websocket/policyInitialization.test.ts` | Add real public protected creation/context/zero raw-egress controls after P04 acceptance; retain all P04 checks. |
| `src/tests/sessions/{createSession,sessionTypes,applicationHost}.test.ts`, `src/tests/websocket/agentWork.disposal.test.ts` | Preserve old lifecycle/type/config/attach-hook assertions; add protected counterparts or exact fixture/API wiring only if needed. No weakening/skips. Unexpected additional fixture migrations return to lead. |
| Owning sessions/work/websocket/authorization READMEs | New file maps/API/legacy versus protected evidence; no repository-wide documentation rewrite. |

No package/lockfile/env/process-wiring/DB/model changes. P04 transport/security implementation is not reworked; only its accepted public types/currentness are consumed by the later creation adapter. Accepted P03 hashes require an explicitly superseding amendment for the listed removal-only files. Lead owns ledger, acceptance and hashes.

Accepted P05-local bounded options: pending creates/settles/bootstrap entries default 128, absolute 1024; preparation deadline defaults to accepted asyncHookDeadlineMs 5000, ceiling 60000; creation approval validity capped at the accepted 60000ms decision horizon and caller expiry; bootstrap lifetime default host cap 1h, proposed absolute cap 24h (each trusted template must set a finite lower/equal maximum); captured creation input JSON default AND absolute cap 1MiB, with smaller validated configured limits allowed. Candidate refs are parsed by the accepted default resourceRefSchema (URI max512) before reservation/approval. These new lifetime/input ceilings are explicit plan-gate values, not changed P01 limits. Reuse accepted role/ref/identifier budgets; do not alias registry/reference caps. Check all counts/bytes before deep capture and reject capacity before deleting a record for disposal.

## 8. RED/GREEN execution and concrete acceptance controls

After required acceptances, implement thin slices with exact focused RED evidence before edits, then GREEN, scope check and relevant old regressions. Two failed repairs of one criterion -> stop with reproducer. No runtime commands have been run for this plan.

1. **Conditional removal amendment first:** positive/negative scoped stale tests in the new removal suite; minimal P03 patch, rerun all authorization/toolPolicy tests. Owner-preserving startup failure cannot be implemented safely without this prerequisite.
2. **Immutable registration/capability capture:** exact registered identity/provider/template/parser callbacks and protected legacy-role rejection; tests mutate original registrations, callback properties, schemas and provider methods after capture, and during a parked prepare. No later mutation widens authority. No serialized policy callbacks/template inventories.
3. **Reservations + explicit approval:** new protected factory method, currentness, timeout/cancellation/reentrant final guard and no grant defaults. Duplicate URI, unknown type/provider/disabled/ambiguous header denial and no callback on invalid selection. No invoke/namespace/GrantIssuer fallback.
4. **Atomic attach/rollback:** actual resource/owner/bootstrap install transaction; intentional second-binding failure, resource install failure, record add failure and collision guards. Verify before first publication/backend, not only final cleanup. URI reusable afterward, incumbent/successor untouched.
5. **Backend failure + disposal/owner projection:** withdraw bootstrap before creationFailed, preserve owner/failed record; exact marker and late backend lifecycle; read-only work domain projection. Keep old private canonical lifecycle tests alongside protected controls.
6. **Public create only:** actual P04 contextual facade path, close cancellation, null reply, no snapshots/subscription/tool openings, real owner/work comparisons; final integration source remains fail-closed without configured capability.

| ID | Proposed actual test names / distinguishing evidence |
| --- | --- |
| **S01** | `S01 senior owner and junior participant keep distinct subjects and scoped roles`: Alice explicitly creates ready session; Bob's separate trusted test binding is installed after ready, both real P03 evaluations use their own complete paths; owner/projection remain Alice. Real WorkService Alice submit succeeds, Bob submit rejects using Bob (never Alice) as principal. No P05 participant issuer. |
| **S02** | `S02 creation and exact bootstrap require explicit registered capability approval`; `S02 invoke allow and namespace membership cannot authorize creation`; `S02 unknown disabled ambiguous type or wrong provider has zero creation effects`; `S02 copied approval or extra actor owner roles policies scope cannot escape the registered template`; `S02 global role cannot grant or filter protected creation`. Include valid direct/no-namespace type+callback+template control, optional no-template explicit approval, and forged JSON authorities. Assert zero record/resource/binding/event/provider on denial, not an already-invalid positive. |
| **S03** | `S03 publication observes committed record resource owner and every bootstrap binding`; `S03 partial binding installation rolls back only the candidate before publication`; `S03 resource or record failure leaves no usable instance and URI is reusable`. Inject actual later-install failure after earlier success. Verify canonical owner absent, grant evaluation denies, no event/backend, other instance untouched. |
| **S04** | `S04 concurrent same-URI prepare holds one invisible reservation`; `S04 cancel timeout stop and factory reuse cannot attach late approval`; `S04 stale prepare backend failure and disposal completion cannot touch a same-URI successor`; `S04 old conditional binding removal and old settle token are no-ops for successor`. Include same-subject and different-owner successors; new instance IDs, current resource/owner/bindings/stamps preserved; no detached old ready/count/failure action. Stop must not wait indefinitely for an ignored signal. |
| **S05** | `S05 ready lifecycle preserves order with canonical work owner lookup`; `S05 inspectable startup failure retains owner but withdraws bootstrap before failure publication`; `S05 backend disposal failure clears only the exact settle marker`; `S05 no live record means no work owner even during settlement`; `S05 public creation success never returns snapshots or tools`. Assert genuine bootstrap operation allow before rejection, old decision stale afterward, binding/assignment removal, immutable owner still present and no participant issuance into failed record. |

Retain existing exact `createSession: lifecycle` ready/failure/sanitized error/sequence controls, `createSession: attach hook` live-at-attach and throw rollback, config/provider/working-directory tests, and exact type disabled/existing revision tests. The old header-enum helper remains registry-backed, not a parser guessing revision identities.

The existing private websocket disposal tests cover owner-map settle windows and failing legacy `unbind`; preserve them as **legacy/internal** evidence, not canonical projection certification. Protected flow has no writable owner `unbind` to inject. Add corresponding protected resource/marker/backend-failure tests rather than faking mutation methods onto the lookup or rewriting old expectations. Existing work tests remain unchanged because SessionOwnerRegistry structurally extends SessionOwnerLookup.

## 9. Gate, migration and downstream impact

Proposed implementation checks (not run): targeted ESLint `--max-warnings 0`; typecheck; new creation/removal suites plus existing sessions/authorization/toolPolicy/work and exact disposal regressions; unmocked public P04/P05 tests alongside private canonical fixtures; docs mapping; final full DB-safe `pnpm validate`. Use established child DB/auth/provider exclusions; no services or packages to green the gate.

API additions are local and explicit: trusted type policy registration, optional SDK factory authorization output capability, optional contextual application helper, optional immutable record resource, read-only WorkService owner dependency and conditional P03 removal. No ToolOperation/PolicyEvaluator/GrantIssuer schema change, namespace resolution grant, new wire version or unsafe-mode flag. Failed/ownerless startup is not “repaired” by teardown/reinstall. Global role and old role-bearing tool filters are rejected in protected configuration rather than silently running alongside the new authority path.

P06 must use exact availability/instance checks before participant issuance and fresh IDs/advancing revisions on reissue; it may reuse conditional removal but still owns delegation/lineage/issuer authorization. P09 must evaluate actual caller/executor and resource readiness; canonical owner existence is not readiness or invoke permission. P10/P12 must implement recipient views and actual authorized SDK/reducer tests; public creation's `null` reply is not permission to return raw canonical snapshots/tools. P04 initial scoped fact reads remain trusted adapter composition; do not manufacture an unscoped reader to expose new private bootstrap receipts. Any later canonical BindingResolver read surface is a separately reviewed integration decision, not a second P05 grant cache.

**Dependency/plan gates satisfied:** P04 accepted; P05 authorization and amended plan recheck PASS; both exact P03 additions approved. Execute only this amended write set. If any additional shared API or fixture scope is needed, stop for an exact lead amendment. Freeze/notify w8:p2 after bounded P05 handoff; no P06 implementation until P05 acceptance.

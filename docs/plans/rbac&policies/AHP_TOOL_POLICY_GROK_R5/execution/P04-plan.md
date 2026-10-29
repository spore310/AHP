# P04 implementation plan — trusted connection setup, protected output deferred

**Status: EXECUTION AUTHORIZED by `P04-authorization.md` (lead plan gate PASS).** Read that amendment and `P04-plan-review.md` with this plan; the amendment wins. Sol is sole P04 writer. User has authorized the remaining R5 sequence; do not ask the user again. Implementation starts only after w8:p2 accepts this plan, including the narrowly identified write-set/test-migration decisions below. P03 is accepted, not reopened.

**Superseding accepted correction:** `P04-sequence-resolution.md` and its PASS recheck tighten all earlier anonymous-success language below. Native InitializeResult requires the genuine shared current serverSeq. Public initialize therefore requires live verified setup with trusted `PreparedInitialScopes.allowGlobalSequence === true`, captured in its snapshot and covered by the same expiry/currentness/release guard. Missing/false/malformed/wire-provided permission never authorizes it. Deny before the kernel/sequence getter, never fabricate zero or omit the required field. Authorized initialize still returns the real canonical cursor and empty snapshots; that capability explicitly permits observing host-wide activity, not resource counts, snapshots or tools. Existing anonymous-positive wording/test plans below are historical and superseded, not a fallback. P05 plan is handed off separately; only this P04 correction is executing.

**Goal:** compose early, bounded, application-injected identity/actor/initial scoped authority independently of agentWork/SQL; attach only current setup to the exact live connection; never equate successful authentication/native initialization with permission to disclose canonical state.

**Architecture:** reuse unchanged P01 ports and accepted P03 facts. Add a host/transport-local setup adapter supplying trusted initial scope selectors and a synchronous currentness guard. Asynchronous preparation reads existing facts; final synchronous attach stores a connection-local immutable snapshot, not new grants/resources. Until P10 supplies a safe recipient view, protected native reads/delivery remain deferred/denied.

**Toolchain:** existing pinned TypeScript/Node/ws/Zod/Vitest only. No installs, model/account changes, children, live DB/services, commits, worktrees, reset/stash, or unrelated edits.

## 1. Verified starting evidence

Read: current repository instructions/CodingRules and delivery/planning/documentation skills; `P04-preflight.md`, P04 packet, CONTRACT_CARD, AUTHORITY, DELIVERY_WIRE; P03 accepted handoff and actual types/APIs; P05 and INTEGRATION only for direct downstream implications.

Base remains `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe`. Dirty/untracked accepted source and plan bundle, plus `nul`, remain intact. Read-only verification during planning: **56/56 P03 manifest entries match**, no mismatches; manifest SHA-256 `fa567a9c5558f0c3250d4460ab35846bb7a9e4f6bd818fbf520176cf27c98497`. No runtime checks were run for this plan; P03 gate results are predecessor evidence, not P04 evidence.

Observed live paths:

| Source/symbol | Current behavior / constraint |
| --- | --- |
| `src/index.ts:createAgentWorkOptions/main` | Environment convenience wiring requires both DB URL and tokens; not a generic security API. Must not make this helper the security composition source. Imports are inert. |
| `src/websocket/helpers/host/{types,helpers}.ts:createAHPServer` | Authenticator currently comes only from agentWork. Host creates sessions, owner registry, optional directory/work service, binding and transport. Keep stop/disposal ordering and ownership. |
| `src/websocket/helpers/server.ts:createWebSocketServer` | Socket pauses for asynchronous authentication, then attaches handlers and resumes. Authentication has no deadline/currentness context; close is checked before establishment. |
| `src/websocket/helpers/connection.ts:attachConnection` | Mints UUID too late for actor resolution today. Owns bounded frame queue, deferred completion correlation, per-invocation settlement and exact-once close handlers. Reserve identity before setup, do not rewrite the frame pump. |
| `src/websocket/helpers/ahp/helpers.ts:initialize/subscribe/listSessions/beforeDispatch/publish` | Builds raw snapshots before subscription reply commit; repeated subscribe returns raw snapshot too; root includes agents/counts. A phase barrier alone does not make these safe. |
| `src/websocket/helpers/ahp/agentWork.ts` | Principal comes from handshake, agent work context from live directory presence; owner equality remains separate. Registration currently binds presence only after its repository await. Do not infer user from absent presence. |
| `src/agents/types.ts`, `helpers/{authenticator,directory}.ts` | Old authenticator returns subject only. Directory generations/presence are distinct from transport setup generation. Registration rows have no P01 executor registration revision: do not invent one here. |
| `src/authorization/types.ts` | `SecurityComposition`, `ActorResolver`, `BindingResolver.read({actor,scope,grantRevision})`, resource/freshness ports already accepted. No unscoped read, cancellation parameter, or setup attachment API exists. |
| `src/authorization/helpers/evaluate/types.ts:ReferenceAuthorizer` | Trusted install methods are administration, not issuance. No grant-revision getter, atomic install batch, or individual binding rollback exists. Therefore connection setup must not perform a speculative batch of shared P03 installs. |
| `src/sessions/createSession/helpers.ts:executeCreateSession` | Existing synchronous record-attach hook precedes publication/backend start. P05 owns protected creation/owner/bootstrap integration, not P04. |

## 2. Decisions and rejected alternatives

**Chosen:** application-selected existing scopes + existing scoped binding reads + connection-local attach. Resources/bindings must already exist in the application's trusted source/registered kernel before connection setup. Zero supplied scopes is a valid **empty authority** result, not a grant. Identity alone is not permission.

Rejected: (a) unscoped binding reads or a synthetic root/session grant; (b) installing a batch into shared P03 and using `teardown()` as rollback (could destroy another connection's real resource); (c) returning raw snapshots once auth resolves; (d) calling namespace `select()` to manufacture authority; (e) adding a broad P04 projection engine to bypass P10.

### Exact additive P04-local option/type proposal

These types live in a new `src/websocket/helpers/security/types.ts`, exported through the websocket boundary. Existing P01 contracts are imported, not edited. Names/signatures below are proposed exact implementation targets, subject to lead gate.

```ts
import type {
  ResourceRef, ResourceResolution, ScopedPolicyBinding,
  SecurityComposition, TrustedRequestContext,
} from "@authorization";

export interface ConnectionFence {
  readonly connectionId: string;
  readonly connectionGeneration: number;
}

export interface InitialBindingScope {
  readonly scope: ResourceRef;
  readonly grantRevision: number;
}

/** Trusted application fact; functions stay private, never go on the wire. */
export interface PreparedInitialScopes {
  readonly scopes: readonly InitialBindingScope[];
  readonly allowGlobalSequence?: boolean; // accepted metadata amendment; default false
  readonly validUntil: number; // finite absolute wall-clock milliseconds
  /** Pure synchronous local check; exceptions mean false. */
  isCurrent(): boolean;
  /** Idempotent synchronous release of this preparation's reservations only. */
  release(): void;
}

export interface InitialAuthoritySource {
  prepare(input: {
    readonly context: TrustedRequestContext;
    readonly fence: ConnectionFence;
    readonly signal: AbortSignal;
  }): Promise<PreparedInitialScopes>;
}

export interface InitialScopeAuthority {
  readonly scope: ResourceRef;
  readonly grantRevision: number;
  readonly resolution: ResourceResolution;
  readonly bindings: readonly ScopedPolicyBinding[];
}

export interface ConnectionSecuritySnapshot {
  readonly context: TrustedRequestContext;
  readonly fence: ConnectionFence;
  readonly scopes: readonly InitialScopeAuthority[];
  readonly allowGlobalSequence: boolean;
  readonly validUntil: number;
}

export interface AHPServerSecurityOptions {
  readonly composition: SecurityComposition;
  readonly initialAuthority: InitialAuthoritySource;
  readonly setupDeadlineMs?: number;
  readonly maxInitialScopes?: number;
  readonly maxInitialBindings?: number; // total, not per-scope multiplication
  readonly maxInitialSubscriptions?: number;
  readonly now?: () => number; // capture once; default Date.now
  /** Required when security is composed with subject-only durable work. */
  readonly workDomainId?: string;
}
```

Add `readonly security?: AHPServerSecurityOptions` to `AHPServerOptions`. Absence never selects a raw protected-output fallback. The env helper remains an optional durable-work convenience, not a required dependency of this new option. No new env variables in P04.

Transport-local surface (same new security leaf, re-exported as needed):

```ts
export interface PreparedConnectionSetup {
  readonly snapshot: ConnectionSecuritySnapshot;
  isCurrent(): boolean;
  release(): void;
}

export interface ConnectionSetupAdapter {
  prepare(input: {
    readonly handshake: TrustedHandshakeContext;
    readonly fence: ConnectionFence;
    readonly authRevision: string;
    readonly signal: AbortSignal;
  }): Promise<PreparedConnectionSetup | undefined>;
}
```

`TrustedHandshakeContext` remains the existing agents type. Add optional `connectionSetup?: ConnectionSetupAdapter` to `WebSocketServerOptions`, mutually exclusive with its legacy `authenticator` option (composition resolves the single source first). Add immutable `connectionGeneration: number`, optional `security?: ConnectionSecuritySnapshot`, and `isSecurityCurrent(): boolean` to `WebSocketConnectionContext`. No callable adapter/credentials appear in snapshots or wire JSON. `isSecurityCurrent()` returns false when setup is absent, stale, released, expired, closed, or from another fence; it never calls an async port.

`attachConnection` accepts an appended optional internal attachment argument carrying the preallocated fence, prepared snapshot/currentness/release references. Existing legacy callers retain their positional principal argument. The composed host always uses the fenced path. No second mutable identity slot or in-place actor reassignment.

### Minimal trusted initial setup algorithm

1. Application registers actual resources/incarnations, policies and bindings using its trusted existing sources/P03 administration before accepting protected setup. It supplies `initialAuthority.prepare` to select only those existing scopes and exact query revisions for the actual trusted context. It does not receive `initialize`, `clientId`, kind, roles, arbitrary URIs, or requested subscriptions. Selection is application policy, not client intent.
2. Reserve a fresh transport UUID, monotonically increasing safe-integer generation (fail closed before overflow), auth revision token and AbortController **before any authentication await**. Freeze/copy bounded handshake headers. Setup state is `pending`, later `attached` or terminal `cancelled`; it cannot transition back.
3. Authenticate once via the chosen identity adapter. Validate domain/subject with accepted schemas. Undefined credential yields no security snapshot and no protected authority; thrown/rejected/malformed credentials close only that connection with a generic reason. Never synthesize a user.
4. Call existing `actors.resolve({principal,connectionId,authRevision})`. Validate/freeze result using existing context/identity schemas. Exact principal domain/subject, connectionId and authRevision must match the request. Delegation is trusted resolver output, never a wire claim. Explicit user classification must be positively established by that adapter. Agent classification remains agent when presence is missing; no downgrade to user.
5. `initialAuthority.prepare` returns bounded existing scopes, finite deadline and local currentness/release closures. Capture the methods once and validate/copy the data, not the executable object. Duplicate full scopes with conflicting revisions reject; no URI-prefix matching. Initial scopes must be in the verified principal's domain in P04 (cross-domain delegation remains a later explicit adapter concern).
6. For each scope call `resources.resolve({domainId,kind,id})`; require the exact full returned resource including instanceId to equal the trusted seed. Then call **`bindings.read({actor: context.actor, scope: seed.scope, grantRevision: seed.grantRevision})`**. Reuse accepted binding schemas, verify every returned actor/scope exactly, reject expired/conflicting/oversized facts; do not merge fragments or invent roles. Preserve admission/mandatory resource facts separately. No caller-chosen scope reaches this flow. Empty reads remain empty authority.
7. Capture `freshness.current(domainId)` before/after the scoped reads; invalidated notices, nonfinite/expired deadlines or revision change deny setup. Do not assume the domain freshness revision equals each scope's grant revision: the seed's synchronous guard must cover those exact grant/resource/actor facts. Every await is inside the same bounded setup deadline; no automatic retry loop.
8. Finish with a deeply frozen plain snapshot. Its deadline is the minimum of seed deadline, applicable binding expiries, freshness deadline if present, and `now()+DEFAULT_DECISION_TTL_MS` (accepted 60s cap). This is freshness for **captured setup facts**, not an allow decision or a P03-issued stamp. No grant/resource install, `GrantIssuer.commit`, descriptor materialization or native subscription happens here.
9. Immediately before attach: check exact live socket/reservation/fence, abort state, overall deadline, actor/domain/identity match, snapshot expiry, captured local seed guard, and any locally established agent fence. **No await between final checks and attaching context/handlers/onConnection.** Attach the snapshot to the connection only. Nothing is published into shared resource/grant state.
10. Keep the seed guard/release private for subsequent currentness. Closing, expiry or invalidation disables protected dispatch immediately; release is called exactly once by host orchestration (adapter must also tolerate repeated defensive release). Shared canonical resources/bindings are not torn down when a connection closes.

`PreparedInitialScopes.isCurrent()` is an explicit new application obligation: synchronous, side-effect-free, checks the exact captured actor/scopes/query revisions/relationships against current locally mirrored facts, false on invalidation. An adapter unable to provide that local check must return no initial protected authority; it cannot claim instantaneous remote revocation. External freshness remains bounded by the explicit deadlines. P03 `matches()` may be used by an application that actually captured issued decisions; P04 must not fabricate such stamps.

### Actual registered-agent classification

The accepted ActorResolver is the authority for actual actor class. Require an agent's returned `agentGeneration` to be a positive safe integer before treating its setup as usable for protected agent operations. Its source/seed guard must positively verify registered-agent membership and current generation; no client labels or missing-directory fallback. Non-DB applications may implement that source with an explicit finite in-memory registration fixture, not an allow-all resolver.

Where the existing AgentDirectory has a binding, require exact subject, agentId, reserved connectionId and generation agreement. A missing/expired required directory binding means **pending/denied protected agent authority**, never human. P04 does not mint executor registration revisions from directory rows, bind a different connection, modify registration rows, or bypass `authorizedAgentContext`/owner checks. Existing native registration/presence lifecycle stays its own authenticated operation. P09 must settle agent-registration-to-execution admission/currentness; no initial agent kind by itself enables tools in P04. No in-place credential/actor rebind is introduced: close/reconnect gets a new transport generation/auth revision and reruns setup.

## 3. One authenticator and subject-only work bridge

Add an explicit bridge helper in `src/agents/helpers/policyIdentity/{types,helpers,index}.ts`, exported from agents:

```ts
export interface LegacyIdentityAdapterOptions {
  readonly authenticator: ConnectionAuthenticator;
  readonly domainId: string;
}
export function createLegacyConnectionIdentityAdapter(
  options: LegacyIdentityAdapterOptions,
): ConnectionIdentityAdapter;
```

It captures/validates domainId once and maps only `{subject}` from that exact authenticator into `{domainId,subject}`. It never classifies user/agent. A module-private WeakMap records bridge adapter -> exact legacy authenticator/domain. An internal leaf lookup (not a new P01 field) permits host construction to verify provenance; copying a structural `.source` property is insufficient.

Construction rules, checked before acquiring sessions/listeners/persistence ownership:

- security only: use `security.composition.identity`, independent of agentWork/DB;
- security + agentWork: identity must be the explicit verified bridge over **`=== agentWork.authenticator`**, with `workDomainId` exactly the captured bridge domain; otherwise throw configuration conflict. Never call both sources or accept whichever authenticates;
- agentWork only: its subject-only authenticator supplies no metadata permission or new policy actor/grant. Public native initialize (and thus ready-phase AHP work RPCs) requires the explicit verified bridge/setup and global-cursor permission. The underlying work service remains subject-/presence-/owner-checked; no raw protocol fallback is added;
- neither: native initialize is denied before reading the global cursor; no ready protocol state or protected assignments are created;
- transport-level `connectionSetup` + legacy `authenticator`: reject at construction, not last-wins.

Project `context.principal={subject: security.context.actor.principal.subject}` into legacy work **only after domain equality and all setup checks**. Do not encode arbitrary domains into the old subject column or substitute the owner. Reject multi-domain durable-work composition in this packet; no permissive configurable `globallyUnique=true` assertion. Existing work lease, subject equality and directory presence checks remain unchanged. P05 must replace the composed host's independently writable owner map with a canonical owner projection before enabling protected creation; P04 denies that creation path instead of introducing a conflicting owner source.

## 4. Native setup is not disclosure; P10 deferral

**P04 supplies no recipient projection implementation and no `authorizeAll`, `legacyUnsafe`, raw-snapshot callback or fallback flag.** Setup readiness is a prerequisite, not sufficient permission for any protected native output.

- Minimal `initialize` with absent/empty initialSubscriptions negotiates only after live verified setup explicitly authorizes global-sequence disclosure. It returns the genuine current `serverSeq` and `snapshots: []`, then commits protocol readiness only on that invocation's successful reply enqueue. No principal, scopes, proofs, private tool metadata or internal catalogue are returned.
- A nonempty `initialSubscriptions` request is bounded **before deep parsing/copy/deduplication** and rejected generically before snapshot lookup, `beginPending`, subscription changes or backend calls. Failed initialization can retry the minimal form. Unknown and known protected URIs are indistinguishable here. Unsupported-version and malformed-request semantics stay typed and safe.
- `subscribe` including repeat subscribe, root/list/counts, session snapshots, protected dispatch/create/dispose and legacy tool invocation/completion must not find another raw route after minimal initialization. With no current explicit resource-authorization/projected-view path implemented in P04, these protected handlers fail closed before effects/lookup. P05/P09/P10 will enable their own admitted paths, not fall through to old ones.
- Existing work extension operations retain their separate current explicit principal/owner/presence checks; native session/tool permission must never be inferred from their existence. If their required current setup/domain checks fail, deny before handlers.
- No protected subscription commits, so raw catalogue/session payloads cannot be buffered/replayed as an auth completion side effect. Preserve reply settlement, pending buffer cleanup, close and deferred completion algorithms, not the unsafe assumption that every native peer can receive canonical payloads. P10 must supply actual recipient projections and last-send checks before these deliveries reopen.
- In-process `host.sessions` remains an explicitly trusted kernel capability, not a client endpoint or a substitute permission check. No network route can invoke it as fallback.

### Resolved integration boundary — accepted amendment

Current wire regressions assume the old unauthenticated/raw behavior: `ahp.test.ts` helper always requests root subscription; `keeps a root subscriber registered until close`, `delivers a post-snapshot action once after the subscribe reply`, and other positive fan-out cases require canonical output. `sdk.test.ts:lets two SDK clients observe the same created session and one rename` and `toolInvocation.test.ts:lists matching full schemas to two SDK subscribers, advertises, executes locally and keeps payloads private` require unfinished P09/P10 behavior. Adding setup alone cannot truthfully make these secure positives.

**Do not keep them green by treating standalone createAHPBinding/createWebSocketServer callers, missing security, or a fake allow-all context as privileged wire bypasses. Do not skip/delete/weaken these assertions.** The packet's original new-test-only write list is insufficient for a globally fail-closed wire transition while preserving all old positive expectations.

Before execution, lead must approve the exact migration boundary/write-set amendment: retain those positive tests against a genuinely authorized explicit resource/view path when that dependency exists, or sequence the protected wire activation with P09/P10 while P04 establishes the setup barrier and denies protected setup outputs. If the latter permits any temporary old wire route, it must not be reachable in composed protected hosts, and must not be described as secure or be selected by missing config. Merely labeling a raw external route a “trusted fixture” is not a solution.

Recommended gate: **accept the initial scoped setup contract now, but resolve this coupled test/activation boundary explicitly before implementation acceptance.** No P10 projection API or compatibility escape is silently designed in this plan. If the lead requires full all-host protected denial in P04, the affected positive wire tests need a coordinated P09/P10 dependency step; a green final gate cannot honestly be promised by P04 alone. This is a concrete known compatibility blocker, not permission to loosen checks or claim intentional failures as passing validation.

## 5. Bounds, cancellation and lifecycle

- `setupDeadlineMs`: integer 1..`POLICY_LIMIT_ABSOLUTE.asyncHookDeadlineMs` (60,000); default `POLICY_LIMIT_DEFAULTS.asyncHookDeadlineMs` (5,000). Capture once. One total timer covers identity, actor, scope, resource, binding and freshness awaits; timer/abort cleanup in `finally`. Do not reset a full deadline per hook.
- Initial scopes/total bindings/subscriptions: separate P04-local positive integer limits, default 128, absolute 1024, not maxPolicyRefs/registry counts. Validate count before clone/parse/iteration; applicable identity/ref/role arrays use existing schemas/limits. Capture options once. Subscriptions count includes duplicates before deduplication to prevent bypass.
- Before setup attaches, register socket close/error and server-stop cancellation. Keep paused-frame behavior; bounded payload and deadline remain active. No handler may process the immediate initialize while setup is pending. Heartbeat must not incorrectly terminate a legitimate pending setup before its own configured deadline; mark liveness/register pong at acceptance while withholding dispatch.
- Timeout/disconnect/stop marks the attempt terminal, aborts the local signal, clears timer, drops context references and releases only connection-owned preparations. Observe late rejected promises; a late returned seed/prepared object is released, not attached. Do not await an uncooperative external callback forever during stop. AbortSignal is on the **local** prepare seam only; P01 ports are not silently changed to accept it.
- Setup failures are connection-local, safe/generic and contain exceptions; no headers/tokens/raw principal details in diagnostics. Synchronous currentness/release throws are contained/fail closed.
- Final checks/attach have no await. Close before reply settlement cannot add subscriptions. Frame pump, per-invocation settlement, maximum queued frames and matching-completion-only bypass stay unchanged except plumbing the preallocated attachment. A stale connection cannot release successor presence/setup.
- Rebind is new connection + new auth revision/generation, not mutation of a ready context. P05/P09/P10 must pass and verify this same fence at every later admission/delivery.

## 6. Bounded proposed write set (after lead gate only)

| Paths | Purpose / scope |
| --- | --- |
| `src/websocket/helpers/host/{types,helpers,index}.ts`, `src/websocket/index.ts` | Add/export host security option; validate one source/domain before constructing resources; compose setup and protected-output barrier. |
| `src/websocket/{types.ts}`, `helpers/server.ts` | Setup adapter option, immutable fence/currentness context, deadline/cancel/late-completion lifecycle. |
| `src/websocket/helpers/connection.ts` | **Explicit packet write-set amendment required**: accept preallocated attachment/fence; preserve frame/reply/deferred/close algorithms. Impossible to resolve actor against actual connectionId before attach otherwise. |
| `src/websocket/helpers/security/{types,constants,helpers,index}.ts` (new) | Local scoped setup orchestration/validation/captured limits; no new shared IAM ports. |
| `src/websocket/helpers/ahp/{types,helpers,index}.ts` | Initialization context/count barrier and coarse protected-output deferral; no projection implementation. Do not rewrite session/provider/work logic. |
| `src/agents/{types,index}.ts`, `helpers/policyIdentity/{types,helpers,index}.ts` (new) | Explicit subject-domain bridge/provenance and trusted actor result validation; no directory persistence changes. |
| `src/tests/websocket/policyInitialization.test.ts`, `src/tests/agents/policyActor.test.ts` (new) | Distinguishing I01–I05 tests below. |
| `src/websocket/README.md`, `src/agents/README.md`, `src/tests/README.md` | Source maps and honest protected-setup/deferred-output behavior only. |
| Existing affected wire tests, if amended | **Not pre-authorized by this plan**: resolve the blocker in section 4 and list exact fixture/expectation migration before writes; no bulk green-by-anonymous fixtures. |

Read-only in P04: all P01/P02/P03 accepted production/contracts/tests, directory/work/persistence implementation, session creation/owner bootstrap (P05), execution dispatcher (P09), projection/reducer/wire implementation (P10), env/process composition (`src/index.ts` inspected, no new env coupling), package/lockfiles. Any necessary accepted-file change stops for an exact amendment first. No ledger or acceptance edits by Sol; lead owns those.

## 7. Ordered execution slices and proposed distinguishing tests

Each slice: add RED test first; run focused test; smallest authorized implementation; rerun same test + relevant regressions; inspect scope. After two failed repairs of a criterion, stop with reproducer. No broad patch loop or full release gate while genuine security RED remains.

1. **One-source bridge/config validation.** Implement local bridge and construction conflict rules; no socket opens before validation. Tests: `I04 rejects distinct security and legacy authenticators before composition effects`; `I04 invokes the exact explicit bridge source once and preserves subject/domain`; `I04 bad credentials and throws affect only their connection`; `I04 rejects cross-domain subject projection when work is enabled`.
2. **Trusted actor/scoped seed preparation.** Tests: `I02 attaches explicit current initial scopes/bindings with security only and no agentWork`; fixture uses finite maps + real accepted P03 direct binding/resource installs, not an allow-all evaluator. Assert read query exactly equals actual actor + full scope + supplied grantRevision. `I02 empty scope seed performs no unscoped binding reads or synthetic installs`; `I02 wrong actor/scope/incarnation, changed revision and invalidated seed deny without partial attach`. Assert no `grants.prepare/commit`, no resolver select, no session creation and no shared registry teardown. User and registered-agent fixture positives remain distinct.
3. **Reserved connection fence + setup deadline.** `I01 holds immediate initialize/initialSubscriptions while identity is parked`; second case parks authority after identity resolves. Sentinel catalogue/tools/session data exist but no reply/protected frame/backend/subscribe effect occurs. Release succeeds only into a safe minimal setup or explicit deferred denial, never raw snapshots. `I05 timeout closes/releases once and late completion cannot attach`; fake timers with explicit cleanup and positive within-deadline control; no sleeps.
4. **Native readiness/disclosure separation.** `I01 authenticated setup still denies raw protected initialSubscriptions`; `I01 minimal initialize yields no snapshots and creates no protected subscription`; repeat-subscribe/list/root-count/tool legacy requests cannot bypass deferral. `I01 failed reply/close cannot commit pending subscriptions`. Use actual sentinel snapshot getters and event publications; count zero protected getter/effects rather than merely accepting empty output from missing authority. Unsupported-version/method-kind ordering stays tested.
5. **Classification and lifecycle.** `I03 spoofed clientId/kind/role cannot alter the trusted actor`; explicit verified-user and registered-agent controls; missing/expired agent verification stays agent pending/denied, never human/admin. `I05 disconnect while preparation is parked releases late facts without admission`; `I05 reconnect/rebind uses a different transport generation/authRevision and cannot reuse old snapshot`; `I05 stale old cleanup cannot release replacement directory presence`. Preserve actual directory ownership/generation checks, not fake executor contexts.
6. **Boundaries and regression integration.** At-limit/one-over setup scopes, total bindings and initialSubscriptions; invalid/nonfinite/fractional limits; mutation after construction cannot widen counts/deadline; duplicate subscription list still counted. Add currentness change between final async resolution and synchronous attach; local guard false/throws denies. Test setup stop/abort while callback never settles and throwing release cleanup. Resolve section 4 migration scope before asserting the full wire regression gate can pass.

The plan preserves I01–I05 as distinguishing obligations, not recorded passes. Exact final test names/counts and all failure results go into the implementation handoff; no test file absent/skipped is evidence.

## 8. Downstream amendment impact (P05 onward)

- **P01/P02/P03:** no signature/schema/limit/behavior amendment proposed. P04-local interfaces compose them; do not add unscoped reads, public P03 grant-revision getters, install batching, or transport fields to shared `TrustedRequestContext`. Connection generation stays local alongside that context.
- **P05:** consume prepared/current connection snapshot, not subject/clientId alone; authorize creation against actual trusted actor. P05 performs its own async prepare followed by instance/owner/bootstrap atomic attach, and canonical owner projection for work. Initial scope setup does not create future sessions. Reserved connection fence propagates into creation checks.
- **P06:** issuance remains separate explicit authority; setup `bindings.read` is never `GrantIssuer` issuance. No owner promotion/default role inherited from setup.
- **P07–P09:** client/dispatcher wiring must take actual caller context + transport generation, preserve executor as separate fence, and deny legacy paths while new admission is absent. Real agent registration/currentness must be resolved before execution; no directory generation relabelled as registration revision.
- **P10:** owns a real per-recipient native/assignment view and reducer coherence. It may lift the protected-output deferral only with explicit scoped resource authorization, currentness at final send, exact-instance routing and safe buffers/counts. Do not reuse “setup ready” as a view permission.
- **P11–P12:** transport credential injection uses the single chosen identity source; SDK initialization starts minimal without protected initialSubscriptions; later negotiate/admit/subscribe through P10. Updated wire regressions must have genuinely finite recipient authority, not raw legacy defaults.

Public additions must be recorded with the accepted P04 gate/handoff. Leaf imports must avoid another authorization/websocket/agents barrel cycle. The new bridge helper does not widen `ConnectionAuthenticator`, and AbortSignal does not change P01 port signatures.

## 9. Verification/handoff and gate request

Implementation-only checks (not run during this planning phase): targeted ESLint with `--max-warnings 0`; `pnpm typecheck`; focused new initialization/actor suites plus authenticator, directory and relevant connection/deferred/owner cleanup regressions; all authorization/toolPolicy regressions to demonstrate P03 unchanged; `pnpm docs:check`; final DB-safe `pnpm validate` after blocker resolution. Never weaken thresholds or skip former wire tests to green a partial privacy rollout.

Use the existing child DB/auth/provider exclusions, record variable names not values. No live DB/services, no dependency/provider installs. Verify accepted P03 manifest again before/after implementation; any changed accepted path requires explicit recorded reason. Lead owns ledger/acceptance and final integrated review/gate.

**Accepted decision:** `P04-authorization.md` resolves section 4: move canonical mechanics into an internal kernel, keep every supported AHP binding/alias/host a fail-closed facade, migrate only imports/construction/evidence labels in `ahp.test.ts`, `sdk.test.ts`, and `toolInvocation.test.ts`, retaining all assertions. No public raw export, option, or no-config fallback. Add genuine public host/facade safe positives and protected negatives. P12 remains actual authorized SDK evidence. This amendment supersedes the historical blocker narrative and the 'not pre-authorized' test/write-set wording above. The new internal kernel files and these exact three test migrations are approved; no other test migration is implied.

Historical gate request: initial trusted scoped setup seam is specified without unscoped reads or invented grants/resources. Lead must gate (1) additive local public types + bridge/currentness obligations, (2) the required `connection.ts`/export write-set amendment, and (3) the explicit P04/P09/P10 protected-wire test/activation dependency in section 4. Until that last compatibility boundary is decided, implementation acceptance/full-green P04 is blocked; Sol must not invent an unsafe fallback or silently expand into projection. Notify w8:p2 with this exact plan path and pause. Only this plan file was written in the planning turn.

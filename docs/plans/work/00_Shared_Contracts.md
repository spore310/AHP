# Agent Hosting Protocol V1 — shared contract decisions

**Status:** target contracts for P0–P5, not implemented APIs.  
**Baseline:** `spore310/AHP`, `develop`, commit `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Execution order:** P0 → P1 → P2 → P3 → P4 → P5. P5 is an explicit ownership cleanup, not a prerequisite for P0–P4.  
**Mode of this deliverable:** planning and review only. Examples below specify shapes and semantics; the coding agent must integrate them into the named existing modules.

## 1. Decisions that must remain true

- All new private work/resource contracts are **V1**. The existing private tool protocol currently labels itself v2; P5 deliberately relabels its one supported shape V1 and removes production compatibility paths. Microsoft's package/protocol version is a separate axis and remains pinned.
- Server authority remains in authorization, sessions and work. Consumers define data, policies, providers and external execution. No model runtime, worker execution engine, broker deployment or scheduler service is added.
- The synchronous `SessionRegistry` stays a live cache. Durable ports are asynchronous. SQL records are durable facts, never serialized authorization receipts.
- One authoritative host owns a logical persistence store in this stage. Multiple adapter pools belonging to that host are supported; active/active hosts are not. A store-scoped ownership lock and monotonically increasing host epoch enforce this operating boundary.
- A session/resource incarnation is immutable. URI reuse creates a new incarnation, with no inheritance of old work, bindings, data or ownership.
- Resource containment and grant inheritance are distinct. Existing edges are immutable in V1. Both graphs, including their combined cleanup dependencies, must remain acyclic and within the same session/domain.
- `scope` and `announce` are selection ceilings, not grants. Current authorization is always required. A provider-created resource beneath a selected parent becomes eligible only under current policy.
- Work submission is immutable and idempotent. Work `data` is independently mutable with compare-and-swap. Submission retries compare `submitted_data`, never current `data`.
- Successful durable mutation precedes live-state installation and publication. A diagnostic/publication failure cannot change a committed command into an apparent rollback.
- At-least-once external execution is possible after an expired lease. Work IDs and application idempotency keys must protect external side effects; a SQL lease cannot undo an external effect.

## 2. Current source anchors

All paths in the packets are repository-relative and refer to the pinned baseline.

| Boundary | Source of current truth |
| --- | --- |
| Session cache, provider/backend, synchronous dispatch | `src/sessions/types.ts`; `helpers/factory/helpers.ts`; `helpers/state/helpers.ts` |
| Creation policy capture and installation receipts | `src/sessions/helpers/creation/{types,helpers}.ts` |
| Exact type registration and capture | `src/sessions/helpers/sessionTypes/{types,helpers}.ts`; `helpers/application/define.ts` |
| Canonical resource facts and sync operations | `src/authorization/helpers/resources/{types,helpers}.ts` |
| Policy compiler and canonical freshness | `src/toolPolicy/helpers/factory/`; `src/authorization/helpers/evaluate/` |
| Async repositories and PostgreSQL | `src/persistence/types.ts`; `helpers/adapters/postgres/` |
| Work service / wire | `src/work/{types.ts,helpers/helpers.ts}`; `src/websocket/helpers/ahp/agentWork.ts` |
| Presence and identity | `src/agents/helpers/directory.ts`; `src/agents/helpers/policyIdentity/` |
| Host composition and delivery | `src/websocket/helpers/host/`; `helpers/ahp/helpers/{kernel,views}/` |
| Consumer and database evidence | `examples/advanced/`; `examples/postgresql-conformance.ts`; `src/tests/persistence/conformance/` |

Source browser: [pinned repository](https://github.com/spore310/AHP/tree/bcd85354723bce293e1384af0ca88e84d5ce9dda).

## 3. JSON data: what the extra blobs mean

Add `canonical_resources.data` and `work_items.data`, both non-null JSONB objects defaulting to `{}`. Root sessions get their application data through their canonical root resource; do not add a second session-level bag with competing ownership.

| Field | Meaning | Mutation rule | Public visibility |
| --- | --- | --- | --- |
| `sessions.durable_state` | Versioned, deliberately serialized Microsoft session state | Session state revision/CAS | Existing protected session projection |
| `canonical_resources.registration_data` | Versioned durable canonical registration facts | Trusted registration only; immutable identity/policy provenance | Never raw wire data |
| `canonical_resources.recovery_input` | Provider-approved input needed to retry/recover | Captured at reserve | Never automatically exposed |
| `canonical_resources.runtime_metadata` | Durable provider recovery receipt/state | Lifecycle service with expected resource revision | Never automatically exposed |
| `canonical_resources.data` | Consumer-defined data attached to that exact instance | Authorized whole-object replace using `dataRevision` | Explicit authorized get/projection only |
| `work_items.input` | Immutable workload input | Set once | Authorized get/claim |
| `work_items.submitted_data` | Immutable initial application data used in replay comparison | Set once, initially equal to `data` | Internal |
| `work_items.data` | Current application progress/context/annotations | Authorized whole-object replace using `dataRevision` | Explicit authorized get/projection only |
| `work_items.result` | Terminal execution result | Exact lease settlement | Authorized get |

Plain JSON capture is shared infrastructure, not an authorization schema. Reuse/extract the existing payload-capture behavior from `toolExecution/helpers/value` into `jsonrpc/helpers/value` when P0 first needs it. Preserve inert own keys; do not execute accessors or interpret `role`, `owner`, `permissions`, `domainId` or similar application keys as authority. Revalidate callback output as well as input.

Reject cycles, accessors, unsupported prototypes, undefined values, functions, symbols, BigInt, non-finite numbers, invalid Unicode/unpaired surrogates and NUL strings/keys that PostgreSQL JSONB cannot round-trip. Array order is meaningful; object key order is not. Never silently truncate or stringify unsupported values.

### Target: `./src/persistence/types.ts`

```ts
export type Revision = string; // canonical positive decimal SQL BIGINT, never JS rounding
export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }

export interface DataSnapshot<T extends JsonObject = JsonObject> {
  readonly data: T;
  readonly dataRevision: Revision;
}

export interface ReplaceData<T extends JsonObject = JsonObject> {
  readonly expectedDataRevision: Revision;
  readonly data: T; // full replacement; no implicit merge / JSON Patch
}

export type ReplaceDataResult<T extends JsonObject = JsonObject> =
  | { readonly status: "updated"; readonly value: DataSnapshot<T> }
  | { readonly status: "conflict" };
```

The SDK captures a detached value before awaiting. A mismatch writes nothing, emits no event and returns a sanitized conflict. Do not return the winner's data in a conflict unless a separate read decision allows it. Resource updates increment `data_revision` and `resource_revision`; work updates increment `data_revision` and `revision` in the same transaction. Empty `{}` is the clear operation. SQL NULL is invalid.

### Target: consumer schema extension

```ts
export interface InstanceDataContract<T extends JsonObject = JsonObject> {
  readonly schema?: JsonObject; // optional descriptive schema, not executable authority
  parse(value: unknown): T;     // consumer's actual data parser
}
```

Put a resource data contract on its registered resource driver and a work data contract on its work-kind registration. Default to bounded plain JSON when omitted. Input/result parsers belong to the work-kind registration. No generic EAV table or GIN index is needed before an application has a concrete query requirement.

A resource-data mutation is exposed first as an authenticated service/helper API, not a universal unauthenticated CRUD RPC. Work gets `x-ahp/work/updateData` because agents need task progress updates. Its permission is distinct from submission/read.

## 4. Durable identity and provider lifecycle

Reuse existing `ResourceRef`, `SecuritySubjectRef`, `PolicyActorRef`, `TrustedRequestContext`, `ResourceRoute` and policy references. Do not create parallel user/agent identity systems.

`domainId` is a trusted security namespace. Resource identity is the full tuple `(domainId, kind, id, instanceId)`; agent registration identity is `(domainId, principal.subject, agentKey)` plus its server-issued registration ID. Enforce a 2,048-byte UTF-8 aggregate budget on persisted indexed identity tuples in the shared validators; retain existing stricter individual limits. This closes the mismatch between character limits and PostgreSQL index-key bytes.

### Target: `./src/sessions/helpers/resources/types.ts`

```ts
export interface PersistedResourceRegistrationV1 {
  readonly version: 1;
  readonly route: ResourceRoute;
  readonly allowedRoutes?: readonly ResourceRoute[];
  readonly mandatory: readonly RegisteredMandatory[];
  readonly externalAuthority: "none" | "required";
  readonly admission: {
    readonly sessionType: { readonly key: string; readonly version: number };
    readonly providerId: string;
  };
  // Resource identity/owner/provider/parent/grantParent are normalized columns.
}

export interface RuntimeResourceContext {
  readonly resource: ResourceRef;
  readonly session: ResourceRef<"session">;
  readonly operationId: string; // stable persisted provision key, not per retry
  readonly recoveryInput: JsonObject;
  readonly runtimeMetadata: JsonObject;
  readonly signal: AbortSignal;
}

export interface RuntimeResourceHandle {
  readonly metadata: JsonObject; // bounded serializable recovery receipt
  release(reason: "host-shutdown" | "creation-cancelled" | "resource-retired"):
    void | Promise<void>; // releases process-local handles only
}

export interface RuntimeResourceDriver {
  readonly key: string;
  readonly version: number;
  readonly kind: string;
  readonly data?: InstanceDataContract;
  captureRecoveryInput(value: unknown): JsonObject;
  ensure(context: RuntimeResourceContext): Promise<RuntimeResourceHandle>;
  restore(context: RuntimeResourceContext): Promise<RuntimeResourceHandle>;
  destroy(context: RuntimeResourceContext): Promise<void>;
}

export interface SessionResourceLifecycle {
  create(input: {
    readonly kind: string;
    readonly id: string;
    readonly parent: ResourceRef;
    readonly grantParent?: ResourceRef;
    readonly driver: { readonly key: string; readonly version: number };
    readonly recoveryInput?: JsonObject;
    readonly data?: JsonObject;
  }): Promise<ResourceRef>;
  readData(resource: ResourceRef): Promise<DataSnapshot>;
  replaceData(resource: ResourceRef, change: ReplaceData): Promise<ReplaceDataResult>;
  retire(resource: ResourceRef): Promise<void>;
}
```

This lifecycle object is a host-issued, per-session capability. It is not constructed from request JSON. Consumer resource registration facts come from a trusted driver/type registration callback; the create request cannot choose owner, domain, arbitrary authorization routes or policy grants. The capability cannot escape its original session incarnation and is revoked at retirement/shutdown.

A driver key/version is registered at startup so callbacks can be found after restart. Do not persist a closure passed to a one-off create call and pretend it can be restored. `ensure` must reconcile by `operationId`: if the external resource already exists, return it. A crash after external creation and before saving the receipt must not create a duplicate. If the backing API cannot provide idempotent create or lookup by that key, this provider cannot claim crash-safe creation; leave the row unavailable and require consumer reconciliation.

### Target: existing `./src/sessions/types.ts`

Extend `ProviderSessionInput` with exact `session`, the scoped `resources`, stable `operationId`, versioned `recoveryInput/runtimeMetadata`, and an abort signal. Preserve normalized config/workingDirectories for initial start. Extend `SessionProvider` with an explicit recovery codec, `restoreSession` and an idempotent `retireSession` that work without a live backend. Its registered resource drivers are supplied as code, never loaded from a database module path.

Keep `SessionBackend.dispose(reason)` for releasing its live handles. `retireSession` destroys external durable resources. Never invoke destructive retirement merely because the process is stopping. The mock provider can implement these as observable no-ops.

Extend `SessionTypePolicyRegistration` with an optional `restoration.prepare` callback following the existing bounded creation-approval pattern. It receives immutable persisted facts, exact type/provider, current trusted configuration and signal; it returns fresh canonical registration/binding installation approval, not old receipts. Missing/denied/failed restoration leaves the session suspended. No automatic restoration of opaque grants or stale creator proofs.

### Lifecycle rules

1. Reserve session + canonical root, or child resource, durably before external creation.
2. Run trusted external provisioning outside a database transaction.
3. Commit the recovery receipt and active state with expected incarnation/revisions.
4. Install fresh canonical authority/live handles and publish.
5. If authority installation fails after commit, fence the live instance, mark suspended/failed durably, release the local handle and reconcile the same provision key. Do not silently lose the durable record.
6. Startup distinguishes an interrupted create (`creating`, reconcile/ensure) from a formerly active instance (restore) and interrupted retirement (resume destroy). Never call ordinary create merely because restore is unsupported.
7. Child creation while the session root is `creating` is allowed only through that exact in-flight creation capability. It is not operational until its entire ancestor chain and session are active.
8. Retirement closes admission, persists `retiring`, cancels queued work and fences leased work, then destroys children before their dependencies and the session backend last. Callback failure retains recoverable state.
9. Soft retirement is successful deletion from the live API. Terminal work/data remains attached to the old incarnation. Physical purge is a separate trusted API with explicit retention policy and dependency checks.

For child retirement, the affected resource set is the bounded transitive dependent closure of containment and grant-parent edges; both are cleanup dependencies in this V1 design. Cancel a nonterminal work item if any immutable positive scope anchor belongs to that retiring set. Do not rewrite its selectors. If only a dynamic descendant beneath a retained positive anchor disappears, retain the work and invalidate/recheck its operation guards; the retired target immediately becomes unusable. Negative exclusions and announcement-only anchors do not independently cancel work. A session retirement covers all its resources and cancels all its nonterminal work.

## 5. Work contracts

### Target: `./src/work/types.ts`

```ts
export interface ResourceLocator {
  readonly kind: string;
  readonly id: string;
  readonly instanceId?: string; // optional expected incarnation; never inferred from URI text
}
export interface ResourceSelectionInput {
  readonly resource: ResourceLocator;
  readonly include: boolean;
  readonly includeDescendants?: boolean; // default false
}
export interface WorkResourceSelection {
  readonly resource: ResourceRef; // exact host-resolved instance
  readonly include: boolean;
  readonly includeDescendants: boolean;
}
export interface WorkSubmission<TInput extends JsonObject = JsonObject,
                                TData extends JsonObject = JsonObject> {
  readonly session?: ResourceLocator; // kind=session; optional if scope implies one root
  readonly requestKey: string;
  readonly kind: string;
  readonly input: TInput;
  readonly priority?: number; // signed int32, default 0
  readonly targetAgentId?: string;
  readonly scope: readonly ResourceSelectionInput[];
  readonly announce?: readonly ResourceSelectionInput[]; // default []
  readonly data?: TData; // default {}; captured into submitted_data AND data
}
export interface WorkRequestContext {
  readonly context: TrustedRequestContext;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
export interface RegisteredAgentIdentity {
  readonly registrationId: string;
  readonly principal: SecuritySubjectRef;
  readonly agentKey: string;
  readonly actorAgentId: string; // canonical PolicyActorRef.agentId; not assumed UUID
}
export interface WorkAgentContext extends WorkRequestContext {
  readonly agent: RegisteredAgentIdentity;
  readonly executionEpoch: Revision; // issued by successful durable binding
}
export interface WorkEntityFacts {
  readonly submitter: PolicyActorRef;
  readonly owner: SecuritySubjectRef; // derived from canonical session
  readonly executor?: RegisteredAgentIdentity;
}
export interface WorkExecutionRef {
  readonly workId: string;
  readonly attempt: number;
  readonly leaseToken: string;
}
export interface WorkLease extends WorkExecutionRef {
  readonly session: ResourceRef<"session">;
  readonly kind: string;
  readonly priority: number;
  readonly input: JsonObject;
  readonly data: JsonObject;
  readonly dataRevision: Revision;
  readonly revision: Revision;
  readonly scope: readonly WorkResourceSelection[];
  readonly leaseExpiresAt: string;
}
```

A narrow chat/resource selection resolves its actual canonical parent. All selected instances must resolve to exactly one session/domain. No prefix parsing, wildcard URI matching, synthetic parent facts or client-supplied ownership.

Scope has at least one positive include. Announce defaults empty. Normalize by exact canonical resource tuple and purpose, deduplicate identical entries, reject contradictory duplicates. For a target, walk containment ancestors from nearest to farthest; an exact selection applies to itself, an ancestor applies only when `includeDescendants=true`. The nearest applicable rule wins; no applicable rule means false. Thus a nearer explicit include may reinstate a descendant below a broader exclusion. This never overrides a permission denial.

Existing scope/announce selectors are immutable. A retired selected incarnation does not match a replacement using the same URI. Dynamic descendants are evaluated against current canonical relationships with depth/count budgets and a graph revision fence.

### Target: `./src/sessions/helpers/sessionTypes/types.ts`

Add serializable work-kind descriptors to `SessionTypeDefinition.work`, and code-bearing `work` registrations to `ApplicationSessionType`/`ResolvedSessionType`. A descriptor is `{kind, inputSchema?, resultSchema?, dataSchema?}`; a code registration supplies input/result/data parsers and optional typed facts extension. Its interpretation is pinned by the exact session type key/version, not a latest resolver. Persist the descriptor as `session_types.work_manifest`, never parser functions.

Include `maxAttempts` in the captured work-kind descriptor/configuration (default 3, integer 1..100); persist the resolved value on submission. This retry budget is independent of agent concurrent capacity. A claim policy authorizes the minimal execution payload in `WorkLease`, with fresh disclosure checks; it does not imply access to unrelated work through the ordinary read/list policy. Lease tokens appear only in the direct successful claimant response and caller-to-host fenced commands.

Extend `defineApplicationSession` and catalogue capture to carry these fields. Do not merely widen an interface: `captureCreationPolicy` currently reconstructs selected keys and would otherwise discard new work/restoration fields.

### Policy registration shape

```ts
export type WorkOperation =
  | "submit" | "read" | "claim" | "renew" | "complete" | "fail"
  | "cancel" | "updateData" | "announce";

export interface WorkOperationPolicy {
  readonly purpose: ToolOperation; // existing closed vocabulary until P5 neutral rename
  readonly policies: readonly PolicyRef[];
}
export interface SessionWorkPolicyRegistration {
  readonly operations: Readonly<Partial<Record<WorkOperation, WorkOperationPolicy>>>;
  prepare?(facts: WorkPolicyFacts, signal: AbortSignal): Promise<WorkPolicyRestriction>;
}
export interface WorkPolicyFacts {
  readonly operation: WorkOperation;
  readonly caller: TrustedRequestContext;
  readonly session: ResourceRef<"session">;
  readonly entities: WorkEntityFacts;
  readonly kind: string;
  readonly work?: { readonly id: string; readonly revision: Revision;
    readonly dataRevision: Revision; readonly status: WorkStatus; readonly attempt: number };
  readonly input: JsonObject;
  readonly data: JsonObject;
  readonly scope: readonly WorkResourceSelection[];
  readonly announce: readonly WorkResourceSelection[];
}
export type WorkPolicyRestriction =
  | { readonly effect: "deny"; release(): void }
  | { readonly effect: "allow"; readonly validUntil: number;
      isCurrent(): boolean; release(): void };
```

The optional prepare callback only narrows an already permitted operation. Absent callback means no extra restriction, whereas absent work registration/operation/policy/grant/evaluator denies. Use existing canonical evaluation and reference freshness, not a new role engine. Suggested purposes: read→discover; submit/cancel/updateData→invoke; claim/renew/complete/fail→execute; announce→publish. Explicit work-specific policy IDs keep an ordinary tool invoke grant from authorizing work. Work has no challenge-continuation flow in this slice: reject statically known challenge-required work/mandatory policy references at registration, and require every evaluated canonical cohort decision to be allow with challengeRequired=false at runtime.

Application work ceilings intersect session-type operation policies, allowed kinds, canonical scope/route permissions and mandatory restrictions. Read/list uses read permission per item; it never equates “can submit” with “can inspect everyone else's input/data/result.” Owners, submitters and executors are addressable facts, not hardcoded roles.

### Authority timing

All async lookup/policy preparation and SQL lock waits happen before final synchronous admission. The server creates a private, single-use admission receipt tied to the exact command and trusted proofs. The repository calls the supplied host-private synchronous admission closure after locks/expected-revision checks and immediately before its first mutation.

An operation admitted before a concurrent revocation/reconnect may finish committing. This is **admission-time authorization**, not an assertion that an in-memory callback and PostgreSQL COMMIT are atomic. Operations not yet admitted must fail when stale. Durable epoch/revision checks fence database races. Before sending a lease/data/lifecycle mutation to SQL, invalidate the affected private work guards and mark the exact operation settling. Known rollback permits fresh preparation; known commit installs fresh facts; unknown outcome remains unavailable until authoritative reconciliation under the same row/session fences waits for the original transaction outcome. Sensitive responses and delivery recheck current authority after awaits; a stale claimant must not receive its lease token. An already committed but withheld lease follows the authority-loss disposition and is still counted until released/expired.

Do not pass an async function to current `ResourceOperations.commit`. Synchronous tool/resource mutations retain their existing final synchronous guard. Durable commands have their own explicitly async repository boundary.

### Scope enforcement after claim

Requests explicitly acting for work carry optional `WorkExecutionRef` in the private resource/tool request envelope. Host code prepares a restrictive work guard against the resolved route and input, checking the exact active attempt, agent epoch, deadline, current work policy and scope membership. Effective targets are the resolved targets when nonempty, otherwise the route origin; an operation that also affects its origin must explicitly include that origin among its targets. Ordinary canonical tool/resource authorization must ALSO succeed.

Use the existing tool dispatcher/broker `current`, `fence` and projection-admission seams. A lease token stays in a private host closure; it must not be forwarded to a different tool executor, exposed in a normal action context, persisted in data or emitted to a subscriber. Direct resource operations combine the work guard with their existing synchronous final admission.

An untagged operation is evaluated under the agent's independent permissions. A work scope cannot constrain arbitrary execution on the worker's own machine or revoke separately held rights. Do not describe the selection as an OS sandbox.

## 6. Agent capacity and lease authority

### Target: `./src/agents/helpers/workConfiguration/{types,helpers,index}.ts`

```ts
export interface AgentWorkConfig {
  readonly defaultMaxActiveClaims?: number; // 3
  readonly identities?: readonly {
    readonly identity: {
      readonly domainId: string;
      readonly subject: string;
      readonly agentKey: string;
    };
    readonly maxActiveClaims?: number;
    readonly allowedKinds?: readonly string[];
  }[];
}
// createAgentWorkConfig captures, validates and freezes the complete config.
```

Match full trusted registration identity, not agentKey alone or a numeric request property. Bind the canonical agent actor to the registration in server code. Global and identity limits are integers 0..1024; 0 disables new claims. An identity override replaces the global default (bounded by the hard maximum). Allowed kinds intersect the required finite host allowlist, exact session definitions and any trusted per-agent restriction. Omitting a per-agent allowedKinds adds no further restriction; an explicit empty array denies every kind. There is never an implicit allow for an unregistered host/session kind. Existing registration quotas still prevent capacity amplification by unlimited registrations.

Increment `agent_registrations.execution_epoch` on every new successful online binding and every disable/re-enable transition. An idempotent repeat for the same still-current connection/identity returns its existing binding without rotating the epoch. Publish live presence only after the increment commits and the connection is still current. Preserve one live connection per registration and one live agent per connection, with bounded pending reservations across the SQL await. Re-enable does not make an agent online. Late cleanup uses expected epoch CAS. Persisting a fencing counter does not persist a socket or online status.

A claim/renew transaction locks the requesting agent row in one awaited statement, then uses a **fresh following statement** at READ COMMITTED to count unexpired leases across all sessions and all epochs. New acquisition is permitted only below the effective cap. Existing leases survive a limit reduction; renew is allowed for existing still-valid leases even when the new cap is lower. The lock is also required for renew so it cannot extend an expired lease after another acquisition counted it absent. Recheck the deadline using database time after the work-row lock wait.

Lock order: host ownership fence → session row / canonical resource rows in stable order → requesting agent → work. Release paths that only reduce count need not lock an agent after a work row. Never lock an expired lease's old agent during takeover.

## 7. Events, diagnostics and projection

`WorkEventPublisher` is a work-owned post-commit event port. Emit once per successful state/data revision, never for identical submit replay or failed/CAS-conflicted commands. Events are best effort; a callback error is a diagnostic, not a transaction rollback. No outbox/event table in this stage.

Public `x-ahp/work/*` packets carry `version: 1`. Work change hints carry an opaque `streamEpoch` (fresh per host ownership generation), exact work/resource identity, work revision and optional `serverSeq` only for recipients allowed to see the shared global sequence. A work revision is scoped to that visible work item; it is not a global hidden-item count.

Subscribe begins bounded buffering before reading a snapshot. Commit the subscription only after a guarded reply is enqueued. Flush buffered work hints using item revisions, with current permission checks. **Do not drop a hint solely because its serverSeq is below a cursor sampled after an asynchronous database query:** the two are not one atomic snapshot. Hints invalidate/refetch work views; they are not durable replay or authoritative data deltas.

Reconnection, overflow, epoch change and explicit/periodic reconciliation use authorized list/get snapshots. Default client reconciliation interval is 30 seconds while actively subscribed, configurable with a 5-second minimum, and cancelled on dispose. No periodic read while disconnected. Missed hints cannot strand an active view indefinitely.

Use existing host diagnostic callbacks, extending their discriminated event union. Work failures retain bounded code, approved summary and failure time; raw worker messages, SQL strings, input/data/result, tokens and stacks are absent from default logs and broadcasts. An optional consumer formatter may return an approved bounded failure summary; default summary is generic.

## 8. Default limits and numeric handling

These are implementation defaults chosen to close unbounded paths; expose coherent lower/higher trusted settings within the stated hard caps.

| Setting | Default | Hard maximum / rule |
| --- | --- | --- |
| Instance/work data | 64 KiB UTF-8 | 256 KiB; depth 16, total keys/elements 4,096 |
| Work input / result | Existing 64 KiB / 256 KiB | Preserve existing stricter host/frame limits |
| Provider recovery input/receipt/registration facts | 64 KiB each | 256 KiB, same structural limits |
| Session durable snapshot | 2 MiB | 8 MiB, explicit serializer; no presence/handles |
| Selectors | 64 per purpose | 128 per purpose |
| Resource graph depth | 32 | 64 |
| Canonical resources per session | 256 | 4,096 |
| Active work per session / host | 1,000 / 10,000 | Trusted configuration; count queued+leased atomically |
| Claim scan | 32 per page, 128 per call | Bounded continuation; 1,024 active scan cursors |
| Work list | 50 items | 100 items / 256 KiB output; examine <=128 rows and <=5 seconds per call; opaque continuation on a budget stop |
| Client work-view retention | 500 tracked items; 20 pages / 10 seconds per refresh | Trusted client setting up to 5,000 items; explicit incomplete/limit state on exhaustion, never a false complete snapshot |
| Pending async policy / authority-loss callbacks | 64 / 32 | 5-second response timeout; retain slot until actual settlement |
| Concurrent provider lifecycle calls | 32 | 30-second response timeout; retain settlement ownership |
| Active claims per identity | 3 | 0..1024 |
| Attempts per work kind | 3 | 1..100; independent of concurrent capacity |
| Lease duration | 60 seconds | Trusted setting 1..300 seconds |
| Protected delivery | Reuse existing 256 entries / 2 MiB | Do not add a parallel unlimited queue |
| Priority | 0 | Integer -2147483648..2147483647 |
| Durable revisions / epochs | Decimal strings | Positive/nonnegative BIGINT as appropriate |
| Native serverSeq | Number | Safe integer only; fail before overflow |

Queue admission counters must have a serialized boundary. Use the host admission mutex for the host-wide active-work reservation plus the session row for per-session validation, retaining reservations until commit/rollback settlement; on startup rebuild counts from SQL before admission. Exact authorized replay consumes no new slot and must not fail merely because the active-work quota is full. Resolve an existing key before reserving, recheck on capacity/conflict races, and retain uncertain-submit reservations until fenced reconciliation determines whether insertion committed. Do not claim a cross-host quota: only one host is supported. Terminal history is retained until an application invokes explicit bounded retention/purge; document disk monitoring and do not silently delete history.

## 9. Migration and implementation strategy

Preserve existing 0001/0002 scripts and add `0003_durable_session_resources.sql` (P0) and `0004_work_policy_scheduling.sql` (P1/P3 schema). V1 has no legacy consumer compatibility code.

Fresh databases apply all four in order. The default 0003 preflight refuses nonempty legacy `sessions`, `work_items` or `agent_registrations`: their old rows do not contain enough trusted domain/incarnation/submitter facts for an honest automatic backfill. It never drops data. For a development database the user may separately choose an explicit reset, or supply an application mapping; neither choice is inferred or implemented by these packets. Existing catalogue definitions can be retained and aligned to current trusted exact registrations.

P0 creates the empty identity foundation and maps the work FK to session incarnation so intermediate code builds. P1 adds immutable submission fields/selectors/data; P3 implements their scheduling/epoch semantics. Every packet must pass its focused gates and the repository gate before the next begins. Do not enable remote work mutations through P2; enable them only after P3 proves the policy, epoch, capacity and settlement fences with real SQL.

The supplied SQL is the complete end-state reference, not a command to run on a populated database. PostgreSQL constraint triggers enforce root consistency and positive scope; repository contracts enforce immutable edges, transitions, graph cycles and authorization. Database-neutral adapters need equivalent transaction guarantees, not PostgreSQL types in public interfaces.


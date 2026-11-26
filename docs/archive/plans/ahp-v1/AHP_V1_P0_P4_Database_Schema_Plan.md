# AHP V1 — complete P0–P5 architecture and implementation packets

**Pinned plan, November 22, 2026.**  
**Evidence baseline:** develop commit `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Status:** reviewed target design; implementation and runtime acceptance remain to be performed.

This complete edition replaces the earlier P0–P4 database-only plan. It retains that file's original name, adds the requested resource/work application data, supplies the full P0–P4 implementation packets and includes the justified P5 tool/client ownership cleanup. Every split packet, the exact V1 wire supplement, source/review record and full target SQL appear below. The separate ZIP also includes the acceptance ledger and an unexecuted rollback-only SQL smoke fixture.

## Current schema to target schema

| Table | Current develop | Pinned target |
| --- | --- | --- |
| schema_migrations | Migration history | Retained; append forward 0003/0004 |
| host_state | Host ID and sequence checkpoint | One logical store, persistent ownership epoch and safe sequence checkpoint |
| session_types | Exact type/provider catalogue | Add serializable work_manifest, keep exact trusted type version |
| tools | Tool definitions/schema descriptors | Retain; align schema dialect to actual draft-07 runtime |
| session_type_tools | Type/tool association | Retained |
| sessions | URI-keyed durable projection | Exact incarnation/domain/type, lifecycle and revisions, explicit state codec |
| canonical_resources | Absent | New exact resource identity, dependencies, driver/recovery facts, data and CAS |
| agent_registrations | Principal/key registration | Domain-aware identity and execution epoch; presence remains live only |
| work_items | Basic input/lease/status rows | Incarnation, priority, provenance, submitted_data/data, revisions and fenced leases |
| work_resource_selections | Absent | New exact scope/announce include/exclude selectors with same-session/domain FKs |

The target still has **10 tables**. The JSON additions require columns and contracts, not another generic metadata table. Scope/announce stay relational because their identities and cross-session boundaries need real constraints.

## Reading order

1. Handoff and shared decisions.
2. Exact service/wire supplement.
3. P0 durable lifecycle; P1 work data; P2 authorization; P3 atomic scheduling; P4 delivery and chat projection.
4. P5 ownership cleanup after the functional work is complete.
5. Source/review record and full SQL reference.

Remote work mutations remain closed until P3 passes its real PostgreSQL policy/epoch/capacity gates. P5 is separate from P0–P4 and must not be mixed into their behavioral changes.


---

## AHP V1 — implementation handoff for P0–P5

**Prepared:** November 22, 2026.  
**Source baseline:** develop at `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Implementation checkout named by the user:** `GLM/agentIdentity`; reconcile its actual diff before editing.  
**Review status:** ready for implementation against the stated baseline after source/static review. No repository implementation, migration execution or runtime test result is included.

### Start here

Read [00_Shared_Contracts.md](00_Shared_Contracts.md), [01_Wire_and_Service_Contracts.md](01_Wire_and_Service_Contracts.md), and this handoff, then execute one packet at a time in order. [AHP_V1_P0_P4_Database_Schema_Plan.md](AHP_V1_P0_P4_Database_Schema_Plan.md) is the complete combined edition; its original filename is retained, and its contents now include P5. The split packets are the same plan in implementation-sized units.

The user's additional JSON requirement is pinned: canonical resources and work items each have bounded application-owned `data` with independent dataRevision CAS. Work also preserves immutable `submitted_data` for retry comparison. Neither bag becomes an authority source. Root session application data belongs to its canonical root resource.

P5 is included with a corrected ownership split: generic Client/connection/RPC in `src/client`, tool contracts/client/execution in singular `src/tool`, generic policy in authorization, protected session views in sessions. ToolClient remains the meaningful tool adapter name. All unreleased private contracts end at V1, with no production legacy fallback.

### Packet order and gates

| Packet | Outcome | Named checks | Required completion evidence |
| --- | --- | ---: | --- |
| [P0](P0_Durable_Sessions_and_Resources.md) | Durable exact identities, lifecycle/recovery hooks, state codec, host fence, data CAS | 24 | Real PostgreSQL lifecycle + restart + public SDK behavior |
| [P1](P1_Work_Contracts_and_Data.md) | Work intent, priority, exact selections, mutable data and immutable replay | 22 | Storage-neutral and real-SQL invariants; strict V1 fixtures |
| [P2](P2_Work_Authorization_and_Hooks.md) | Existing-auth extension, typed parties, work-scope guard and consumer callbacks | 23 | Adversarial policy/revocation/disclosure tests; remote mutation still closed |
| [P3](P3_Claims_Capacity_and_Diagnostics.md) | Atomic cap/priority claims, binding epochs, lease settlement, diagnostics | 21 | Real two-pool races, representative query evidence; then enable remote mutations |
| [P4](P4_Events_Snapshots_and_Chat_Projection.md) | Post-commit hints, bounded authorized reconciliation and replaceable chat projection | 22 | Snapshot/event races, dropped hints, memory limits and public binding test app |
| [P5](P5_Tool_and_Client_Boundaries.md) | Tool/client ownership cleanup and one supported private V1 tool shape | 19 | Real SDK boundary, portable runtime import/use and no legacy execution path |

There are **131 named acceptance checks**, plus the wire supplement's contract fixtures and the final `pnpm validate` gate. These are requirements, not claimed passing tests.

### Preflight for the coding agent

1. Read `.agents/AGENTS.md`, applicable task hooks, architecture/ownership instructions and `docs/CodingRules.md` in the actual checkout. Preserve current unrelated work.
2. Record branch, HEAD, status and the diff from the pinned baseline. The packet paths are source anchors; inspect post-baseline modifications before adapting them. Do not reset, switch or overwrite the user's working branch merely because this plan inspected develop.
3. Use repository-pinned Node/pnpm and the installed lockfile. At the inspected commit: Node 24.21.0, pnpm 10.34.6, TypeScript 5.9.3, Microsoft package 1.0.0. Record any deliberate dependency change separately; none is required by this plan.
4. Establish relevant baseline tests. A preexisting failure must be recorded and distinguished from a regression, not silently accepted as the new baseline.
5. Provision a disposable migrated PostgreSQL 17 database through the existing local test setup and `AHP_TEST_DATABASE_URL` loopback guard. Tests that need SQL must fail/mark the phase blocked when that environment is absent; they must not silently skip or use a production database.
6. Preserve the one authoritative host operating boundary. Two pools in one host are required for race tests; two concurrently active hosts for one logical store are intentionally rejected.

### SQL artifacts and migration policy

[AHP_V1_Target_Schema.sql](AHP_V1_Target_Schema.sql) is the complete **fresh empty-schema reference**, not an upgrade script. It declares 10 tables. Author forward `0003_durable_session_resources.sql` and `0004_work_policy_scheduling.sql` in the existing migration runner and test all four migrations on a fresh database. Keep 0001/0002 history unchanged.

The default 0003 preflight refuses nonempty old sessions/work/registration tables. Those rows lack trusted domain/incarnation/submitter facts. Do not invent ownership or drop data. A reset or application mapping is a separate explicitly authorized development-data action, not a compatibility layer required for released consumers.

[AHP_V1_Schema_Smoke.sql](AHP_V1_Schema_Smoke.sql) is an optional raw-DDL fixture test. It was authored and statically inspected here but **not executed**. It checks root consistency, composite FK boundaries, opaque instance IDs, positive-scope preservation/rekey, lease/result/data checks, sequential CAS and URI reuse, then rolls back its fixture. It does not test policy, concurrent transactions, adapter commit handling or provider recovery.

For an explicitly disposable empty database only:

```sh
psql "$AHP_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f AHP_V1_Target_Schema.sql
psql "$AHP_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f AHP_V1_Schema_Smoke.sql
```

The migration-conformance path should separately apply actual 0001–0004 and run the same invariants. Never apply both the fresh reference and the migrations into the same already-created schema.

### Definition of done for every packet

- Implement the documented behavior through the existing owners and strict runtime schemas; update all active callers, mocks, fixtures and the in-memory adapter.
- Add meaningful counterexample/concurrency tests from the packet; use controlled promises/SQL barriers rather than long sleeps.
- Run the focused suites and relevant test app, then `pnpm validate` under the repository's required gate. For SQL phases, also run real PostgreSQL conformance.
- Update current README/API documentation to implemented facts. Preserve proposed-vs-current labels for future phases; do not rewrite historical narratives as though they never existed.
- Record actual commands/results and remaining limitations in [03_Acceptance_Matrix.md](03_Acceptance_Matrix.md). A mock pass is not a database pass; an internal kernel fixture is not a public createAHPServer/pinned-SDK integration pass.
- Review authority bypasses, async gaps, commit uncertainty, lease races, late cleanup, bounds, import cycles and deletion semantics before moving to the next packet.

### Scope that stays outside these packets

No active/active hosts, SQL-backed authorization grant store, durable work event outbox, exactly-once external effects, model execution runtime, automatic native chat turns, background queue daemon, arbitrary JSON query/index system or published npm exports redesign. These are explicit operating limits, not missing implementation tasks disguised as completion.

### Handoff prompt

> Implement P0 from this accepted AHP V1 packet set in the existing authorized checkout. Read the shared contracts, wire supplement, pinned-source review and current repository instructions first. Reconcile branch drift without discarding existing work. Implement only P0 and the minimum P1-schema scaffolding explicitly required for buildability; keep remote work mutations closed until P3. Run the P0 test app, repository gate and real PostgreSQL acceptance, update the evidence ledger, and review the diff. Report concrete changes, test results and any blocked gate. Do not implement P5 early or replace consumer policy with owner-only shortcuts. Continue subsequent packets in order when the task's authorization covers them.

The overall user request authorizes this complete plan, not repository implementation by the planning assistant. The local coding agent can receive the full-stage implementation instruction separately, or use this per-packet prompt.

---

## Agent Hosting Protocol V1 — shared contract decisions

**Status:** target contracts for P0–P5, not implemented APIs.  
**Baseline:** `spore310/AHP`, `develop`, commit `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Execution order:** P0 → P1 → P2 → P3 → P4 → P5. P5 is an explicit ownership cleanup, not a prerequisite for P0–P4.  
**Mode of this deliverable:** planning and review only. Examples below specify shapes and semantics; the coding agent must integrate them into the named existing modules.

### 1. Decisions that must remain true

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

### 2. Current source anchors

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

### 3. JSON data: what the extra blobs mean

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

#### Target: `./src/persistence/types.ts`

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

#### Target: consumer schema extension

```ts
export interface InstanceDataContract<T extends JsonObject = JsonObject> {
  readonly schema?: JsonObject; // optional descriptive schema, not executable authority
  parse(value: unknown): T;     // consumer's actual data parser
}
```

Put a resource data contract on its registered resource driver and a work data contract on its work-kind registration. Default to bounded plain JSON when omitted. Input/result parsers belong to the work-kind registration. No generic EAV table or GIN index is needed before an application has a concrete query requirement.

A resource-data mutation is exposed first as an authenticated service/helper API, not a universal unauthenticated CRUD RPC. Work gets `x-ahp/work/updateData` because agents need task progress updates. Its permission is distinct from submission/read.

### 4. Durable identity and provider lifecycle

Reuse existing `ResourceRef`, `SecuritySubjectRef`, `PolicyActorRef`, `TrustedRequestContext`, `ResourceRoute` and policy references. Do not create parallel user/agent identity systems.

`domainId` is a trusted security namespace. Resource identity is the full tuple `(domainId, kind, id, instanceId)`; agent registration identity is `(domainId, principal.subject, agentKey)` plus its server-issued registration ID. Enforce a 2,048-byte UTF-8 aggregate budget on persisted indexed identity tuples in the shared validators; retain existing stricter individual limits. This closes the mismatch between character limits and PostgreSQL index-key bytes.

#### Target: `./src/sessions/helpers/resources/types.ts`

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

#### Target: existing `./src/sessions/types.ts`

Extend `ProviderSessionInput` with exact `session`, the scoped `resources`, stable `operationId`, versioned `recoveryInput/runtimeMetadata`, and an abort signal. Preserve normalized config/workingDirectories for initial start. Extend `SessionProvider` with an explicit recovery codec, `restoreSession` and an idempotent `retireSession` that work without a live backend. Its registered resource drivers are supplied as code, never loaded from a database module path.

Keep `SessionBackend.dispose(reason)` for releasing its live handles. `retireSession` destroys external durable resources. Never invoke destructive retirement merely because the process is stopping. The mock provider can implement these as observable no-ops.

Extend `SessionTypePolicyRegistration` with an optional `restoration.prepare` callback following the existing bounded creation-approval pattern. It receives immutable persisted facts, exact type/provider, current trusted configuration and signal; it returns fresh canonical registration/binding installation approval, not old receipts. Missing/denied/failed restoration leaves the session suspended. No automatic restoration of opaque grants or stale creator proofs.

#### Lifecycle rules

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

### 5. Work contracts

#### Target: `./src/work/types.ts`

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

#### Target: `./src/sessions/helpers/sessionTypes/types.ts`

Add serializable work-kind descriptors to `SessionTypeDefinition.work`, and code-bearing `work` registrations to `ApplicationSessionType`/`ResolvedSessionType`. A descriptor is `{kind, inputSchema?, resultSchema?, dataSchema?}`; a code registration supplies input/result/data parsers and optional typed facts extension. Its interpretation is pinned by the exact session type key/version, not a latest resolver. Persist the descriptor as `session_types.work_manifest`, never parser functions.

Include `maxAttempts` in the captured work-kind descriptor/configuration (default 3, integer 1..100); persist the resolved value on submission. This retry budget is independent of agent concurrent capacity. A claim policy authorizes the minimal execution payload in `WorkLease`, with fresh disclosure checks; it does not imply access to unrelated work through the ordinary read/list policy. Lease tokens appear only in the direct successful claimant response and caller-to-host fenced commands.

Extend `defineApplicationSession` and catalogue capture to carry these fields. Do not merely widen an interface: `captureCreationPolicy` currently reconstructs selected keys and would otherwise discard new work/restoration fields.

#### Policy registration shape

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

#### Authority timing

All async lookup/policy preparation and SQL lock waits happen before final synchronous admission. The server creates a private, single-use admission receipt tied to the exact command and trusted proofs. The repository calls the supplied host-private synchronous admission closure after locks/expected-revision checks and immediately before its first mutation.

An operation admitted before a concurrent revocation/reconnect may finish committing. This is **admission-time authorization**, not an assertion that an in-memory callback and PostgreSQL COMMIT are atomic. Operations not yet admitted must fail when stale. Durable epoch/revision checks fence database races. Before sending a lease/data/lifecycle mutation to SQL, invalidate the affected private work guards and mark the exact operation settling. Known rollback permits fresh preparation; known commit installs fresh facts; unknown outcome remains unavailable until authoritative reconciliation under the same row/session fences waits for the original transaction outcome. Sensitive responses and delivery recheck current authority after awaits; a stale claimant must not receive its lease token. An already committed but withheld lease follows the authority-loss disposition and is still counted until released/expired.

Do not pass an async function to current `ResourceOperations.commit`. Synchronous tool/resource mutations retain their existing final synchronous guard. Durable commands have their own explicitly async repository boundary.

#### Scope enforcement after claim

Requests explicitly acting for work carry optional `WorkExecutionRef` in the private resource/tool request envelope. Host code prepares a restrictive work guard against the resolved route and input, checking the exact active attempt, agent epoch, deadline, current work policy and scope membership. Effective targets are the resolved targets when nonempty, otherwise the route origin; an operation that also affects its origin must explicitly include that origin among its targets. Ordinary canonical tool/resource authorization must ALSO succeed.

Use the existing tool dispatcher/broker `current`, `fence` and projection-admission seams. A lease token stays in a private host closure; it must not be forwarded to a different tool executor, exposed in a normal action context, persisted in data or emitted to a subscriber. Direct resource operations combine the work guard with their existing synchronous final admission.

An untagged operation is evaluated under the agent's independent permissions. A work scope cannot constrain arbitrary execution on the worker's own machine or revoke separately held rights. Do not describe the selection as an OS sandbox.

### 6. Agent capacity and lease authority

#### Target: `./src/agents/helpers/workConfiguration/{types,helpers,index}.ts`

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

### 7. Events, diagnostics and projection

`WorkEventPublisher` is a work-owned post-commit event port. Emit once per successful state/data revision, never for identical submit replay or failed/CAS-conflicted commands. Events are best effort; a callback error is a diagnostic, not a transaction rollback. No outbox/event table in this stage.

Public `x-ahp/work/*` packets carry `version: 1`. Work change hints carry an opaque `streamEpoch` (fresh per host ownership generation), exact work/resource identity, work revision and optional `serverSeq` only for recipients allowed to see the shared global sequence. A work revision is scoped to that visible work item; it is not a global hidden-item count.

Subscribe begins bounded buffering before reading a snapshot. Commit the subscription only after a guarded reply is enqueued. Flush buffered work hints using item revisions, with current permission checks. **Do not drop a hint solely because its serverSeq is below a cursor sampled after an asynchronous database query:** the two are not one atomic snapshot. Hints invalidate/refetch work views; they are not durable replay or authoritative data deltas.

Reconnection, overflow, epoch change and explicit/periodic reconciliation use authorized list/get snapshots. Default client reconciliation interval is 30 seconds while actively subscribed, configurable with a 5-second minimum, and cancelled on dispose. No periodic read while disconnected. Missed hints cannot strand an active view indefinitely.

Use existing host diagnostic callbacks, extending their discriminated event union. Work failures retain bounded code, approved summary and failure time; raw worker messages, SQL strings, input/data/result, tokens and stacks are absent from default logs and broadcasts. An optional consumer formatter may return an approved bounded failure summary; default summary is generic.

### 8. Default limits and numeric handling

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

### 9. Migration and implementation strategy

Preserve existing 0001/0002 scripts and add `0003_durable_session_resources.sql` (P0) and `0004_work_policy_scheduling.sql` (P1/P3 schema). V1 has no legacy consumer compatibility code.

Fresh databases apply all four in order. The default 0003 preflight refuses nonempty legacy `sessions`, `work_items` or `agent_registrations`: their old rows do not contain enough trusted domain/incarnation/submitter facts for an honest automatic backfill. It never drops data. For a development database the user may separately choose an explicit reset, or supply an application mapping; neither choice is inferred or implemented by these packets. Existing catalogue definitions can be retained and aligned to current trusted exact registrations.

P0 creates the empty identity foundation and maps the work FK to session incarnation so intermediate code builds. P1 adds immutable submission fields/selectors/data; P3 implements their scheduling/epoch semantics. Every packet must pass its focused gates and the repository gate before the next begins. Do not enable remote work mutations through P2; enable them only after P3 proves the policy, epoch, capacity and settlement fences with real SQL.

The supplied SQL is the complete end-state reference, not a command to run on a populated database. PostgreSQL constraint triggers enforce root consistency and positive scope; repository contracts enforce immutable edges, transitions, graph cycles and authorization. Database-neutral adapters need equivalent transaction guarantees, not PostgreSQL types in public interfaces.


---

## V1 work wire and service contracts

**Status:** normative target supplement to the shared contracts and P1–P4. These are proposed interfaces, not names already exported by develop. Keep all request schemas strict and all replies explicitly serialized. Microsoft native requests and JSON-RPC `"2.0"` remain unchanged.

### 1. Service surface

Target: `./src/work/types.ts`. Reuse the existing WorkStatus and WorkError owners. Replace the old owner-only AuthorizedAgentContext with the shared trusted contexts. Keep full internal repository records out of public replies.

```ts
export interface WorkFailure {
  readonly retryable: boolean;
  readonly code?: string;     // bounded advisory worker input, not a trusted log code
  readonly message?: string;  // <=512 characters; never stored/logged by default
}
export interface WorkCompletion {
  readonly result: JsonObject;
  readonly data?: ReplaceData;
}
export interface WorkFailureCommand extends WorkFailure {
  readonly data?: ReplaceData;
}
export interface WorkService {
  submit(caller: WorkRequestContext, input: WorkSubmission):
    Promise<{ readonly id: string }>;
  claim(caller: WorkAgentContext, session: ResourceLocator):
    Promise<WorkClaimResult>;
  renew(caller: WorkAgentContext, execution: WorkExecutionRef):
    Promise<{ readonly leaseExpiresAt: string; readonly revision: Revision }>;
  complete(caller: WorkAgentContext, execution: WorkExecutionRef,
    command: WorkCompletion): Promise<void>;
  fail(caller: WorkAgentContext, execution: WorkExecutionRef,
    command: WorkFailureCommand): Promise<{ readonly status: WorkStatus }>;
  cancel(caller: WorkRequestContext, workId: string): Promise<void>;
  updateData(caller: WorkRequestContext, workId: string, change: ReplaceData,
    execution?: WorkExecutionRef): Promise<DataSnapshot>;
  get(caller: WorkRequestContext, workId: string): Promise<AuthorizedWorkView | null>;
}
```

`claim` requires a session-kind locator; the claim is session-scoped while capacity is identity-wide. The host resolves it once to an exact incarnation. A WorkExecutionRef on renew/complete/fail supplies the **attempt** as well as ID and token; do not leave the old lease wire schema without attempt. The host derives connection, actor, registration and execution epoch. Work data service conflicts throw the owned WorkError `conflict`; the trusted resource helper may return the shared ReplaceDataResult union. Both represent the same no-write CAS semantics.

Complete/fail/cancel still return their existing simple success shapes on the wire as specified below. The direct claim response is the only ordinary response that contains the newly issued lease token. AuthorizedWorkView is an explicit read projection, never an object spread of the internal record.

### 2. Mutating and direct-read method shapes

All object params below include `version: 1`. Field names are fixed; the wire adapter can flatten WorkExecutionRef while the service accepts its typed object.

| Method | Required/optional params beyond version | Success result |
| --- | --- | --- |
| `x-ahp/work/submit` | Shared WorkSubmission fields: optional session; requestKey, kind, input, scope; optional priority, targetAgentId, announce, data | `{version:1, workId}` |
| `x-ahp/work/claim` | `session: ResourceLocator` with kind=session | `{version:1, ...WorkClaimResult}`; claimed uses `lease`, never the old `work:null` shape |
| `x-ahp/work/renew` | `workId, attempt, leaseToken` | `{version:1, leaseExpiresAt, revision}` |
| `x-ahp/work/complete` | `workId, attempt, leaseToken, result`; optional `data: ReplaceData` | `null` |
| `x-ahp/work/fail` | `workId, attempt, leaseToken, retryable`; optional code, message, `data: ReplaceData` | `{version:1, status}` |
| `x-ahp/work/cancel` | `workId` | `null`, including authorized terminal no-op |
| `x-ahp/work/updateData` | `workId, expectedDataRevision, data`; optional `execution: WorkExecutionRef` | `{version:1, data, dataRevision}` |
| `x-ahp/work/get` | `workId` | `{version:1, work: AuthorizedWorkView | null}`; absent and undisclosable work both use null |

For updateData with execution, its workId must equal the outer workId. A token does not grant an independently authenticated caller worker identity. Reject writable domain/owner/submitter/registration/epoch/capacity fields. ResourceLocator.instanceId is opaque text; workId, lease token and durable registration IDs use the existing UUID validation.

Agent register/renew/unregister method names stay unchanged. Their schemas still accept no claimed principal/epoch. Register becomes async through durable binding, keeps idempotent same-connection behavior and returns `{version:1, agentId, presenceExpiresAt}`. Registration IDs may be returned; a client cannot choose them. Expose execution epochs only in trusted server context, not as client-selected configuration.

### 3. Lists and subscriptions

Target: `./src/work/helpers/views/types.ts` and `./src/work/helpers/client/types.ts`.

```ts
export interface WorkListSummary {
  readonly id: string;
  readonly session: ResourceRef<"session">;
  readonly kind: string;
  readonly priority: number;
  readonly status: WorkStatus;
  readonly revision: Revision;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AuthorizedWorkView extends WorkListSummary {
  readonly input?: JsonObject;
  readonly data?: JsonObject;
  readonly dataRevision?: Revision;
  readonly result?: JsonObject;
  readonly entities?: WorkEntityFacts;
  readonly scope?: readonly WorkResourceSelection[];
  readonly announce?: readonly WorkResourceSelection[];
  readonly attemptCount?: number;
  readonly maxAttempts?: number;
  readonly failure?: { readonly code: string; readonly summary: string;
    readonly occurredAt: string };
}
export interface WorkListFilter {
  readonly kinds?: readonly string[];      // <=64 unique registered kinds
  readonly statuses?: readonly WorkStatus[]; // omitted = all; [] = none
}
export interface WorkListRequest {
  readonly version: 1;
  readonly session?: ResourceLocator;
  readonly announceTo?: ResourceLocator;
  readonly filter?: WorkListFilter;
  readonly limit?: number;                 // default 50; 1..100
  readonly cursor?: string;                // opaque server-owned handle
}
export interface WorkPage {
  readonly items: readonly WorkListSummary[];
  readonly nextCursor?: string;
}
export interface WorkSubscribeRequest {
  readonly version: 1;
  readonly resource: ResourceLocator;
  readonly filter?: WorkListFilter;
  readonly limit?: number;
}
export interface WorkSubscribeReply extends WorkPage {
  readonly version: 1;
  readonly subscriptionId: string;
  readonly streamEpoch: string;
}
```

The authorized detail serializer may include the listed optional fields only within its current read projection. A consumer can narrow that projection; it cannot add unapproved fields or disclose internal records. Default list and hints never contain these detail fields. A summary is not a valid lease response. There is deliberately no leaseToken, executionEpoch, submitted_data or recovery metadata member on AuthorizedWorkView.

A list request requires session or announceTo; the latter may infer the one canonical session. Omitted kinds means the current allowed registered kind set, not unknown kinds. An explicit empty kinds list returns no items. Unknown kinds/statuses reject before SQL. Cursors bind the complete normalized filter/limit, actor/connection generation, exact resource/session, authority basis and finite upper key. A subsequent list request must match that binding; for subscription pagination include the returned subscription identity in the client-owned cursor state. Subscriptions apply the same optional filter as their initial snapshot and hints.

Return `{version:1, ...WorkPage}` for list. WorkPage.nextCursor is present even on a zero-visible-item page when the examined-row budget stopped the scan. It is absent only at the actual end of the finite sweep. Keep at most 1,024 server list cursor handles, expire them after 60 seconds of inactivity and invalidate them with their owning connection/subscription/authority generation. Claim continuations have a separate bounded 1,024-entry owner; neither exposes raw hidden row IDs/counts. An expired cursor is a sanitized stale request requiring restart, not an empty page.

A work client can choose active-status filters to keep a dashboard small; the SDK does not silently change an explicitly requested historical view. The P4 tracked-item/page/time limits make an overlarge automatic view explicitly incomplete. Manual history pagination remains possible within each server request's limits.

Unsubscribe params are `{version:1, subscriptionId}`, reply null. Reset params are `{version:1, subscriptionId, streamEpoch}` only; do not add a denied work/resource ID. Use the P4 WorkChangedParams shape for changed. A rich chat projection is an explicitly opted-in, separately guarded presentation field owned by the work view adapter; it is absent by default and obeys the same output budget.

### 4. Errors, uncertain outcomes and consumer formatting

Reuse `src/jsonrpc/helpers.ts`'s owned RpcError, the protocol's existing numeric code vocabulary and `agentWork.ts`'s sanitized mapping. Do not add arbitrary numeric error codes.

| Condition | Public behavior |
| --- | --- |
| Malformed request, unknown or unauthorized target | Existing generic InvalidParams / `Request rejected`; get uses the null projection above |
| Idempotency or data CAS conflict | Existing AhpErrorCodes.Conflict / `Conflict`; no winner payload |
| Stale attempt, expired cursor or exhausted retry | Existing generic InvalidRequest / `Request rejected` |
| Claim capacity or scan budget | Typed capacity/deferred claim result, not an authorization error or hidden queue count |
| Known database failure | Generic InternalError; diagnostic correlation only |
| Unknown COMMIT result | Owned RepositoryError `outcome_unknown`, mapped to InternalError with bounded `{version:1, kind:"outcome_unknown", correlationId}` data |

The unknown-outcome marker tells an authorized caller to reconcile, not blindly resubmit effects. Submit reconciles with the same idempotency key; get reconciles work state. Complete/fail may subsequently be stale because the first command committed. Never map an unconfirmed commit to a definite rollback or invent a successful result. Keep existing error-object identity checks; an arbitrary thrown object with a numeric code must not become trusted wire data.

Consumer failure formatting extends the existing work hooks:

```ts
interface ApprovedWorkFailure {
  readonly code: string;    // <=64, application-approved safe identifier
  readonly summary: string; // <=512, no secrets; generic fallback
}
interface WorkFailureFormattingContext {
  readonly workId: string;
  readonly kind: string;
  readonly attempt: number;
  readonly reported: WorkFailure;
  readonly signal: AbortSignal;
}
// WorkServiceHooks.formatFailure?(context):
//   ApprovedWorkFailure | Promise<ApprovedWorkFailure>
```

Apply existing callback count/deadline/settlement rules, run the formatter before SQL locking, and recapture its output. Missing/failed formatter uses code `execution_failed` and a generic summary. Raw worker code/message is untrusted advisory input and never automatically becomes a persisted diagnostic. Internal lease-expiry/lifecycle failures use server-defined codes. Default logs contain the approved stable code and correlation fields, not raw messages or payloads.

### 5. Contract acceptance additions

- Every new work method has exact positive/negative Zod fixtures, including unknown-field rejection and attempt required on lease mutations.
- Service results, wire serializers and client parsers agree on the single V1 shapes; no old `work:null` claim fallback remains.
- Undisclosable and nonexistent work have identical public get outcomes; no invalid request leaks data through an error.
- Bounded cursor expiry, actor/filter binding and zero-item continuation are covered by P4-14/P4-21; client capacity by P4-22.
- Work and resource CAS use consistent no-write conflict semantics while keeping their explicit service return styles.
- Unknown outcome uses an owned error; arbitrary thrown `{code,data}` objects still receive generic internal mapping.
- The approved-failure formatter cannot bypass lease/policy checks, run while holding SQL locks or expose unapproved worker text by default.

---

## P0 — durable sessions, canonical resources, and provider lifecycle

**Outcome:** sessions and canonical resource instances survive process loss; provider-owned resources can be reconciled, restored and retired through existing session/provider boundaries.  
**Depends on:** shared contract decisions and exact source baseline.  
**Does not implement:** work scheduling policy, chat inference/turn execution, distributed hosting, automatic grant restoration or a general event store.

### 1. Current implementation and ownership

The session factory currently owns a synchronous in-memory registry and reducer. `dispatchAction` mutates the record and publishes immediately. Provider start is asynchronous; late backend completion already checks record identity and disposes a detached backend. Those safeguards must survive durability.

The existing persistence session repository is a URI-keyed projection. `work.submit` currently ensures that projection inside its transaction. Host `describeSession` synthesizes creation/modification timestamps at read time. Neither path is authoritative session lifecycle persistence.

Extend these owners:

| Owner | Existing files to modify | New supporting files |
| --- | --- | --- |
| Session lifecycle/cache | `src/sessions/types.ts`, `createSession/{helpers,types}.ts`, `helpers/{factory,state,registry,creation}/` | `sessions/helpers/{durability,resources,recovery}/{types,helpers,index}.ts` |
| Type/consumer registration | `sessions/helpers/{application,sessionTypes}/` | Resource driver and restoration registration capture inside these owners |
| Durable repositories | `src/persistence/types.ts`, provider/facade/lifecycle helpers | `persistence/helpers/adapters/postgres/helpers/resources/`, `helpers/ownership/` |
| Host wiring | `websocket/helpers/host/{types,helpers}.ts`, AHP kernel dispatch/disposal callers | No new top-level runtime service |
| Reusable JSON capture | `toolExecution/helpers/value/`, all current imports | `jsonrpc/helpers/value/{types,helpers,index}.ts` |
| SQL | Existing 0001/0002 remain history | `database/migrations/0003_durable_session_resources.sql` |
| Tests/docs | Mirrored under `src/tests/`; module READMEs | Dedicated durable-session and provider-recovery suites |

Update the protected provider-capture path in `sessions/helpers/factory/helpers.ts`: it currently constructs a fresh frozen object containing only providerId, agentInfo, startSession and config. Explicitly capture/bind the new recovery codec, restore/retire callbacks and driver registrations there. Widening SessionProvider alone would silently discard those capabilities, just as widening a policy interface without its capture path would.

### 2. Foundation repository contract

In `./src/persistence/types.ts`, replace the URI-only durable session projection with an exact record. Its fields correspond to the complete target SQL: canonical session ref, exact type ID/key/version, provider, owner, lifecycle, state/graph revisions, timestamps, persisted state and last accepted sequence. A resource record adds parent/grant-parent refs, registration facts, driver identity, provision key, recovery input/receipt, consumer data and revisions.

Keep provider-specific SQL types private. Public records use ISO timestamps and decimal-string revisions/epochs. Do not expose PoolClient, transactions, row locks or database errors through session/provider APIs.

Specify operation-owned atomic methods, rather than allowing consumers to compose unrelated repository calls and assume a transaction:

```ts
// Target operations on the existing persistence provider; names are fixed here.
interface DurableSessionRepository {
  reserve(input: ReserveSessionInput, admission: SynchronousAdmission):
    Promise<DurableSessionRecord>; // session + root together
  get(ref: ResourceRef<"session">): Promise<DurableSessionRecord | undefined>;
  listRecoverable(page: RecoveryPage): Promise<RecoveryPageResult>;
  commitState(input: CommitSessionStateInput, admission: SynchronousAdmission):
    Promise<DurableSessionRecord>;
  transition(input: SessionTransitionInput, admission: SynchronousAdmission):
    Promise<DurableSessionRecord>; // root lifecycle updated atomically too
  beginRetirement(input: RetireSessionInput, admission: SynchronousAdmission):
    Promise<RetirementSnapshot>; // session/root fence + nonterminal work cancellation
  finishRetirement(input: FinishRetirementInput): Promise<void>;
  purge(input: PurgeRetiredSessionInput): Promise<boolean>;
}
interface DurableResourceRepository {
  reserve(input: ReserveResourceInput, admission: SynchronousAdmission):
    Promise<DurableResourceRecord>;
  get(ref: ResourceRef): Promise<DurableResourceRecord | undefined>;
  listSession(input: ResourcePage): Promise<ResourcePageResult>;
  activate(input: ActivateResourceInput): Promise<DurableResourceRecord>;
  replaceData(input: ReplaceResourceDataInput, admission: SynchronousAdmission):
    Promise<ReplaceDataResult>;
  beginRetirement(input: RetireResourceInput, admission: SynchronousAdmission):
    Promise<RetirementSnapshot>;
  finishRetirement(input: FinishRetirementInput): Promise<void>;
}
```

All inputs include the private host ownership fence and exact expected identities. Mutations include relevant expected revisions. Lifecycle completion inputs use host-issued pending-operation ownership, not a public authorized flag.

- `reserve` assigns incarnation/relational IDs/provision key once. A child reserve also increments the parent session's `graph_revision`.
- `commitState` includes expected state revision, next serialized state, modifiedAt and assigned serverSeq; it increments the state revision and persists the sequence checkpoint atomically.
- `activate` stores the provider receipt and sets active only if the exact pending operation and ancestor/session state still permit it.
- `beginRetirement` changes authoritative availability before external cleanup. P0 must already coordinate current work rows; the old “any dependent work blocks deletion” check is insufficient.
- `purge` is a separate trusted retention command. It is never called by ordinary process shutdown or implicitly on a metadata update.
- No successful repository response can carry a live mutable alias into the cache.

Use the existing provider facade/dispose boundary to expose sessions, resources, registrations and work over the **same logical store**. In-memory acceptance adapters implement the same atomic contract using deterministic locking and injected clock, not a new hidden production database.

### 3. Single-host ownership

Add `host_state.ownership_epoch` and an owned lifecycle port on persistence. Host composition calls it once; opening an extra repository pool does not acquire a second host lease.

PostgreSQL steps:

1. On a dedicated retained connection, try a session-level advisory lock for the logical store namespace. The key must not vary by process ID or arbitrary hostId.
2. Fail startup if another host owns the namespace. Verify the stable logical host/store ID; increment the persisted epoch and commit before hydration.
3. Every mutation transaction reads/locks the host-state row and compares its captured epoch. Hold the lock until commit. Use shared mode for ordinary writes; a sequence-checkpoint write acquires its required exclusive row lock **before** session/agent/work locks, never upgrades late.
4. A lock-connection error closes local admission immediately. Outstanding operations may settle under the admission guarantee, but cannot write using an old epoch after a replacement owner has taken the row.
5. A replacement owner cannot become active until its epoch update has waited for old mutation transactions and committed. Recovery then rebuilds live state.
6. Stop drains admitted transactions within configured bounds, releases live resources and finally releases the advisory connection. Do not reuse a connection whose lock ownership became uncertain.

This is protection against overlapping hosts and delayed writes, not active/active scheduling or fencing arbitrary external provider side effects. Provider operations still require idempotency and cooperative cancellation.

### 4. Reserve → provision → activate

Implement one lifecycle coordinator under sessions, not a new independent resource authority.

#### New session

1. Capture/validate native parameters, exact type/provider, normalized config, owner/domain from trusted creation context and consumer approval.
2. Allocate session incarnation and root IDs, stable provision key and serialized provider recovery input.
3. Reserve session + root `creating` in one transaction after final synchronous admission. Unique URI constraints settle competing creates.
4. Attach the exact provisional live record and fresh creation authority only for permitted creating-state operations. A claim/tool operation requiring readiness still denies.
5. Call provider `startSession` with abort signal and per-session resource capability. Provider may create chats/terminals/custom backing resources via registered drivers. Their calls use the same durable reserve/provision/activate protocol.
6. Commit the root/session active transition with recovery metadata only after the backend exists and the exact creation still owns the record. Install it in the cache and publish the native ready transition after the commit.
7. If shutdown/retirement wins while provisioning awaits, never resurrect the old record. Release any late handle; reconcile/destroy by the old provision key as required. A replacement URI is unrelated.

#### Child resource

The host chooses domain/owner/provider facts and canonical registration from trusted registration code. It verifies the parent and optional grant parent belong to the exact session and are valid dependencies. Capture all data before awaiting. Reserve under a session-row graph lock so two inserts cannot race graph validation or a resource-count limit.

Existing edges cannot be reparented in this V1 slice. A parent may be active, or creating under the same scoped creation capability; a child below a nonoperational ancestor is never independently executable. Register canonical route facts and separate grant inheritance; parent selection does not itself issue grants.

#### Failure ownership

| Failure window | Required durable/live result |
| --- | --- |
| Reserve fails | No external provision call, no live publication |
| External create fails | Failed/unavailable record; approved bounded diagnostic; no active authority |
| External create succeeds; receipt commit fails/unknown | Reconcile the same provision key; do not invent a second resource |
| Durable active commit succeeds; live install fails | Fence, suspend/reconcile, release local handle; retain durable identity |
| Timeout while callback still running | Abort signal and unavailable state; keep settlement slot/ownership until actual settlement |
| Late success after retirement | Release/destroy only the old instance; never reattach or overwrite replacement metadata |

A cleanup exception must not prevent cleanup attempts for sibling resources. Aggregate sanitized completion diagnostics while retaining each unresolved resource's recovery state.

### 5. Restart and recovery

The host must hydrate durable identities before serving operations that depend on them. `start()` acquires ownership, loads bounded recovery pages, reconstructs canonical facts through the trusted registrations, and schedules bounded provider recovery. Listening may begin while individual restores are pending, but such sessions stay unavailable for execution and are not advertised as ready.

- Resolve the exact session type/provider/driver version. Do not silently pick latest.
- Revalidate `registration_data` against current trusted type/provider rules. Persisted routes/mandatory refs are facts to verify, not proof that a grant exists.
- Invoke the new restoration approval boundary to install fresh allowed bindings. Missing registration/approval means suspended.
- For `creating`, call idempotent driver ensure/reconciliation using the saved operation key. For active/suspended with a completed receipt, call restore. For retiring, resume destruction. Never restore retired instances.
- Rebuild parent/grant dependencies in order. A child cannot become operational before its ancestors.
- Restore only the explicitly serialized state. Clear activeClients, sockets, subscriptions, live tool advertisements, managed proposal activation, presence, proof caches and live handles.
- Do not invent a native Microsoft `suspended` lifecycle value. The durable lifecycle is separate; native ready snapshots are exposed only after successful restoration. Trusted server inspection can report suspended/failed durable records.
- Seed the shared sequence from the durable host/session checkpoint. A new host ownership epoch invalidates prior work-stream cursors; missing events are recovered through snapshots, not replay.

Recovery failures are isolated per session where storage remains healthy. A database/ownership failure keeps the host closed. Expose bounded in-process recovery status/diagnostics so an application can distinguish pending, restored and suspended instances without publishing private data.

### 6. Durable state writes and sequencing

Define the actual baseline codec in `./src/sessions/helpers/durability/types.ts`; never serialize the entire live SessionState by object spread:

```ts
import type { SessionState } from "@microsoft/agent-host-protocol";
export interface PersistedSessionStateV1 {
  readonly version: 1;
  readonly title: SessionState["title"];
  readonly isRead: boolean;
  readonly isArchived: boolean;
  readonly workingDirectories?: readonly string[];
}
```

The pinned upstream represents read/archive as `SessionStatus.IsRead` / `IsArchived` bits, not `SessionState.isRead` properties. Encode those bits explicitly. Restore the permitted flags with an idle activity baseline; derive provider from the exact durable registration and lifecycle from current recovery. Reconstruct current server tool/type metadata from trusted registrations. Do not restore activeClients, old in-progress/input-needed activity, creation errors, executor advertisements or cached managed-tool activation. Current baseline client actions mutate title/read/archive and active-client membership; membership remains transient, even if the durable command checkpoints its revision/sequence. Initial approved working directories round-trip through the codec and are revalidated by restoration approval/provider recovery.

Canonical chat/resource recovery remains in resource rows/registered drivers; the baseline has no implemented native chat catalogue writer to serialize. Adding accepted durable native fields later requires an explicit codec extension and round-trip test. This packet does not falsely claim to persist every member of the upstream SessionState union or to restore native chat execution. Root application data stays in the canonical root's separate data object.

Change `SessionsFactory.dispatchAction` to return `Promise<ActionEnvelope>` in V1. Update all production callers, handler tests, test fixtures and examples. No sync wrapper pretending completion is durable.

Implement a bounded host state-write/publication sequencer:

1. Validate and stage a reducer transition on detached state; capture expected record/state revision and prepared authorization.
2. Enter the sequenced write slot. Acquire host checkpoint lock before session locks. Recheck the staged revision, exact instance and final admission.
3. Allocate the shared serverSeq, persist next state/revision/checkpoint, await commit.
4. Only after confirmed commit install the cache state and publish in the same ordered slot.
5. On a known rollback leave cache and listeners untouched. On unknown commit outcome suspend/reload that exact session; do not return an invented rollback guarantee.
6. Release the slot in finally. Bound queue entries and deadlines. Provider provisioning is outside this slot.
7. Work hints enter the same publication order **after** their own transaction commits; a hint may be dropped on bounded overflow and recovered by reconciliation.

Audit every sequence producer, including server-originated ready/failure actions and root summary/count changes. Never allocate sequence N before an awaited commit and allow another producer to publish N+1 first. Rejected operations may consume gaps; remove comments promising gap-free replay. Preserve final synchronous send guards.

There is no requirement that every transient hint be durably checkpointed. serverSeq is ordered within the active host stream; streamEpoch/reinitialization prevents comparing unrelated restart streams.

### 7. Retirement and physical cleanup

Explicit retirement requires the relevant session/resource permission or trusted provider capability. Capture the expected incarnation once at request admission.

1. Close admission locally and mark the exact root/resource `retiring` durably under its session lock.
2. Cancel queued and leased work that cannot remain valid; clear all lease fields atomically and invalidate private work guards. Explicit deletion is a hard lifecycle boundary: the authority-loss hook cannot resurrect that work. Preserve terminal records.
3. Withdraw grants/subscriptions/delivery rights, abort pending creation and execution guards, and hide the live resource.
4. Invoke idempotent child destroys in reverse dependency order, then the provider's session retirement callback. Releasing a process handle and destroying a durable resource are separate calls.
5. Mark resources and session retired only when their required destruction has succeeded; update root/session lifecycle in one transaction. Set retired_at consistently.
6. On timeout/failure keep retiring state and allow exact-instance retry/recovery. Do not report completed deletion. Native dispose awaits this operation and returns a sanitized error if the bounded completion fails.
7. A later trusted purge selects terminal work under an explicit retention policy, removes its selectors/work, then retired dependency leaves/resources and finally the session. FK restrictions catch accidental history deletion.

For a child resource, compute the bounded dependent closure through both containment and grant-parent edges under the session graph lock. A work item is cancelled when any positive immutable scope anchor falls inside that closure; an announcement-only or excluded anchor does not cause cancellation. Deleting a dynamic descendant beneath an otherwise retained included parent does not cancel the whole work item, but invalidates affected work guards and makes that target unavailable. Never remove or rewrite immutable selector rows merely to keep a job eligible. Whole-session retirement cancels all its nonterminal work.

Shutdown follows a different path: deny new admissions, drain bounded admitted work, invalidate live presence/guards, release handles, dispose transport/listeners/persistence. It **does not** call durable destroy/retire or delete SQL rows.

### 8. SQL and migration acceptance

Author 0003 against the existing empty baseline. Refuse legacy session/work/registration rows without a trusted mapping. Add domain/incarnation/resource/epoch foundation, new root checks, recovery fields and resource data CAS. Map existing empty work identity/FK columns to the new parent identity so P0 remains buildable; P1 adds its submission fields and selections.

Use the supplied target schema as the end-state specification. Important constraints include same-domain/session composite FKs, public identity uniqueness, only one nonretired URI, exact root/session equality, distinct opaque resource instance IDs, JSON object checks and retirement consistency.

Do not claim cross-row graph acyclicity or callback semantics from a JSONB column. Enforce graph insertion, combined dependency cycles and immutable edges in the repository transaction. The optional raw SQL smoke script covers DDL; real adapter tests cover these service/repository rules.

### 9. Required acceptance evidence

| ID | Test and observable result |
| --- | --- |
| P0-01 | Two concurrent creates of one URI: exactly one instance/root/provision call; losing request has no authority |
| P0-02 | SQL reserve rollback: zero live record/events/external calls |
| P0-03 | Database write fails on native action: live snapshot/revision and accepted event count unchanged |
| P0-04 | Two concurrent staged updates: one stale revision is rejected/retried after reauthorization; no lost update |
| P0-05 | Crash after external provision before receipt: restore/ensure finds the same operation key; external resource count remains one |
| P0-06 | Shutdown while start/child create is pending: late handle released, durable row retained, no late ready event |
| P0-07 | Restart: same canonical refs and data; fresh backend/bindings; no old sockets, grants, advertisements or presence |
| P0-08 | Missing/mismatched type/provider/driver/restoration approval: suspended, no claims/tools, actionable sanitized diagnostic |
| P0-09 | Exact child-parent and grant-parent FK rejection across domain/session; repository rejects self/combined cycles and reparent |
| P0-10 | Data round-trip including nested arrays/Unicode/empty object; reject unsafe/unbounded values before SQL |
| P0-11 | Two data replacements with one expected revision: exactly one wins; no event on loser; original input mutation cannot alter storage |
| P0-12 | Retire with queued/leased/terminal work: nonterminal fenced/cancelled; terminal retained; cleanup resumes after failure |
| P0-13 | URI reuse: new incarnation has no old work/data/grants; stale completion cannot alter it |
| P0-14 | Physical purge rejects live/dependent/unretained rows; explicit terminal purge then resource/session purge succeeds |
| P0-15 | Two hosts sharing a namespace: second start fails; multiple pools for one host succeed; lost owner connection closes admission |
| P0-16 | Old pool transaction delayed across ownership takeover: expected-epoch guard fails; new host waits prior admitted transaction appropriately |
| P0-17 | Real PostgreSQL deferred root constraints reject missing/mismatched roots; both insert/update orderings within valid transaction pass |
| P0-18 | Async native dispatch remains interoperable through the public binding and pinned Microsoft client; accepted envelope only after commit |
| P0-19 | A non-settling callback cannot free/reuse a lifecycle capacity slot; unrelated cleanup still attempted |
| P0-20 | Interleaved state commits and work-ready publication never emit descending host sequence values; safe-integer overflow fails closed |
| P0-21 | Child retirement cancels work anchored in its dependent closure; other work survives a dynamic-descendant removal but cannot act on the retired target |
| P0-22 | Independent child-data writers sharing a session do not deadlock on a deferred root-check lock upgrade; lifecycle writers acquire exclusive session locks before dependent mutations |
| P0-23 | Protected provider capture preserves/binds restore, retire, recovery codec and registered drivers; mutating caller registrations later has no effect |
| P0-24 | Title/read/archive/approved working directories survive restart; transient activity/clients/tool advertisements do not; codec matches pinned enum bits |

### 10. Test/app commands and exit gate

Extend `src/tests/persistence/conformance/helpers.ts` with storage-neutral durable-resource tests and `src/tests/persistence/adapters/postgres/conformance.ts` with real PostgreSQL tests. Add `src/tests/sessions/durability.test.ts`, `resourceLifecycle.test.ts`, `recovery.test.ts`, and public-host restart tests under `src/tests/websocket/`.

Update `examples/advanced/persistence.ts` to implement the new ports. Add `examples/durable-lifecycle.ts`: loopback host, explicit test storage, provider-backed session plus chat/resource, data write, stop/restart, same-instance recovery, explicit retirement. It must run with a deterministic in-memory provider for routine validation and with an explicitly supplied disposable PostgreSQL database for SQL acceptance.

Required commands:

```sh
pnpm exec vitest run src/tests/sessions src/tests/persistence
pnpm exec vite-node examples/quickstart.ts
pnpm exec vite-node examples/advanced/index.ts
pnpm exec vite-node examples/durable-lifecycle.ts
pnpm exec vite-node examples/postgresql-conformance.ts
pnpm validate
```

The PostgreSQL command requires a migrated disposable loopback database via `AHP_TEST_DATABASE_URL`; it must not silently skip, use a production database or be replaced by a query stub. Record actual evidence separately from offline checks.

**Exit gate:** durable create/update/restart/retire/purge and ownership fencing pass with real SQL and public SDK tests; current-state docs describe the implemented behavior; unresolved external callback failures remain observable unavailable state. P0 is incomplete if sessions are merely written by an event listener after in-memory acceptance.


---

## P1 — work contracts, canonical selections, priority, data and idempotency

**Outcome:** a work item has an exact parent incarnation, immutable intent/provenance, deterministic scope and announcement rules, and separately mutable application data.  
**Depends on:** P0 durable identities, coherent repositories and lifecycle fences.  
**Boundary:** remote work mutation remains disabled until P3 policy, epoch and capacity integration passes.

### 1. Existing files and target ownership

Modify `src/work/{types.ts,index.ts,helpers/helpers.ts}`, `src/persistence/types.ts`, the PostgreSQL work repository/row mappers, `src/websocket/helpers/ahp/agentWork.ts`, session-type/application capture, and the in-memory test/example adapters.

Add selection behavior under `src/work/helpers/selections/{types,helpers,index}.ts`; add work-kind definition capture under `src/work/helpers/definitions/`. Session types reference that work-owned definition contract. Do not put SQL in the work service or policies in a wire parser.

Create `database/migrations/0004_work_policy_scheduling.sql` for the final work shape: priority, domain/incarnation FK, submitter facts, data/submitted_data/revisions, lease execution epoch, failure fields, selector table and indices. P3 implements the lease behavior against these fields. Match the end-state SQL exactly.

### 2. Submission API and normalization

Use the shared `WorkSubmission` shape. A request may name its session explicitly or let its narrow positive resource references imply one session. The server resolves every referenced instance in the trusted domain. A claimed chat parent supplied in JSON is ignored/rejected; actual parentage comes from P0.

Recommended consumer shape:

```ts
// Target usage in ./examples/advanced/work.ts
const submission = {
  requestKey: "review-request-42",
  kind: "review",
  priority: 10,
  input: { artifact: "artifact_example" },
  scope: [
    { resource: { kind: "session", id: sessionUri }, include: true, includeDescendants: true },
    { resource: { kind: "chat", id: privateChatUri }, include: false, includeDescendants: true },
  ],
  announce: [
    { resource: { kind: "chat", id: reviewChatUri }, include: true },
  ],
  data: { ui: { label: "Review draft" }, checkpoint: null },
} satisfies WorkSubmission;
```

A task restricted to one chat needs only that chat in scope. The server stores the exact session and chat incarnations. No parent entry is required merely to reconstruct ancestry.

Normalization is deterministic:

1. Capture bounded plain JSON and strict top-level request keys.
2. Resolve work kind in the exact session type; run its captured input/data parsers and recapture output. Parsers must be deterministic for repeated input.
3. Apply priority 0, data {}, announce [], includeDescendants false, and absent target as null.
4. Resolve locators to full canonical refs and internal resource PKs. A supplied expected instance must match current canonical identity.
5. Require one root/domain and at least one positive scope selection.
6. Normalize selections by purpose + full identity. Identical duplicates collapse; contradictory duplicates fail.
7. Freeze the normalized command. Application parsers and request objects cannot mutate it after an await.
8. P2 prepares authority; the repository transaction validates exact current rows/revisions and inserts work + both selector sets atomically.

Reject decimals, NaN, infinity and out-of-int32 priority values before SQL. Higher values have greater scheduling precedence. Priority is immutable in this slice.

### 3. Selector evaluation contract

Use canonical **containment**, not grant-parent links, to determine membership. Grant-parent/explicit route information remains part of authorization.

```ts
// Algorithm contract for ./src/work/helpers/selections/helpers.ts
function selected(target: ResourceRef, rules: readonly WorkResourceSelection[],
                  ancestryNearestFirst: readonly ResourceRef[]): boolean {
  for (const [distance, ancestor] of ancestryNearestFirst.entries()) {
    const rule = rules.find((entry) => sameResource(entry.resource, ancestor));
    if (rule !== undefined && (distance === 0 || rule.includeDescendants)) {
      return rule.include;
    }
  }
  return false;
}
```

The implementation must build ancestry from bounded trusted repository/cache facts; the caller does not supply `ancestryNearestFirst`. Use an indexed map rather than repeated linear `find` in the final helper. Verify the captured graph revision before admission.

| Rules | Target | Membership |
| --- | --- | --- |
| Session include + descendants | Current child chat | Included |
| Session include + descendants; chat exclude | That chat | Excluded |
| Same, chat exclude without descendants | Chat's child terminal | Inherited session include |
| Same, chat exclude + descendants | Chat's child terminal | Excluded |
| Excluded chat subtree; terminal explicit include | That terminal | Included, if permission also allows |
| Chat include without descendants | Sibling or child terminal | Not included |
| Old chat incarnation included | Replacement chat with same URI | Not included |
| No announce rules | Any notification target | Not selected |

A retired selected resource cannot silently become a different instance. Existing work may retain its selector row for audit; execution eligibility fails when its required positive anchor is unavailable. A newly created descendant can match a parent selector, but every actual operation still needs ordinary authorization and applicable mandatory restrictions.

P0 cancels nonterminal work if any positive scope anchor is explicitly retired. Removing only a dynamic descendant under a retained positive anchor does not cancel the entire item; canonical availability and work guards deny operations on the retired target. Negative or announcement-only anchors are not execution requirements.

Do not equate two selector sets merely because they expand to the same resources today. They may differ for future children. Replay comparison uses normalized rules, including includeDescendants.

### 4. Work state and schema

The state machine remains queued → leased → completed/failed/cancelled, with retryable failure/expiry returning to queued or enabling a replacement lease when budget remains.

Persist:

- Exact session_instance_id/domain, work kind, requestKey, priority and immutable input.
- Server-derived submitter actor kind/subject/optional canonical agentId.
- Optional target registration in the same domain. An owner's principal equality is not the target-eligibility rule; P2 decides current executor eligibility.
- `submitted_data` and mutable `data`, initially equal.
- `revision` for every state/data/lease mutation, `data_revision` only for data replacement.
- Lease token, registration ID, execution epoch and deadline only when leased.
- Attempt count/maxAttempts; separate from concurrent capacity.
- Result only when completed; sanitized latest failure code/summary/time.
- Separate scope/announce selector rows with exact composite FKs.

Work owner comes from the canonical parent session. Never persist a separately writable workOwner field.

Keep attempt limits in trusted session/app work configuration. They are not a caller permission/capacity field. The resolved maxAttempts is part of immutable stored submission intent. If a replay arrives after host defaults changed, look up the existing request before deriving a different default: compare client-supplied immutable values and the exact originally pinned type configuration, and do not reinterpret an existing request under a new default. Exact session-type versions are immutable registrations.

The schema's lease check must explicitly require **all fields present for leased, all fields null otherwise**. The earlier boolean equivalence with “all are nonnull” permitted partially populated lease fields on a nonleased row; it is replaced.

### 5. Idempotency and commit outcomes

Unique key: `(session_instance_id, kind, request_key)`.

For an existing key, compare:

| Included in replay equality | Excluded from replay equality |
| --- | --- |
| Exact session incarnation, kind, requestKey | Status and work revision |
| Normalized input and priority | Mutable data/dataRevision |
| Original submitted_data | Result and diagnostics |
| Target registration or null | Lease token/epoch/deadline |
| Stable submitter actor identity | Connection ID, current presence and generation |
| Normalized immutable scope and announce rules | Current expanded descendants |
| Originally resolved retry configuration | Attempt count |

Object key order does not matter; array order does. PostgreSQL JSONB equality and the in-memory structural comparator must agree for supported JSON values. Do not rely on raw JSON.stringify order.

Identical replay returns the same ID in **every** status, including failed/cancelled/completed. Remove the current service exception for failed/cancelled replay. It emits no submitted event and does not reset priority/data/status/attempts. A different submitter cannot discover or take over an existing row merely by guessing its key; P2 performs current submit/read visibility checks before returning any identity.

Exact authorized replay does not reserve a new active-work slot or fail solely because a submission quota is full. Resolve the existing key before new-row reservation and recheck after conflict/capacity races. Keep an uncertain-submit reservation until reconciliation under the same session/key fences determines whether the row committed.

The transaction inserts work and selectors together. On a duplicate insert conflict, read/compare the committed row and selector set inside the same repository operation. A concurrent conflicting request must not partially replace selectors or data.

If COMMIT outcome is unknown, return a sanitized storage/uncertain-outcome error. A retry with the same key recovers the committed identity. Do not allocate a second key automatically and do not claim a rollback merely because the client connection failed.

### 6. Data mutation API

#### Target `./src/work/types.ts`

```ts
interface WorkService {
  updateData(
    caller: WorkRequestContext,
    workId: string,
    change: ReplaceData,
    execution?: WorkExecutionRef,
  ): Promise<DataSnapshot>;
}
```

The wire equivalent is `x-ahp/work/updateData` with `version:1`, workId, expectedDataRevision, data and optional work-execution reference. The host derives the actor and execution epoch; the packet cannot supply owner, permissions, capacity or trusted identity.

P2 authorizes this operation. If the acting identity is using its executor role, require its exact active lease. An application may separately grant a user/owner metadata-update permission; do not hardcode it. A terminal work item may be annotated by an independently permitted actor while its parent remains accessible; an old executor lease is insufficient.

Whole-object replacement uses:

```sql
UPDATE work_items
SET data = $1::jsonb,
    data_revision = data_revision + 1,
    revision = revision + 1,
    updated_at = clock_timestamp()
WHERE id = $2
  AND session_instance_id = $3
  AND data_revision = $4::bigint
RETURNING data, data_revision, revision;
```

This statement is the CAS portion, not the entire authorization/locking transaction. It runs after exact host/session/actor/lease checks. Empty RETURNING means a stale update; it is not permission to overwrite.

Completion/failure may optionally include the same `ReplaceData` object so an executor can save its final checkpoint and terminal result in one atomic fenced settlement. If dataRevision is stale, the entire settlement fails; no partial result/status mutation. Without a data change, settlement leaves dataRevision unchanged.

No generic remote resource-data CRUD is added in P1. P0's scoped trusted resource helper and application-specific authorized operations are the extension point.

### 7. Read models and pagination preparation

Define three projections, with explicit serializers:

- Internal repository record: full immutable intent, selectors, provenance and lease fields.
- Authorized work view: selected input/result/data/provenance, revisions and status; never leaseToken or raw private recovery/policy metadata.
- Work list summary: ID, exact session, kind, priority, status, timestamps and revision; omit input/result/data by default so pagination has a predictable budget.

P2 decides whether each projection is visible. P4 adds list/subscription wiring. Targeted agent information or failure summary is included only if the view policy permits it.

Use immutable `created_at,id` for list keysets; priority-claim scans use `priority DESC,created_at,id`. Preserve database timestamp precision in opaque cursors. A pg Date converted to milliseconds must not truncate the microseconds used by SQL keyset comparisons.

### 8. Acceptance tests

| ID | Evidence |
| --- | --- |
| P1-01 | Narrow chat scope resolves the real session with no explicit parent entry |
| P1-02 | Mixed-session/domain/unknown/stale-instance locators reject without writing or revealing foreign data |
| P1-03 | Table-driven selector truth table above, nested reinclusion, future descendants and graph-revision invalidation |
| P1-04 | Canonical selection order/identical duplicates do not affect replay; contradictory duplicates fail |
| P1-05 | Parent selector and today's equivalent explicit-child list remain distinct immutable intents |
| P1-06 | Signed int32 extrema accepted; decimals/overflow rejected; priority round-trips exactly |
| P1-07 | Same requestKey, different kind produces separate work; same key/kind/instance produces one row |
| P1-08 | Two concurrent identical submissions produce one work+selector set; different immutable values conflict |
| P1-09 | Exact replay after mutable data changes and all terminal states returns original ID, without events or resets |
| P1-10 | Recreated session URI does not collide with old session work |
| P1-11 | Mutating caller objects during awaits cannot change stored data/input/selectors |
| P1-12 | CAS race has one winner; failed CAS leaves both revisions/event count unchanged |
| P1-13 | Final data replacement + complete/fail is atomic, including stale data revision rollback |
| P1-14 | Ordinary read/list serialization never includes lease token, private registration/recovery facts or submitted_data |
| P1-15 | SQL rejects partial lease tuples, result on noncompleted work, null/non-object data and cross-session selectors |
| P1-16 | A work row without a positive scope cannot commit; multi-row insert with valid scope does commit |
| P1-17 | Simulated unknown submit COMMIT outcome recovers through identical replay rather than duplicate job |
| P1-18 | Database/in-memory equality agrees for supported nested JSON, Unicode and array/object ordering |
| P1-19 | Limits include negative exclusions, duplicate normalization work, total elements and future-descendant expansion |
| P1-20 | Type catalogue capture preserves new work descriptors/parsers while SQL manifests contain no functions |
| P1-21 | Exact replay succeeds with a full active-work quota and consumes zero new slots; uncertain submit keeps its reservation until fenced reconciliation |
| P1-22 | Concurrent raw SQL deletion of different positive selector rows cannot both commit leaving zero positive scope; the deferred trigger serializes on their work row |

Extend existing `src/tests/work/workService.test.ts`, `src/tests/persistence/contracts.test.ts`, PostgreSQL work tests and session-type tests; add `src/tests/work/selections.test.ts` and `data.test.ts`. Update current fixtures instead of leaving an alternate legacy contract.

Run focused work/persistence/session-type suites, in-memory advanced application, real PostgreSQL conformance and `pnpm validate`. P1 is not remotely enabled until P3; this is an intentional fail-closed integration gate, not a feature flag for two public protocol versions.


---

## P2 — work authorization, typed participants, scoped execution and consumer hooks

**Outcome:** consumers define work policy through the existing authorization/type-registration system; AHP enforces it consistently from submission through execution, settlement, data access and delivery.  
**Depends on:** P0 exact durable resources and P1 immutable work contracts.  
**Default:** no registered operation/grant means deny.

### 1. Extend the existing boundaries

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

### 2. Session and application work policy

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

### 3. Typed participant flow

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

### 4. Operation policy matrix

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

### 5. Async preparation and local admission

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

### 6. Work scope during actual resource/tool calls

The host must enforce scope on operations explicitly executed for a work item.

#### Existing seams to extend

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

### 7. Consumer authority-loss callback

#### Target: `./src/work/helpers/authorityLoss/types.ts`

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

### 8. Test requirements

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

### 9. App integration and exit gate

Update the advanced application to declare explicit submit/read/execute/cancel/data/announce policies; demonstrate a worker selected by trusted ActorResolver and configured registration mapping. Keep example roles fake and application-defined.

Run work/agents/session-policy suites, protected websocket/egress/tool-dispatch suites, the advanced sample, tagged work tool/resource flow and `pnpm validate`. P3 must still prove database concurrency; P2's policy tests are not that proof.

**Exit gate:** every work entrypoint and tagged execution path uses one coherent canonical authorization system; no subject-only owner bypass remains; callback/admission/disclosure semantics are tested and documented. Keep remote mutations closed until P3 passes its real-database epoch/capacity gates, then enable the V1 work handlers.


---

## P3 — atomic priority claims, agent capacity, lease fencing and diagnostics

**Outcome:** work acquisition and settlement are correct under competing requests, reconnects, expiry, retries and database lock waits.  
**Depends on:** P0 host/incarnation fences, P1 schema/contracts, P2 prepared canonical authority.  
**No additions:** autonomous worker runtime, scheduling daemon, Redis, distributed queue or inferred caller permissions.

### 1. Files and public configuration

Extend `src/agents/types.ts`, `helpers/directory.ts` and new `helpers/workConfiguration/`. Extend work service/repository contracts and `persistence/helpers/adapters/postgres/helpers/{workItems,agentRegistrations}/`. Update `websocket/helpers/host/`, `helpers/ahp/agentWork.ts` and current tests/examples.

Use the trusted global default and full-identity override contract from shared decisions. `createAgentWorkConfig` returns a captured configuration handle with:

```ts
interface AgentWorkConfiguration {
  resolve(identity: RegisteredAgentIdentity): {
    readonly revision: Revision;
    readonly maxActiveClaims: number;
    readonly allowedKinds?: readonly string[];
  };
  replace(input: AgentWorkConfig): void; // trusted in-process application method only
}
```

Validate the complete replacement before atomically installing it. Increment its local configuration revision. In-flight acquisition prepared under a changed limit must re-resolve before admission/retry. A capacity-only reduction does not invalidate existing work effects or cancel/deny valid renewals. Removing an allowed kind or changing authorization does re-evaluate affected executor authority. No remote endpoint can write this configuration. Omitted per-agent allowedKinds inherits the required finite host/session intersection; an explicit empty set denies all kinds.

Default `maxActiveClaims=3`; zero pauses acquisition. Per-identity override replaces the global default. The stable identity includes domain/principal/key and the application-assigned canonical actor mapping. No override by displayName or agentKey alone.

### 2. Durable binding epochs

Make agent binding asynchronous. Registration/presence are different operations even if one wire request orchestrates both.

1. Authenticate/resolve the canonical actor and reserve bounded pending binding capacity.
2. Resolve/register the durable identity in the same domain/principal; apply existing persistent registration quotas.
3. Atomically validate enabled and increment execution_epoch.
4. Recheck the exact connection and pending reservation, then publish memory presence containing executionEpoch.
5. Return the registration identity/presence lifetime; trusted epoch need not be writable or selected by the client.
6. If disconnect happens during SQL, publish nothing and never reverse the increment.
7. Disable immediately denies new local admission, then commits disabled + epoch increment; re-enable also increments but creates no presence.
8. Late disconnect cleanup touches only its own connection/generation/epoch.

The current local generation remains useful for transport ownership; it is not the durable epoch. A fresh process must never reuse an earlier epoch. Old unexpired leases remain capacity-consuming until released/expired, even after a new binding.

Preserve current binding idempotency: a repeat for the same current connection/identity returns the same live binding and epoch. A different connection cannot replace a still-live binding; it receives a conflict. Reserve both identity and connection ownership before the SQL await so concurrent new binds cannot both publish. Coalesce/reject duplicate pending requests deterministically within the existing bounded owner. A disconnect invalidates its pending reservation; a new later connection must obtain a newly incremented epoch. An uncertain bind commit produces no presence until fenced reconciliation; never roll its counter backward.

### 3. Candidate selection before SQL mutation

Consumer policies can require asynchronous work; do not execute them while holding row locks.

- Scan coarse eligible candidates using exact session/domain, allowed kinds, target compatibility, queued/expired state and remaining attempts.
- Order by `priority DESC, created_at ASC, id ASC`.
- Read 32 candidates per page, at most 128 examined per call. Prepare policies and scope facts with bounded concurrency.
- Preserve a server-owned keyset continuation when a denied page hides deeper work. Bind it to exact agent epoch, session, filter, authority/config/graph revision and host epoch.
- Retain at most 1,024 continuations with finite expiry. A changed authority/filter/epoch resets that sweep. A completed sweep starts again from the priority head.
- Pass only genuine prepared candidate IDs and exact work revisions to the mutation transaction.
- Never pass a client-supplied list of authorized IDs, maxClaims or allowedKinds.

Priority means the highest permitted **unlocked** candidate in the current evaluated sweep. New arrivals and policy changes may interleave. There is no strict global fairness or starvation-free priority-aging promise. A locked urgent item can be skipped; low priority can wait behind sustained higher-priority arrivals.

#### Claim result

Use an explicit V1 result so clients do not confuse a bounded partial scan with an empty queue:

```ts
type WorkClaimResult =
  | { readonly status: "claimed"; readonly lease: WorkLease }
  | { readonly status: "empty" }
  | { readonly status: "capacity" }
  | { readonly status: "deferred"; readonly retryAfterMs: number };
```

`deferred` means the scan/recheck budget ended or bounded admission is busy; it is retryable and contains no unauthorized row counts. `empty` means a complete sweep found no currently eligible candidate, subject to concurrent arrivals. `capacity` refers only to the caller's trusted limit. Update current null-return clients/examples directly; no dual protocol path.

Preserve exact database timestamp precision in scan cursors. Use a database-returned UTC microsecond string/opaque tuple, not a JavaScript Date that discards ordering precision.

### 4. Claim transaction: order is part of correctness

Use READ COMMITTED and a single checked-out client. The query double tests are useful but real two-pool tests must prove lock/snapshot behavior.

```sql
-- 1. BEGIN and guard the captured host ownership epoch.
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT ownership_epoch
FROM host_state
WHERE host_id = $host_id
FOR SHARE;
-- adapter rejects if the row/epoch differs from the private host fence.

-- 2. Lock exact session and any required canonical rows in stable order.
SELECT session_instance_id, domain_id, lifecycle_status, graph_revision
FROM sessions
WHERE session_instance_id = $session_instance_id AND domain_id = $domain_id
FOR SHARE;
-- adapter verifies active operational incarnation and prepared graph facts.

-- 3. Acquire the REQUESTING agent's capacity lock in its own awaited statement.
SELECT id, domain_id, principal_subject, agent_key, enabled, execution_epoch
FROM agent_registrations
WHERE id = $agent_id AND domain_id = $domain_id
FOR UPDATE;

-- 4. Only NOW start a NEW statement so its snapshot includes the prior lock holder.
SELECT count(*)::integer AS active_claims
FROM work_items
WHERE lease_agent_id = $agent_id
  AND status = 'leased'
  AND lease_expires_at > clock_timestamp();
-- includes all sessions/kinds/old epochs. Return capacity if count >= effective cap.

-- 5. Pick one already-prepared candidate, locked without waiting behind other work.
SELECT w.*
FROM work_items AS w
JOIN unnest($candidate_ids::uuid[], $candidate_revisions::bigint[])
  AS permitted(id, revision) ON permitted.id = w.id AND permitted.revision = w.revision
WHERE w.session_instance_id = $session_instance_id
  AND w.domain_id = $domain_id
  AND w.kind = ANY($allowed_kinds::text[])
  AND (w.target_agent_id IS NULL OR w.target_agent_id = $agent_id)
  AND w.attempt_count < w.max_attempts
  AND (w.status = 'queued'
       OR (w.status = 'leased' AND w.lease_expires_at <= clock_timestamp()))
ORDER BY w.priority DESC, w.created_at ASC, w.id ASC
FOR UPDATE OF w SKIP LOCKED
LIMIT 1;

-- 6. Read current time/locked facts as needed, then invoke the synchronous
--    host-owned admission closure exactly once before the guarded mutation.

-- 7. Token is a newly generated server UUID. No consumer callback between
--    final local admission and handing this mutation to the database client.
UPDATE work_items
SET status = 'leased',
    lease_agent_id = $agent_id,
    lease_execution_epoch = $execution_epoch::bigint,
    lease_token = $new_token,
    lease_expires_at = clock_timestamp() + ($lease_ms * interval '1 millisecond'),
    attempt_count = attempt_count + 1,
    revision = revision + 1,
    updated_at = clock_timestamp()
WHERE id = $work_id AND revision = $expected_revision::bigint
  AND attempt_count < max_attempts
  AND (status = 'queued'
       OR (status = 'leased' AND lease_expires_at <= clock_timestamp()))
RETURNING *;
COMMIT;
```

The variables above are named placeholders explaining the actual query sequence; implement positional parameters through the existing adapter. Validate candidate-array lengths and numeric bounds; no interpolated SQL.

The service verifies current enabled registration/epoch, policy, presence, required resource readiness and configuration before mutation, using actual locked data. SQL checks expected identity/epoch and row predicates as well. Do not replace these with caller-originated `authorized: true`.

If selection/admission becomes stale, roll back and boundedly re-prepare; never skip mandatory authority checks to use the remaining candidate. Revalidate disclosure after commit. Publish only the confirmed new revision.

**Do not merge steps 3 and 4 into one lock-and-count CTE.** A statement can begin its snapshot before waiting on the lock. The new statement after lock acquisition is the required visibility boundary. PostgreSQL documents READ COMMITTED command snapshots and the intentionally inconsistent queue view of SKIP LOCKED.

### 5. Renewal and settlement

#### Renew

Lock host → session/resources → requesting agent → exact work row. After the work lock has actually been acquired, evaluate a **fresh database time** and all current predicates in the mutation statement:

```sql
UPDATE work_items
SET lease_expires_at = clock_timestamp() + ($lease_ms * interval '1 millisecond'),
    revision = revision + 1, updated_at = clock_timestamp()
WHERE id = $work_id
  AND session_instance_id = $session_instance_id
  AND status = 'leased'
  AND lease_agent_id = $agent_id
  AND lease_execution_epoch = $execution_epoch::bigint
  AND attempt_count = $attempt
  AND lease_token = $token
  AND lease_expires_at > clock_timestamp()
RETURNING lease_expires_at, revision;
```

Registration enabled/epoch and session/resource facts are checked under the locks and local admission. A `statement_timestamp()` from the earlier lock-waiting query cannot authorize revival after expiry. Renewing an existing unexpired lease does not acquire a new capacity slot, so cap reductions do not deny it.

#### Complete/fail/cancel

Complete/fail require token + attempt + registration epoch + exact session and deadline, with current policy/presence. Release-only operations need not lock the agent after a work row; never introduce that reverse order. A concurrent new claim may conservatively count a lease about to be released, which can delay a claim but cannot exceed the cap.

- Complete validates result, optionally replaces data with CAS, sets completed, increments revision and clears every lease field.
- Retryable fail queues only when attempt_count < max_attempts; otherwise failed. Capture approved failure code/summary/time. Clear all lease fields.
- Cancel requires separate authority, changes queued/leased to cancelled, increments revision and clears all lease fields. Terminal cancellation is a no-op after permission checking.
- A repeated settle with a now-cleared token may return stale. It does not mutate or emit twice; the worker resolves an uncertain outcome through authorized get. No terminal token-history ledger is added.
- A changed token/attempt/epoch must never settle or annotate a newer attempt.

Before sending any lease/data/retirement mutation to SQL, mark affected private guards settling after final admission; they cannot remain usable while outcome is uncertain. A known rollback allows fresh preparation, a confirmed commit installs fresh facts, and unknown outcome remains unavailable until same-fence locked reconciliation. A late operation may release only its own settling marker. Maintain private lease-guard invalidation alongside every confirmed mutation. Timed-out operations retain their in-flight SQL/settlement capacity until the underlying transaction is known to settle or its client is discarded.

### 6. Expiry and retry exhaustion

Replace the current global exhausted-row reconciliation on every claim with bounded, indexed reconciliation for the requested session plus bounded startup recovery maintenance. It is a host-owned repository operation, not a worker permission grant.

A batch locks only its selected expired/exhausted rows with SKIP LOCKED, rechecks the deadline after locks, transitions to failed, records `lease_expired`, clears lease fields and increments revisions. Emit post-commit events through P4 when wired. An expired lease with attempts remaining is available to a replacement claim; old token/epoch/attempt then fails.

Do not build a background scheduler or promise immediate terminal-state notification in a completely idle host. The durable deadline already determines whether a lease is active. Consumers needing timed maintenance can call the bounded reconciliation helper through their existing application lifecycle.

### 7. Diagnostic extension and error storage

Extend existing callbacks instead of adding a logging subsystem:

- Add top-level `AHPServerOptions.onDiagnostic` forwarding sanitized session/work/persistence/binding events.
- Replace the current no-op callback passed to `createAHPBinding` with this forwarding adapter.
- Retain optional per-module sinks if needed, with explicit no-double-delivery composition.
- Work hooks include `submitted`, `claimCapacityDenied`, `claimScanDeferred`, `staleLeaseRejected`, `authorityLoss`, `publicationFailed`, `storageOutcomeUnknown` and lifecycle failures.
- Diagnostic payloads contain stable IDs/codes/counts/durations and a generated correlation ID. Never include token, input/data/result, credentials, raw worker text, SQL text, arbitrary exception message or stack.
- A diagnostic sink throw cannot alter a successful commit. Consumers route records to their logger.

Persist latest failure code (<=64 chars), approved summary (<=512 chars) and failure timestamp. The default formatter returns a generic summary. A consumer formatter may choose a safe summary from its context; validate output and fall back on failure. Do not call arbitrary worker text “sanitized” just because it was truncated.

Expose bounded counters through the existing service/configuration boundary when needed for tests and consumer monitoring: pending/settling operations, scan deferrals, cap denials, authority-loss queue occupancy. No new metrics framework or event-history table.

### 8. Real SQL acceptance matrix

Use two independent pools sharing one host ownership fence and controlled SQL barriers; do not rely on random sleeps or only string-matching SQL stubs.

| ID | Required result |
| --- | --- |
| P3-01 | Ten simultaneous claims for one agent at cap 3 yield exactly three active leases |
| P3-02 | Same identity across different sessions/kinds still shares one cap |
| P3-03 | Different agents proceed independently without exceeding either cap |
| P3-04 | Global default, identity override, zero and invalid bounds behave as specified |
| P3-05 | Lower cap blocks new acquisition, keeps current leases and valid renewals; config change during preparation cannot use old cap |
| P3-06 | Old-epoch unexpired leases count; reconnect increments epoch and cannot renew/settle old attempts |
| P3-07 | A delayed claim before bind/disable epoch change is rejected at the correct lock/admission boundary |
| P3-08 | Agent lock wait followed by count observes the preceding commit; deliberately combined snapshot design would fail this test |
| P3-09 | Renew waits on work lock until after expiry; it cannot revive a lease after new capacity was acquired |
| P3-10 | Expired takeover races with old renew/complete/fail; exactly one valid transition, no stale overwrite |
| P3-11 | Priority extrema and created_at/id ties order deterministically; locked high-priority row may be skipped |
| P3-12 | More denied candidates than one scan page do not permanently hide an eligible later row |
| P3-13 | Stale prepared candidates, graph/policy/config changes and bounded scan exhaustion produce safe retry/empty/deferred outcomes |
| P3-14 | DB microsecond cursor keys neither skip nor repeat the same-timestamp fixture rows indefinitely |
| P3-15 | MaxAttempts exhaustion and bounded reconciliation clear every lease field and emit one revision |
| P3-16 | Commit/rollback/client-discard paths release checked-out clients and in-flight reservations exactly once |
| P3-17 | Unknown COMMIT outcome has no false rollback/success claim; authorized read/replay establishes actual state |
| P3-18 | Lock order under concurrent claim/renew/cancel/retire/config changes does not deadlock; bounded storage errors remain sanitized |
| P3-19 | Failure formatting rejects raw secrets/control/unbounded output by default; diagnostic sink failures do not change committed work |
| P3-20 | Same cap/retry/data semantics pass the portable in-memory repository conformance suite |
| P3-21 | Same-connection register replay keeps its epoch; competing binds cannot both publish, and reconnect after release increments it |

### 9. Performance and example gates

Use a representative dedicated fixture with at least 10,000 mixed queued/leased/terminal rows, multiple kinds/targets/agents and skewed priorities. Record EXPLAIN (ANALYZE, BUFFERS) for candidate scans, active-agent counts and expiry batches. Run ANALYZE after loading fixtures. Inspect the actual queries; PostgreSQL may reasonably choose a sequential scan for a tiny/high-selectivity fixture, so do not assert one universal plan string.

Check that requests do not perform an unbounded global expiry UPDATE, that index predicates match status/identity filters, and that candidate authorization is outside lock-holding transactions. Record p50/p95 durations and pool usage as evidence for the fixture, not a universal throughput promise. Tune defaults only from those results.

Add `examples/work-capacity.ts`: two sessions, one worker at cap 3, a trusted override for a second worker, distinct priorities, reconnect, expiry and successful settlement. Extend the PostgreSQL conformance runner and ensure its local-only guard remains.

Commands:

```sh
pnpm exec vitest run src/tests/agents src/tests/work src/tests/persistence src/tests/websocket/agentWork.integration.test.ts
pnpm exec vite-node examples/work-capacity.ts
pnpm exec vite-node examples/postgresql-conformance.ts
pnpm exec vite-node examples/advanced/index.ts
pnpm validate
```

Enable remote V1 work mutations only after this gate; P2 alone is insufficient.

**Exit gate:** real database concurrency demonstrates the cap and stale-attempt guarantees; policy/disclosure tests still pass; the application can configure identity-specific capacity; diagnostics distinguish failure without exposing private content.


---

## P4 — WorkEventPublisher, protected snapshots, notifications and chat projection

**Outcome:** committed work changes reach currently authorized clients through the existing host binding/delivery machinery, with a reliable reconciliation path when hints are missed.  
**Depends on:** P0–P3 durable identity/state and operation/read authorization.  
**Deliberate limit:** best-effort hints plus authoritative reads; no durable outbox, replay log or automatic chat turn execution.

### 1. Existing extension points

The factory already publishes native catalogue/session envelopes. The AHP kernel owns subscriptions, pending buffers and reply-settlement hooks. Protected delivery owns per-peer ordering, byte/count limits and final-send guards. Its current branches recognize native action/catalogue messages, so merely calling its existing publish closure with a work method will not create a safe work channel.

Extend:

| Owner | Files / responsibility |
| --- | --- |
| Work events and view projection | `src/work/helpers/{events,views}/{types,helpers,index}.ts` |
| Host wiring | `src/websocket/helpers/host/{types,helpers}.ts` |
| V1 wire handlers | `src/websocket/helpers/ahp/agentWork.ts`, constants/types |
| Subscription coordination | `src/websocket/helpers/ahp/helpers/kernel/helpers.ts` |
| Shared protected delivery | `src/websocket/helpers/ahp/helpers/views/{types,helpers}.ts` |
| Client work projection | `src/work/helpers/client/{types,helpers,index}.ts`, existing single transport reader |
| Chat placeholder adapter | `src/work/helpers/chatProjection/{types,helpers,index}.ts` |
| Example/integration evidence | `examples/advanced/`, new work-events sample, mirrored tests |

A standalone generic broadcaster would duplicate the existing ownership and freshness rules; do not add one.

### 2. Post-commit event contract

#### Target: `./src/work/helpers/events/types.ts`

```ts
export type WorkEventKind =
  | "submitted" | "claimed" | "renewed" | "completed"
  | "failed" | "requeued" | "cancelled" | "dataUpdated";

export interface WorkEvent {
  readonly version: 1;
  readonly type: WorkEventKind;
  readonly workId: string;
  readonly revision: Revision;
  readonly session: ResourceRef<"session">;
  readonly occurredAt: string;
  // No lease token, input/data/result, raw exception or authorization proof.
}
export interface WorkEventPublisher {
  publish(event: WorkEvent): void;
  subscribe(listener: (event: WorkEvent) => void): () => void;
  dispose(): void;
}
```

A concrete local publisher bounds listeners and catches diagnostic failures. Host subscribers enqueue protected projection; they do not synchronously wait for every recipient to acknowledge. Async listener return values are not silently awaited or allowed to produce unhandled rejections.

Publish after a confirmed commit and live/private-proof invalidation. Identical submit replay, failed transaction/CAS, terminal no-op cancel and stale settlement emit nothing. Unknown commit outcome emits an uncertainty diagnostic and is recovered by reading, not a fabricated event. Callback failure cannot undo a committed mutation.

Events carry per-work revisions. They may arrive late, be duplicated by a consumer's retry or be missed around a crash. Clients discard older/equal item revisions; they do not assume global adjacency. The wire serverSeq is allocated through the shared P0 publication order, not by the repository.

### 3. V1 wire surface

Existing mutation methods use P1–P3 contracts. Add these methods, keeping explicit `version:1` and strict runtime schemas:

| Method | Request | Response / behavior |
| --- | --- | --- |
| `x-ahp/work/list` | session locator and optional announceTo locator, filters, bounded limit/cursor; announceTo alone may imply session | Authorized summaries, nextCursor; no unauthorized totals |
| `x-ahp/work/get` | exact workId | Authorized detailed view or sanitized not-found/denied outcome |
| `x-ahp/work/subscribe` | canonical resource locator and initial page limit | connection-owned subscriptionId, streamEpoch and initial authorized page |
| `x-ahp/work/unsubscribe` | subscriptionId | Removes only this connection's subscription, buffer/cursor/proofs |
| `x-ahp/work/changed` | server notification only | Small authorized change hint |
| `x-ahp/work/reset` | server notification only | Clear/refetch instruction for the known subscription; no hidden resource details |

`list` without announceTo considers the exact session's work and applies read policy to every row. With announceTo, it also requires that resource to match the work's announce selection. `subscribe(resource)` follows the latter rule: it observes work announced to that resource. Thus announce=[] suppresses unsolicited hints but does not prevent an authorized owner/application from listing the session's work.

All selectors resolve to exact instances. A cursor/subscription can never follow a reused URI into a new incarnation.

#### Changed hint shape

```ts
interface WorkChangedParams {
  readonly version: 1;
  readonly subscriptionId: string;
  readonly streamEpoch: string; // opaque, changes on host ownership generation
  readonly workId: string;
  readonly revision: Revision;
  readonly change: WorkEventKind;
  readonly serverSeq?: number; // only when allowGlobalSequence is explicitly true
}
```

Do not disclose leaseToken, executor-only input, mutable application data or raw errors in a hint. A hint causes get/list invalidation/refetch. Rich chat presentation is an optional separately authorized projection, not an invitation to broadcast full records.

If the consumer has not composed coherent protected view/delivery support, work subscription capability is unavailable; do not fall back to unprotected publication. List/get still use their own canonical authorization. Advertise supported private work methods in the existing extension capability/configuration surface, without inventing a Microsoft-native capability name.

### 4. Authorization and view projection

- Submission authorizes selecting each announcement target with the work announce policy.
- Delivery independently evaluates the current recipient's work read permission and visibility of the target canonical resource.
- A parent's descendants selector is resolved from canonical ancestry. An exclusion is evaluated before projection but does not bypass mandatory denial.
- Being subscribed, being the submitter, or knowing a work ID is not permission to receive its input/result/data.
- Consumer projection callbacks receive only the already authorized work facts for that recipient. Bound their input/output, pending count and deadline; recheck proof/context after callback settlement.
- Private intent storage binds the exact canonical resource/work instance and recipient generation, not just a mutable URI.
- An announcement recipient cannot infer hidden work counts from a global sequence when allowGlobalSequence is false. Do not expose a global work-counter substitute.

For list/get, use detached read snapshots and work revisions. Revalidate data-dependent proof freshness and relevant row revisions before guarded response admission. A page is a current authorized projection at its read/admission boundary; paginated pages are **not** claimed to be one long-lived database transaction or an immutable point-in-time snapshot. Client reconciliation handles concurrent changes.

List/snapshot work is bounded by examined rows as well as returned items: examine at most 128 rows and spend at most 5 seconds per call, with bounded concurrent policy evaluation. A count-budget stop returns an opaque continuation even when it returned zero visible items. Capture a finite sweep upper key at the first page; bind continuations to recipient, exact session/resource, filter, generation and upper key. No cursor means the sweep actually reached its end. A timeout/failed policy preparation returns a retryable incomplete/error outcome, never a false end-of-sweep. Cursors reveal no raw hidden row IDs or counts; this is not a claim to eliminate all timing/pagination-pattern side channels.

No fresh grants are created by a projection. Existing mandatory bindings/external proof rules remain applicable.

### 5. Subscribe/snapshot race, explicitly

1. Validate and authorize the canonical subscription target; allocate a bounded connection-owned pending slot and generation.
2. Begin buffering matching work events **before** starting the asynchronous list query/projection.
3. Read the first authorized page. Capture per-item revisions and streamEpoch.
4. Install the reply's final authority/connection/instance guard through the existing invocation mechanism.
5. In `onReplySettled`, activate only after a successful guarded enqueue. If the reply failed, remove the pending slot and discard its events.
6. Flush buffered hints through the same ordered protected queue, checking current permission for each. Deduplicate a hint only when its item revision is known to be already represented; otherwise keep it as a refetch hint.
7. **Never discard a buffered work hint using only a sampled serverSeq.** SQL snapshot completion and sequence.current() are not an atomic consistency cut.
8. Unsubscribe/replacement/connection-close invalidates the generation and releases every cursor/proof/buffer. A late snapshot completion cannot reactivate it.

Example race to test: SQL reads work at revision 4; work commits revision 5 and publishes while the page is being authorized; the page captures a larger global sequence afterward. Revision 5 must still be delivered/refetched after the reply. A naive fromSeq cutoff would lose it.

Extend the existing delivery intent to a discriminated union for native messages and work hints. Work subscriptions may have their own typed entries, but **share** pending/queued byte and entry accounting with native delivery. No parallel unbounded fan-out queue. Retain final-send guards immediately before actual socket writes.

### 6. Reconciliation, resets and failure handling

The work client helper consumes one generic extension request/notification port; it does not start another transport recv loop. Until P5 extraction, extend the existing transport's single-reader observer seam and adapt it; P5 moves that generic seam to client without rewriting work semantics.

Client behavior:

- On changed(workId, revision), mark the known item dirty and coalesce an authorized get/list refresh.
- Compare decimal-string revisions numerically, not lexically and not through unsafe Number conversion.
- On fresh subscription, epoch change, reset, reconnect or queue overflow, discard the old subscription generation/cursors and reconcile from list.
- While actively connected/subscribed, reconcile every 30 seconds by default (configurable, minimum 5 seconds), even with no hints. This resolves a lost final notification without requiring another work change.
- Pagination accumulates a current view; revisions prevent older pages from overwriting newer item data. Remove vanished items only after a complete successful finite sweep for that exact filter/generation. An empty page with a continuation, a timeout or partial refresh must not be treated as a complete empty snapshot.
- No timer/read continues after dispose or while disconnected. No automatic work submission or execution is retried because a view refreshed.
- A permission change invalidates pending projections; emit only a safe reset for an already-known subscription or close it. Never expose the denied item's identity as an explanation.
- Retiring the target invalidates the subscription. A replacement URI requires a fresh explicit subscription and current authorization.

Bound client-retained state as well as each server page. Default to 500 tracked items (hard maximum 5,000) and at most 20 pages / 10 seconds in one refresh. Dirty sets, revision maps and pending gets are bounded by the tracked set and existing request limits. If a refresh reaches a retention/page/time limit, expose an explicit incomplete/limit result and its continuation, cancel that scan generation, and do not report authoritative deletion of unseen items. Do not automatically accumulate an entire unbounded terminal history. The consumer can narrow filters or read more history through explicit pages. A cache reset caused by capacity is a local invalidation, not evidence that the server deleted items; pause automatic full-view accumulation until the consumer chooses a bounded view. Reconciliation's convergence guarantee applies to an actively maintained view that fits its declared bounds.

Overflow follows existing fail-closed close/reset behavior. The server records a bounded diagnostic; it does not enqueue another huge error payload into the same exhausted queue.

### 7. Microsoft chat placeholder, verified at the pinned version

The repository pins `@microsoft/agent-host-protocol@1.0.0`. The corresponding upstream `v1.0.0` tag points to commit `5f16d81bb7045b66d7bc768d244feab75002d943`. Its root exports include Message/MessageKind, ChatState and ChatAction. MessageKind includes SystemNotification. Source:

- [package manifest](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/package.json)
- [chat state/message types](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/state.ts)
- [chat actions](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts)

Use these actual types through one replaceable adapter:

```ts
// Target ./src/work/helpers/chatProjection/types.ts
import { MessageKind } from "@microsoft/agent-host-protocol";
import type { Message, ChatState, ChatAction } from "@microsoft/agent-host-protocol";

export type WorkChatState = ChatState;
export type WorkChatAction = ChatAction;
export type WorkChatMessage = Pick<Message, "text" | "_meta"> & {
  readonly origin: { readonly kind: MessageKind.SystemNotification };
};

export interface WorkChatProjectionAdapter {
  project(input: {
    readonly chat: ResourceRef<"chat">;
    readonly event: WorkEvent;
    readonly work: AuthorizedWorkView;
    readonly recipient: TrustedRequestContext;
    readonly signal: AbortSignal;
  }): WorkChatMessage | undefined | Promise<WorkChatMessage | undefined>;
}
```

The initial implementation supports only the bounded system-notification subset above. Default text derives from permitted kind/status; metadata may contain workId/revision. A consumer can supply its formatter. Validate text length, permitted origin, bounded plain metadata and no extra fields after the callback. Do not invent an upstream MessageSchema runtime export.

Expose this optional message in the extension's authorized work presentation, or pass it to an explicitly registered consuming application's chat handler. The default adapter **does not dispatch a native chat action** and does not alter native chat turn state.

This distinction matters: upstream Message participates in turn initiation/steering; pendingMessageSet can schedule a turn; backgroundWork represents currently running shells/subagents. Queued AHP coordination work must not be disguised as either. Provider-created canonical chat resources and a typed work presentation do not mean the host implements every native chat lifecycle method.

Future custom chat handling replaces this one adapter/handler seam. Work storage, lease authority and selectors do not depend on a proprietary chat message representation.

### 8. Acceptance tests

| ID | Observable evidence |
| --- | --- |
| P4-01 | Each confirmed mutation emits its expected event/revision; replay/rollback/conflict/no-op emits none |
| P4-02 | Subscriber receives a hint only when announce selection and current recipient read/target authority allow |
| P4-03 | Excluded child, private result/data and target from another incarnation never leak |
| P4-04 | Queue before snapshot → commit during query → guarded reply → correct later revision hint |
| P4-05 | The async SQL/global-cursor race above cannot lose revision 5 |
| P4-06 | Reply denied/failed/disconnected leaves no active subscription or retained buffer |
| P4-07 | Unsubscribe/re-subscribe/retire/URI reuse invalidates old generation and late completions |
| P4-08 | Mixed native/work bursts share entry/byte limits; overflow resets/closes without unbounded memory |
| P4-09 | Revocation during projection and immediately before send suppresses payload |
| P4-10 | Recipient without global-sequence permission sees no serverSeq/global hidden count |
| P4-11 | Deliberately drop the final hint; periodic reconciliation converges without another event |
| P4-12 | Reordered/duplicate hints and stale pages cannot roll an item backward |
| P4-13 | Restart changes streamEpoch, preserves data/work, requires a fresh subscription and snapshot |
| P4-14 | Pagination is bounded, cursor-bound to actor/filter/instance, preserves SQL timestamp precision and omits unauthorized totals |
| P4-15 | Exact Microsoft v1 types compile at the adapter; callback output is runtime-bounded and cannot forge user-message origin |
| P4-16 | Work announcement never emits pendingMessageSet, backgroundWorkSet or an unsupported native ChatAction by default |
| P4-17 | One SDK/transport reader handles native messages, work RPC and work notifications concurrently |
| P4-18 | Dispose cancels periodic refresh, pending RPC/projection, listeners and subscriptions; late callbacks do not send |
| P4-19 | Publisher/diagnostic callback failures do not roll back committed work |
| P4-20 | Public createAHPServer + real pinned AhpClient demonstrates the full authorized work flow; no kernel substitution is mistaken for public proof |
| P4-21 | More than 128 denied rows before an allowed row yields bounded empty continuation pages and eventually the authorized item; no timeout/partial page triggers vanished-item deletion |
| P4-22 | Large terminal history respects tracked-item/page/time limits, returns explicit incomplete/limit state and never grows hidden dirty/revision maps without bound |

Add `src/tests/work/events.test.ts`, `views.test.ts`, `client.test.ts`, `chatProjection.test.ts`, and `src/tests/websocket/workEvents.integration.test.ts`. Extend existing protected egress/projection tests. Add `examples/work-events.ts` with two differently authorized recipients, an excluded chat, a dropped hint, reconnect and successful reconciliation.

Commands:

```sh
pnpm exec vitest run src/tests/work src/tests/websocket
pnpm exec vite-node examples/work-events.ts
pnpm exec vite-node examples/advanced/index.ts
pnpm exec vite-node examples/postgresql-conformance.ts
pnpm validate
```

**Exit gate:** missed notifications recover through current authorized reads, all delivery shares the established boundaries, chat types are pinned and replaceable, and no test claims native chat behavior the host has not implemented.


---

## P5 — coherent tool ownership and a genuine general client

**Decision:** include P5 after P4. The user's cleanup goal is justified; the existing ToolClient cannot simply be renamed Client because its behavior is tool-specific.  
**Outcome:** tool capabilities live under singular `src/tool`, generic client connection/RPC behavior lives under `src/client`, and general session/security responsibilities remain with their owners.  
**Scope:** ownership/portability refactor plus the explicit private-protocol V1 label correction below. No new execution permissions or server model runtime.

### 1. What the source actually contains

At the pinned baseline:

- `src/toolClient` is only a re-export compatibility facade.
- The actual client lives in `toolExecution/helpers/client`. It initializes Microsoft's AhpClient, immediately negotiates private tool capabilities, subscribes/looks up assignments/advertises handlers, and executes or coordinates tools.
- Its `.client` property is the actual Microsoft AhpClient, which is more general than the containing ToolClient.
- `examples/advanced/work.ts` imports ToolInvocationTransport solely to call agents/work extension RPC. This is a concrete reason to extract general client transport.
- `toolExecution/helpers/client/helpers/broker` is server-side remote-tool dispatch/authority, despite its client-directory location.
- Shared private wire schemas are nested beneath the client subtree.
- `toolPolicy` contains generic role/direct-grant policy compilation and namespace selection already used by resource operations/session creation.
- `toolExecution/helpers/views` implements protected session/root snapshots and catalogue projection, not tool execution.
- ReferenceAuthorizer owns canonical tool-assignment authority; that ledger must not be duplicated or moved merely to tidy names.

P5 corrects these boundaries. It does not turn ToolAction into a generic server request abstraction.

### 2. Final entrypoint and file map

These are repository TypeScript aliases. The package is currently private and has no npm exports map; do not claim this is a published multi-package SDK.

| Current capability | Target files | Public alias |
| --- | --- | --- |
| Tool definitions/catalogue/trusted compilation | `src/tool/{index,types,constants}.ts`; `helpers/{contracts,catalogue}/` | `@tool`, `@tool/contracts` |
| Shared private tool DTOs + portable descriptor comparison | `src/tool/helpers/protocol/{index,types,helpers}.ts`; `helpers/descriptors/` beneath it | `@tool/protocol` |
| Client local tool implementations/advertisement/artifact handling | `src/tool/helpers/client/` | `@tool/client` |
| Tool action/dispatcher/calls/challenge/projection/artifacts | `src/tool/helpers/execution/` | `@tool/execution` |
| Host tool actions and authoritative remote-tool proxy | `src/tool/helpers/execution/helpers/{server,remote}/` | `@tool/server` |
| Tool-specific admission/proposals/assignment projections/binding types | `src/tool/helpers/policy/` | `@tool/policy` |
| Portable execution-binding schema/types only | `src/tool/helpers/policy/helpers/binding/` | `@tool/policy/binding` |
| Generic connection/framing/extension-RPC/lifecycle | `src/client/{index,types,helpers}.ts`; `helpers/transport/` | `@client`, `@client/transport` |
| Generic policy definitions/compiler/namespaces | `src/authorization/helpers/policies/` | `@authorization/policies` |
| Neutral resource authorization route | Existing authorization contract owner | `@authorization` or narrow policy entry |
| Protected session/root view projection | `src/sessions/helpers/views/` | `@sessions/views` |
| Shared bounded JSON values | P0's `src/jsonrpc/helpers/value/` | `@jsonrpc/value` |
| Transport authentication, socket queues, routing | Existing `src/websocket/` | Unchanged |
| Work scheduling/data/events | Existing `src/work/` | Unchanged |
| App-specific policy examples and composition | Existing `src/application/`, `examples/` | Unchanged |

Delete production `src/toolClient`, old `src/tools`, `src/toolPolicy` and `src/toolExecution` after all active consumers migrate. No compatibility export directories remain for unreleased consumers. Move nested helpers according to CodingRules; do not create operation-named standalone files merely for this reorganization.

Keep `@tool` small. Portable `@tool/client` and `@tool/protocol` must not traverse a root barrel that evaluates Ajv, Node ws, pg, host dispatch or application composition.

### 3. General Client and ToolClient are separate capabilities

#### Target `./src/client/types.ts`

```ts
import type { AhpClient, AhpTransport } from "@microsoft/agent-host-protocol/client";

export type ClientConnection =
  | { readonly transport: AhpTransport; readonly ownership: "owned" }
  | { readonly transport: AhpTransport; readonly ownership: "borrowed";
      readonly detach: () => void | Promise<void> };

export interface ClientOptions {
  readonly clientId: string;
  readonly displayName?: string;
  readonly protocolVersions: readonly string[];
}
export interface ExtensionRpcOptions {
  readonly timeoutMs?: number; // default 5,000; finite integer 1..35,000
  readonly signal?: AbortSignal;
}
export interface ExtensionRpcClient {
  request(method: string, params: unknown,
    options?: ExtensionRpcOptions): Promise<unknown>;
  notify(method: string, params: unknown,
    options?: ExtensionRpcOptions): Promise<void>;
  onNotification(method: string, listener: (params: unknown) => void): () => void;
}
export interface ClientLifetime {
  readonly signal: AbortSignal;
  // Synchronous owned cleanup; rejects attachment after the lifetime has ended.
  // The returned function unregisters this cleanup before partial-setup rollback.
  addCleanup(cleanup: () => void): () => void;
}
export interface Client {
  readonly protocol: AhpClient;
  readonly rpc: ExtensionRpcClient;
  readonly lifetime: ClientLifetime;
  shutdown(): Promise<void>;
}
```

`connectClient(connection, options)` initializes native AHP only. It sends zero `x-ahp/tools/*` methods and works with a native endpoint lacking the tool extension.

The portable core accepts the declared transport-bearing ClientConnection. Update callers of the old string/URL shortcut to construct the pinned SDK's WebSocketTransport explicitly in their environment-specific example/application and pass it as owned. Do not make portable client imports load the SDK's Node WebSocket entry merely to retain an unreleased shortcut. Capture bounded extension params with the shared portable JSON helper before awaiting/sending; preserve the existing frame and correlation limits.

`createToolClient(client)` attaches the tool-specific behavior to an already initialized Client, negotiates the private V1 tool capability and returns ToolClient. `connectToolClient(connection, options)` remains a convenience composition of these two operations. It creates one native client and one reader; failure during negotiation shuts down the owned logical Client.

`createToolClient(existingClient)` failure instead rolls back only its partial adapter attachment; the caller's existing work/native users retain their connection. Register cleanup and exclusive notification handlers before the first negotiation await. Reject duplicate tool attachment and attachment to an ended lifetime. Unregister every partial handler/cleanup on failure; abort that adapter's local controller. A successfully attached tool adapter is owned by the connection until its shutdown.

ToolClient keeps its meaningful name and tool methods. Expose `connection: Client`; native operations become `tools.connection.protocol`. Its shutdown delegates to that same Client. Client owns extension cleanup and endpoint release; there is no independently closing second transport. An independently detachable tool adapter while keeping an advertised endpoint alive is not introduced in this packet.

Borrowed means the logical endpoint's supplied detach callback is invoked; the generic client must not close the shared physical carrier itself. All shutdown paths share one promise and one logical release.

Explicit shutdown, native protocol shutdown, remote EOF, receive failure and fatal send failure all end the same lifetime exactly once. Mark it closed and abort its signal before running a snapshot of registered synchronous cleanup callbacks. Isolate callback exceptions; cleanup cannot return an asynchronous operation or postpone closure. Tool cleanup aborts controllers, drops advertisements and queued invocations, rejects pending joins/poll delays and suppresses late completions. Work cleanup cancels requests, observers and reconciliation timers. Do not await a noncooperative local execute callback to release the endpoint; retain its occupied execution accounting until it actually settles.

`request` and `notify` share the bounded send owner (64 in-flight sends); requests retain the existing 64-correlation cap. `notify` writes a notification with no request ID and resolves when its send settles, not on a remote acknowledgement. Timing out or aborting retires the caller's response correlation/timer/listener, but an already started send retains its send-capacity slot until actual settlement. It does not cancel remote work or prove that a command was not accepted. Use the lifetime signal plus a per-operation signal; do not close the shared Client merely because one work view is disposed.

#### Target `./src/tool/helpers/client/types.ts`

```ts
export interface ToolCallOptions {
  readonly work?: WorkExecutionRef;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
// Add options?: ToolCallOptions to dispatchTool(channel, contract, input, options)
// and callTool(channel, ref, input, options). Preserve their existing result types.
```

P2 introduces the optional work tag on the old client path; P5 carries that same contract to its new owner. `dispatchTool` places the tag beside input in the caller-to-host request. `callTool` forwards it once at dispatch and uses one overall deadline (default 35 seconds), passing the remaining bounded budget and cancellation signal to assignment, dispatch and status requests and polling delays. The host extracts the tag into its private restrictive guard. It never enters a remote tool invocation, completion, ordinary execution context, result, advertisement or view. Existing challenge continuation/status/projection paths retain the host-side guard and recheck it; they cannot detach a resumed call from its original work authority.

### 4. Extract transport carefully

Move generic behavior from ToolInvocationTransport:

- Bounded extension request IDs/correlation/timers and safe error mapping.
- Text, binary and parsed frame handling, including invalid UTF-8/oversize behavior.
- Bounded sends and retaining capacity until actual send settlement.
- Native frame forwarding to the single AhpClient receive owner.
- EOF/error/disposal, owned/borrowed release, and pending-reader termination.
- P4's work-notification observer seam and extension shutdown hooks.

Keep tool behavior in the tool adapter:

- Assignment generations, staged advertisements and exact acknowledgements.
- Local tool implementation lookup/validation/execution.
- Invocation correlation/tombstones, cancellation and late completion suppression.
- Tool artifact loading and challenge/continuation behavior.
- Tool notification parsing and projection.

Register recognized private notification methods with one owner each. Restrict extension interception to explicit `x-ahp/` methods; native protocol messages are forwarded unchanged. Duplicate handler ownership rejects. Work's one adapter can fan out to its bounded work subscriptions. Do not introduce a generic plugin manager, multiple recv loops or reconnect/redispatch policy.

Generic extension request IDs must not collide with the native SDK's requests, and responses must only resolve their exact pending owner. Unrecognized/malformed frames follow the existing safe forwarding/drop contract, verified by tests.

### 5. Policy/view extraction without moving authority

Move the generic policy factory, namespace and role/direct-grant contracts to authorization:

- ToolPolicyFactory → PolicyFactory.
- createToolPolicyFactory → createPolicyFactory.
- ToolPolicyNamespace → PolicyNamespace.
- ToolExecutionPolicyBase → PolicyDefinitionBase.
- ToolOperation → PolicyOperation, preserving the existing closed seven-purpose vocabulary.

Move the schema/error names consistently. Do not introduce arbitrary operation strings or change missing-operation denial. P2's work operation map remains separate from the basic policy purpose. Preserve challenge-required denial for work and the existing tool challenge flow.

Create a neutral ResourceAuthorizationRoute type for canonical route, external proofs and mandatory binding selectors. Protected session views and tool policy consume that contract instead of views importing ClientToolRoute. Replace tool-owned Awaitable imports with local standard promise unions where appropriate.

Preserve exact compiler object identity and usesPolicyFactory checks across ReferenceAuthorizer, session creation/restoration, work, views and dispatchers.

Keep canonical tool contracts, assignment/executor authority and proof-cohort validation in ReferenceAuthorizer for this stage. It uses runtime `defineToolContract` and `toolExecutionBindingSchema`, not only types. Put the latter's pure schema/types in the portable `@tool/policy/binding` leaf; that leaf must not evaluate the admission/assignment policy barrel. The relocated generic compiler uses authorization-local validation/constants leaves. Do not route the authorizer through `@tool/server` or `@tool/client`; do not claim authorization has become completely tool-free. A separate assignment-ledger extraction would require its own security design and is not authorized by a folder cleanup.

Move session/root views to sessions, preserving proof/cursor binding, projection whitelist, excluded-row basis, URI reuse and final-send freshness. The websocket delivery queue stays in websocket; P4 work projection stays in work.

### 6. One unreleased V1 private tool protocol

Current code uses `z.literal(2)` and top-level `version:2` in its private tool extension. The user explicitly wants all unreleased work to remain V1. P5 therefore changes the **one supported private wire shape** to top-level `version:1` on both server and client, retaining the current fields/semantics plus already accepted P2 scope restriction support.

- Update private tool schemas, capabilities, request/reply/notification constructors and exact tests together.
- Rename the active `toolProtocolV2.test.ts` suite/current documentation to V1.
- Reject version 2 after the change; do not negotiate/fallback between historical private versions.
- Do not change JSON-RPC `"2.0"`, Microsoft protocol versions, package versions, tool contract revision/version values, policy revisions or a legitimate tool definition with version 2.
- Remove production legacy-shape handling rather than keeping it for old internal fixtures: the old `x-ahp/tools/call` route/request schema, the completion-schema union and shape branch, optional `expectedContractId` invocation fallback, and native active-client metadata used as an execution advertisement. Preserve ordinary native session metadata and current private advertisement/invalidation.
- Migrate useful legacy correlation/capacity/lifecycle scenarios to strict V1 using the real public binding, or retire redundant tests after mapping their coverage. A historical fixture may remain only if genuinely independent of removed production behavior. Do not copy an old kernel into tests or retain a production fallback merely to make legacy tests pass.

This is an intentional unreleased private wire label change, not merely moving files. Verify it at both producer and consumer ends.

The producer inventory includes `toolExecution/helpers/client/helpers/protocol/types.ts`, request constructors in client helpers, `websocket/helpers/ahp/helpers/toolProtocol/helpers.ts`, host invocation envelopes in `websocket/helpers/ahp/toolInvocation.ts`, and retained status DTOs in `toolExecution/helpers/calls/helpers.ts`, followed by their moved paths. The inspected fallback is selected by message shape/call path, not a numeric `version === 2` branch. Changing only `z.literal(2)` will not remove that fallback. Preserve `ToolInvocationContext.version = invoke.contract.version`; explicitly test private envelope version 1 carrying a legitimate tool contract version 2.

### 7. Migration order within P5

1. Refresh the post-P4 import/caller map and establish the behavior tests before moves.
2. Relocate generic policy contracts/compiler and neutral route types; update coherent consumers in one slice.
3. Extract generic Client/transport with existing tool/work adapters still functioning through it.
4. Move tool-owned source and shared DTOs to singular tool; relocate the remote broker under server execution ownership.
5. Move session/root views into sessions and finish shared value-helper imports.
6. Apply the one-shape V1 wire relabel across server/client/tests in a distinct reviewable slice.
7. Update every active caller, fixture, alias and README source map; remove obsolete facades.
8. Review the final dependency graph and run all existing behavior/acceptance gates.

Update tsconfig paths and docs/CodingRules aliases. Vite already reads tsconfig paths; no resolver plugin/dependency is needed. Do not edit unrelated archived narratives to pretend historical versions did not exist.

### 8. Required tests

Reuse the real-SDK `src/tests/toolExecution/clientBoundary.test.ts` cases under the new owners. It covers framing, exact ack, queued joins, send/read failures, ownership and teardown; do not replace it with a mock that returns expected values from the same new helper.

| ID | Evidence |
| --- | --- |
| P5-01 | Generic connect initializes/pings/subscribes to an endpoint with no private tool extension and emits zero tool methods |
| P5-02 | Native SDK requests, agents/work RPC and work notifications share one receive owner without correlation loss |
| P5-03 | Tool attachment still negotiates, assigns, advertises and executes exactly once; failed connectToolClient convenience creation releases its new logical endpoint once |
| P5-04 | Owned/borrowed shutdown, EOF, failed sends and nonsettling handlers preserve capacity and stop late completions |
| P5-05 | `examples/advanced/work.ts` imports `@client`, no tool transport |
| P5-06 | Final `@client`, `@tool/client`, `@tool/protocol` portable imports do not evaluate Node-only/server/application modules |
| P5-07 | Execute descriptor equality/ack validation with Buffer absent and Unicode/budget cases; import mocks alone are insufficient |
| P5-08 | Host and remote dispatch preserve caller/executor separation, challenge flow, exact assignment/lease restrictions and projection guards |
| P5-09 | A moved policy factory remains the same instance everywhere; a tool grant still cannot authorize unrelated work/resource effects |
| P5-10 | Session/work views preserve revocation, excluded-row, cursor, retirement and URI-reuse behavior |
| P5-11 | Private server/client packets all use top-level version 1; version 2 rejected; JSON-RPC/tool-contract versions unchanged |
| P5-12 | No active production/example/config/current-doc imports point to deleted aliases; historical fixtures remain clearly test-only |
| P5-13 | A local executor sends exactly one correlated completion through `rpc.notify`; send timeout does not free an unsettled send slot |
| P5-14 | Generic shutdown/EOF with tool and work adapters attached aborts handlers, requests, poll delays and timers; repeated calls release once |
| P5-15 | Partial/duplicate/closed attachment cleans up deterministically without closing an existing caller-owned Client |
| P5-16 | A near-deadline status request uses the remaining budget; disposing one work view cancels its request without closing other connection users |
| P5-17 | Work-tagged SDK dispatch reaches the host guard, enforces effective-target scope and never exposes its token to a remote executor |
| P5-18 | Old call/completion/invocation envelopes reject; migrated correlation/capacity tests cover the supported V1 public path |
| P5-19 | Private envelope version 1 with tool contract version 2 executes with context.version equal to 2 |

There is a source-backed portability risk: `src/tools/helpers/protocol/helpers.ts` uses `Buffer.byteLength` inside canonicalJsonEqual. The client executes it. Use TextEncoder or the already verified shared portable byte counter only after matching Unicode and budget behavior; an import-only test will miss a free Buffer global.

Retain and migrate serverExecutor, pipeline, cleanup, challenge, artifacts, resultProjection and clientDispatch suites. Preserve public websocket tool protocol, serverTools integration, tool capacity/proposals/artifacts and protected egress suites, plus all P0–P4 tests.

`websocket/sdk.test.ts` and `toolInvocation.test.ts` currently substitute the internal kernel; their current pass would not prove public binding compatibility. Migrate their useful tool scenarios and retain valid native scenarios against the supported boundary. The real public-binding/SDK suites must remain separate. Inventory references to `src/tests/websocket/legacyToolClient/`, then remove the fixture if no independent historical test needs it. No executing test may rely on the production fallback deleted above.

### 9. App and final gate

Run:

```sh
pnpm exec vitest run src/tests/client src/tests/tool src/tests/authorization src/tests/sessions src/tests/work src/tests/websocket
pnpm exec vite-node examples/quickstart.ts
pnpm exec vite-node examples/advanced/index.ts
pnpm exec vite-node examples/durable-lifecycle.ts
pnpm exec vite-node examples/work-capacity.ts
pnpm exec vite-node examples/work-events.ts
pnpm exec vite-node examples/postgresql-conformance.ts
pnpm validate
```

The new test paths are the migrated targets. Update commands to exact final filenames only when moving tests; do not skip an existing suite because its old folder disappeared.

**Exit gate:** the generic client is genuinely independent from tool negotiation; all tool-owned capabilities have one clear home; authorization/state ownership and prior acceptance behavior are intact; private protocol is consistently V1; no active compatibility facades or hidden server imports remain.


---

## Source evidence and final architectural review

**Prepared:** November 22, 2026.  
**Baseline:** develop at `bcd85354723bce293e1384af0ca88e84d5ce9dda`.  
**Verdict:** READY FOR IMPLEMENTATION as a reviewed plan with explicit acceptance gates. This is not implementation approval, a test pass or deployment readiness.

### 1. Evidence boundary

The prior schema plan/SQL and the user's accepted decisions were reconciled with pinned repository source. The source tree was inspected at one exact develop commit; it was not assumed identical to the user's named `GLM/agentIdentity` working checkout. Relevant contracts, capture paths, policy/currentness code, persistence SQL, host/wire delivery, client transport, existing tests and examples were read. Microsoft upstream types were verified at the pinned package tag, not guessed from a later library version.

No repository files were implemented, committed or pushed. No actual application database was modified. No PostgreSQL engine, migration, TypeScript compile, Vitest suite, public SDK integration or test application was run during this planning task. The SQL reference and smoke fixture have only static review here.

### 2. Pinned source-to-decision map

| Current source boundary | Exact source | Target implication |
| --- | --- | --- |
| Existing eight-table baseline | [database/migrations/0001_session_tool_baseline.sql](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/database/migrations/0001_session_tool_baseline.sql) | The current session/catalogue tables are not the target durable resource lifecycle. |
| Existing agent/work baseline | [database/migrations/0002_agent_work.sql](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/database/migrations/0002_agent_work.sql) | Current work identity/lease constraints need the P0/P1 forward migrations. |
| Session/provider/live contracts | [src/sessions/types.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/types.ts) | Keep synchronous live registry; extend async provider and durable ports instead of pretending a SQL registry is synchronous. |
| Protected provider capture | [src/sessions/helpers/factory/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/factory/helpers.ts) | Explicitly preserve new restore/retire/codec/driver methods in the captured provider object. |
| Current native action subset | [src/sessions/helpers/actions/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/actions/helpers.ts) | Title/read/archive persist; active-client membership is transient. Unsupported native actions do not become implemented through storage. |
| Reducer and immediate publication | [src/sessions/helpers/state/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/state/helpers.ts) | P0 stages and commits accepted state before live apply/publication and makes dispatch asynchronous. |
| Creation-policy capture | [src/sessions/helpers/creation/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/sessions/helpers/creation/helpers.ts) | New work/restoration registrations must survive actual capture and catalogue resolution. |
| Current durable ports | [src/persistence/types.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/persistence/types.ts) | Old URI-only ensure projection and subject-only repository requests are replaced by exact instance/transaction contracts. |
| PostgreSQL work operations | [src/persistence/helpers/adapters/postgres/helpers/workItems/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/persistence/helpers/adapters/postgres/helpers/workItems/helpers.ts) | Claims, renewals, replay comparison and owner predicates require deliberate transaction changes. |
| Current work service | [src/work/helpers/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/work/helpers/helpers.ts) | Remove owner-only flow and terminal-replay exception; prepare existing canonical policy instead. |
| Current work wire | [src/websocket/helpers/ahp/agentWork.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/websocket/helpers/ahp/agentWork.ts) | Strict V1 already exists for work; update single shapes, attempt fencing, trusted contexts and sanitized errors. |
| Live agent identity/presence | [src/agents/helpers/directory.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/agents/helpers/directory.ts) | Keep existing one-connection binding/idempotency while adding durable execution epochs around the async boundary. |
| Canonical resource operation seam | [src/authorization/helpers/resources/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/authorization/helpers/resources/helpers.ts) | Keep final synchronous current/admission semantics; do not sneak async SQL into ResourceOperations.commit. |
| Existing generic policy compiler | [src/toolPolicy/helpers/factory/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolPolicy/helpers/factory/helpers.ts) | Extend this authorization implementation for work; P5 moves generic ownership without replacing the engine. |
| Thin ToolClient facade | [src/toolClient/index.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolClient/index.ts) | This directory is a compatibility export, not the actual general client implementation. |
| Actual tool-specific client | [src/toolExecution/helpers/client/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers.ts) | It initializes native SDK and negotiates/advertises/executes tools; generic Client extraction is warranted. |
| Client transport/lifetime | [src/toolExecution/helpers/client/helpers/transport/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers/transport/helpers.ts) | Preserve one recv owner, completion notification sends, bounded correlation, send settlement and shutdown. |
| Server broker inside client subtree | [src/toolExecution/helpers/client/helpers/broker/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers/broker/helpers.ts) | Move server remote execution to tool server ownership; do not rename it a client feature. |
| Shared tool DTOs in client subtree | [src/toolExecution/helpers/client/helpers/protocol/types.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/client/helpers/protocol/types.ts) | Move portable DTOs into tool/protocol and relabel the one unreleased private shape V1. |
| Legacy broker fallback | [src/websocket/helpers/ahp/toolInvocation.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/websocket/helpers/ahp/toolInvocation.ts) | Remove old shape/call-path behavior and migrate useful tests; changing the numeric literal is insufficient. |
| Retained call status producers | [src/toolExecution/helpers/calls/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/toolExecution/helpers/calls/helpers.ts) | Update all retained private status DTOs, not just request schemas. |
| Portable comparator concern | [src/tools/helpers/protocol/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/tools/helpers/protocol/helpers.ts) | Runtime Buffer use requires actual execution with Buffer absent, not only import mocks. |
| Generic work use of tool transport | [examples/advanced/work.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/examples/advanced/work.ts) | Work/agents RPC should depend on client, without forcing tool negotiation. |
| Real SDK boundary tests | [src/tests/toolExecution/clientBoundary.test.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/tests/toolExecution/clientBoundary.test.ts) | Preserve ownership/framing/send/read/teardown tests through P5. |
| Public private-tool test | [src/tests/websocket/toolProtocolV2.test.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/tests/websocket/toolProtocolV2.test.ts) | Migrate to single V1 public-binding proof; internal kernel substitutions are different evidence. |
| Real PostgreSQL test app | [examples/postgresql-conformance.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/examples/postgresql-conformance.ts) | Extend actual loopback migrated-database acceptance; do not silently substitute stubs. |
| Owned RPC error mapping | [src/jsonrpc/helpers.ts](https://github.com/spore310/AHP/blob/bcd85354723bce293e1384af0ca88e84d5ce9dda/src/jsonrpc/helpers.ts) | Extend existing RpcError/code vocabulary and preserve error provenance. |

The table describes evidence from develop; the accompanying contracts describe future behavior. Source comments that call a synchronous in-memory registry replaceable by a database, or a transient stream gap-free, are descriptions to correct during implementation rather than guarantees to repeat.

### 3. Upstream and database references

Pinned Microsoft package: `@microsoft/agent-host-protocol@1.0.0`, upstream tag commit `5f16d81bb7045b66d7bc768d244feab75002d943`.

- [TypeScript package](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/package.json).
- [SessionState and status bits](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/state.ts): read/archive are status bits; ready is a native lifecycle value, suspended is not.
- [Chat message/state types](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/state.ts) and [chat actions](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts): use a system-notification projection; avoid accidentally initiating a turn.
- [PostgreSQL 17 transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html): separate command snapshots at READ COMMITTED inform lock-before-count ordering.
- [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html): SKIP LOCKED is suited to queue-like access, not a globally consistent strict-order snapshot.
- [PostgreSQL 17 explicit/advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html): retained host ownership and deliberate row-lock ordering.
- [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html): cross-row invariants require more than a row CHECK; the reference uses composite FKs and deferred triggers where appropriate.

### 4. Findings corrected before handoff

Two bounded independent source/contract reviews covered work authority/durability and tool/client boundaries, followed by targeted rechecks of their findings. The lead also reviewed the full packet set and late wire/codec/bounds clarifications. The following are resolved design findings, not claims that fixes already exist in the repository.

| Finding | Pinned correction | Evidence required during implementation |
| --- | --- | --- |
| Mutable JSON could break idempotent replay | Separate immutable submitted_data from current data; use independent dataRevision CAS | P1 replay/CAS/final-settlement tests |
| Crash between provider create and receipt save could duplicate resources | Reserve exact identity/provision key first; idempotent ensure/reconcile and explicit restore/destroy | P0 crash-window/restart tests |
| Provider/policy widening could be silently dropped by capture code | Update both actual capture paths and application/type resolution | P0-23, P1-20, P2-02 |
| Session durable state could resurrect live clients/activity | Explicit V1 stable-state codec, current readiness and fresh bindings | P0-07/P0-24 |
| Remote work opened before scheduling fences existed | Remain closed through P2; enable only after P3's real-SQL gates | Intermediate composition and P3 gate |
| Unknown commit left old execution guards usable | Mark exact guards settling before SQL; reconcile under the same locks; retain uncertain reservations | P2-23, P3-17 |
| Owner-only checks contradicted consumer policy and cross-principal work | One canonical SecurityComposition across wire/service/SQL and typed trusted entities | P2-03/P2-05/P2-06 |
| Empty canonical target arrays bypassed work scope | Targets when nonempty, otherwise origin; real origin effects must be declared | P2-21 |
| Claim capacity count could use a pre-lock snapshot | Separate awaited agent-lock statement, then fresh count; all epochs/sessions included | P3-01/P3-08 |
| Renew could revive an expired lease after lock wait | Recheck fresh database time after acquiring exact work lock | P3-09/P3-10 |
| Scope trigger allowed concurrent last-positive deletion | Lock distinct OLD/NEW work parents; separate fresh existence query at READ COMMITTED | P1-22 plus real two-session SQL |
| Revised root trigger introduced a late lock upgrade | Root validation takes session FOR SHARE; lifecycle/root writers lock exclusively up front | P0-22 |
| List output limits left scanning/memory unbounded | Examined-row/time budget, finite sweep, opaque continuation, bounded client tracked state | P4-14/P4-21/P4-22 |
| Snapshot/global-sequence race could lose a work change | Buffer before query, reconcile by per-item revisions; never cut hints by sampled serverSeq alone | P4-04/P4-05/P4-11 |
| General client port could not send completions or preserve deadlines | notify plus bounded request options, overall polling deadline and actual send settlement accounting | P5-13/P5-16 |
| Tool/work adapters could not observe generic shutdown | One lifetime signal/cleanup seam, partial attachment rollback and shared logical release | P5-14/P5-15 |
| Legacy tests required production fallback planned for deletion | Migrate useful scenarios to strict public V1; remove fallback/obsolete fixtures with coverage mapping | P5-18 |
| Host schema accepted work tag but caller SDK could not send it | Optional typed tool call options; token retained only on caller-to-host/private guard path | P5-17 |
| Version relabel could corrupt unrelated version axes | Private top-level envelope 1; legitimate tool contract 2 remains context.version 2 | P5-11/P5-19 |
| Portability test could miss a free Buffer global | Execute comparison/ack paths with Buffer absent and Unicode/budget cases | P5-06/P5-07 |

The targeted reviewers found no remaining material blocker in their corrected scopes. Small client deadline/cleanup wording clarifications were also applied. The later root-owned supplement fixes complete wire shapes, the required attempt field, bounded cursor ownership, approved error formatting, same-connection bind idempotency, child-retirement behavior and the exact stable state codec.

### 5. Final consistency decisions

- All remote contracts have one supported V1 shape. Work starts at V1 already; P5 relabels the currently unreleased private tool shape. JSON-RPC, Microsoft package/protocol and tool-definition versions are separate axes.
- Scope and announce are different typed selections. The nearest applicable include/exclude wins within containment, but no selection grants permission. A narrow child resolves its real parent; an excluded subtree can be explicitly re-included at a deeper anchor only within current permission.
- Canonical resource application data, provider recovery facts and native durable state stay separate. Metadata keys cannot forge owner/domain/role/policy. All callback outputs are captured and bounded again.
- Data conflicts cause no partial update or event. Authorized replay is independent of current mutable data and consumes no new quota. Unknown outcomes never become a false rollback or fabricated success.
- The current synchronous authorization final-admission seam is preserved. SQL authorization is explicitly admission-time with row/epoch fences, not a claim that JavaScript and COMMIT are atomic. External effects can be at least once.
- Single-store ownership is enforced at host composition with a retained database advisory connection and persistent epoch. It is not reacquired independently by every pool.
- Consumer hooks may narrow permission and choose a fenced authority-loss disposition. They cannot mint grants, mutate another attempt or veto explicit resource retirement.
- Same-connection agent-register replay is idempotent. A new binding/reconnect rotates the persistent epoch; live presence still stays in memory.
- Client/work bounds are visible outcomes. A partial scan or overlarge client view does not pretend that unseen work disappeared.
- P5 is a dependency/ownership cleanup with explicit behavior gates, not a new execution policy, an assignment-ledger rewrite or a new package ecosystem.

### 6. Operating limits and remaining proof obligations

The plan supports one active authoritative host for a logical store, PostgreSQL 17 READ COMMITTED, externally executed work and best-effort work hints with authorized reconciliation. It does not promise native chat turn hosting, durable event replay, active/active failover or exactly-once external side effects.

Before declaring implementation complete, the coding agent must compile and run the exact authored migrations and tests, including real two-pool lock waits, deferred-trigger races, unknown-COMMIT fault injection, recovery after provider creation, public binding/pinned-SDK interoperability, client runtime portability and all sample apps. Query plans and bounded-load measurements must be recorded using the actual adapter, not inferred from index names.

A provider whose external API cannot reconcile by a stable creation key cannot claim crash-safe automatic provisioning. The adapter should leave its durable instance unavailable and expose a consumer reconciliation path. Nonempty legacy development rows require an explicitly trusted mapping/reset decision; the default migration safely refuses them. Neither condition is hidden by declaring the plan ready.

---

## Full PostgreSQL 17 target schema

Fresh empty-schema reference only; forward migrations are separate implementation work. This SQL was statically reviewed, not executed here.

```sql
-- Agent Hosting Protocol V1 target schema — reviewed planning reference.
-- Baseline: spore310/AHP develop bcd85354723bce293e1384af0ca88e84d5ce9dda.
-- PostgreSQL 17, UTF-8, standard 8 KiB pages. Fresh EMPTY schema only.
-- This is NOT an upgrade script. P0/P1 author forward 0003/0004 migrations
-- from the two existing baselines; refuse nonempty legacy identity/work tables
-- unless an explicit application-supplied migration mapping is provided.
-- No production repository/database was changed by authoring this reference.
-- The portable repository contract must implement the same invariants.
BEGIN;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- host_id identifies the logical store, not a random process.
-- P0 acquires one namespace advisory lock on a DEDICATED connection, then
-- increments ownership_epoch. All mutation transactions hold this row FOR SHARE
-- and compare their expected epoch. Acquire ownership at host composition, not
-- once per repository pool. One active authoritative host per logical store.
CREATE TABLE host_state (
  host_id TEXT PRIMARY KEY,
  ownership_epoch BIGINT NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
  server_seq BIGINT NOT NULL DEFAULT 0
    CHECK (server_seq BETWEEN 0 AND 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(trim(host_id)) > 0)
);
CREATE UNIQUE INDEX host_state_one_logical_store_uidx ON host_state ((TRUE));

CREATE TABLE session_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  provider_id TEXT NOT NULL,
  display_name TEXT,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  work_manifest JSONB NOT NULL DEFAULT '{"kinds":[]}'::jsonb,
  creation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_key, version),
  CHECK (length(trim(type_key)) BETWEEN 1 AND 128),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (jsonb_typeof(config_schema) = 'object'),
  CHECK (jsonb_typeof(work_manifest) = 'object')
);

CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  display_name TEXT,
  description TEXT,
  -- Existing baseline says json-schema; trusted runtime uses draft-07.
  -- Align this descriptor in the migration without changing validation behavior.
  schema_dialect TEXT NOT NULL DEFAULT 'draft-07',
  input_schema JSONB NOT NULL,
  output_schema JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tool_key, version),
  CHECK (length(trim(tool_key)) BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(input_schema) = 'object'),
  CHECK (output_schema IS NULL OR jsonb_typeof(output_schema) = 'object')
);

CREATE TABLE session_type_tools (
  session_type_id UUID NOT NULL REFERENCES session_types(id) ON DELETE RESTRICT,
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE RESTRICT,
  PRIMARY KEY (session_type_id, tool_id)
);

CREATE TABLE sessions (
  session_instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id TEXT NOT NULL,
  session_uri TEXT NOT NULL,
  -- Durable mode requires an exact trusted type. In-memory untyped tests may remain.
  session_type_id UUID NOT NULL REFERENCES session_types(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  owner_principal_subject TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'creating' CHECK (
    lifecycle_status IN ('creating','active','suspended','failed','retiring','retired')
  ),
  state_revision BIGINT NOT NULL DEFAULT 1 CHECK (state_revision > 0),
  graph_revision BIGINT NOT NULL DEFAULT 1 CHECK (graph_revision > 0),
  durable_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_server_seq BIGINT NOT NULL DEFAULT 0
    CHECK (last_server_seq BETWEEN 0 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE (session_instance_id, domain_id),
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(session_uri)) > 0 AND octet_length(session_uri) <= 2048),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (length(trim(owner_principal_subject)) > 0),
  CHECK (octet_length(domain_id) <= 512),
  CHECK (octet_length(domain_id) + octet_length(owner_principal_subject) <= 2048),
  CHECK (jsonb_typeof(durable_state) = 'object'),
  CHECK ((lifecycle_status = 'retired') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX sessions_nonretired_uri_uidx
  ON sessions (session_uri) WHERE lifecycle_status <> 'retired';
CREATE INDEX sessions_owner_idx ON sessions (domain_id, owner_principal_subject);
CREATE INDEX sessions_recovery_idx
  ON sessions (lifecycle_status, session_instance_id)
  WHERE lifecycle_status <> 'retired';

CREATE TABLE canonical_resources (
  resource_pk UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_instance_id UUID NOT NULL,
  domain_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  -- Opaque public ResourceRef identity: not generally a UUID.
  instance_id TEXT NOT NULL,
  owner_principal_subject TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  parent_resource_pk UUID,
  grant_parent_resource_pk UUID,
  lifecycle_status TEXT NOT NULL DEFAULT 'creating' CHECK (
    lifecycle_status IN ('creating','active','suspended','failed','retiring','retired')
  ),
  resource_revision BIGINT NOT NULL DEFAULT 1 CHECK (resource_revision > 0),
  relationship_revision BIGINT NOT NULL DEFAULT 1 CHECK (relationship_revision > 0),
  data_revision BIGINT NOT NULL DEFAULT 1 CHECK (data_revision > 0),
  -- Durable facts only; reconstruct and revalidate against current trusted code.
  -- Exact schema is PersistedResourceRegistrationV1 in the contract packet.
  registration_data JSONB NOT NULL,
  runtime_driver_key TEXT NOT NULL,
  runtime_driver_version INTEGER NOT NULL CHECK (runtime_driver_version > 0),
  -- Reserved before an external call. Retry/reconcile by the SAME key.
  provision_key UUID NOT NULL DEFAULT gen_random_uuid(),
  recovery_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Consumer-owned instance data, separate from recovery and authorization facts.
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE (domain_id, kind, resource_id, instance_id),
  UNIQUE (resource_pk, session_instance_id, domain_id),
  UNIQUE (provision_key),
  FOREIGN KEY (session_instance_id, domain_id)
    REFERENCES sessions (session_instance_id, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_resource_pk, session_instance_id, domain_id)
    REFERENCES canonical_resources (resource_pk, session_instance_id, domain_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (grant_parent_resource_pk, session_instance_id, domain_id)
    REFERENCES canonical_resources (resource_pk, session_instance_id, domain_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(kind)) > 0),
  CHECK (length(trim(resource_id)) > 0),
  CHECK (length(trim(instance_id)) > 0),
  CHECK (length(trim(owner_principal_subject)) > 0),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (length(trim(runtime_driver_key)) > 0),
  -- Shared SDK UTF-8 identity budget; avoids oversized multibyte B-tree keys.
  CHECK (octet_length(domain_id) + octet_length(kind)
         + octet_length(resource_id) + octet_length(instance_id) <= 2048),
  CHECK (parent_resource_pk IS NULL OR parent_resource_pk <> resource_pk),
  CHECK (grant_parent_resource_pk IS NULL OR grant_parent_resource_pk <> resource_pk),
  CHECK (jsonb_typeof(registration_data) = 'object'),
  CHECK (jsonb_typeof(recovery_input) = 'object'),
  CHECK (jsonb_typeof(runtime_metadata) = 'object'),
  CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((lifecycle_status = 'retired') = (retired_at IS NOT NULL)),
  CHECK (
    (kind = 'session' AND instance_id = session_instance_id::text
     AND parent_resource_pk IS NULL AND grant_parent_resource_pk IS NULL)
    OR (kind <> 'session' AND parent_resource_pk IS NOT NULL)
  )
);
CREATE UNIQUE INDEX canonical_resources_nonretired_id_uidx
  ON canonical_resources (kind, resource_id) WHERE lifecycle_status <> 'retired';
CREATE UNIQUE INDEX canonical_resources_one_session_root_uidx
  ON canonical_resources (session_instance_id) WHERE kind = 'session';
CREATE INDEX canonical_resources_parent_idx
  ON canonical_resources (session_instance_id, parent_resource_pk);
CREATE INDEX canonical_resources_grant_parent_idx
  ON canonical_resources (session_instance_id, grant_parent_resource_pk);
CREATE INDEX canonical_resources_recovery_idx
  ON canonical_resources (session_instance_id, lifecycle_status, resource_pk);

CREATE TABLE agent_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id TEXT NOT NULL,
  principal_subject TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  display_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Fencing counter only. Never a persisted assertion that this agent is online.
  execution_epoch BIGINT NOT NULL DEFAULT 0 CHECK (execution_epoch >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_id, principal_subject, agent_key),
  UNIQUE (id, domain_id),
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(principal_subject)) > 0),
  CHECK (length(trim(agent_key)) BETWEEN 1 AND 128),
  CHECK (octet_length(domain_id) + octet_length(principal_subject)
         + octet_length(agent_key) <= 2048),
  CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 200)
);

CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_instance_id UUID NOT NULL,
  domain_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  input JSONB NOT NULL,
  -- Immutable initial data makes retries independent from subsequent data updates.
  submitted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_revision BIGINT NOT NULL DEFAULT 1 CHECK (data_revision > 0),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','leased','completed','failed','cancelled')
  ),
  submitted_by_kind TEXT NOT NULL CHECK (submitted_by_kind IN ('user','agent')),
  submitted_by_subject TEXT NOT NULL,
  submitted_by_agent_id TEXT,
  target_agent_id UUID,
  lease_agent_id UUID,
  lease_execution_epoch BIGINT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
  result JSONB,
  last_failure_code TEXT,
  last_failure_message TEXT,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_instance_id, kind, request_key),
  UNIQUE (id, session_instance_id, domain_id),
  FOREIGN KEY (session_instance_id, domain_id)
    REFERENCES sessions (session_instance_id, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_agent_id, domain_id)
    REFERENCES agent_registrations (id, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (lease_agent_id, domain_id)
    REFERENCES agent_registrations (id, domain_id) ON DELETE RESTRICT,
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(kind)) BETWEEN 1 AND 128),
  CHECK (length(trim(request_key)) BETWEEN 1 AND 256),
  CHECK (octet_length(kind) + octet_length(request_key) <= 2048),
  CHECK (length(trim(submitted_by_subject)) > 0),
  CHECK (submitted_by_agent_id IS NULL OR length(trim(submitted_by_agent_id)) > 0),
  CHECK ((submitted_by_kind = 'agent') = (submitted_by_agent_id IS NOT NULL)),
  CHECK (jsonb_typeof(input) = 'object'),
  CHECK (jsonb_typeof(submitted_data) = 'object'),
  CHECK (jsonb_typeof(data) = 'object'),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CHECK ((status = 'completed') = (result IS NOT NULL)),
  CHECK (last_failure_code IS NULL OR length(last_failure_code) BETWEEN 1 AND 64),
  CHECK (last_failure_message IS NULL OR length(last_failure_message) BETWEEN 1 AND 512),
  CHECK ((last_failure_code IS NULL) = (last_failed_at IS NULL)),
  CHECK (last_failure_message IS NULL OR last_failure_code IS NOT NULL),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    (status = 'leased' AND lease_agent_id IS NOT NULL
     AND lease_execution_epoch IS NOT NULL AND lease_execution_epoch > 0
     AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
     AND attempt_count > 0)
    OR
    (status <> 'leased' AND lease_agent_id IS NULL
     AND lease_execution_epoch IS NULL AND lease_token IS NULL
     AND lease_expires_at IS NULL)
  )
);
CREATE INDEX work_items_queued_priority_idx
  ON work_items (session_instance_id, priority DESC, created_at, id)
  WHERE status = 'queued';
CREATE INDEX work_items_expired_claim_idx
  ON work_items (session_instance_id, lease_expires_at, priority DESC, created_at, id)
  WHERE status = 'leased';
CREATE INDEX work_items_active_agent_idx
  ON work_items (lease_agent_id, lease_expires_at) WHERE status = 'leased';
CREATE INDEX work_items_session_list_idx
  ON work_items (session_instance_id, created_at, id);

CREATE TABLE work_resource_selections (
  work_id UUID NOT NULL,
  session_instance_id UUID NOT NULL,
  domain_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('scope','announce')),
  resource_pk UUID NOT NULL,
  include BOOLEAN NOT NULL,
  include_descendants BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (work_id, purpose, resource_pk),
  FOREIGN KEY (work_id, session_instance_id, domain_id)
    REFERENCES work_items (id, session_instance_id, domain_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_pk, session_instance_id, domain_id)
    REFERENCES canonical_resources (resource_pk, session_instance_id, domain_id)
    ON DELETE RESTRICT
);
CREATE INDEX work_resource_selections_resource_idx
  ON work_resource_selections (resource_pk, purpose);

-- Cross-row root consistency cannot be implemented with a row CHECK.
-- Deferred checks allow session + root reserve/activate/retire in one transaction.
CREATE FUNCTION ahp_assert_session_root() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  candidate UUID;
  candidates UUID[] := ARRAY[]::UUID[];
  session_row sessions%ROWTYPE;
  root_row canonical_resources%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN candidates := array_append(candidates, OLD.session_instance_id); END IF;
  IF TG_OP <> 'DELETE' THEN candidates := array_append(candidates, NEW.session_instance_id); END IF;
  FOR candidate IN SELECT DISTINCT value FROM unnest(candidates) AS ids(value) ORDER BY value LOOP
    -- READ COMMITTED adapter contract: fence session fact changes, then read
    -- dependent facts in a fresh statement after any lock wait. SHARE avoids
    -- a deferred lock upgrade for independent resource-data writers. Session
    -- lifecycle/root mutations already take their exclusive locks up front.
    SELECT * INTO session_row FROM sessions
      WHERE session_instance_id = candidate FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO root_row FROM canonical_resources
      WHERE session_instance_id = candidate AND kind = 'session';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session requires a canonical root' USING ERRCODE = '23514';
    END IF;
    IF ROW(root_row.domain_id, root_row.resource_id, root_row.instance_id,
           root_row.owner_principal_subject, root_row.provider_id, root_row.lifecycle_status)
       IS DISTINCT FROM
       ROW(session_row.domain_id, session_row.session_uri, candidate::text,
           session_row.owner_principal_subject, session_row.provider_id, session_row.lifecycle_status) THEN
      RAISE EXCEPTION 'Session root facts must match session' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sessions_require_root
  AFTER INSERT OR UPDATE ON sessions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_session_root();
CREATE CONSTRAINT TRIGGER resources_preserve_root
  AFTER INSERT OR UPDATE OR DELETE ON canonical_resources DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_session_root();

CREATE FUNCTION ahp_assert_work_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  candidate UUID;
  candidates UUID[] := ARRAY[]::UUID[];
BEGIN
  IF TG_TABLE_NAME = 'work_items' THEN
    IF TG_OP <> 'INSERT' THEN candidates := array_append(candidates, OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN candidates := array_append(candidates, NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN candidates := array_append(candidates, OLD.work_id); END IF;
    IF TG_OP <> 'DELETE' THEN candidates := array_append(candidates, NEW.work_id); END IF;
  END IF;
  FOR candidate IN SELECT DISTINCT value FROM unnest(candidates) AS ids(value) ORDER BY value LOOP
    -- Common-parent serialization prevents concurrent removal of the last
    -- positive selections. A separate fresh statement follows the lock wait.
    PERFORM id FROM work_items WHERE id = candidate FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT EXISTS (
       SELECT 1 FROM work_resource_selections
       WHERE work_id = candidate AND purpose = 'scope' AND include
    ) THEN
      RAISE EXCEPTION 'Work requires a positive scope selection' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER work_requires_scope
  AFTER INSERT OR UPDATE ON work_items DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_work_scope();
CREATE CONSTRAINT TRIGGER selections_preserve_scope
  AFTER INSERT OR UPDATE OR DELETE ON work_resource_selections DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_work_scope();

COMMIT;

-- Service/repository obligations, intentionally not claimed as DDL guarantees:
-- 1. Identity, type/provider, immutable submissions and selectors never mutate.
-- 2. Containment/grant-parent graphs are acyclic; existing edges are immutable
--    in V1. Insertion and retirement serialize on the exact session row and
--    advance graph_revision. Parents must be active, except creation under
--    the same host-issued in-flight capability; such children stay unavailable
--    until the full session/ancestor chain is active.
-- 3. Data schemas, UTF-8 byte/depth/key budgets, and projections are enforced
--    before I/O; JSONB object checks alone are not a size or schema validator.
-- 4. Current trusted policy, host epoch, live readiness, execution epoch,
--    lease token, attempt and database deadline fence every applicable command.
-- 5. Claim/renew capacity uses a separate agent-lock statement before counting.
-- 6. Physical purge deletes terminal work and its selectors first, then
--    resources in reverse containment/grant dependency order, then session.
-- 7. No grants, opaque proof receipts, sockets, presence, functions, arbitrary
--    credentials or runtime handles are reconstructed from these JSON columns.
-- 8. Repository writes and deferred cross-row checks use READ COMMITTED;
--    other isolation modes are unsupported until separately proved. Lock
--    distinct touched parent IDs in stable order before multi-row mutation.
--    Arbitrary direct SQL lock order can deadlock and must safely roll back.

```

# P0 — durable sessions, canonical resources, and provider lifecycle

**Outcome:** sessions and canonical resource instances survive process loss; provider-owned resources can be reconciled, restored and retired through existing session/provider boundaries.  
**Depends on:** shared contract decisions and exact source baseline.  
**Does not implement:** work scheduling policy, chat inference/turn execution, distributed hosting, automatic grant restoration or a general event store.

## 1. Current implementation and ownership

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

## 2. Foundation repository contract

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

## 3. Single-host ownership

Add `host_state.ownership_epoch` and an owned lifecycle port on persistence. Host composition calls it once; opening an extra repository pool does not acquire a second host lease.

PostgreSQL steps:

1. On a dedicated retained connection, try a session-level advisory lock for the logical store namespace. The key must not vary by process ID or arbitrary hostId.
2. Fail startup if another host owns the namespace. Verify the stable logical host/store ID; increment the persisted epoch and commit before hydration.
3. Every mutation transaction reads/locks the host-state row and compares its captured epoch. Hold the lock until commit. Use shared mode for ordinary writes; a sequence-checkpoint write acquires its required exclusive row lock **before** session/agent/work locks, never upgrades late.
4. A lock-connection error closes local admission immediately. Outstanding operations may settle under the admission guarantee, but cannot write using an old epoch after a replacement owner has taken the row.
5. A replacement owner cannot become active until its epoch update has waited for old mutation transactions and committed. Recovery then rebuilds live state.
6. Stop drains admitted transactions within configured bounds, releases live resources and finally releases the advisory connection. Do not reuse a connection whose lock ownership became uncertain.

This is protection against overlapping hosts and delayed writes, not active/active scheduling or fencing arbitrary external provider side effects. Provider operations still require idempotency and cooperative cancellation.

## 4. Reserve → provision → activate

Implement one lifecycle coordinator under sessions, not a new independent resource authority.

### New session

1. Capture/validate native parameters, exact type/provider, normalized config, owner/domain from trusted creation context and consumer approval.
2. Allocate session incarnation and root IDs, stable provision key and serialized provider recovery input.
3. Reserve session + root `creating` in one transaction after final synchronous admission. Unique URI constraints settle competing creates.
4. Attach the exact provisional live record and fresh creation authority only for permitted creating-state operations. A claim/tool operation requiring readiness still denies.
5. Call provider `startSession` with abort signal and per-session resource capability. Provider may create chats/terminals/custom backing resources via registered drivers. Their calls use the same durable reserve/provision/activate protocol.
6. Commit the root/session active transition with recovery metadata only after the backend exists and the exact creation still owns the record. Install it in the cache and publish the native ready transition after the commit.
7. If shutdown/retirement wins while provisioning awaits, never resurrect the old record. Release any late handle; reconcile/destroy by the old provision key as required. A replacement URI is unrelated.

### Child resource

The host chooses domain/owner/provider facts and canonical registration from trusted registration code. It verifies the parent and optional grant parent belong to the exact session and are valid dependencies. Capture all data before awaiting. Reserve under a session-row graph lock so two inserts cannot race graph validation or a resource-count limit.

Existing edges cannot be reparented in this V1 slice. A parent may be active, or creating under the same scoped creation capability; a child below a nonoperational ancestor is never independently executable. Register canonical route facts and separate grant inheritance; parent selection does not itself issue grants.

### Failure ownership

| Failure window | Required durable/live result |
| --- | --- |
| Reserve fails | No external provision call, no live publication |
| External create fails | Failed/unavailable record; approved bounded diagnostic; no active authority |
| External create succeeds; receipt commit fails/unknown | Reconcile the same provision key; do not invent a second resource |
| Durable active commit succeeds; live install fails | Fence, suspend/reconcile, release local handle; retain durable identity |
| Timeout while callback still running | Abort signal and unavailable state; keep settlement slot/ownership until actual settlement |
| Late success after retirement | Release/destroy only the old instance; never reattach or overwrite replacement metadata |

A cleanup exception must not prevent cleanup attempts for sibling resources. Aggregate sanitized completion diagnostics while retaining each unresolved resource's recovery state.

## 5. Restart and recovery

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

## 6. Durable state writes and sequencing

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

## 7. Retirement and physical cleanup

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

## 8. SQL and migration acceptance

Author 0003 against the existing empty baseline. Refuse legacy session/work/registration rows without a trusted mapping. Add domain/incarnation/resource/epoch foundation, new root checks, recovery fields and resource data CAS. Map existing empty work identity/FK columns to the new parent identity so P0 remains buildable; P1 adds its submission fields and selections.

Use the supplied target schema as the end-state specification. Important constraints include same-domain/session composite FKs, public identity uniqueness, only one nonretired URI, exact root/session equality, distinct opaque resource instance IDs, JSON object checks and retirement consistency.

Do not claim cross-row graph acyclicity or callback semantics from a JSONB column. Enforce graph insertion, combined dependency cycles and immutable edges in the repository transaction. The optional raw SQL smoke script covers DDL; real adapter tests cover these service/repository rules.

## 9. Required acceptance evidence

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

## 10. Test/app commands and exit gate

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


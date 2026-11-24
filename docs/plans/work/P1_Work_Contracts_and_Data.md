# P1 — work contracts, canonical selections, priority, data and idempotency

**Outcome:** a work item has an exact parent incarnation, immutable intent/provenance, deterministic scope and announcement rules, and separately mutable application data.  
**Depends on:** P0 durable identities, coherent repositories and lifecycle fences.  
**Boundary:** remote work mutation remains disabled until P3 policy, epoch and capacity integration passes.

## 1. Existing files and target ownership

Modify `src/work/{types.ts,index.ts,helpers/helpers.ts}`, `src/persistence/types.ts`, the PostgreSQL work repository/row mappers, `src/websocket/helpers/ahp/agentWork.ts`, session-type/application capture, and the in-memory test/example adapters.

Add selection behavior under `src/work/helpers/selections/{types,helpers,index}.ts`; add work-kind definition capture under `src/work/helpers/definitions/`. Session types reference that work-owned definition contract. Do not put SQL in the work service or policies in a wire parser.

Create `database/migrations/0004_work_policy_scheduling.sql` for the final work shape: priority, domain/incarnation FK, submitter facts, data/submitted_data/revisions, lease execution epoch, failure fields, selector table and indices. P3 implements the lease behavior against these fields. Match the end-state SQL exactly.

## 2. Submission API and normalization

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

## 3. Selector evaluation contract

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

## 4. Work state and schema

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

## 5. Idempotency and commit outcomes

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

## 6. Data mutation API

### Target `./src/work/types.ts`

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

## 7. Read models and pagination preparation

Define three projections, with explicit serializers:

- Internal repository record: full immutable intent, selectors, provenance and lease fields.
- Authorized work view: selected input/result/data/provenance, revisions and status; never leaseToken or raw private recovery/policy metadata.
- Work list summary: ID, exact session, kind, priority, status, timestamps and revision; omit input/result/data by default so pagination has a predictable budget.

P2 decides whether each projection is visible. P4 adds list/subscription wiring. Targeted agent information or failure summary is included only if the view policy permits it.

Use immutable `created_at,id` for list keysets; priority-claim scans use `priority DESC,created_at,id`. Preserve database timestamp precision in opaque cursors. A pg Date converted to milliseconds must not truncate the microseconds used by SQL keyset comparisons.

## 8. Acceptance tests

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


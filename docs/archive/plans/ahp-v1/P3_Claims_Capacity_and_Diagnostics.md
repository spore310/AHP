# P3 — atomic priority claims, agent capacity, lease fencing and diagnostics

**Outcome:** work acquisition and settlement are correct under competing requests, reconnects, expiry, retries and database lock waits.  
**Depends on:** P0 host/incarnation fences, P1 schema/contracts, P2 prepared canonical authority.  
**No additions:** autonomous worker runtime, scheduling daemon, Redis, distributed queue or inferred caller permissions.

## 1. Files and public configuration

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

## 2. Durable binding epochs

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

## 3. Candidate selection before SQL mutation

Consumer policies can require asynchronous work; do not execute them while holding row locks.

- Scan coarse eligible candidates using exact session/domain, allowed kinds, target compatibility, queued/expired state and remaining attempts.
- Order by `priority DESC, created_at ASC, id ASC`.
- Read 32 candidates per page, at most 128 examined per call. Prepare policies and scope facts with bounded concurrency.
- Preserve a server-owned keyset continuation when a denied page hides deeper work. Bind it to exact agent epoch, session, filter, authority/config/graph revision and host epoch.
- Retain at most 1,024 continuations with finite expiry. A changed authority/filter/epoch resets that sweep. A completed sweep starts again from the priority head.
- Pass only genuine prepared candidate IDs and exact work revisions to the mutation transaction.
- Never pass a client-supplied list of authorized IDs, maxClaims or allowedKinds.

Priority means the highest permitted **unlocked** candidate in the current evaluated sweep. New arrivals and policy changes may interleave. There is no strict global fairness or starvation-free priority-aging promise. A locked urgent item can be skipped; low priority can wait behind sustained higher-priority arrivals.

### Claim result

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

## 4. Claim transaction: order is part of correctness

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

## 5. Renewal and settlement

### Renew

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

### Complete/fail/cancel

Complete/fail require token + attempt + registration epoch + exact session and deadline, with current policy/presence. Release-only operations need not lock the agent after a work row; never introduce that reverse order. A concurrent new claim may conservatively count a lease about to be released, which can delay a claim but cannot exceed the cap.

- Complete validates result, optionally replaces data with CAS, sets completed, increments revision and clears every lease field.
- Retryable fail queues only when attempt_count < max_attempts; otherwise failed. Capture approved failure code/summary/time. Clear all lease fields.
- Cancel requires separate authority, changes queued/leased to cancelled, increments revision and clears all lease fields. Terminal cancellation is a no-op after permission checking.
- A repeated settle with a now-cleared token may return stale. It does not mutate or emit twice; the worker resolves an uncertain outcome through authorized get. No terminal token-history ledger is added.
- A changed token/attempt/epoch must never settle or annotate a newer attempt.

Before sending any lease/data/retirement mutation to SQL, mark affected private guards settling after final admission; they cannot remain usable while outcome is uncertain. A known rollback allows fresh preparation, a confirmed commit installs fresh facts, and unknown outcome remains unavailable until same-fence locked reconciliation. A late operation may release only its own settling marker. Maintain private lease-guard invalidation alongside every confirmed mutation. Timed-out operations retain their in-flight SQL/settlement capacity until the underlying transaction is known to settle or its client is discarded.

## 6. Expiry and retry exhaustion

Replace the current global exhausted-row reconciliation on every claim with bounded, indexed reconciliation for the requested session plus bounded startup recovery maintenance. It is a host-owned repository operation, not a worker permission grant.

A batch locks only its selected expired/exhausted rows with SKIP LOCKED, rechecks the deadline after locks, transitions to failed, records `lease_expired`, clears lease fields and increments revisions. Emit post-commit events through P4 when wired. An expired lease with attempts remaining is available to a replacement claim; old token/epoch/attempt then fails.

Do not build a background scheduler or promise immediate terminal-state notification in a completely idle host. The durable deadline already determines whether a lease is active. Consumers needing timed maintenance can call the bounded reconciliation helper through their existing application lifecycle.

## 7. Diagnostic extension and error storage

Extend existing callbacks instead of adding a logging subsystem:

- Add top-level `AHPServerOptions.onDiagnostic` forwarding sanitized session/work/persistence/binding events.
- Replace the current no-op callback passed to `createAHPBinding` with this forwarding adapter.
- Retain optional per-module sinks if needed, with explicit no-double-delivery composition.
- Work hooks include `submitted`, `claimCapacityDenied`, `claimScanDeferred`, `staleLeaseRejected`, `authorityLoss`, `publicationFailed`, `storageOutcomeUnknown` and lifecycle failures.
- Diagnostic payloads contain stable IDs/codes/counts/durations and a generated correlation ID. Never include token, input/data/result, credentials, raw worker text, SQL text, arbitrary exception message or stack.
- A diagnostic sink throw cannot alter a successful commit. Consumers route records to their logger.

Persist latest failure code (<=64 chars), approved summary (<=512 chars) and failure timestamp. The default formatter returns a generic summary. A consumer formatter may choose a safe summary from its context; validate output and fall back on failure. Do not call arbitrary worker text “sanitized” just because it was truncated.

Expose bounded counters through the existing service/configuration boundary when needed for tests and consumer monitoring: pending/settling operations, scan deferrals, cap denials, authority-loss queue occupancy. No new metrics framework or event-history table.

## 8. Real SQL acceptance matrix

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

## 9. Performance and example gates

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


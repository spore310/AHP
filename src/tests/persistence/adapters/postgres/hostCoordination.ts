import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import type { DurableHost, DurableStorage, HostClaim, HostEvent, HostEventDelivery } from "@persistence";
import { createPostgresDurableStorage } from "@persistence/helpers/adapters/postgres";
import { assertHostCoordinationConformance } from "../../conformance/hostCoordination";
import { createWorkSessionFixture } from "../../conformance/work";
import { assertScheduling } from "../../conformance/scheduling";
import type { AgentRegistrationRecord } from "@persistence";
import { testWorkSettlement } from "./p1Work";
import { checkDeadline } from "./p3Work";

const migrations = ["0001_session_tool_baseline", "0002_agent_work", "0003_durable_session_resources", "0004_work_policy_scheduling", "0005_host_coordination"];
const namespaceId = "ahp-namespace:conformance/sql";
const claim = (instanceId: string, overrides: Partial<HostClaim> = {}): HostClaim => ({
  namespaceId, instanceId, shared: true, policy: { revision: 1, digest: "digest-1" }, capabilities: { providers: ["test"] }, leaseMs: 1_500, ...overrides });
const until = async (check: () => boolean | Promise<boolean>, label: string, timeoutMs = 8_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${label}.`);
};

/**
 * Real-SQL proof for host coordination. Every scenario uses its own schema with
 * all forward migrations applied, and separate pools for separate "hosts".
 */
export async function testHostCoordination(input: string): Promise<void> {
  const base = new URL(input);
  base.searchParams.delete("options");
  const admin = new Pool({ connectionString: base.href, max: 4 });
  const schemas: string[] = [];
  const scripts = await Promise.all(migrations.map((name) => readFile(new URL(`../../../../../database/migrations/${name}.sql`, import.meta.url), "utf8")));
  const createSchema = async (): Promise<string> => {
    const schema = `host_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    const client = await admin.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path = ${schema}`);
      for (const script of scripts) await client.query(script);
    } finally {
      await client.query("RESET search_path").catch(() => undefined);
      client.release();
    }
    return schema;
  };
  const storageFor = (schema: string): DurableStorage => createPostgresDurableStorage({ connectionString: base.href, schema, maxConnections: 3, eventPollMs: 50 });
  try {
    // H2-08: the PostgreSQL adapter implements the same transitions as the in-memory adapter.
    await assertHostCoordinationConformance(async () => {
      const schema = await createSchema();
      return () => storageFor(schema);
    });

    const schema = await createSchema();
    const sql = new Pool({ connectionString: base.href, max: 4, options: `-c search_path=${schema}` });
    const hosts: DurableHost[] = [];
    try {
      // H2-01: two real connections race for one membership identity and for one lease.
      const sameIdentity = await Promise.allSettled([storageFor(schema).acquire("host-a", () => undefined, claim("a-1")), storageFor(schema).acquire("host-a", () => undefined, claim("a-1"))]);
      const sameLease = sameIdentity.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      assert.equal(sameLease.length, 1);
      const a = sameLease[0];
      assert.ok(a?.coordination);
      hosts.push(a);
      const rivals = await Promise.allSettled([storageFor(schema).acquire("host-b", () => undefined, claim("b-1")), storageFor(schema).acquire("host-b", () => undefined, claim("b-2"))]);
      const winners = rivals.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      assert.equal(winners.length, 1);
      const b = winners[0];
      assert.ok(b?.coordination);
      hosts.push(b);
      // The losing claims left nothing behind.
      assert.deepEqual((await sql.query("SELECT host_id, role FROM host_members ORDER BY host_id")).rows, [{ host_id: "host-a", role: "active" }, { host_id: "host-b", role: "active" }]);
      assert.equal((await sql.query<{ held: number }>("SELECT count(*)::int AS held FROM pg_locks WHERE locktype='advisory' AND objid='host_state'::regclass::oid AND granted")).rows[0]?.held, 2);

      // H2-02 H2-07: an expired membership cannot renew, closes admission by itself and cannot release its successor.
      let lost = 0;
      const expiring = await storageFor(schema).acquire("host-c", () => {
        lost += 1;
      }, claim("c-1", { leaseMs: 1_000 }));
      const oldGeneration = expiring.coordination?.generation;
      const session = await createWorkSessionFixture(expiring);
      await sql.query("UPDATE host_members SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE host_id = 'host-c'");
      await until(() => lost === 1 && !expiring.isOpen(), "expired member lost");
      await assert.rejects(expiring.sessions.get(session.ref));
      const successor = await storageFor(schema).acquire("host-c", () => undefined, claim("c-1", { leaseMs: 1_000 }));
      hosts.push(successor);
      assert.notEqual(successor.coordination?.generation, oldGeneration);
      assert.equal(BigInt(successor.epoch), BigInt(expiring.epoch) + 1n);
      await expiring.release();
      assert.equal(await a.coordination.isCurrentMember("host-c", "c-1", successor.coordination?.generation ?? ""), true);
      assert.equal(await a.coordination.isCurrentMember("host-c", "c-1", oldGeneration ?? ""), false);
      assert.deepEqual((await successor.sessions.listRecoverable()).map((row) => row.ref), [session.ref]);

      // H2-03: a write the old owner started before a transfer either commits first or is refused. It never lands after.
      const moving = await createWorkSessionFixture(a);
      const gate = await sql.connect();
      try {
        await gate.query("BEGIN");
        await gate.query("SELECT 1 FROM sessions WHERE session_instance_id = $1 FOR UPDATE", [moving.ref.instanceId]);
        const seq = (await a.coordination.allocateServerSeq(1))[0] ?? 0;
        const admitted = a.sessions.commitState({ ref: moving.ref, expectedRevision: "1", state: { title: "admitted" }, serverSeq: seq, modifiedAt: new Date().toISOString() }, () => true);
        const transfer = a.coordination.transfer(moving.ref, "host-b");
        // Both outcomes are inspected together below.
        admitted.catch(() => undefined);
        transfer.catch(() => undefined);
        // The admitted write waits on the session row. The transfer queues behind that write's host fence.
        await until(async () => (await sql.query<{ waiting: number }>("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0]?.waiting === 2, "both writers waiting");
        await gate.query("COMMIT");
        const [write, move] = await Promise.allSettled([admitted, transfer]);
        assert.equal(move.status, "fulfilled", move.status === "rejected" ? String(move.reason) : undefined);
        const stored = (await sql.query<{ owner_host_id: string; state_revision: string; durable_state: { title?: string } }>(
          "SELECT owner_host_id, state_revision::text, durable_state FROM sessions WHERE session_instance_id = $1", [moving.ref.instanceId])).rows[0];
        assert.equal(stored?.owner_host_id, "host-b");
        // Whichever order the locks were granted in, the outcome is consistent with it.
        assert.equal(stored.state_revision, write.status === "fulfilled" ? "2" : "1");
        await assert.rejects(a.sessions.commitState({ ref: moving.ref, expectedRevision: stored.state_revision, state: { title: "late" }, serverSeq: (await a.coordination.allocateServerSeq(1))[0] ?? 0,
          modifiedAt: new Date().toISOString() }, () => true));
        assert.equal((await sql.query<{ title: string | null }>("SELECT durable_state->>'title' AS title FROM sessions WHERE session_instance_id = $1", [moving.ref.instanceId])).rows[0]?.title
          ?? null, write.status === "fulfilled" ? "admitted" : null);
      } finally {
        await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
      }

      // H2-05: a revocation waits for a transaction that was already admitted, and precedes every later one.
      const admittedEarlier = await sql.connect();
      try {
        await admittedEarlier.query("BEGIN");
        await admittedEarlier.query("SELECT 1 FROM host_namespaces FOR SHARE");
        let recorded = false;
        const revoking = a.coordination.revokeAuthority().then((revision) => {
          recorded = true;
          return revision;
        });
        await delay(300);
        assert.equal(recorded, false, "the revocation is ordered after the admitted transaction");
        await admittedEarlier.query("COMMIT");
        const revision = await revoking;
        // No notification is involved: the next fenced transaction on another host fails closed, with no effect.
        await assert.rejects(createWorkSessionFixture(b));
        assert.equal(b.coordination.authorityRevision(), revision);
        a.coordination.acknowledgeAuthority(revision);
        b.coordination.acknowledgeAuthority(revision);
        await createWorkSessionFixture(b);
      } finally {
        await admittedEarlier.query("ROLLBACK").catch(() => undefined);
        admittedEarlier.release();
      }

      // H2-10: ownership change, retirement, revocation and a state write compete for the same rows.
      // They queue in one lock order behind a single barrier and all settle: no deadlock, no stuck client.
      {
        const contested = await createWorkSessionFixture(a);
        const retired = await createWorkSessionFixture(a);
        const deadlocksBefore = (await sql.query<{ deadlocks: string }>("SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()")).rows[0]?.deadlocks;
        const barrier = await sql.connect();
        try {
          await barrier.query("BEGIN");
          await barrier.query("SELECT 1 FROM sessions WHERE session_instance_id = ANY($1::uuid[]) FOR UPDATE", [[contested.ref.instanceId, retired.ref.instanceId]]);
          const seq = (await a.coordination.allocateServerSeq(1))[0] ?? 0;
          const competing = [
            a.sessions.commitState({ ref: contested.ref, expectedRevision: "1", state: { title: "write" }, serverSeq: seq, modifiedAt: new Date().toISOString() }, () => true),
            a.coordination.transfer(contested.ref, "host-b"),
            a.sessions.beginRetirement(retired.ref, () => true),
            a.coordination.transfer(retired.ref, "host-b"),
            a.coordination.revokeAuthority(),
            b.coordination.adopt("host-a"),
          ];
          for (const operation of competing) operation.catch(() => undefined);
          await until(async () => ((await sql.query<{ waiting: number }>("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0]?.waiting ?? 0) >= 2, "operations queued");
          await barrier.query("COMMIT");
          const outcomes = await Promise.race([Promise.allSettled(competing), delay(20_000).then(() => assert.fail("competing operations did not settle"))]);
          // Refusals are generic: no statement text, table name or lock detail reaches the caller.
          for (const outcome of outcomes) if (outcome.status === "rejected") assert.ok(!/select|update|host_state|sessions|deadlock/iu.test(String(outcome.reason)), String(outcome.reason));
          assert.equal(outcomes[5]?.status, "rejected", "a live owner is never adopted from");
          const revoked = outcomes[4];
          const revision = revoked?.status === "fulfilled" ? Number(revoked.value) : assert.fail("the revocation did not complete");
          a.coordination.acknowledgeAuthority(revision);
          // The other host has not observed the revocation yet. Its next fenced write fails closed, then it acknowledges.
          await assert.rejects(createWorkSessionFixture(b));
          b.coordination.acknowledgeAuthority(revision);
        } finally {
          await barrier.query("ROLLBACK").catch(() => undefined);
          barrier.release();
        }
        // Nothing is left inside a transaction or waiting, so no pooled client leaked.
        await until(async () => (await sql.query<{ stuck: number }>(`SELECT count(*)::int AS stuck FROM pg_stat_activity WHERE datname=current_database()
          AND pid <> pg_backend_pid() AND (state LIKE 'idle in transaction%' OR wait_event_type='Lock')`)).rows[0]?.stuck === 0, "no stuck database client");
        // Each session ended in exactly one consistent state.
        const rows = (await sql.query<{ id: string; owner: string; lifecycle: string }>(`SELECT session_instance_id::text AS id, owner_host_id AS owner, lifecycle_status AS lifecycle
          FROM sessions WHERE session_instance_id = ANY($1::uuid[])`, [[contested.ref.instanceId, retired.ref.instanceId]])).rows;
        const state = new Map(rows.map((row) => [row.id, row]));
        assert.ok(["host-a", "host-b"].includes(state.get(contested.ref.instanceId)?.owner ?? ""));
        assert.equal(state.get(contested.ref.instanceId)?.lifecycle, "active");
        const afterRetire = state.get(retired.ref.instanceId);
        // Retirement and transfer exclude each other: a retiring session stays with its owner, a moved one is not retiring.
        assert.ok((afterRetire?.lifecycle === "retiring" && afterRetire.owner === "host-a") || (afterRetire?.lifecycle === "active" && afterRetire.owner === "host-b"), JSON.stringify(afterRetire));
        await createWorkSessionFixture(a);
        await createWorkSessionFixture(b);

        // The adoption order itself, with an owner that has no live instance.
        const gone = await storageFor(schema).acquire("host-d", () => undefined, claim("d-1"));
        const orphan = await createWorkSessionFixture(gone);
        await gone.release();
        const lingering = await sql.connect();
        try {
          // A transaction the dead owner left open still holds its host row.
          await lingering.query("BEGIN");
          await lingering.query("SELECT 1 FROM host_state WHERE host_id='host-d' FOR SHARE");
          const started = performance.now();
          await assert.rejects(b.coordination.adopt("host-d"));
          // Refused without waiting on another host's row, so the adopter's own row was never pinned behind it.
          assert.ok(performance.now() - started < 5_000, "adoption waited on the previous owner's row");
          // The refused adoption left no lock behind: the lingering transaction can take the namespace row at once.
          await lingering.query("SET LOCAL lock_timeout = '2s'");
          await lingering.query("UPDATE host_namespaces SET updated_at = clock_timestamp()");
          await lingering.query("COMMIT");
        } finally {
          await lingering.query("ROLLBACK").catch(() => undefined);
          lingering.release();
        }
        const held = await sql.connect();
        try {
          await held.query("BEGIN");
          const pid = (await held.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid ?? 0;
          await held.query("SELECT 1 FROM sessions WHERE session_instance_id = $1 FOR UPDATE", [orphan.ref.instanceId]);
          const blockedBy = async (): Promise<number> => (await sql.query<{ waiting: number }>(
            "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid])).rows[0]?.waiting ?? 0;
          // The adoption now holds the dead owner's row, its own host row and the namespace share lock, and waits for the session row.
          const adopting = b.coordination.adopt("host-d");
          adopting.catch(() => undefined);
          await until(async () => await blockedBy() >= 1, "adoption waiting for the session row");
          // A revocation takes its own host row and then the namespace row exclusively: it queues behind the adoption.
          const revoking = a.coordination.revokeAuthority();
          revoking.catch(() => undefined);
          await until(async () => ((await sql.query<{ waiting: number }>("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0]?.waiting ?? 0) >= 2,
            "revocation queued behind the adoption");
          await held.query("COMMIT");
          const [adopted, revision] = await Promise.race([Promise.all([adopting, revoking]), delay(20_000).then(() => assert.fail("adoption and revocation did not settle"))]);
          assert.deepEqual(adopted.map((location) => [location.session.instanceId, location.hostId]), [[orphan.ref.instanceId, "host-b"]]);
          a.coordination.acknowledgeAuthority(revision);
          await assert.rejects(createWorkSessionFixture(b));
          b.coordination.acknowledgeAuthority(revision);
        } finally {
          await held.query("ROLLBACK").catch(() => undefined);
          held.release();
        }
        assert.equal((await sql.query<{ owner: string }>("SELECT owner_host_id AS owner FROM sessions WHERE session_instance_id = $1", [orphan.ref.instanceId])).rows[0]?.owner, "host-b");
        await createWorkSessionFixture(b);
        // Backends report a deadlock to the statistics collector when they next go idle, at most ten seconds later.
        await delay(11_000);
        assert.equal((await sql.query<{ deadlocks: string }>("SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()")).rows[0]?.deadlocks, deadlocksBefore);
      }

      // H8-09: the lease regressions hold on one host while another host is active in the same store:
      // a renewal after expiry cannot revive a lease, and a lost commit acknowledgement stays uncertain.
      {
        const register = async (r: AgentRegistrationRecord): Promise<void> => {
          await sql.query(`INSERT INTO agent_registrations(id,domain_id,principal_subject,agent_key,execution_epoch,enabled) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT (id) DO UPDATE SET execution_epoch=EXCLUDED.execution_epoch,enabled=EXCLUDED.enabled`, [r.id, r.domainId, r.principalSubject, r.agentKey, r.executionEpoch, r.enabled]);
        };
        let written = 0;
        const busy = setInterval(() => {
          void createWorkSessionFixture(a).then(() => {
            written += 1;
          }, () => undefined);
        }, 25);
        const blockedBy = async (pool: Pool, pid: number): Promise<void> => until(async () => ((await pool.query<{ waiting: number }>(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid])).rows[0]?.waiting ?? 0) >= 1, "a writer blocked behind the barrier");
        try {
          await assertScheduling(b, register, async (id) => {
            assert.equal((await sql.query("UPDATE work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id])).rowCount, 1);
          });
          const before = written;
          // A renewal that waited on a row lock past the stored deadline is refused, the lease is taken over
          // with a new attempt, and the earlier attempt can neither renew nor settle.
          await checkDeadline(b, b.work, sql, register, blockedBy);
          assert.ok(written > before, "the other logical host committed writes during the renewal window");
          await testWorkSettlement(b, sql);
        } finally {
          clearInterval(busy);
        }
        assert.ok(written > 0);
      }

      // H6: the durable outbox. Every consumer has its own cursor; nothing is consumed exclusively.
      const seen: Record<"a" | "b", HostEvent[]> = { a: [], b: [] };
      const resets: Record<"a" | "b", number> = { a: 0, b: 0 };
      const listen = (name: "a" | "b") => (delivery: HostEventDelivery): void => {
        if (delivery.type === "reset") resets[name] += 1;
        else seen[name].push(delivery.event);
      };
      const stops = [a.coordination.subscribeEvents(listen("a")), b.coordination.subscribeEvents(listen("b"))];
      const marker = (kind: string) => (events: HostEvent[]) => events.filter((event) => event.kind === kind);
      const insert = "INSERT INTO host_events (topic, kind, origin_host_id, entity_id, revision) VALUES ('work', $1, 'probe', $2, $3)";
      // H6-01: no notification is sent for this row. Polling the durable table still delivers it to every consumer.
      await sql.query(insert, ["committed", "w-1", 1]);
      await until(() => marker("committed")(seen.a).length === 1 && marker("committed")(seen.b).length === 1, "every consumer sees a committed event");
      // H6-02: a rolled-back change publishes nothing.
      const rolled = await sql.connect();
      try {
        await rolled.query("BEGIN");
        await rolled.query(insert, ["rolled-back", "w-2", 1]);
        await rolled.query("SELECT pg_notify('ahp_host_events', 'x')");
        await rolled.query("ROLLBACK");
      } finally {
        rolled.release();
      }
      // H6-06: a lower identifier that commits late is never skipped, and arrives before the higher one.
      const late = await sql.connect();
      try {
        await late.query("BEGIN");
        await late.query(insert, ["late-low", "w-3", 1]);
        await sql.query(insert, ["early-high", "w-4", 1]);
        await sql.query("SELECT pg_notify('ahp_host_events', 'x')");
        await delay(300);
        assert.equal(marker("early-high")(seen.a).length + marker("early-high")(seen.b).length, 0);
        await late.query("COMMIT");
      } finally {
        late.release();
      }
      await until(() => marker("early-high")(seen.a).length === 1 && marker("early-high")(seen.b).length === 1, "held event delivered");
      for (const events of [seen.a, seen.b]) {
        assert.deepEqual(events.filter((event) => event.kind === "late-low" || event.kind === "early-high").map((event) => event.kind), ["late-low", "early-high"]);
        assert.equal(marker("rolled-back")(events).length, 0);
        // H6-03: stable identity per event, so a redelivery is recognisable.
        assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
      }
      // A real work change records its own event in the same transaction, with identifiers only.
      const graph = await b.work.graph(moving.ref.domainId, { kind: "session", id: moving.ref.id });
      assert.ok(graph);
      const submitted = await b.work.submit({ session: moving.ref, requestKey: "outbox", kind: "review", maxAttempts: 3, input: { secret: "not-in-events" }, submittedData: {}, priority: 0, targetAgentId: null,
        scope: [{ resource: moving.ref, include: true, includeDescendants: false }], announce: [], submitter: { kind: "user", principal: { domainId: moving.ref.domainId, subject: "owner" } } },
      graph.session.graphRevision, { host: 1000, session: 10 }, () => true);
      await until(() => seen.a.some((event) => event.entityId === submitted.id) && seen.b.some((event) => event.entityId === submitted.id), "work event on every consumer");
      const workEvent = seen.a.find((event) => event.entityId === submitted.id);
      assert.deepEqual([workEvent?.topic, workEvent?.kind, workEvent?.originHostId, workEvent?.revision, workEvent?.session], ["work", "submitted", "host-b", "1", moving.ref]);
      assert.ok(!JSON.stringify(seen).includes("not-in-events"));
      assert.equal((await sql.query<{ rows: number }>("SELECT count(*)::int AS rows FROM host_events WHERE entity_id = $1", [submitted.id])).rows[0]?.rows, 1);
      // H6-04: a consumer that stops and a new one that starts do not disturb the other.
      stops[0]?.();
      await sql.query(insert, ["after-unsubscribe", "w-5", 1]);
      await until(() => marker("after-unsubscribe")(seen.b).length === 1, "remaining consumer");
      assert.equal(marker("after-unsubscribe")(seen.a).length, 0);
      // H6-10: retention loss and an oversized backlog are reported as a reset, never silently skipped.
      await sql.query("UPDATE host_event_retention SET pruned_through = (SELECT (pg_current_xact_id()::text)::bigint + 100)");
      await sql.query("SELECT pg_notify('ahp_host_events', 'x')");
      await until(() => resets.b >= 1, "retention reset");
      await sql.query("UPDATE host_event_retention SET pruned_through = 0");
      await delay(150);
      const before = resets.b;
      await sql.query("INSERT INTO host_events (topic, kind, origin_host_id) SELECT 'work', 'flood', 'probe' FROM generate_series(1, 600)");
      await until(() => resets.b > before, "backlog reset");
      assert.equal(marker("flood")(seen.b).length, 0);
      stops[1]?.();
      // Retention is bounded: old events are removed and the watermark records how far.
      const pruning = await createPostgresDurableStorage({ connectionString: base.href, schema, maxConnections: 2, eventPollMs: 50, eventRetentionMs: 1_000 })
        .acquire("host-d", () => undefined, claim("d-1"));
      hosts.push(pruning);
      await until(async () => (await sql.query<{ old: number; pruned: string }>(`SELECT (SELECT count(*)::int FROM host_events
        WHERE occurred_at < clock_timestamp() - interval '1 second') AS old, (SELECT pruned_through::text FROM host_event_retention) AS pruned`)).rows
        .every((row) => row.old === 0 && BigInt(row.pruned) > 0n), "old events pruned");
    } finally {
      for (const host of hosts.reverse()) await host.release().catch(() => undefined);
      await sql.end();
    }
    // H4-08: namespace destruction and recreation.
    {
      const schema = await createSchema();
      const sql = new Pool({ connectionString: base.href, max: 2, options: `-c search_path=${schema}` });
      try {
        // A long lease keeps this handle open in the process after its membership is gone, as a paused host would be.
        const first = await storageFor(schema).acquire("host-a", () => undefined, claim("a-1", { shared: false, leaseMs: 60_000 }));
        const session = await createWorkSessionFixture(first);
        const before = { generation: first.coordination?.generation ?? "", epoch: first.epoch };
        // Active dependencies prevent destruction, and a bound namespace cannot be renamed, emptied or replaced.
        await assert.rejects(sql.query("DELETE FROM host_namespaces"), /cannot be destroyed/u);
        await assert.rejects(sql.query("UPDATE host_namespaces SET namespace_id = 'ahp-namespace:other/name'"), /cannot be renamed/u);
        await assert.rejects(sql.query("TRUNCATE host_namespaces"), /cannot be truncated/u);
        // The guard reads this schema whatever the caller's search path is. The administrative pool uses another one.
        assert.notEqual((await admin.query<{ schema: string }>("SELECT current_schema() AS schema")).rows[0]?.schema, schema);
        await assert.rejects(admin.query(`DELETE FROM ${schema}.host_namespaces`), /cannot be destroyed/u);
        await first.sessions.beginRetirement(session.ref, () => true);
        await first.sessions.finishRetirement(session.ref);
        // Nothing is active any more, but a member is still live.
        await assert.rejects(sql.query("DELETE FROM host_namespaces"), /cannot be destroyed/u);
        await assert.rejects(admin.query(`SELECT ${schema}.ahp_recreate_namespace($1)`, [namespaceId]), /still exists/u);
        // The membership expires by the database clock. The process still believes it owns the store.
        assert.equal((await sql.query("UPDATE host_members SET lease_expires_at = clock_timestamp() - interval '1 second'")).rowCount, 1);
        assert.equal(first.isOpen(), true);
        // A deletion is refused outside read committed, where its check could miss a member that joined meanwhile.
        const strict = await sql.connect();
        try {
          await strict.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
          await assert.rejects(strict.query("DELETE FROM host_namespaces"), /read committed/u);
        } finally {
          await strict.query("ROLLBACK").catch(() => undefined);
          strict.release();
        }
        // A deletion takes the lock a joining host holds, before it touches the row: it waits for the join.
        const joining = await sql.connect();
        try {
          await joining.query("BEGIN");
          const pid = (await joining.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid ?? 0;
          await joining.query("SELECT pg_advisory_xact_lock('host_state'::regclass::oid::int, hashtext('ahp-host-join'))");
          const deleting = admin.query(`DELETE FROM ${schema}.host_namespaces`);
          deleting.catch(() => undefined);
          await until(async () => ((await admin.query<{ waiting: number }>("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid])).rows[0]?.waiting ?? 0) === 1,
            "the deletion waiting for the join lock");
          // While it waits it holds no lock on the namespace row, so the join can still rewrite that row.
          await joining.query("SET LOCAL lock_timeout = '2s'");
          await joining.query("UPDATE host_namespaces SET updated_at = clock_timestamp()");
          await joining.query("COMMIT");
          assert.equal((await deleting).rowCount, 1);
        } finally {
          await joining.query("ROLLBACK").catch(() => undefined);
          joining.release();
        }
        // A destroyed namespace admits nobody, and only the administrative function can bind the store again.
        await assert.rejects(storageFor(schema).acquire("host-b", () => undefined, claim("b-1", { shared: false })));
        await assert.rejects(sql.query("INSERT INTO host_namespaces (namespace_id) VALUES ($1)", [namespaceId]), /only through ahp_recreate_namespace/u);
        await admin.query(`SELECT ${schema}.ahp_recreate_namespace($1)`, [namespaceId]);
        assert.equal((await sql.query<{ id: string }>("SELECT namespace_id AS id FROM host_namespaces")).rows[0]?.id, namespaceId);
        await assert.rejects(sql.query("SELECT ahp_recreate_namespace($1)", [namespaceId]), /still exists/u);
        // The earlier ownership token is refused in SQL: the handle is open, and its fenced write still fails.
        assert.equal(first.isOpen(), true);
        assert.equal((await sql.query("SELECT 1 FROM host_state WHERE host_id = 'host-a' AND ownership_epoch = $1::bigint", [before.epoch])).rowCount, 0);
        await assert.rejects(createWorkSessionFixture(first));
        assert.equal((await sql.query("SELECT 1 FROM sessions WHERE lifecycle_status <> 'retired'")).rowCount, 0);
        assert.equal((await sql.query("SELECT 1 FROM host_members")).rowCount, 0);
        await first.release();
        const again = await storageFor(schema).acquire("host-a", () => undefined, claim("a-1", { shared: false }));
        try {
          assert.ok(BigInt(again.epoch) > BigInt(before.epoch) + 1n);
          assert.ok(BigInt(again.coordination?.generation ?? "0") > BigInt(before.generation));
          assert.equal(await again.coordination?.isCurrentMember("host-a", "a-1", before.generation), false);
          // The retired session's history is still there: recreation destroys nothing.
          assert.equal((await again.sessions.get(session.ref))?.lifecycle, "retired");
          assert.notEqual((await createWorkSessionFixture(again)).ref.instanceId, session.ref.instanceId);
          await assert.rejects(sql.query("DELETE FROM host_namespaces"), /cannot be destroyed/u);
          // A store with an active session cannot be bound again even if its namespace row is forced away
          // with the guards switched off. The whole attempt is rolled back.
          const forced = await sql.connect();
          try {
            await forced.query("BEGIN");
            await forced.query("ALTER TABLE host_namespaces DISABLE TRIGGER USER");
            assert.equal((await forced.query("DELETE FROM host_namespaces")).rowCount, 1);
            await forced.query("ALTER TABLE host_namespaces ENABLE TRIGGER USER");
            await assert.rejects(forced.query("SELECT ahp_recreate_namespace($1)", [namespaceId]), /cannot be bound again/u);
          } finally {
            await forced.query("ROLLBACK").catch(() => undefined);
            forced.release();
          }
          assert.equal((await sql.query<{ id: string }>("SELECT namespace_id AS id FROM host_namespaces")).rows[0]?.id, namespaceId);
        } finally {
          await again.release();
        }
      } finally {
        await sql.end();
      }
    }
  } finally {
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.end();
  }
}

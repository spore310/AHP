import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";
import { RepositoryError, type DurableHost, type StoredSession } from "@persistence";
import type { WorkFence, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { loseCommitAcknowledgement } from "./commitAcknowledgement";
import { assertTargetReplayConformance, createWorkSessionFixture } from "../../conformance/work";

export async function testWorkSettlement(host: DurableHost, sql: Pool): Promise<void> {
  const ref = { domainId: "settlement", kind: "session" as const, id: "ahp-session:/settlement", instanceId: randomUUID() };
  const yes = (): boolean => true;
  const now = new Date().toISOString();
  const session: StoredSession = { ref, type: { id: randomUUID(), key: "settlement", version: 1 }, owner: "owner", providerId: "fixture",
    state: {}, lifecycle: "creating", graphRevision: "1", stateRevision: "1", lastServerSeq: 0, createdAt: now, modifiedAt: now };
  const operationId = randomUUID();
  await host.sessions.reserve(session, { ref, session: ref, operationId, driver: { key: "fixture", version: 1 }, owner: session.owner, providerId: session.providerId,
    lifecycle: "creating", data: {}, registration: {}, recoveryInput: {}, runtimeMetadata: {}, dataRevision: "1", resourceRevision: "1", createdAt: now, modifiedAt: now }, yes);
  await host.sessions.transition({ ref, session: ref, expected: "creating", next: "active", operationId }, yes);
  const graph = await host.work.graph(ref.domainId, ref);
  assert.ok(graph);
  const principal = { domainId: ref.domainId, subject: "worker" };
  const registrationId = randomUUID();
  await sql.query(`INSERT INTO agent_registrations(id,domain_id,principal_subject,agent_key,execution_epoch)
    VALUES ($1,$2,$3,'operator',7)`, [registrationId, ref.domainId, principal.subject]);
  const intent: WorkIntent = { session: ref, kind: "settlement", requestKey: randomUUID(), scope: [{ resource: ref, include: true, includeDescendants: false }],
    announce: [], priority: 7, input: {}, submittedData: {}, maxAttempts: 2, targetAgentId: registrationId,
    submitter: { kind: "agent", agentId: "canonical.agent", principal } };
  const submit = () => host.work.submit(intent, graph.session.graphRevision, { session: 1, host: 1000 }, yes);
  await loseCommitAcknowledgement("INSERT INTO work_items", intent.requestKey, submit);
  const replay = await submit();
  assert.equal(replay.created, false);
  const id = replay.id;
  assert.equal((await sql.query("SELECT 1 FROM work_items WHERE request_key=$1", [intent.requestKey])).rowCount, 1);
  const token = randomUUID();
  const lease = async (attempt: number, epoch: string) => sql.query(`UPDATE work_items SET status='leased',attempt_count=$1,lease_agent_id=$2,lease_token=$3,
    lease_execution_epoch=$5,lease_expires_at=clock_timestamp()+interval '1 minute',revision=revision+1 WHERE id=$4`, [attempt, registrationId, token, id, epoch]);
  await lease(1, "7");
  const before = await host.work.get(ref.domainId, id);
  assert.equal(before?.lease?.executionEpoch, "7");
  assert.deepEqual(before.submitter, intent.submitter);
  const execution = { registrationId, executionEpoch: "7", attempt: 1, leaseToken: token };
  const fence: WorkFence = { id, session: ref, execution, revision: before.revision };
  const finalData = { expectedDataRevision: "1", data: { checkpoint: true } };
  const complete = { status: "completed" as const, result: { done: true }, data: finalData };
  await assert.rejects(host.work.settle({ ...fence, execution: undefined }, complete, yes));
  await assert.rejects(host.work.settle({ ...fence, execution: { ...execution, leaseToken: randomUUID() } }, complete, yes));
  await assert.rejects(host.work.settle(fence, { ...complete, data: { ...finalData, expectedDataRevision: "2" } }, yes));
  assert.deepEqual(await host.work.get(ref.domainId, id), before);
  await sql.query("UPDATE work_items SET lease_expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [id]);
  await assert.rejects(host.work.settle(fence, complete, yes));
  await sql.query("UPDATE work_items SET lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1", [id]);
  const retry = await host.work.settle(fence, { status: "failed", code: "retry", summary: "Temporary failure", retryable: true, data: finalData }, yes);
  assert.equal(retry.status, "queued");
  assert.equal(retry.failure?.code, "retry");
  assert.equal(retry.lease, undefined);
  assert.equal(retry.dataRevision, "2");
  await lease(2, "7");
  const stale = { ...fence, execution: { ...execution, attempt: 2 }, revision: "4" };
  await sql.query("UPDATE agent_registrations SET execution_epoch=8 WHERE id=$1", [registrationId]);
  await assert.rejects(host.work.settle(stale, { ...complete, data: undefined }, yes));
  await assert.rejects(host.work.replaceData(stale, { ...finalData, expectedDataRevision: "2" }, yes));
  await sql.query("UPDATE work_items SET lease_execution_epoch=8,lease_token=gen_random_uuid(),revision=revision+1 WHERE id=$1", [id]);
  const rebound = await host.work.get(ref.domainId, id);
  assert.ok(rebound?.lease);
  const second = { ...fence, execution: rebound.lease, revision: rebound.revision };
  await assert.rejects(host.work.settle(second, complete, yes));
  const done = await host.work.settle(second, { ...complete, data: { expectedDataRevision: "2", data: { checked: true } } }, yes);
  assert.equal(done.status, "completed");
  assert.equal(done.lease, undefined);
  assert.deepEqual(done.result, complete.result);
  assert.deepEqual(done.data, { checked: true });
  assert.equal(done.dataRevision, "3");
  assert.equal(done.revision, "6");
  assert.deepEqual(await submit(), replay);
  await assertTargetReplayConformance(host, async (agent) => {
    await sql.query(`INSERT INTO agent_registrations(id,domain_id,principal_subject,agent_key,enabled) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET enabled=EXCLUDED.enabled`, [agent.id, agent.domainId, agent.principalSubject, agent.agentKey, agent.enabled]);
  });
  await testPendingQuota(host, sql);
}

/** The original transaction waits inside a deferred trigger while COMMIT is running on the server. */
async function testPendingQuota(host: DurableHost, sql: Pool): Promise<void> {
  await sql.query("CREATE SEQUENCE p1_quota_attempt");
  await sql.query(`CREATE FUNCTION p1_quota_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.request_key = TG_ARGV[0] THEN
        IF nextval('p1_quota_attempt') = 1 THEN
          PERFORM pg_advisory_xact_lock('p1_quota_attempt'::regclass::oid::bigint);
          IF TG_ARGV[1] = 'rollback' THEN
            RAISE EXCEPTION 'injected uncertain completion' USING ERRCODE='40003';
          END IF;
        END IF;
      END IF;
      RETURN NULL;
    END; $$`);
  async function blockedBy(pid: number, count: number, queryPattern: string): Promise<number> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waiting = await sql.query<{ pid: number }>(`WITH RECURSIVE
        clients AS MATERIALIZED (SELECT pid,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'),
        waiters(pid) AS (SELECT pid FROM clients WHERE $1=ANY(blockers)
          UNION SELECT c.pid FROM clients c JOIN waiters w ON w.pid=ANY(c.blockers))
        SELECT c.pid FROM clients c JOIN waiters USING(pid) WHERE c.query LIKE $2`, [pid, queryPattern]);
      if (waiting.rowCount === count && waiting.rows[0]) return waiting.rows[0].pid;
      await setTimeout(10);
    }
    return assert.fail(`Expected ${String(count)} database clients blocked by the recorded transaction.`);
  }
  for (const outcome of ["commit", "rollback"] as const) {
    const requestKey = randomUUID();
    const make = async (key: string) => {
      const { ref } = await createWorkSessionFixture(host);
      const graph = await host.work.graph(ref.domainId, ref);
      assert.ok(graph);
      const intent: WorkIntent = { session: ref, requestKey: key, kind: "review", maxAttempts: 3, input: {}, submittedData: {}, priority: 0, targetAgentId: null,
        scope: [{ resource: ref, include: true, includeDescendants: false }], announce: [], submitter: { kind: "user", principal: { domainId: ref.domainId, subject: "tester" } } };
      return { intent, revision: graph.session.graphRevision };
    };
    const first = await make(requestKey);
    const different = await make(randomUUID());
    const { rows: [capacity] } = await sql.query<{ available: number }>("SELECT count(*)::int+1 AS available FROM work_items WHERE status IN ('queued','leased')");
    assert.ok(capacity);
    const submit = (item: typeof first) => host.work.submit(item.intent, item.revision, { host: capacity.available, session: 1 }, () => true);
    await sql.query("ALTER SEQUENCE p1_quota_attempt RESTART WITH 1");
    await sql.query(`CREATE CONSTRAINT TRIGGER quota_pause AFTER INSERT ON work_items DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION p1_quota_commit('${requestKey}','${outcome}')`);
    const gate = await sql.connect();
    try {
      await gate.query("BEGIN");
      const { rows: [holder] } = await gate.query<{ pid: number }>("SELECT pg_backend_pid() AS pid, pg_advisory_xact_lock('p1_quota_attempt'::regclass::oid::bigint)");
      assert.ok(holder);
      const original = outcome === "commit"
        ? loseCommitAcknowledgement("INSERT INTO work_items", requestKey, () => submit(first))
        : assert.rejects(submit(first), { name: "DurableCommitUncertain" });
      try {
        const writer = await blockedBy(holder.pid, 1, "COMMIT");
        const competitors = Promise.allSettled([submit(first), submit(different)]);
        try {
          await blockedBy(writer, 2, "SELECT 1 FROM host_state%FOR UPDATE");
          assert.equal((await sql.query("SELECT id FROM work_items WHERE request_key=ANY($1::text[])", [[requestKey, different.intent.requestKey]])).rowCount, 0);
        } finally {
          await gate.query("COMMIT");
        }
        const results = await competitors;
        const accepted = results.filter((r) => r.status === "fulfilled");
        assert.equal(accepted.length, 1);
        const rejected = results.find((r) => r.status === "rejected");
        assert.ok(rejected?.reason instanceof RepositoryError && rejected.reason.code === "conflict");
        assert.equal(accepted[0]?.value.created, outcome === "rollback");
        if (outcome === "commit") assert.equal(results[0].status, "fulfilled");
        const winner = results[0].status === "fulfilled" ? first : different;
        assert.deepEqual(await submit(winner), { id: accepted[0].value.id, created: false });
        assert.equal((await sql.query("SELECT id FROM work_items WHERE request_key=ANY($1::text[])", [[requestKey, different.intent.requestKey]])).rowCount, 1);
      } finally {
        await gate.query("ROLLBACK");
        await original;
      }
    } finally {
      gate.release();
      await sql.query("DROP TRIGGER quota_pause ON work_items");
    }
  }
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DurableHost } from "@persistence";
import type { WorkFence, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { createWorkSessionFixture } from "../../conformance/work";
import { loseCommitAcknowledgement } from "./commitAcknowledgement";
import { workFixture } from "../../../work/commandsFixture";

export async function testWorkAuthorityStorage(host: DurableHost, sql: Pool, waitForBlocker: (sql: Pool, pid: number) => Promise<void>): Promise<void> {
  const { ref, root } = await createWorkSessionFixture(host);
  const graph = await host.work.graph(ref.domainId, ref);
  assert.ok(graph);
  const yes = (): boolean => true;
  const firstAgent = randomUUID(), secondAgent = randomUUID(), originalToken = randomUUID(), nextToken = randomUUID();
  const insert = await sql.query(`INSERT INTO agent_registrations(id,domain_id,principal_subject,agent_key,execution_epoch)
    VALUES ($1,$3,'p2-first','p2-worker',5),($2,$3,'p2-second','p2-worker',9)`, [firstAgent, secondAgent, ref.domainId]);
  assert.equal(insert.rowCount, 2);
  const intent: WorkIntent = { session: ref, requestKey: randomUUID(), kind: "review", maxAttempts: 3, priority: 0, input: {}, submittedData: {},
    targetAgentId: null, submitter: { kind: "user", principal: { domainId: ref.domainId, subject: "tester" } },
    scope: [{ resource: ref, include: true, includeDescendants: false }], announce: [] };
  const submit = (maxAttempts: number) => host.work.submit({ ...intent, requestKey: randomUUID(), maxAttempts }, graph.session.graphRevision, { session: 10, host: 1000 }, yes);
  const { id } = await submit(3);
  const other = await submit(1);
  const lease = `UPDATE work_items SET status='leased',attempt_count=$2,lease_agent_id=$3,lease_token=$4,
    lease_execution_epoch=$5,lease_expires_at=clock_timestamp()+interval '5 minutes',revision=revision+1 WHERE id=$1`;
  assert.equal((await sql.query(lease, [id, 1, firstAgent, originalToken, 5])).rowCount, 1);
  assert.equal((await sql.query(lease, [other.id, 1, secondAgent, randomUUID(), 9])).rowCount, 1);
  const original = await host.work.inspect(ref.domainId, id);
  assert.equal(original?.registration?.id, firstAgent);
  assert.equal(original.row.lease?.leaseToken, originalToken);
  assert.equal(await host.work.inspect("foreign", id), undefined);
  const ids = [id, other.id].sort();
  const paged = (await host.work.leased(undefined, 128)).filter((row) => ids.includes(row.id));
  assert.deepEqual(paged, ids.map((key) => ({ domainId: ref.domainId, id: key })));
  assert.deepEqual(await host.work.leased(ids[0], 1), [paged[1]]);
  const writer = await sql.connect();
  try {
    await writer.query("BEGIN");
    const backend = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = backend.rows[0]?.pid;
    assert.ok(pid);
    assert.equal((await writer.query(lease, [id, 2, secondAgent, nextToken, 9])).rowCount, 1);
    const inspection = host.work.inspect(ref.domainId, id);
    try {
      await waitForBlocker(sql, pid);
    } finally {
      await writer.query("COMMIT");
    }
    const locked = await inspection;
    assert.equal(locked?.row.lease?.leaseToken, nextToken);
    assert.deepEqual(locked.registration, { id: secondAgent, key: "p2-worker", subject: "p2-second", epoch: "9", enabled: true });
    assert.ok(locked.databaseTime < Date.parse(locked.row.lease.expiresAt));
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
  }
  const now = await host.work.inspect(ref.domainId, id);
  assert.ok(now?.row.lease);
  const fence: WorkFence = { session: ref, id, revision: now.row.revision, execution: now.row.lease };
  const unchanged = async () => {
    assert.deepEqual(await host.work.get(ref.domainId, id), now.row);
  };
  for (const stale of [{ ...fence, execution: original.row.lease }, { ...fence, revision: original.row.revision }]) {
    await assert.rejects(host.work.disposition(stale, "cancel", yes), { code: "conflict" });
    await unchanged();
  }
  let checks = 0;
  await assert.rejects(host.work.disposition(fence, "requeue", () => {
    checks++;
    return Promise.resolve(true);
  }), { code: "conflict" });
  assert.equal(checks, 1);
  await unchanged();
  const observation = host.work.observe?.(ref, id);
  assert.ok(observation);
  assert.equal(observation.current(), true);
  await loseCommitAcknowledgement("UPDATE work_items SET status=$2", id, () => host.work.disposition(fence, "requeue", yes));
  assert.equal(observation.current(), false);
  observation.release();
  const confirmed = await host.work.inspect(ref.domainId, id);
  assert.equal(confirmed?.row.status, "queued");
  assert.equal(confirmed.row.lease, undefined);
  assert.equal(BigInt(confirmed.row.revision), BigInt(fence.revision) + 1n);
  await assert.rejects(host.work.disposition(fence, "cancel", yes), { code: "conflict" });
  const exhausted = await host.work.inspect(ref.domainId, other.id);
  assert.ok(exhausted?.row.lease);
  const budget = await host.work.disposition({ session: ref, id: other.id, revision: exhausted.row.revision, execution: exhausted.row.lease }, "requeue", yes);
  assert.equal(budget.status, "failed");
  assert.equal(budget.failure?.code, "authority_lost");
  assert.equal(budget.lease, undefined);
  assert.equal((await sql.query("SELECT id FROM work_items WHERE id=ANY($1::uuid[]) AND status='leased'", [ids])).rowCount, 0);
  assert.equal((await sql.query(lease, [id, 3, secondAgent, randomUUID(), 9])).rowCount, 1);
  const last = await host.work.inspect(ref.domainId, id);
  assert.ok(last?.row.lease);
  await host.sessions.beginRetirement(ref, yes);
  assert.equal(await host.work.inspect(ref.domainId, id), undefined);
  await assert.rejects(host.work.disposition({ session: ref, id, revision: last.row.revision, execution: last.row.lease }, "requeue", yes), { code: "conflict" });
  assert.equal((await host.work.get(ref.domainId, id))?.status, "cancelled");
  await host.sessions.finishRetirement(root.session);
  await testReplayWhileWriting(host, sql, waitForBlocker);
}

async function testReplayWhileWriting(host: DurableHost, sql: Pool, waitForBlocker: (sql: Pool, pid: number) => Promise<void>) {
  const decisions: Array<string | undefined> = [];
  const f = await workFixture({ prepare: (_caller, _op, _intent, row) => {
    decisions.push(row?.revision);
    return Promise.resolve({ isCurrent: () => row?.data.hidden !== true, release() {} });
  } }, host);
  const { id } = await f.service.submit(f.caller, f.request);
  const writer = await sql.connect();
  try {
    await writer.query("BEGIN");
    const transaction = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = transaction.rows[0]?.pid;
    assert.ok(pid);
    assert.equal((await writer.query(`UPDATE work_items SET data='{"hidden":true}',data_revision=data_revision+1,revision=revision+1 WHERE id=$1`, [id])).rowCount, 1);
    const replay = f.service.submit(f.caller, f.request);
    const result = Promise.allSettled([replay]);
    try {
      await waitForBlocker(sql, pid);
    } finally {
      await writer.query("COMMIT");
    }
    const [decision] = await result;
    assert.ok(decision.status === "rejected" && decision.reason instanceof Error && "code" in decision.reason && decision.reason.code === "unauthorized");
    assert.deepEqual(decisions, [undefined, "1", "2"]);
    assert.equal((await sql.query("SELECT 1 FROM work_items WHERE session_instance_id=$1 AND request_key=$2", [f.ref.instanceId, f.request.requestKey])).rowCount, 1);
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
    f.service.close();
  }
}

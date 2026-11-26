import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import type { AgentRegistrationRecord, DurableHost } from "@persistence";
import { createOwnedPostgresStorage } from "@persistence/helpers/adapters/postgres/helpers/resources/helpers";
import { createPostgresDurableWork } from "@persistence/helpers/adapters/postgres/helpers/durableWork/helpers";
import { admit } from "@persistence/helpers/adapters/postgres/helpers/resources/rows/helpers";
import { withTransaction } from "@persistence/helpers/adapters/postgres/helpers/connection";
import type { ClaimAdmission, DurableWorkRepository, StoredWork } from "@persistence/helpers/durability/workTypes";
import { assertScheduling, schedulingFixture } from "../../conformance/scheduling";
import { loseCommitAcknowledgement } from "./commitAcknowledgement";
import { schedulingPerformance } from "./p3Performance";
import { workFixture } from "../../../work/commandsFixture";
import type { WorkAgentContext } from "@work";

type Barrier = (sql: Pool, pid: number) => Promise<void>;
const yes = (): undefined => undefined;
async function blocked<T>(sql: Pool, wait: Barrier, lock: (c: PoolClient) => Promise<unknown>, start: () => Promise<T>, held?: () => Promise<void>) {
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    const { rows: [process] } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    assert.ok(process);
    await lock(client);
    const outcome = Promise.allSettled([start()]);
    try {
      await wait(sql, process.pid);
      await held?.();
    } finally {
      await client.query("COMMIT");
    }
    const [result] = await outcome;
    if (result.status === "rejected") throw result.reason;
    return result.value;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
export async function testPostgresScheduling(url: string, sql: Pool, second: Pool, wait: Barrier) {
  let other: DurableWorkRepository | undefined;
  const store = createOwnedPostgresStorage({ connectionString: url }, (owner) => {
    other = createPostgresDurableWork((run, checkpoint) => withTransaction(second, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await owner.lock(client, checkpoint);
      return run(client);
    }), admit, owner.epoch);
  });
  const host = await store.acquire("p0-conformance", () => undefined);
  const peer = other;
  assert.ok(peer);
  const register = async (r: AgentRegistrationRecord) => {
    await sql.query(`INSERT INTO agent_registrations(id,domain_id,principal_subject,agent_key,execution_epoch,enabled) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET execution_epoch=EXCLUDED.execution_epoch,enabled=EXCLUDED.enabled`, [r.id, r.domainId, r.principalSubject, r.agentKey, r.executionEpoch, r.enabled]);
  };
  try {
    await assertScheduling(host, register, async (id) => {
      assert.equal((await sql.query("UPDATE work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id])).rowCount, 1);
    }, peer);
    const a = await schedulingFixture(host, register), b = await schedulingFixture(host, register);
    const id = await a.submit(0), waiting = await a.submit(1);
    await b.submit(1);
    const aRows = (await host.work.scanCandidates(a.scan)).rows, bRows = (await peer.scanCandidates(b.scan)).rows;
    // The prior registration-lock holder creates an uncommitted lease. Another identity can continue.
    const outcome = await blocked(sql, wait, async (writer) => {
      await writer.query("SELECT id FROM agent_registrations WHERE id=$1 FOR UPDATE", [a.actor.registrationId]);
      await writer.query(`UPDATE work_items SET status='leased',attempt_count=1,lease_agent_id=$2,lease_execution_epoch=1,lease_token=gen_random_uuid(),
        lease_expires_at=clock_timestamp()+interval '1 minute',revision=revision+1 WHERE id=$1`, [id, a.actor.registrationId]);
    }, () => host.work.claimPrepared(a.prepare(aRows, 1), yes), async () => {
      assert.equal((await peer.claimPrepared(b.prepare(bRows), yes)).status, "claimed");
    });
    assert.equal(outcome.status, "capacity");
    assert.equal((await host.work.get(a.ref.domainId, waiting))?.status, "queued");
    await assert.rejects(blocked(sql, wait, (writer) => writer.query("UPDATE agent_registrations SET enabled=false,execution_epoch=2 WHERE id=$1", [a.actor.registrationId]),
      () => host.work.claimPrepared(a.prepare(aRows, 5), yes)), { code: "conflict" });
    const actorB = await peer.scanCandidates(b.scan);
    assert.equal(actorB.rows.length, 0);
    await checkOrdering(host, sql, register);
    await checkLockedResources(host, sql, register, wait);
    await checkDeadline(host, peer, sql, register, wait);
    await checkSettling(host, sql, register, wait);
    await checkServiceAdmission(host, sql, register, wait);
    await schedulingPerformance(host, sql, register);
  } finally {
    await host.release();
  }
  assert.equal(second.waitingCount, 0);
  assert.equal(second.idleCount, second.totalCount);
}

async function checkServiceAdmission(host: DurableHost, sql: Pool, register: Register, wait: Barrier) {
  let config = { revision: "1", maxActiveClaims: 1 };
  let configChange = new AbortController(), policyChange = new AbortController();
  let locked = false;
  const applicationCalls: string[] = [];
  const callback = (name: string) => {
    if (locked) applicationCalls.push(name);
    return true;
  };
  const observeAdmission = (check: ClaimAdmission): ClaimAdmission => (facts) => {
    locked = true;
    try {
      check(facts);
      return undefined;
    } finally {
      locked = false;
    }
  };
  let parkRenew: ((run: () => Promise<StoredWork>) => Promise<StoredWork>) | undefined;
  const observed: DurableWorkRepository = { ...host.work,
    claimPrepared: (input, check) => host.work.claimPrepared(input, observeAdmission(check)),
    renewPrepared(input, check) {
      const run = () => host.work.renewPrepared(input, observeAdmission(check));
      return parkRenew ? parkRenew(run) : run();
    } };
  const diagnostics: string[] = [];
  const f = await workFixture({ repository: () => observed,
    prepare: () => Promise.resolve({ isCurrent: () => callback("approval.isCurrent"), fence: () => callback("approval.fence"), release() {} }),
    scheduling: { allowedKinds: ["review"],
      admission(caller, _approval, operation) {
        callback("scheduling.admission");
        return AbortSignal.any([caller.signal, policyChange.signal, ...(operation === "claim" ? [configChange.signal] : [])]);
      },
      configuration: { resolve() {
        callback("configuration.resolve");
        return config;
      } } }, onDiagnostic(event) {
      diagnostics.push(event);
      throw new Error("The test sink is offline.");
    } }, host);
  const principal = f.caller.context.actor.principal;
  const locator = { kind: f.ref.kind, id: f.ref.id, instanceId: f.ref.instanceId };
  const agent = { registrationId: randomUUID(), principal, agentKey: randomUUID(), actorAgentId: "test-worker" };
  const worker: WorkAgentContext = { ...f.caller, agent, isCurrent: () => callback("caller.isCurrent"), fence: () => callback("caller.fence"), executionEpoch: "1",
    context: { ...f.caller.context, actor: { kind: "agent", principal, agentId: agent.actorAgentId } } };
  await register({ id: agent.registrationId, principalSubject: principal.subject, domainId: principal.domainId, agentKey: agent.agentKey,
    enabled: true, executionEpoch: "1", createdAt: f.session.createdAt });
  try {
    const { id } = await f.service.submit(f.caller, f.request);
    const abandoned = await blocked(sql, wait, (c) => c.query("SELECT id FROM agent_registrations WHERE id=$1 FOR UPDATE", [agent.registrationId]),
      () => f.service.claim(worker, locator), async () => {
        assert.equal(f.service.stats().pending, 1);
        config = { revision: "2", maxActiveClaims: 0 };
        configChange.abort();
        configChange = new AbortController();
        await Promise.resolve();
      });
    assert.equal(abandoned.status, "deferred");
    assert.equal((await host.work.get(f.ref.domainId, id))?.revision, "1");
    assert.equal(f.service.stats().pending, 0);
    assert.equal((await f.service.claim(worker, locator)).status, "capacity");
    config = { revision: "3", maxActiveClaims: 1 };
    const claim = await f.service.claim(worker, locator);
    assert.ok(claim.status === "claimed");
    config = { revision: "4", maxActiveClaims: 0 };
    const { workId, attempt, leaseToken } = claim.lease;
    const execution = { workId, attempt, leaseToken };
    const previous = await host.work.get(f.ref.domainId, id);
    assert.ok(previous?.lease);
    parkRenew = (run) => blocked(sql, wait, (c) => c.query("SELECT id FROM work_items WHERE id=$1 FOR UPDATE", [id]), run, () => {
      policyChange.abort();
      return Promise.resolve();
    });
    await assert.rejects(f.service.renew(worker, execution));
    assert.deepEqual(await host.work.get(f.ref.domainId, id), previous);
    parkRenew = undefined;
    policyChange = new AbortController();
    await f.service.renew(worker, execution);
    assert.deepEqual(applicationCalls, []);
    assert.deepEqual(await f.service.fail(worker, execution, { retryable: false, code: "privateCode", message: "worker secret" }), { status: "failed" });
    const persisted = await sql.query<{ code: string; summary: string; leased: boolean }>(
      "SELECT last_failure_code AS code,last_failure_message AS summary,lease_token IS NOT NULL AS leased FROM work_items WHERE id=$1", [id]);
    assert.deepEqual(persisted.rows, [{ code: "execution_failed", summary: "Work execution failed.", leased: false }]);
    assert.ok(diagnostics.includes("submitted") && diagnostics.includes("claimCapacityDenied"));
    assert.equal(f.service.stats().pending, 0);
  } finally {
    f.service.close();
  }
}
type Register = (r: AgentRegistrationRecord) => Promise<void>;
async function checkLockedResources(host: DurableHost, sql: Pool, register: Register, wait: Barrier) {
  const f = await schedulingFixture(host, register);
  await f.submit(1);
  const page = await host.work.scanCandidates(f.scan);
  const outcome = await blocked(sql, wait, (client) => client.query(
    "UPDATE canonical_resources SET data='{\"policyInput\":true}',data_revision=data_revision+1 WHERE session_instance_id=$1", [f.ref.instanceId]),
  () => host.work.claimPrepared(f.prepare(page.rows), (locked) => {
    assert.equal(locked.resources[0]?.data.policyInput, true);
    return undefined;
  }));
  assert.equal(outcome.status, "claimed");
}
async function checkOrdering(host: DurableHost, sql: Pool, register: Register) {
  const f = await schedulingFixture(host, register);
  const urgent = await f.submit(2147483647);
  const tied = [await f.submit(0), await f.submit(0)].sort();
  const newer = await f.submit(0);
  const last = await f.submit(-2147483648);
  await sql.query("UPDATE work_items SET created_at='2026-01-01 00:00:00.000001Z' WHERE id=ANY($1::uuid[])", [tied]);
  await sql.query("UPDATE work_items SET created_at='2026-01-01 00:00:00.000002Z' WHERE id=$1", [newer]);
  const all = (await host.work.scanCandidates(f.scan)).rows;
  assert.deepEqual(all.map((r) => r.id), [urgent, ...tied, newer, last]);
  for (let i = 0; i < all.length - 1; i++) {
    const page = await host.work.scanCandidates({ ...f.scan, after: all[i], limit: 1 });
    assert.equal(page.rows[0]?.id, all[i + 1]?.id);
  }
  const held = await sql.connect();
  try {
    await held.query("BEGIN");
    await held.query("SELECT id FROM work_items WHERE id=$1 FOR UPDATE", [urgent]);
    const skipped = await host.work.claimPrepared(f.prepare(all), yes);
    assert.ok(skipped.status === "claimed");
    assert.equal(skipped.row.id, tied[0]);
  } finally {
    await held.query("ROLLBACK");
    held.release();
  }
  const observer = host.work.observe?.(f.ref, urgent);
  assert.ok(observer);
  const one = f.prepare(all);
  const published: string[] = [];
  assert.ok(host.workEvents);
  const stopEvents = host.workEvents.subscribe((event) => {
    published.push(event.workId);
  });
  const discarded = await loseCommitAcknowledgement("UPDATE work_items SET status='leased'", urgent, () => host.work.claimPrepared(one, () => {
    assert.equal(observer.current(), true);
    return undefined;
  }));
  assert.equal(observer.current(), false);
  stopEvents();
  assert.deepEqual(published, []);
  observer.release();
  const disconnected = async () => !(await sql.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1", [discarded])).rowCount;
  const deadline = performance.now() + 5000;
  while (!await disconnected() && performance.now() < deadline) await setTimeout(10);
  assert.equal(await disconnected(), true);
  assert.equal((await host.work.inspect(f.ref.domainId, urgent))?.row.attemptCount, 1);
  assert.equal((await host.work.claimPrepared({ ...one, candidates: one.candidates.filter((r) => r.id === urgent) }, yes)).status, "changed");
}
export async function checkDeadline(host: DurableHost, peer: DurableWorkRepository, sql: Pool, register: Register, wait: Barrier) {
  const f = await schedulingFixture(host, register);
  const id = await f.submit(1000);
  await f.submit(1);
  const rows = (await host.work.scanCandidates(f.scan)).rows;
  const original = await host.work.claimPrepared(f.prepare(rows, 1), yes);
  assert.ok(original.status === "claimed" && original.row.lease);
  const fence = { id, session: f.ref, revision: original.row.revision, execution: original.row.lease, graphRevision: f.graph.session.graphRevision };
  await sql.query("UPDATE work_items SET lease_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1", [id]);
  await assert.rejects(blocked(sql, wait, (c) => c.query("SELECT id FROM work_items WHERE id=$1 FOR UPDATE", [id]),
    () => host.work.renewPrepared({ actor: f.actor, fence, leaseMs: 60000 }, yes), async () => {
      // Wait to the actual stored database deadline, including the time already spent reaching the lock barrier.
      await sql.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM lease_expires_at-clock_timestamp()))+0.01) FROM work_items WHERE id=$1", [id]);
    }), { code: "conflict" });
  assert.equal((await host.work.get(f.ref.domainId, id))?.revision, original.row.revision);
  const candidates = (await host.work.scanCandidates(f.scan)).rows;
  const [takeover, stale] = await Promise.all([peer.claimPrepared(f.prepare(candidates, 1), yes),
    Promise.allSettled([host.work.renewPrepared({ actor: f.actor, fence, leaseMs: 60000 }, yes),
      host.work.settle(fence, { status: "completed", result: {} }, () => true),
      host.work.settle(fence, { status: "failed", retryable: true, code: "retry", summary: "retry" }, () => true)])]);
  assert.ok(takeover.status === "claimed" && takeover.row.id === id);
  assert.equal(takeover.row.attemptCount, 2);
  assert.ok(stale.every((r) => r.status === "rejected"));
  assert.equal((await host.work.get(f.ref.domainId, id))?.revision, String(BigInt(original.row.revision) + 1n));
}

async function checkSettling(host: DurableHost, sql: Pool, register: Register, wait: Barrier) {
  const f = await schedulingFixture(host, register);
  const id = await f.submit(1);
  const rows = (await host.work.scanCandidates(f.scan)).rows;
  const observer = host.work.observe?.(f.ref, id);
  assert.ok(observer);
  const lock = "pg_advisory_xact_lock('work_items'::regclass::oid::bigint)";
  await sql.query(`CREATE FUNCTION p3_hold_claim() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM ${lock}; RETURN NEW; END $$`);
  await sql.query("CREATE TRIGGER p3_claim_update BEFORE UPDATE OF lease_token ON work_items FOR EACH ROW WHEN (NEW.status='leased') EXECUTE FUNCTION p3_hold_claim()");
  let retirement: Promise<unknown> | undefined;
  try {
    const claimed = await blocked(sql, wait, (client) => client.query("SELECT " + lock),
      () => host.work.claimPrepared(f.prepare(rows), yes), async () => {
        assert.equal(observer.current(), false);
        const during = host.work.observe?.(f.ref, id);
        assert.ok(during);
        assert.equal(during.current(), false);
        during.release();
        const { rows: [writer] } = await sql.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'UPDATE work_items SET status=''leased''%' AND wait_event='advisory'");
        assert.ok(writer);
        retirement = host.sessions.beginRetirement(f.ref, () => true);
        await wait(sql, writer.pid);
      });
    assert.equal(claimed.status, "claimed");
    await retirement;
    const final = await host.work.get(f.ref.domainId, id);
    assert.equal(final?.status, "cancelled");
    assert.equal(final.lease, undefined);
    assert.equal(final.revision, String(BigInt(rows[0]?.revision ?? "0") + 2n));
  } finally {
    observer.release();
    await sql.query("DROP TRIGGER p3_claim_update ON work_items");
    await sql.query("DROP FUNCTION p3_hold_claim()");
  }
}

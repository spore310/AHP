import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AgentRegistrationRecord, DurableHost, ResourceRecord } from "@persistence";
import type { WorkAgentContext } from "@work";
import type { ResourceSelectionInput } from "@work/helpers/selections/types";
import { workFixture } from "../../work/commandsFixture";
import type { CandidateScan, ClaimActor, PreparedClaim, StoredWork, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { createWorkSessionFixture } from "./work";

export async function schedulingFixture(host: DurableHost, register: (agent: AgentRegistrationRecord) => Promise<void>, identity?: ClaimActor) {
  const { ref } = await createWorkSessionFixture(host);
  const actor = identity ?? { principal: { domainId: ref.domainId, subject: randomUUID() }, registrationId: randomUUID(), agentKey: "scheduler", executionEpoch: "1" };
  if (!identity) await register({ id: actor.registrationId, domainId: ref.domainId, principalSubject: actor.principal.subject, agentKey: actor.agentKey,
    executionEpoch: actor.executionEpoch, enabled: true, createdAt: new Date().toISOString() });
  const graph = await host.work.graph(ref.domainId, ref);
  assert.ok(graph);
  const scan: CandidateScan = { session: ref, registrationId: actor.registrationId, allowedKinds: ["review", "other"], limit: 32 };
  const submit = async (priority: number, kind = "review", maxAttempts = 2, targetAgentId: string | null = null) => {
    const intent: WorkIntent = { session: ref, kind, maxAttempts, priority, targetAgentId, requestKey: randomUUID(), input: {}, submittedData: {}, announce: [],
      scope: [{ resource: ref, include: true, includeDescendants: false }], submitter: { kind: "user", principal: { domainId: ref.domainId, subject: "tester" } } };
    return (await host.work.submit(intent, graph.session.graphRevision, { session: 1000, host: 10000 }, () => true)).id;
  };
  const prepare = (rows: readonly Pick<StoredWork, "id" | "revision">[], maxActiveClaims = 3): PreparedClaim => ({
    actor, session: ref, graphRevision: graph.session.graphRevision, candidates: rows.map(({ id, revision }) => ({ id, revision })),
    allowedKinds: scan.allowedKinds, leaseMs: 60000, maxActiveClaims,
  });
  return { actor, ref, graph, scan, submit, prepare };
}

export async function assertScheduling(host: DurableHost, register: (record: AgentRegistrationRecord) => Promise<void>, expire: (id: string) => Promise<void>,
  secondRepository = host.work) {
  await assertConfiguredSelections(host, register);
  const first = await schedulingFixture(host, register);
  const second = await schedulingFixture(host, register, first.actor);
  for (let i = 0; i < 5; i++) {
    await first.submit(i);
    await second.submit(i, "other");
  }
  const scanA = await host.work.scanCandidates(first.scan);
  const scanB = await host.work.scanCandidates(second.scan);
  assert.deepEqual(scanA.rows.map((r) => r.priority), [4, 3, 2, 1, 0]);
  const yes = (): undefined => undefined;
  const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) => i % 2
    ? host.work.claimPrepared(first.prepare(scanA.rows), yes)
    : secondRepository.claimPrepared(second.prepare(scanB.rows), yes)));
  const claimed = attempts.filter((r) => r.status === "claimed").map((r) => r.row);
  assert.equal(claimed.length, 3);
  assert.equal(new Set(claimed.map((r) => r.id)).size, 3);
  assert.equal(attempts.filter((r) => r.status === "capacity").length, 7);
  const row = claimed[0];
  assert.ok(row?.lease);
  const owner = row.session.instanceId === first.ref.instanceId ? first : second;
  const sampleFence = { session: owner.ref, id: row.id, revision: row.revision };
  const sample = await host.work.sampleLease(sampleFence);
  assert.ok(sample);
  assert.deepEqual(Object.keys(sample).sort(), ["databaseTime", "expiresAt"]);
  assert.equal(sample.expiresAt, row.lease.expiresAt);
  assert.ok(Number.isFinite(sample.databaseTime));
  assert.equal(await host.work.sampleLease({ ...sampleFence, session: { ...owner.ref, id: "unknown" } }), undefined);
  assert.equal(await host.work.sampleLease({ ...sampleFence, revision: "1" }), undefined);
  const renewal = { actor: owner.actor, leaseMs: 60000, fence: { id: row.id, session: row.session, revision: row.revision,
    execution: row.lease, graphRevision: owner.graph.session.graphRevision } };
  assert.equal((await host.work.claimPrepared(owner.prepare([], 0), yes)).status, "capacity");
  const renewed = await host.work.renewPrepared(renewal, (locked) => {
    assert.equal(locked.row.id, row.id);
    assert.equal(locked.registration.id, owner.actor.registrationId);
    assert.equal(locked.hostEpoch, host.epoch);
    return undefined;
  });
  assert.equal(renewed.lease?.leaseToken, row.lease.leaseToken);
  assert.equal(BigInt(renewed.revision), BigInt(row.revision) + 1n);
  assert.equal(await host.work.sampleLease(sampleFence), undefined);
  await assert.rejects(host.work.renewPrepared(renewal, yes));
  const page = await host.work.scanCandidates({ ...first.scan, limit: 1 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.hasMore, true);
  const rest = await host.work.scanCandidates({ ...first.scan, after: page.rows[0] });
  assert.ok(rest.rows.every((candidate) => candidate.id !== page.rows[0]?.id));
  const bad = () => Promise.resolve(true);
  await assert.rejects(host.work.claimPrepared(first.prepare(rest.rows, 12), bad as unknown as typeof yes));
  assert.equal((await host.work.leased(undefined, 128)).filter((r) => claimed.some((c) => r.id === c.id)).length, 3);
  const rebind = { ...first.actor, executionEpoch: "2" };
  await register({ id: rebind.registrationId, domainId: first.ref.domainId, principalSubject: rebind.principal.subject, agentKey: rebind.agentKey,
    executionEpoch: rebind.executionEpoch, enabled: true, createdAt: new Date().toISOString() });
  await assert.rejects(host.work.renewPrepared({ ...renewal, fence: { ...renewal.fence, revision: renewed.revision } }, yes));
  assert.equal((await host.work.claimPrepared({ ...first.prepare(rest.rows), actor: rebind }, yes)).status, "capacity");
  await expire(row.id);
  const takeover = await secondRepository.claimPrepared({ ...owner.prepare([renewed]), actor: rebind }, yes);
  assert.ok(takeover.status === "claimed" && takeover.row.lease);
  assert.equal(takeover.row.attemptCount, 2);
  assert.notEqual(takeover.row.lease.leaseToken, renewed.lease.leaseToken);
  await assert.rejects(host.work.settle({ ...renewal.fence, revision: takeover.row.revision }, { status: "completed", result: {} }, () => true));
  await expire(row.id);
  const observer = host.work.observe?.(row.session, row.id);
  assert.ok(observer);
  const failed = await host.work.expireExhausted(row.session, 1);
  assert.deepEqual(failed, [{ id: row.id, revision: String(BigInt(takeover.row.revision) + 1n) }]);
  assert.equal(observer.current(), false);
  observer.release();
  const stored = await host.work.get(row.session.domainId, row.id);
  assert.equal(stored?.status, "failed");
  assert.equal(stored.failure?.code, "lease_expired");
  assert.equal(stored.lease, undefined);
  assert.deepEqual(await host.work.expireExhausted(row.session, 1), []);
  const stale = { ...first.prepare(rest.rows, 12), actor: rebind, graphRevision: "9223372036854775807" };
  await assert.rejects(host.work.claimPrepared(stale, yes));
}

async function assertConfiguredSelections(host: DurableHost, register: (record: AgentRegistrationRecord) => Promise<void>) {
  const f = await workFixture({ selectionLimits: { maxSelectors: 128 }, scheduling: {
    allowedKinds: ["review"], configuration: { resolve: () => ({ maxActiveClaims: 3, revision: "1" }) }, admission: (caller) => caller.signal,
  }, prepare: () => Promise.resolve({ isCurrent: () => true, fence: () => true, release() {} }) }, host);
  try {
    const principal = f.caller.context.actor.principal;
    const agent = { principal, agentKey: randomUUID(), registrationId: randomUUID(), actorAgentId: "selector-worker" };
    await register({ principalSubject: principal.subject, domainId: principal.domainId, id: agent.registrationId, agentKey: agent.agentKey,
      executionEpoch: "1", enabled: true, createdAt: f.session.createdAt });
    const worker: WorkAgentContext = { ...f.caller, agent, executionEpoch: "1", fence: () => true,
      context: { ...f.caller.context, actor: { kind: "agent", principal, agentId: agent.actorAgentId } } };
    const scope: ResourceSelectionInput[] = [...f.request.scope];
    for (let i = 0; i < 64; i++) {
      const child: ResourceRecord = { ...f.root, operationId: randomUUID(), parent: f.ref,
        ref: { ...f.ref, kind: "chat", id: randomUUID(), instanceId: randomUUID() } };
      await host.resources.reserve(child, () => true);
      await host.resources.activate({ session: f.ref, ref: child.ref, operationId: child.operationId, expected: "creating", next: "active" }, () => true);
      scope.push({ resource: { kind: child.ref.kind, id: child.ref.id }, include: true });
    }
    const { id } = await f.service.submit(f.caller, { ...f.request, scope });
    assert.equal((await host.work.inspect(f.ref.domainId, id))?.row.scope.length, 65);
    const claimed = await f.service.claim(worker, { kind: "session", id: f.ref.id });
    assert.ok(claimed.status === "claimed", "configured 65-selector scope must be claimable");
    const { workId, attempt, leaseToken } = claimed.lease;
    await f.service.renew(worker, { workId, attempt, leaseToken });
    const current = await host.work.inspect(f.ref.domainId, id);
    assert.ok(current?.row.lease);
    const requeued = await host.work.disposition({ id, session: f.ref, revision: current.row.revision, execution: current.row.lease }, "requeue", () => true);
    assert.equal(requeued.status, "queued");
  } finally {
    f.service.close();
  }
}

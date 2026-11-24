import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AgentRegistrationRecord, DurableHost, ResourceRecord, StoredSession } from "@persistence";
import type { WorkIntent } from "@persistence/helpers/durability/workTypes";

/** Work admission, replay and conflicting updates share these assertions on both adapters. */
export async function createWorkSessionFixture(host: DurableHost, ref: StoredSession["ref"] = { domainId: "work-contract", kind: "session", id: `ahp-session:/${randomUUID()}`, instanceId: randomUUID() }) {
  const stamp = new Date().toISOString();
  const session: StoredSession = { ref, type: { id: randomUUID(), key: `contract-${randomUUID()}`, version: 1, workManifest: [{ kind: "review", maxAttempts: 3 }] }, owner: "owner", providerId: "test",
    state: {}, lifecycle: "creating", graphRevision: "1", stateRevision: "1", lastServerSeq: 0, createdAt: stamp, modifiedAt: stamp };
  const root: ResourceRecord = { ref, session: ref, operationId: randomUUID(), driver: { key: "session", version: 1 }, owner: session.owner,
    providerId: session.providerId, lifecycle: "creating", registration: {}, recoveryInput: {}, runtimeMetadata: {}, data: {},
    dataRevision: "1", resourceRevision: "1", createdAt: stamp, modifiedAt: stamp };
  await host.sessions.reserve(session, root, () => true);
  await host.sessions.transition({ ref, session: ref, operationId: root.operationId, expected: "creating", next: "active" }, () => true);
  return { ref, session, root };
}

export async function assertWorkDataConformance(host: DurableHost): Promise<void> {
  const { ref } = await createWorkSessionFixture(host);
  const graph = await host.work.graph(ref.domainId, { kind: ref.kind, id: ref.id });
  assert.ok(graph);
  assert.deepEqual(graph.session.ref, ref);
  assert.equal(await host.work.graph("foreign", { kind: ref.kind, id: ref.id }), undefined);
  const intent: WorkIntent = { session: ref, requestKey: "review", kind: "review", submitter: { kind: "user", principal: { domainId: ref.domainId, subject: "owner" } },
    input: { nested: { first: "雪", second: [1, 2], zero: -0 } }, submittedData: { draft: true }, priority: -2147483648, targetAgentId: null, maxAttempts: 3,
    scope: [{ resource: ref, include: true, includeDescendants: true }], announce: [] };
  const submit = (row = intent, admit = () => true, sessionLimit = 1) => host.work.submit(row, graph.session.graphRevision, { host: 1000, session: sessionLimit }, admit);
  await assert.rejects(submit(intent, () => false));
  const [first, replay] = await Promise.all([submit(), submit()]);
  assert.equal(first.id, replay.id);
  assert.deepEqual([first.created, replay.created].sort(), [false, true]);
  assert.equal(await host.work.get("foreign", first.id), undefined);
  const fence = { id: first.id, session: ref, revision: "1" };
  const write = (label: number) => host.work.replaceData(fence, { expectedDataRevision: "1", data: { label } }, () => true);
  const outcomes = await Promise.allSettled([write(1), write(2)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const row = await host.work.get(ref.domainId, first.id);
  assert.equal(row?.revision, "2");
  assert.equal(row.dataRevision, "2");
  assert.deepEqual(row.submittedData, { draft: true });
  assert.equal(row.priority, -2147483648);
  assert.equal((await submit({ ...intent, input: { nested: { second: [1, 2], first: "雪", zero: 0 } }, maxAttempts: 4 })).id, first.id);
  for (const mismatch of [{ priority: 1 }, { input: { nested: { second: [2, 1], first: "雪" } } }, { submittedData: {} },
    { scope: [{ resource: ref, include: true, includeDescendants: false }] }]) await assert.rejects(submit({ ...intent, ...mismatch }));
  await assert.rejects(submit({ ...intent, kind: "other" }));
  assert.notEqual((await submit({ ...intent, kind: "other", priority: 2147483647 }, () => true, 2)).id, first.id);
  assert.deepEqual(await host.work.get(ref.domainId, first.id), row);
  await host.sessions.beginRetirement(ref, () => true);
  await host.sessions.finishRetirement(ref);
  const replacement = await createWorkSessionFixture(host, { ...ref, instanceId: randomUUID() });
  const after = await host.work.graph(ref.domainId, { kind: ref.kind, id: ref.id });
  assert.ok(after);
  assert.deepEqual(after.session.ref, replacement.ref);
  const successor = await host.work.submit({ ...intent, session: replacement.ref,
    scope: [{ resource: replacement.ref, include: true, includeDescendants: true }] }, after.session.graphRevision, { host: 1000, session: 1 }, () => true);
  assert.notEqual(successor.id, first.id);
  assert.equal((await host.work.get(ref.domainId, first.id))?.status, "cancelled");
  await assertRetiredSelectorReplay(host);
}

async function assertRetiredSelectorReplay(host: DurableHost): Promise<void> {
  const first = await createWorkSessionFixture(host);
  const second = await createWorkSessionFixture(host);
  const id = `chat:/${randomUUID()}`;
  const yes = (): boolean => true;
  const submitter = { kind: "agent" as const, agentId: "stable-agent", principal: { domainId: first.ref.domainId, subject: "tester" } };
  const key = { requestKey: randomUUID(), kind: "review", submitter };
  const limits = { session: 1, host: 1000 };
  const locator = { kind: "chat", id };
  async function create(fixture: typeof first) {
    const ref = { ...fixture.ref, ...locator, instanceId: randomUUID() };
    const operationId = randomUUID();
    await host.resources.reserve({ ...fixture.root, ref, parent: fixture.ref, operationId }, yes);
    await host.resources.activate({ ref, session: fixture.ref, operationId, expected: "creating", next: "active" }, yes);
    const graph = await host.work.graph(ref.domainId, locator, key);
    assert.deepEqual(graph?.session.ref, fixture.ref);
    const intent: WorkIntent = { ...key, session: fixture.ref, input: {}, submittedData: {}, maxAttempts: 3, priority: 0, targetAgentId: null,
      scope: [{ resource: ref, include: true, includeDescendants: false }], announce: [] };
    const created = await host.work.submit(intent, graph.session.graphRevision, limits, yes);
    return { ref, intent, created };
  }
  async function retire(fixture: typeof first, child: Awaited<ReturnType<typeof create>>) {
    await host.resources.beginRetirement(fixture.ref, child.ref, yes);
    await host.resources.finishRetirement(fixture.ref, child.ref);
    const row = await host.work.get(fixture.ref.domainId, child.created.id);
    assert.equal(row?.status, "cancelled");
    return row;
  }
  const old = await create(first);
  const cancelled = await retire(first, old);
  assert.equal(await host.work.graph(first.ref.domainId, locator), undefined);
  assert.equal(await host.work.graph(first.ref.domainId, locator, { ...key, requestKey: "other" }), undefined);
  assert.equal(await host.work.graph(first.ref.domainId, locator, { ...key, submitter: { ...submitter, agentId: "different" } }), undefined);
  assert.equal(await host.work.graph(first.ref.domainId, { ...locator, instanceId: "wrong" }, key), undefined);
  const past = await host.work.graph(first.ref.domainId, locator, key);
  assert.deepEqual(past?.previous, cancelled);
  assert.ok(past);
  // Occupy the freed slot with unrelated root work before retrying the cancelled key.
  await host.work.submit({ ...old.intent, requestKey: "occupy", scope: [{ resource: first.ref, include: true, includeDescendants: false }] },
    past.session.graphRevision, limits, yes);
  await assert.rejects(host.work.submit(old.intent, past.session.graphRevision, limits, () => false));
  assert.deepEqual(await host.work.submit(old.intent, past.session.graphRevision, limits, yes), { id: old.created.id, created: false });
  await assert.rejects(host.work.submit({ ...old.intent, requestKey: "new" }, past.session.graphRevision, { session: 10, host: 1000 }, yes));
  assert.deepEqual(await host.work.get(first.ref.domainId, old.created.id), cancelled);
  const fresh = await create(second);
  const current = await host.work.graph(first.ref.domainId, locator, key);
  assert.deepEqual(current?.session.ref, second.ref);
  assert.equal(current.previous?.id, fresh.created.id);
  assert.equal((await host.work.graph(first.ref.domainId, old.ref, key))?.previous?.id, old.created.id);
  await retire(second, fresh);
  assert.equal(await host.work.graph(first.ref.domainId, locator, key), undefined);
  assert.equal((await host.work.graph(first.ref.domainId, fresh.ref, key))?.previous?.id, fresh.created.id);
}

export async function assertTargetReplayConformance(host: DurableHost, setRegistration: (row: AgentRegistrationRecord) => Promise<void>): Promise<void> {
  const { session, ref } = await createWorkSessionFixture(host);
  const agent = { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", domainId: ref.domainId, principalSubject: "worker",
    agentKey: "target", enabled: true, createdAt: session.createdAt };
  await setRegistration(agent);
  const key = { kind: "review", requestKey: "target", submitter: { kind: "user" as const, principal: { domainId: ref.domainId, subject: "tester" } } };
  const graph = await host.work.graph(ref.domainId, ref);
  assert.ok(graph);
  const intent: WorkIntent = { ...key, session: ref, input: {}, submittedData: {}, maxAttempts: 3, priority: 0, targetAgentId: agent.id.toUpperCase(),
    scope: [{ resource: ref, include: true, includeDescendants: false }], announce: [] };
  const submit = (item: WorkIntent, sessionLimit: number) => host.work.submit(item, graph.session.graphRevision, { host: 1000, session: sessionLimit }, () => true);
  const created = await submit(intent, 1);
  const original = await host.work.get(ref.domainId, created.id);
  assert.equal(original?.targetAgentId, agent.id);
  await setRegistration({ ...agent, enabled: false });
  assert.deepEqual(await submit({ ...intent, targetAgentId: agent.id }, 1), { id: created.id, created: false });
  assert.deepEqual(await submit(intent, 1), { id: created.id, created: false });
  await assert.rejects(submit({ ...intent, requestKey: "new" }, 10));
  assert.deepEqual(await host.work.get(ref.domainId, created.id), original);
}

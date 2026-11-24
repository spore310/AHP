import assert from "node:assert/strict";

import { createPersistence } from "@persistence";
import {
  RepositoryError,
  type AgentRegistrationRepository,
  type DurableSessionInput,
  type PersistenceProvider,
} from "@persistence/types";

export type PersistenceConformanceProviderFactory
  = () => PersistenceProvider | Promise<PersistenceProvider>;

const registrationConflict = (error: unknown): boolean => error instanceof RepositoryError && error.code === "conflict";

/** Run against two adapters sharing an empty store with a per-principal cap of one and a total cap of two. */
export const assertRegistrationQuotaConformance = async (
  first: AgentRegistrationRepository,
  second: AgentRegistrationRepository,
): Promise<void> => {
  const existing = { domainId: "quota", principalSubject: "quota-a", agentKey: "worker" };
  const [left, right] = await Promise.all([first.register(existing), second.register(existing)]);
  assert.equal(left.id, right.id);
  await assert.rejects(second.register({ ...existing, agentKey: "second-worker" }), registrationConflict);

  const outcomes = await Promise.allSettled([
    first.register({ domainId: "quota", principalSubject: "quota-b", agentKey: "worker" }),
    second.register({ domainId: "quota", principalSubject: "quota-c", agentKey: "worker" }),
  ]);
  const succeeded = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const refused = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(succeeded.length, 1);
  assert.equal(refused.length, 1);
  assert.ok(registrationConflict(refused[0]?.reason));
  assert.equal((await first.register({ ...existing, displayName: "Renamed" })).id, left.id);
  assert.equal((await second.getById(left.id, "quota"))?.displayName, "Renamed");
};

/** Runs data-contract scenarios against any provider fixture, without SQL hooks. */
export const assertPersistenceConformance = async (
  createProvider: PersistenceConformanceProviderFactory,
): Promise<void> => {
  const provider = await createProvider();
  const persistence = createPersistence(provider);
  const principalSubject = "persistence-conformance-principal";
  const sessionUri = `ahp-session:/persistence-conformance-${String(Date.now())}`;
  const timestamp = new Date().toISOString();
  const session: DurableSessionInput = {
    sessionUri,
    ownerPrincipalSubject: principalSubject,
    providerId: "conformance",
    createdAt: timestamp,
    modifiedAt: timestamp,
    lastServerSeq: 1,
    durableState: { conformance: true },
  };

  try {
    const absentId = "00000000-0000-4000-8000-999999999999";
    assert.equal(await persistence.registrations.getById(absentId), undefined);
    assert.equal(await persistence.sessions.get(sessionUri), undefined);
    assert.equal(await persistence.sessions.delete(sessionUri), false);
    assert.equal(await persistence.work.claim({
      agentId: absentId,
      principalSubject,
      sessionUri,
      kinds: ["conformance.task"],
    }), null);
    assert.equal(await persistence.work.renew({
      agentId: absentId,
      principalSubject,
      workId: absentId,
      token: absentId,
    }), null);
    assert.equal(await persistence.work.complete({
      agentId: absentId,
      principalSubject,
      workId: absentId,
      token: absentId,
      result: null,
    }), false);
    assert.equal(await persistence.work.fail({
      agentId: absentId,
      principalSubject,
      workId: absentId,
      token: absentId,
      retryable: false,
    }), null);
    assert.equal(await persistence.work.cancel({ workId: absentId, principalSubject }), null);
    assert.equal(await persistence.work.get({ workId: absentId, principalSubject }), null);
    assert.equal(await persistence.work.reconcileExpired(), 0);
    assert.equal(await persistence.work.hasDependentWork(sessionUri), false);

    const registration = await persistence.registrations.register({
      principalSubject,
      agentKey: "conformance-agent",
    });
    assert.equal((await persistence.registrations.getById(registration.id))?.id, registration.id);
    await persistence.sessions.ensure(session);
    assert.equal((await persistence.sessions.get(sessionUri))?.ownerPrincipalSubject, principalSubject);

    const workInput = {
      session,
      requestKey: "conformance-request",
      kind: "conformance.task",
      input: { payload: { first: 1, second: 2 }, items: [1, 2] },
    };
    const submitted = await persistence.work.submit(workInput);
    assert.equal(submitted.created, true);
    const replay = await persistence.work.submit(workInput);
    assert.equal(replay.id, submitted.id);
    assert.equal(replay.created, false);
    const reorderedReplay = await persistence.work.submit({
      ...workInput,
      input: { items: [1, 2], payload: { second: 2, first: 1 } },
    });
    assert.deepEqual(reorderedReplay, { id: submitted.id, created: false });
    await assert.rejects(
      persistence.work.submit({ ...workInput, input: { items: [2, 1], payload: { first: 1, second: 2 } } }),
      (error: unknown) => error instanceof RepositoryError && error.code === "conflict",
    );
    assert.equal(await persistence.work.hasDependentWork(sessionUri), true);
    await assert.rejects(
      persistence.sessions.delete(sessionUri),
      (error: unknown) => error instanceof RepositoryError && error.code === "conflict",
    );

    const lease = await persistence.work.claim({
      agentId: registration.id,
      principalSubject,
      sessionUri,
      kinds: ["conformance.task"],
    });
    assert.ok(lease);
    assert.equal(lease.attempt, 1);
    assert.ok(await persistence.work.renew({
      agentId: registration.id,
      principalSubject,
      workId: lease.workId,
      token: lease.leaseToken,
    }));
    assert.equal(await persistence.work.complete({
      agentId: registration.id,
      principalSubject,
      workId: lease.workId,
      token: lease.leaseToken,
      result: { done: true },
    }), true);
    assert.equal((await persistence.work.get({
      workId: lease.workId,
      principalSubject,
    }))?.status, "completed");
    assert.equal(await persistence.work.cancel({
      workId: lease.workId,
      principalSubject,
    }), "completed");
  } finally {
    await persistence.dispose();
  }
};

export { createLegacyPersistenceFixture as createMemoryPersistenceFixture } from "./legacy";

/** Identical exact-resource, capture, CAS and retention checks for either backend. */
export async function assertDurableResourceConformance(storage: import("@persistence").DurableStorage, hostId: string): Promise<void> {
  const host = await storage.acquire(hostId, () => undefined);
  const ref = { domainId: "conformance", kind: "session" as const, id: "ahp-session:/resource-conformance", instanceId: crypto.randomUUID() };
  const stamp = new Date().toISOString();
  const record: import("@persistence").StoredSession = { ref, owner: "owner", providerId: "fixture", type: { id: crypto.randomUUID(), key: "resource-conformance", version: 1 },
    lifecycle: "creating", state: {}, stateRevision: "1", graphRevision: "1", lastServerSeq: 0, createdAt: stamp, modifiedAt: stamp };
  const root: import("@persistence").ResourceRecord = { ref, session: ref, owner: record.owner, providerId: record.providerId, driver: { key: "fixture", version: 1 },
    operationId: crypto.randomUUID(), registration: {}, recoveryInput: {}, runtimeMetadata: {}, lifecycle: "creating", resourceRevision: "1",
    dataRevision: "1", data: {}, createdAt: stamp, modifiedAt: stamp };
  try {
    await assert.rejects(host.sessions.reserve(record, root, () => Promise.reject(new Error("async admission"))));
    assert.equal(await host.sessions.get(ref), undefined);
    await host.sessions.reserve(record, root, () => true);
    const child = { ...root, ref: { ...ref, kind: "chat", id: "chat:/resource-conformance", instanceId: "opaque-instance" }, parent: ref, operationId: crypto.randomUUID() };
    await host.resources.reserve(child, () => true);
    const data = { list: ["雪", {}] };
    const write = host.resources.replaceData(ref, child.ref, { data, expectedDataRevision: "1" }, () => true);
    data.list.length = 0;
    assert.deepEqual(await write, { status: "updated", value: { dataRevision: "2", data: { list: ["雪", {}] } } });
    const replace = () => host.resources.replaceData(ref, child.ref, { data: {}, expectedDataRevision: "2" }, () => true);
    assert.deepEqual((await Promise.all([replace(), replace()])).map((r) => r.status).sort(), ["conflict", "updated"]);
    assert.deepEqual((await host.resources.get(child.ref))?.data, {});
    assert.equal((await host.resources.get(child.ref))?.resourceRevision, "3");
    await assert.rejects(host.resources.replaceData(ref, child.ref, { data: { value: "\0" }, expectedDataRevision: "3" }, () => true));
    await assert.rejects(host.resources.reserve({ ...child, parent: child.ref }, () => true));
    assert.equal((await host.resources.get(child.ref))?.dataRevision, "3");
    const activate = (row: typeof root, next: "active" | "failed", expected: "creating" | "failed" = "creating") =>
      ({ ref: row.ref, session: ref, operationId: row.operationId, expected, next });
    const branch = { ...child, ref: { ...child.ref, id: "branch" }, operationId: crypto.randomUUID() };
    const leaf = { ...child, ref: { ...child.ref, id: "leaf" }, parent: ref, grantParent: branch.ref, operationId: crypto.randomUUID() };
    await host.resources.reserve({ ...branch, parent: child.ref }, () => true);
    await host.resources.reserve(leaf, () => true);
    const pending = await host.resources.get(leaf.ref);
    await assert.rejects(host.resources.activate(activate(leaf, "active"), () => true));
    assert.deepEqual(await host.resources.get(leaf.ref), pending);
    await assert.rejects(host.resources.replaceData(ref, leaf.ref, { data: {}, expectedDataRevision: "1" }, () => true));
    await host.resources.activate(activate(child, "failed"), () => true);
    await assert.rejects(host.resources.activate(activate(leaf, "active"), () => true));
    await assert.rejects(host.resources.replaceData(ref, leaf.ref, { data: { unavailable: true }, expectedDataRevision: "1" }, () => true));
    assert.deepEqual(await host.resources.get(leaf.ref), pending);
    await host.resources.activate(activate(child, "active", "failed"), () => true);
    await host.sessions.transition(activate(root, "failed"), () => true);
    await assert.rejects(host.resources.activate(activate(leaf, "active"), () => true));
    assert.deepEqual(await host.resources.get(leaf.ref), pending);
    const retry = { ref, session: ref, expected: "failed", next: "creating", operationId: root.operationId } as const;
    await assert.rejects(host.resources.activate({ ...retry, ref: leaf.ref, operationId: leaf.operationId, expected: "creating" }, () => true));
    await assert.rejects(host.sessions.transition({ ...retry, operationId: crypto.randomUUID() }, () => true));
    await assert.rejects(host.sessions.transition(retry, () => false));
    await host.sessions.transition(retry, () => true);
    await host.sessions.transition({ ...activate(root, "active"), runtimeMetadata: { receipt: {} } }, () => true);
    await host.sessions.transition({ ...activate(root, "failed"), expected: "active" }, () => true);
    await assert.rejects(host.sessions.transition(retry, () => true));
    await host.sessions.transition(activate(root, "active", "failed"), () => true);
    await host.resources.activate(activate(branch, "active"), () => true);
    await host.resources.activate(activate(leaf, "active"), () => true);
    assert.equal((await host.resources.replaceData(ref, leaf.ref, { data: {}, expectedDataRevision: "1" }, () => true)).status, "updated");
    for (const row of await host.resources.beginRetirement(ref, branch.ref, () => true)) {
      await host.resources.finishRetirement(ref, row.ref);
    }
    assert.equal(await host.sessions.purge(ref, "2100-01-01"), false);
    const closure = await host.sessions.beginRetirement(ref, () => true);
    assert.deepEqual(closure.map((r) => r.ref), [child.ref, ref]);
    await assert.rejects(host.sessions.finishRetirement(ref));
    await host.resources.finishRetirement(ref, child.ref);
    await host.sessions.finishRetirement(ref);
    assert.equal(await host.sessions.purge(ref, "2000-01-01"), false);
    assert.equal(await host.sessions.purge(ref, "2100-01-01"), true);
  } finally { await host.release(); }
}

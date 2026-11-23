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
  const existing = { principalSubject: "quota-a", agentKey: "worker" };
  const [left, right] = await Promise.all([first.register(existing), second.register(existing)]);
  assert.equal(left.id, right.id);
  await assert.rejects(second.register({ ...existing, agentKey: "second-worker" }), registrationConflict);

  const outcomes = await Promise.allSettled([
    first.register({ principalSubject: "quota-b", agentKey: "worker" }),
    second.register({ principalSubject: "quota-c", agentKey: "worker" }),
  ]);
  const succeeded = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const refused = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(succeeded.length, 1);
  assert.equal(refused.length, 1);
  assert.ok(registrationConflict(refused[0]?.reason));
  assert.equal((await first.register({ ...existing, displayName: "Renamed" })).id, left.id);
  assert.equal((await second.getById(left.id))?.displayName, "Renamed");
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

export { createExamplePersistence as createMemoryPersistenceFixture } from "../../../../examples/advanced/persistence";

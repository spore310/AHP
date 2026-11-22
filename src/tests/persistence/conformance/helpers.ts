import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

import { createPersistence } from "@persistence";
import {
  RepositoryError,
  type AgentRegistrationRecord,
  type DurableSessionInput,
  type PersistenceProvider,
  type WorkItemRecord,
  type WorkLeaseRecord,
  type WorkStatus,
} from "@persistence/types";

import type { PersistenceConformanceFixture } from "./types";

// The in-memory conformance provider models async ports with deterministic state.
/* eslint-disable @typescript-eslint/require-await */
export type PersistenceConformanceProviderFactory
  = () => PersistenceProvider | Promise<PersistenceProvider>;

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

export const createMemoryPersistenceFixture = (): PersistenceConformanceFixture => {
  const registrations = new Map<string, AgentRegistrationRecord>();
  const registrationKeys = new Map<string, string>();
  const sessions = new Map<string, DurableSessionInput>();
  const work = new Map<string, WorkItemRecord>();
  let sequence = 0;
  let now = 1_000_000;
  let disposed = false;
  const assertOpen = (): void => {
    if (disposed) {
      throw new RepositoryError("database", "The test provider is closed.");
    }
  };

  const provider: PersistenceProvider = {
    registrations: {
      async register(input) {
        assertOpen();
        const key = `${input.principalSubject}\u0000${input.agentKey}`;
        const existingId = registrationKeys.get(key);
        if (existingId !== undefined) {
          const existing = registrations.get(existingId);
          if (existing !== undefined) {
            const updated = input.displayName === undefined
              ? existing
              : { ...existing, displayName: input.displayName };
            registrations.set(existingId, updated);
            return updated;
          }
        }
        sequence += 1;
        const record: AgentRegistrationRecord = {
          id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          principalSubject: input.principalSubject,
          agentKey: input.agentKey,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          enabled: true,
          createdAt: new Date(0).toISOString(),
        };
        registrations.set(record.id, record);
        registrationKeys.set(key, record.id);
        return record;
      },
      async getById(id) {
        assertOpen();
        return registrations.get(id);
      },
    },
    sessions: {
      async ensure(input) {
        assertOpen();
        const existing = sessions.get(input.sessionUri);
        if (existing !== undefined && existing.ownerPrincipalSubject !== input.ownerPrincipalSubject) {
          throw new RepositoryError("unauthorized", "The session belongs to another principal.");
        }
        sessions.set(input.sessionUri, input);
        return input;
      },
      async get(sessionUri) {
        assertOpen();
        return sessions.get(sessionUri);
      },
      async delete(sessionUri) {
        assertOpen();
        if ([...work.values()].some((item) => item.sessionUri === sessionUri)) {
          throw new RepositoryError("conflict", "The session still has dependent work.");
        }
        return sessions.delete(sessionUri);
      },
    },
    work: {
      async submit(input) {
        assertOpen();
        const existing = [...work.values()].find(
          (item) => item.sessionUri === input.session.sessionUri && item.requestKey === input.requestKey,
        );
        if (existing !== undefined) {
          const same = existing.kind === input.kind
            && isDeepStrictEqual(existing.input, input.input)
            && existing.targetAgentId === input.targetAgentId;
          if (!same) {
            throw new RepositoryError("conflict", "The request key was already used with different work.");
          }
          return { id: existing.id, created: false };
        }
        await provider.sessions.ensure(input.session);
        sequence += 1;
        const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
        const record: WorkItemRecord = {
          id,
          sessionUri: input.session.sessionUri,
          requestKey: input.requestKey,
          kind: input.kind,
          input: input.input,
          status: "queued",
          targetAgentId: input.targetAgentId,
          attemptCount: 0,
          maxAttempts: 3,
          createdAt: input.session.createdAt,
          updatedAt: input.session.modifiedAt,
        };
        work.set(id, record);
        return { id, created: true };
      },
      async claim(input): Promise<WorkLeaseRecord | null> {
        assertOpen();
        const registration = registrations.get(input.agentId);
        if (registration === undefined || !registration.enabled
          || registration.principalSubject !== input.principalSubject) {
          return null;
        }
        const candidate = [...work.values()].find((item) => (
          item.sessionUri === input.sessionUri
          && sessions.get(item.sessionUri)?.ownerPrincipalSubject === input.principalSubject
          && input.kinds.includes(item.kind)
          && (item.targetAgentId === undefined || item.targetAgentId === registration.id)
          && item.status === "queued"
          && item.attemptCount < item.maxAttempts
        ));
        if (candidate === undefined) {
          return null;
        }
        const leaseToken = `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, "0")}`;
        const expiresAt = new Date(now + 60_000).toISOString();
        work.set(candidate.id, {
          ...candidate,
          status: "leased",
          leaseAgentId: registration.id,
          leaseToken,
          leaseExpiresAt: expiresAt,
          attemptCount: candidate.attemptCount + 1,
        });
        return {
          workId: candidate.id,
          sessionUri: candidate.sessionUri,
          kind: candidate.kind,
          input: candidate.input,
          leaseToken,
          leaseExpiresAt: expiresAt,
          attempt: candidate.attemptCount + 1,
        };
      },
      async renew(input) {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || item.status !== "leased" || item.leaseAgentId !== input.agentId
          || item.leaseToken !== input.token || (item.leaseExpiresAt !== undefined
            && Date.parse(item.leaseExpiresAt) <= now)) {
          return null;
        }
        const leaseExpiresAt = new Date(now + 60_000).toISOString();
        work.set(item.id, { ...item, leaseExpiresAt });
        return { leaseExpiresAt };
      },
      async complete(input) {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || item.status !== "leased" || item.leaseAgentId !== input.agentId
          || item.leaseToken !== input.token) {
          return false;
        }
        work.set(item.id, {
          ...item,
          status: "completed",
          result: input.result,
          leaseAgentId: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
        });
        return true;
      },
      async fail(input) {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || item.status !== "leased" || item.leaseAgentId !== input.agentId
          || item.leaseToken !== input.token) {
          return null;
        }
        const status: WorkStatus = input.retryable && item.attemptCount < item.maxAttempts
          ? "queued"
          : "failed";
        work.set(item.id, { ...item, status, leaseAgentId: undefined, leaseToken: undefined });
        return status;
      },
      async cancel(input) {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || sessions.get(item.sessionUri)?.ownerPrincipalSubject !== input.principalSubject) {
          return null;
        }
        if (item.status === "queued" || item.status === "leased") {
          work.set(item.id, { ...item, status: "cancelled", leaseAgentId: undefined, leaseToken: undefined });
          return "cancelled";
        }
        return item.status;
      },
      async get(input) {
        assertOpen();
        const item = work.get(input.workId);
        return item !== undefined
          && sessions.get(item.sessionUri)?.ownerPrincipalSubject === input.principalSubject
          ? item
          : null;
      },
      async reconcileExpired() {
        assertOpen();
        let reconciled = 0;
        for (const item of work.values()) {
          if (item.status === "leased" && item.leaseExpiresAt !== undefined
            && Date.parse(item.leaseExpiresAt) <= now && item.attemptCount >= item.maxAttempts) {
            work.set(item.id, { ...item, status: "failed", leaseAgentId: undefined, leaseToken: undefined });
            reconciled += 1;
          }
        }
        return reconciled;
      },
      async hasDependentWork(sessionUri) {
        assertOpen();
        return [...work.values()].some((item) => item.sessionUri === sessionUri);
      },
    },
    async dispose() {
      disposed = true;
    },
  };

  return {
    provider,
    registrations,
    sessions,
    work,
    seedRegistration: (record) => registrations.set(record.id, record),
    seedSession: (session) => sessions.set(session.sessionUri, session),
    setNow: (value) => { now = value; },
    isDisposed: () => disposed,
  };
};

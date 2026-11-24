import { describe, expect, it } from "vitest";

import { createAgentDirectory } from "@agents";
import { createPersistence } from "@persistence";
import type { DurableSessionInput } from "@persistence/types";
import { createSessionOwnerRegistry, createWorkService } from "@work";
import { createExamplePersistence } from "../../../examples/advanced/persistence";

import {
  assertPersistenceConformance,
  assertRegistrationQuotaConformance,
  assertDurableResourceConformance,
  createMemoryPersistenceFixture,
} from "./conformance/helpers";

const principal = { subject: "principal-a" };
const sessionUri = "ahp-session:/conformance";
const session: DurableSessionInput = {
  sessionUri,
  ownerPrincipalSubject: principal.subject,
  providerId: "memory-provider",
  createdAt: "2026-10-23T00:00:00.000Z",
  modifiedAt: "2026-10-23T00:00:00.000Z",
  lastServerSeq: 1,
  durableState: { state: "ready" },
};

const composeServices = (fixture: ReturnType<typeof createMemoryPersistenceFixture>) => {
  const persistence = createPersistence(fixture.provider);
  const agents = createAgentDirectory({ registrations: persistence.registrations });
  const owners = createSessionOwnerRegistry();
  owners.bind(sessionUri, principal.subject);
  const service = createWorkService({
    repository: persistence.work,
    sessions: owners,
    presence: agents,
    registrations: persistence.registrations,
    describeSession: () => session,
    allowedKinds: new Set(["code.review"]),
  });
  return { persistence, agents, service };
};

describe("provider conformance through neutral services", () => {
  it("keeps the example's durable sessions and resources isolated from URI-only writes", async () => {
    const persistence = createPersistence(createExamplePersistence().provider);
    try {
      const storage = persistence.durability;
      if (!storage) throw new Error("Example durability is missing.");
      const host = await storage.acquire("example", () => undefined);
      try {
        const denied = { code: "unauthorized" };
        const worker = await persistence.registrations.register({ principalSubject: principal.subject, agentKey: "worker" });
        const lease = { agentId: worker.id, principalSubject: principal.subject, workId: worker.id, token: "old" };
        await expect(persistence.sessions.ensure(session)).rejects.toMatchObject(denied);
        await expect(persistence.sessions.delete(sessionUri)).rejects.toMatchObject(denied);
        await expect(persistence.work.submit({ session, requestKey: "old", kind: "review", input: {} })).rejects.toMatchObject(denied);
        await expect(persistence.work.claim({ ...lease, sessionUri, kinds: ["review"] })).rejects.toMatchObject(denied);
        await expect(persistence.work.renew(lease)).rejects.toMatchObject(denied);
        await expect(persistence.work.complete({ ...lease, result: {} })).rejects.toMatchObject(denied);
        await expect(persistence.work.fail({ ...lease, retryable: false })).rejects.toMatchObject(denied);
        await expect(persistence.work.cancel(lease)).rejects.toMatchObject(denied);
        await expect(persistence.work.reconcileExpired()).rejects.toMatchObject(denied);
        await expect(persistence.work.get(lease)).resolves.toBeNull();
        await expect(persistence.work.hasDependentWork(sessionUri)).resolves.toBe(false);
      } finally {
        await host.release();
      }
      await assertDurableResourceConformance(storage, "example");
    } finally {
      await persistence.dispose();
    }
  });

  it("exposes the historical URI-only work contract only on the legacy fixture", () => {
    expect(createMemoryPersistenceFixture().provider.durability).toBeUndefined();
  });

  it("runs the reusable contract suite against a non-SQL provider", async () => {
    await assertPersistenceConformance(() => createMemoryPersistenceFixture().provider);
  });

  it("runs the reusable registration quotas against a non-SQL provider", async () => {
    const memory = createMemoryPersistenceFixture({ maxPerPrincipal: 1, maxTotal: 2 });
    const persistence = createPersistence(memory.provider);
    try {
      await assertRegistrationQuotaConformance(memory.provider.registrations, persistence.registrations);
      expect(memory.registrations.size).toBe(2);
    } finally {
      await persistence.dispose();
    }
  });

  it("substitutes an independently built provider through AgentDirectory and WorkService", async () => {
    const fixture = createMemoryPersistenceFixture();
    const { persistence, agents, service } = composeServices(fixture);
    const registration = await agents.register(principal, "agent-key");
    const binding = agents.bindPresence(registration.id, principal, "connection-a");

    const submission = {
      sessionUri,
      requestKey: "request-one",
      kind: "code.review",
      input: { path: "src/index.ts" },
    };
    const first = await service.submit(principal, submission);
    const replay = await service.submit(principal, submission);
    expect(replay.id).toBe(first.id);
    expect(fixture.work.size).toBe(1);

    await expect(service.submit(principal, { ...submission, input: { path: "different.ts" } }))
      .rejects.toMatchObject({ code: "conflict" });

    const lease = await service.claim({
      principal,
      agentId: registration.id,
      connectionId: "connection-a",
      generation: binding.generation,
    }, sessionUri);
    expect(lease).toMatchObject({ workId: first.id, attempt: 1, kind: "code.review" });
    await persistence.dispose();
  });

  it("isolates provider records and disposers across two instances", async () => {
    const firstFixture = createMemoryPersistenceFixture();
    const secondFixture = createMemoryPersistenceFixture();
    const first = createPersistence(firstFixture.provider);
    const second = createPersistence(secondFixture.provider);

    const input = { principalSubject: principal.subject, agentKey: "same-key" };
    const firstRecord = await first.registrations.register(input);
    const secondRecord = await second.registrations.register(input);
    expect(firstRecord.id).toBe(secondRecord.id);
    expect(firstFixture.registrations.size).toBe(1);
    expect(secondFixture.registrations.size).toBe(1);

    await first.dispose();
    expect(firstFixture.isDisposed()).toBe(true);
    expect(secondFixture.isDisposed()).toBe(false);
    await expect(first.registrations.getById(firstRecord.id)).rejects.toMatchObject({ code: "database" });
    await expect(second.registrations.getById(secondRecord.id)).resolves.toEqual(secondRecord);
    await second.dispose();
  });
});

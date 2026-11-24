import { describe, expect, it } from "vitest";

import { createAgentDirectory } from "@agents";
import { createPersistence } from "@persistence";
import type { DurableSessionInput } from "@persistence/types";
import { workFixture } from "../work/commandsFixture";
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
    const persistence = createPersistence(createExamplePersistence().provider);
    try {
      if (!persistence.durability) throw new Error("Missing example storage");
      const host = await persistence.durability.acquire("example", () => undefined);
      const f = await workFixture({}, host);
      const directory = createAgentDirectory({ registrations: persistence.registrations, domainId: f.ref.domainId });
      const target = await directory.register({ subject: "different-owner" }, "worker");
      const request = { ...f.request, targetAgentId: target.id };
      const created = await f.service.submit(f.caller, request);
      await expect(f.service.submit(f.caller, request)).resolves.toEqual(created);
      await expect(host.work.get(f.ref.domainId, created.id)).resolves.toMatchObject({ targetAgentId: target.id });
    } finally { await persistence.dispose(); }
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

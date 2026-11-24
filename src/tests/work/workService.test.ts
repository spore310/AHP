import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSessionOwnerRegistry, createWorkReadPort, WorkError } from "@work";
import type { JsonObject, JsonValue } from "@persistence/helpers/durability/types";
import type { WorkItemRecord } from "@persistence/types";
import { createAgentWorkExtension } from "@websocket/helpers/ahp/agentWork";
import { workFixture } from "./commandsFixture";

describe("exact-instance work commands", () => {
  it("rejects invalid text, missing locators, disallowed kinds and invalid priorities without writing", async () => {
    const f = await workFixture();
    try {
      const submit = vi.spyOn(f.host.work, "submit");
      const invalid = [
        { requestKey: " " }, { requestKey: "bad\u0000key" }, { requestKey: "x".repeat(257) },
        { kind: " " }, { kind: "not-registered" }, { input: { nested: ["\ud800"] } }, { data: { "bad\u0000key": true } },
        { session: { kind: "session", id: " " } }, { session: { kind: "session", id: "x".repeat(2049) } },
        { scope: [] }, { priority: 1.5 }, { priority: 2147483648 },
      ];
      for (const change of invalid) {
        await expect(f.service.submit(f.caller, { ...f.request, ...change })).rejects.toMatchObject({ code: "invalid" });
      }
      expect(submit).not.toHaveBeenCalled();
      expect(f.rows.size).toBe(0);
    } finally {
      await f.host.release();
    }
  });

  it("enforces the 64 KiB input budget in UTF-8 and the 16-level JSON depth limit", async () => {
    const f = await workFixture();
    try {
      const envelopeBytes = Buffer.byteLength(JSON.stringify({ value: "" }));
      const value = "x".repeat(65536 - envelopeBytes - Buffer.byteLength("雪")) + "雪";
      const nested = (depth: number): JsonObject => {
        let node: JsonValue = "leaf";
        for (let i = 1; i < depth; i++) node = { child: node };
        return { child: node };
      };
      const submit = vi.spyOn(f.host.work, "submit");
      await expect(f.service.submit(f.caller, { ...f.request, input: { value: value + "x" } })).rejects.toMatchObject({ code: "invalid" });
      await expect(f.service.submit(f.caller, { ...f.request, input: nested(17) })).rejects.toMatchObject({ code: "invalid" });
      expect(submit).not.toHaveBeenCalled();
      expect(f.rows.size).toBe(0);
      await f.service.submit(f.caller, { ...f.request, input: { value } });
      await f.service.submit(f.caller, { ...f.request, requestKey: "deep", input: nested(16) });
      expect(f.rows.size).toBe(2);
    } finally {
      await f.host.release();
    }
  });

  it("checks target registration by domain and enabled state", async () => {
    const f = await workFixture();
    try {
      const target = { id: randomUUID(), domainId: f.ref.domainId, principalSubject: "different-worker", agentKey: "worker",
        createdAt: f.session.createdAt, enabled: true };
      const request = { ...f.request, targetAgentId: target.id };
      for (const record of [undefined, { ...target, enabled: false }, { ...target, domainId: "foreign" }]) {
        if (record) f.agents.set(target.id, record);
        await expect(f.service.submit(f.caller, request)).rejects.toMatchObject({ code: "conflict" });
        expect(f.rows.size).toBe(0);
      }
      f.agents.set(target.id, target);
      const { id } = await f.service.submit(f.caller, request);
      expect(f.rows.get(id)?.targetAgentId).toBe(target.id);
    } finally {
      await f.host.release();
    }
  });

  it("refuses a pending submission after the principal's admission expires or its exact session retires", async () => {
    for (const retiring of [false, true]) {
      const entered = Promise.withResolvers<undefined>();
      const resume = Promise.withResolvers<undefined>();
      const release = vi.fn();
      let current = true;
      const f = await workFixture({ prepare: async () => {
        entered.resolve(undefined);
        await resume.promise;
        return { isCurrent: () => current, release };
      } });
      try {
        const attempt = f.service.submit(f.caller, f.request);
        await entered.promise;
        if (retiring) await f.host.sessions.beginRetirement(f.ref, () => true);
        else current = false;
        resume.resolve(undefined);
        await expect(attempt).rejects.toMatchObject({ code: retiring ? "conflict" : "unauthorized" });
        expect(release).toHaveBeenCalledOnce();
        expect(f.rows.size).toBe(0);
      } finally {
        resume.resolve(undefined);
        await f.host.release();
      }
    }
  });

  it("keeps the leased row unchanged when result validation, registration, attempt or deadline checks fail", async () => {
    const f = await workFixture();
    try {
      const { id } = await f.service.submit(f.caller, f.request);
      const { worker, execution } = f.lease(id);
      const row = f.rows.get(id);
      const agent = f.agents.get(worker.agent.registrationId);
      if (!row?.lease || !agent) throw new Error("Missing lease fixture.");
      const settle = vi.spyOn(f.host.work, "settle");
      await expect(f.service.complete(worker, execution, { result: [] as unknown as JsonObject })).rejects.toMatchObject({ code: "invalid" });
      expect(settle).not.toHaveBeenCalled();
      await expect(f.service.complete(worker, { ...execution, attempt: 2 }, { result: {} })).rejects.toMatchObject({ code: "conflict" });
      await expect(f.service.complete({ ...worker, executionEpoch: "3" }, execution, { result: {} })).rejects.toMatchObject({ code: "conflict" });
      f.agents.set(agent.id, { ...agent, enabled: false });
      await expect(f.service.fail(worker, execution, { retryable: false })).rejects.toMatchObject({ code: "conflict" });
      expect(f.rows.get(id)).toEqual(row);
      f.agents.set(agent.id, agent);
      const expired = { ...row, lease: { ...row.lease, expiresAt: new Date(0).toISOString() } };
      f.rows.set(id, expired);
      await expect(f.service.complete(worker, execution, { result: {} })).rejects.toMatchObject({ code: "conflict" });
      expect(f.rows.get(id)).toEqual(expired);
    } finally {
      await f.host.release();
    }
  });
});

describe("protected work reads and legacy session disposal", () => {
  it("checks the original instance at delivery for a repository-backed read and strips its private fields", async () => {
    const uri = "ahp-session:/instance";
    const original = randomUUID();
    const item: WorkItemRecord = { id: randomUUID(), sessionUri: uri, sessionInstanceId: original, requestKey: "private-key", kind: "review",
      input: {}, status: "leased", leaseAgentId: "private-agent", leaseToken: "private-token", attemptCount: 1, maxAttempts: 3,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
    const get = vi.fn(() => Promise.resolve(item));
    let current: string = original;
    const port = createWorkReadPort({ sessions: createSessionOwnerRegistry(), repository: { get, hasDependentWork: vi.fn() },
      currentInstance: (session, instance, owner, domain) => session === uri && instance === current && owner === "alice" && domain === "trusted" });
    const guard = vi.fn<(check: () => boolean) => void>();
    const actor = { subject: "alice" };
    const reply = await port.get(actor, item.id, "trusted", guard);
    expect(get).toHaveBeenCalledWith({ workId: item.id, domainId: "trusted", principalSubject: "alice" });
    expect(reply).toMatchObject({ id: item.id, status: "leased" });
    for (const secret of ["private-key", "private-agent", "private-token"]) expect(JSON.stringify(reply)).not.toContain(secret);
    expect(guard.mock.calls[0]?.[0]()).toBe(true);
    current = randomUUID();
    expect(guard.mock.calls[0]?.[0]()).toBe(false);
    await expect(port.get(actor, item.id, "trusted")).resolves.toBeNull();
  });

  it("guards canonical replies by exact instance and live connection and redacts the stored lease", async () => {
    const f = await workFixture();
    try {
      const { id } = await f.service.submit(f.caller, f.request);
      const { execution } = f.lease(id);
      const principal = { subject: f.session.owner };
      const repository = { get: vi.fn(), hasDependentWork: vi.fn() };
      let instance = f.ref.instanceId;
      let connected = true;
      const port = createWorkReadPort({ sessions: createSessionOwnerRegistry(), repository, canonicalGet: f.host.work.get.bind(f.host.work),
        currentInstance: (uri, exact, subject, domain) => uri === f.ref.id && exact === instance && subject === principal.subject && domain === f.ref.domainId });
      const handler = createAgentWorkExtension({ work: port }).handlers["x-ahp/work/get"];
      if (!handler) throw new Error("Missing work read handler.");
      const guard = vi.fn<(check: () => boolean) => void>();
      const call = (read: typeof handler) => read({ version: 1, workId: id }, {
        connectionId: "reader", principal, isSecurityCurrent: () => connected,
        security: { context: f.caller.context, fence: { connectionId: "reader", connectionGeneration: 1 }, scopes: [], allowGlobalSequence: true, validUntil: Date.now() + 10000 },
        send: () => true, onClose() {}, close() {},
      }, { kind: "request", onReplySettled() {}, guardReply: guard });
      const reply = await call(handler);
      expect(reply).toMatchObject({ work: { id, session: f.ref, status: "leased" } });
      for (const secret of [execution.leaseToken, "leaseToken", "leaseAgentId", "executionEpoch", "submittedData"]) {
        expect(JSON.stringify(reply)).not.toContain(secret);
      }
      expect(await port.get({ subject: "foreign" }, id, f.ref.domainId)).toBeNull();
      expect(await port.get(principal, id, "foreign")).toBeNull();
      expect(repository.get).not.toHaveBeenCalled();
      expect(guard).toHaveBeenCalledOnce();
      const check = guard.mock.calls[0]?.[0];
      expect(check?.()).toBe(true);
      instance = "replacement";
      expect(check?.()).toBe(false);
      expect(await port.get(principal, id, f.ref.domainId)).toBeNull();
      instance = f.ref.instanceId;
      connected = false;
      expect(check?.()).toBe(false);
      connected = true;
      const wrapped = createAgentWorkExtension({ work: { get: (actor, workId, domain) => port.get(actor, workId, domain) } }).handlers["x-ahp/work/get"];
      if (!wrapped) throw new Error("Missing wrapped work read handler.");
      await expect(call(wrapped)).rejects.toThrow();
    } finally {
      await f.host.release();
    }
  });

  it("validates disposal text before lookup and refuses a session with dependent work", async () => {
    const hasDependentWork = vi.fn(() => Promise.resolve(false));
    const port = createWorkReadPort({ sessions: createSessionOwnerRegistry(), repository: { get: vi.fn(), hasDependentWork } });
    for (const uri of ["ahp-session:/bad\u0000", "ahp-session:/\ud800"]) {
      await expect(port.assertSessionDisposable(uri)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(hasDependentWork).not.toHaveBeenCalled();
    const uri = "ahp-session:/work";
    hasDependentWork.mockResolvedValueOnce(true);
    await expect(port.assertSessionDisposable(uri)).rejects.toMatchObject({ code: "conflict" });
    await expect(port.assertSessionDisposable(uri)).resolves.toBeUndefined();
    expect(hasDependentWork.mock.calls).toEqual([[uri], [uri]]);
  });

  it("preserves the existing owner on a conflicting bind and releases ownership on unbind or clear", () => {
    const owners = createSessionOwnerRegistry();
    const uri = "ahp-session:/work";
    owners.bind(uri, "alice");
    owners.bind(uri, "alice");
    expect(() => {
      owners.bind(uri, "bob");
    }).toThrow(WorkError);
    expect(owners.owner(uri)).toBe("alice");
    owners.unbind(uri);
    expect(owners.owner(uri)).toBeUndefined();
    owners.bind(uri, "bob");
    owners.clear();
    expect(owners.owner(uri)).toBeUndefined();
  });
});

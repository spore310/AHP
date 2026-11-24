import { openWorkClient } from "../../../examples/advanced/work";
import { ACTION_TYPE_SESSION_READY } from "@sessions/constants";
import { TOOL_CONTRACT_META_KEY } from "@tool";
import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import { createMemoryDurableStorage } from "@persistence";
import type { ProviderSessionInput, RuntimeResourceDriver, SessionProvider } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { actorFor, channel, createReviewHost, reviewWorkerKey } from "../../../examples/advanced/host";
import { approveRestore, observableStorage, sessionHost } from "./durableFixture";

describe("session recovery", () => {
  it.each(["approval", "driver", "provider", "type", "child-owner"] as const)("P0-08 suspends an instance with missing or mismatched %s", async (reason) => {
    const w = observableStorage((host) => ({ ...host,
      sessions: { ...host.sessions, async listRecoverable(after) {
        const rows = await host.sessions.listRecoverable(after);
        return reason === "type" ? rows.map((row) => ({ ...row, type: { ...row.type, version: row.type.version + 1 } })) : rows;
      } },
      resources: { ...host.resources, async listSession(ref) {
        const rows = await host.resources.listSession(ref);
        return reason === "child-owner" ? rows.map((row) => row.ref.kind === "session" ? row : { ...row, owner: "wrong" }) : rows;
      } },
    }));
    let input: ProviderSessionInput | undefined;
    const driver: RuntimeResourceDriver = { key: "driver", version: 1, kind: "chat", captureRecoveryInput: () => ({}),
      ensure: () => Promise.resolve({ metadata: {}, release() {} }), restore: () => Promise.reject(new Error("private driver detail")), destroy: () => Promise.resolve() };
    const provider: SessionProvider = { ...mockProvider, drivers: [driver], startSession: (v) => {
      input = v;
      return Promise.resolve({ dispose() {} });
    } };
    const restore = vi.fn(mockProvider.restoreSession?.bind(mockProvider));
    const one = sessionHost(w.storage, provider);
    const two = createReviewHost("direct", { durability: { hostId: "test", storage: w.storage },
      provider: { ...provider, restoreSession: restore, ...(reason === "driver" ? { drivers: [] } : {}), ...(reason === "provider" ? { recovery: { version: 2, capture: () => ({}) } } : {}) },
      ...(reason === "approval" ? {} : { restoration: approveRestore }) });
    try {
      await one.host.start();
      await one.provision();
      assert.ok(input?.resources);
      await input.resources.create({ kind: "chat", id: "chat", driver, parent: one.origin() });
      await one.stop();
      await two.host.start();
      expect(two.host.sessions.durability?.inspect()).toEqual([{ session: one.origin(), reason: "Check exact type, provider, drivers and restoration approval." }]);
      expect(two.host.sessions.authorization?.getResource(channel)).toBeUndefined();
      expect(two.host.sessions.authorization?.isReady(one.origin())).toBe(false);
      expect(two.host.sessions.getSessionToolManifest(channel)).toBeUndefined();
      expect(restore).not.toHaveBeenCalled();
      expect((await w.current().sessions.get(one.origin()))?.lifecycle).toBe("suspended");
    } finally {
      await one.stop();
      await two.stop();
    }
  });

  it("P0-07/23/24 captures exact callbacks and recovers stable state with new handles", async () => {
    const w = observableStorage();
    let input: ProviderSessionInput | undefined;
    let backends = 0;
    const invoked: string[] = [];
    const driver: RuntimeResourceDriver = { kind: "chat", key: "driver", version: 1, captureRecoveryInput: () => ({}),
      ensure: () => Promise.resolve({ metadata: {}, release() {} }),
      restore() {
        invoked.push(this.key);
        return Promise.resolve({ metadata: {}, release() {} });
      },
      destroy() {
        invoked.push(this.key);
        return Promise.resolve();
      } };
    const config = { version: 1, capture() {
      invoked.push("codec");
      return { v: this.version };
    } };
    const provider = { ...mockProvider, drivers: [driver], recovery: config,
      startSession(v: ProviderSessionInput) {
        input = v;
        backends++;
        return Promise.resolve({ dispose() {} });
      },
      restoreSession(v: ProviderSessionInput) {
        input = v;
        backends++;
        invoked.push(this.providerId);
        return Promise.resolve({ dispose() {} });
      },
      retireSession() {
        invoked.push(this.providerId);
        return Promise.resolve();
      } };
    const one = sessionHost(w.storage, provider);
    const two = createReviewHost("direct", { durability: { storage: w.storage, hostId: "test" }, provider,
      restoration: { prepare: ({ session }) => Promise.resolve({ isCurrent: () => true, bindings: [{
        id: "fresh", actor: actorFor("senior"), scope: session.ref, roles: ["discover"], revision: 1, policies: [{ id: "example.review-access", revision: 1 }],
        authority: { kind: "host-policy", policy: { id: "example.review-access", revision: 1 } },
      }] }) } });
    const clients: Awaited<ReturnType<typeof openWorkClient>>[] = [];
    const unexpected = (): never => {
      throw new Error("Mutated registration called");
    };
    provider.drivers.length = 0;
    provider.restoreSession = unexpected;
    provider.retireSession = unexpected;
    config.capture = unexpected;
    try {
      const address = await one.host.start();
      const oldPeer = await openWorkClient("ws://127.0.0.1:" + String(address.port), "junior", "old-peer");
      clients.push(oldPeer);
      expect(await oldPeer.request("x-ahp/agents/register", { agentKey: reviewWorkerKey })).toHaveProperty("agentId");
      await one.provision(["file:///approved"]);
      assert.ok(input?.resources);
      const child = await input.resources.create({ kind: "chat", id: "chat", driver, parent: one.origin() });
      await input.resources.replaceData(child, { expectedDataRevision: "1", data: { nested: ["雪", {}] } });
      for (const action of [{ type: "session/titleChanged", title: "recovered" }, { type: "session/isReadChanged", isRead: true }, { type: "session/isArchivedChanged", isArchived: true }]) {
        await one.host.sessions.dispatchAction({ channel, clientId: "old", clientSeq: 1, action });
      }
      const subject = { actor: actorFor("senior"), scope: one.origin() };
      expect(one.registry.readBindings(subject).bindings.map((b) => b.id)).toContain("demo-senior");
      const manifest = one.host.sessions.getSessionToolManifest(channel);
      assert.ok(manifest?.toolContracts[0]);
      const tool = manifest.toolContracts[0];
      const ad = await one.host.sessions.dispatchAction({ channel, clientId: "old", clientSeq: 4, action: { type: "session/activeClientSet", activeClient: { clientId: "old", tools: [{
        ...tool.definition, _meta: { [TOOL_CONTRACT_META_KEY]: { id: tool.id, key: tool.key, version: tool.version } },
      }] } } });
      expect(ad.rejectionReason).toBeUndefined();
      expect(one.host.sessions.getSessionSnapshot(channel)?.state.activeClients[0]?.tools).toHaveLength(1);
      await one.stop();
      const recoveredAddress = await two.host.start();
      expect(() => one.connection("junior")).toThrow();
      const newPeer = await openWorkClient("ws://127.0.0.1:" + String(recoveredAddress.port), "junior", "new-peer");
      clients.push(newPeer);
      await expect(newPeer.request("x-ahp/agents/renew", {})).rejects.toThrow();
      expect(two.host.sessions.authorization?.getResource(channel)).toEqual(one.origin());
      expect(two.host.sessions.getSessionSnapshot(channel)?.state).toMatchObject({ title: "recovered", status: 97, workingDirectories: ["file:///approved"], activeClients: [] });
      expect(two.registry.readBindings(subject).bindings.map((b) => b.id)).toEqual(["fresh"]);
      expect(await input.resources.readData(child)).toEqual({ dataRevision: "2", data: { nested: ["雪", {}] } });
      await two.host.sessions.authorization?.disposeSession(one.origin());
      expect(backends).toBe(2);
      expect(invoked).toEqual(["codec", "mock", "driver", "driver", "mock"]);
    } finally {
      await Promise.allSettled(clients.map((peer) => peer.connection.shutdown()));
      await one.stop();
      await two.stop();
    }
  });

  it("P0-20 orders work-ready hints after parked durable native commits", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let park = false;
    const w = observableStorage((h) => ({ ...h, sessions: { ...h.sessions, async commitState(write, admit) {
      if (park) {
        entered.resolve(undefined);
        await release.promise;
      }
      return h.sessions.commitState(write, admit);
    } } }));
    const demo = sessionHost(w.storage);
    try {
      await demo.host.start();
      await demo.provision();
      // Drain the creation's asynchronous count notification.
      await demo.host.sessions.durability?.publishWorkReady(() => undefined);
      const observed: number[] = [];
      demo.host.sessions.onSessionEnvelope((e) => {
        observed.push(e.serverSeq);
      });
      park = true;
      const action = demo.host.sessions.dispatchAction({ channel, clientId: "local", clientSeq: 1, action: { type: "session/titleChanged", title: "ordered" } });
      await entered.promise;
      const hint = demo.host.sessions.durability?.publishWorkReady((seq) => {
        observed.push(seq);
      });
      expect(observed).toEqual([]);
      release.resolve(undefined);
      await Promise.all([hint, action]);
      expect(observed).toHaveLength(2);
      expect(observed[1]).toBeGreaterThan(observed[0] ?? Infinity);
    } finally {
      release.resolve(undefined);
      await demo.stop();
    }
  });
  it("P0-06 releases a backend arriving after host stop and retains the creating row", async () => {
    const w = observableStorage();
    const entered = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const dispose = vi.fn();
    const demo = sessionHost(w.storage, { ...mockProvider, async startSession() {
      entered.resolve(undefined);
      await resume.promise;
      return { dispose };
    } });
    try {
      await demo.host.start();
      const create = demo.provision().catch(() => undefined);
      await entered.promise;
      const ready = vi.fn<(envelope: import("@microsoft/agent-host-protocol").ActionEnvelope) => void>();
      demo.host.sessions.onSessionEnvelope(ready);
      await demo.stop();
      resume.resolve(undefined);
      await create;
      await vi.waitFor(() => {
        expect(dispose).toHaveBeenCalledOnce();
      });
      const store = await w.storage.acquire("test", () => undefined);
      try {
        expect(await store.sessions.listRecoverable()).toMatchObject([{ lifecycle: "creating" }]);
      } finally {
        await store.release();
      }
      expect(ready.mock.calls.flat().filter((e) => e.action.type === ACTION_TYPE_SESSION_READY)).toHaveLength(0);
    } finally {
      resume.resolve(undefined);
      await demo.stop();
    }
  });
  it("P0-12/13 resumes retirement after driver failure and isolates a reused URI", async () => {
    const storage = createMemoryDurableStorage();
    let fail = true;
    let input: ProviderSessionInput | undefined;
    const destroy = vi.fn(() => fail ? Promise.reject(new Error("private cleanup detail")) : Promise.resolve());
    const driver = { key: "chat", version: 1, kind: "chat", captureRecoveryInput: () => ({}), ensure: () => Promise.resolve({ metadata: {}, release() {} }),
      restore: () => Promise.resolve({ metadata: {}, release() {} }), destroy };
    const provider = { ...mockProvider, drivers: [driver], startSession(v: ProviderSessionInput) {
      input = v;
      return Promise.resolve({ dispose() {} });
    } };
    const one = sessionHost(storage, provider), two = sessionHost(storage, provider);
    try {
      await one.host.start();
      await one.provision();
      assert.ok(input?.resources);
      const old = input.resources;
      await old.create({ kind: "chat", id: "chat", driver, parent: one.origin() });
      await expect(one.host.sessions.authorization?.disposeSession(one.origin())).rejects.toThrow("retry");
      fail = false;
      await one.stop();
      await two.host.start();
      expect(two.host.sessions.getSessionSnapshot(channel)).toBeUndefined();
      await two.provision();
      expect(two.origin().instanceId).not.toBe(one.origin().instanceId);
      expect(await input.resources.readData(two.origin())).toEqual({ dataRevision: "1", data: {} });
      await expect(old.replaceData(one.origin(), { expectedDataRevision: "1", data: { stale: true } })).rejects.toThrow();
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      await one.stop();
      await two.stop();
    }
  });
});

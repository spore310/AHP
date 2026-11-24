import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import { createMemoryDurableStorage } from "@persistence";
import { mockProvider } from "@sessions/mock";
import type { ProviderSessionInput, RuntimeResourceDriver, SessionProvider } from "@sessions";
import { actorFor, channel } from "../../../examples/advanced/host";

import { observableStorage, sessionHost } from "./durableFixture";

describe("durable lifecycle", () => {
  it("P0-01/02 reserves before authority, backend and publication", async () => {
    const provider = { ...mockProvider, startSession: vi.fn(mockProvider.startSession.bind(mockProvider)) };
    let fail = true;
    const wrapped = observableStorage((h) => ({ ...h, sessions: { ...h.sessions, reserve: (s, r, admit) => h.sessions.reserve(s, r, () => !fail && admit()) } }));
    const demo = sessionHost(wrapped.storage, provider);
    const events = vi.fn();
    demo.host.sessions.onCatalogueNotification(events);
    try {
      await demo.host.start();
      await expect(demo.provision()).rejects.toThrow();
      expect(events).not.toHaveBeenCalled();
      expect(provider.startSession).not.toHaveBeenCalled();
      expect(demo.host.sessions.authorization?.getResource(channel)).toBeUndefined();
      expect(await wrapped.current().sessions.listRecoverable()).toHaveLength(0);
      fail = false;
      const pair = await Promise.allSettled([demo.provision(), demo.provision()]);
      expect(pair.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(provider.startSession).toHaveBeenCalledTimes(1);
      const rows = await wrapped.current().sessions.listRecoverable();
      expect(rows).toHaveLength(1);
      expect(await wrapped.current().resources.listSession(demo.origin())).toHaveLength(1);
    } finally { await demo.stop(); }
  });
  it("P0-03/04 commits once before live acceptance and rejects an obsolete staged action", async () => {
    let fail = false;
    const wrapped = observableStorage((h) => ({ ...h, sessions: { ...h.sessions, commitState: (w, a) => h.sessions.commitState(w, () => !fail && a()) } }));
    const demo = sessionHost(wrapped.storage);
    try {
      await demo.host.start();
      await demo.provision();
      const sessions = demo.host.sessions;
      const before = await wrapped.current().sessions.get(demo.origin());
      const snapshot = sessions.getSessionSnapshot(channel);
      const events = vi.fn();
      sessions.onSessionEnvelope(events);
      const rename = (title: string) => sessions.dispatchAction({ channel, clientId: "local", clientSeq: 1, action: { type: "session/titleChanged", title } });
      fail = true;
      await expect(rename("rollback")).rejects.toThrow();
      expect(await wrapped.current().sessions.get(demo.origin())).toEqual(before);
      expect(sessions.getSessionSnapshot(channel)).toEqual(snapshot);
      expect(events).not.toHaveBeenCalled();
      fail = false;
      const [first, stale] = await Promise.all([rename("one"), rename("two")]);
      expect(first.rejectionReason).toBeUndefined();
      expect(stale.rejectionReason).toBeTruthy();
      expect(events).toHaveBeenCalledTimes(1);
      expect(sessions.getSessionSnapshot(channel)?.state.title).toBe("one");
      assert.ok(before);
      expect((await wrapped.current().sessions.get(demo.origin()))?.stateRevision).toBe(String(BigInt(before.stateRevision) + 1n));
    } finally { await demo.stop(); }
  });

  it("P0-05/06/07 reconciles a child created externally before its receipt; releases late handles", async () => {
    const storage = createMemoryDurableStorage();
    const entered = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const backing = new Set<string>();
    const released = vi.fn();
    let calls = 0;
    let input: ProviderSessionInput | undefined;
    const driver: RuntimeResourceDriver = { key: "chat", version: 1, kind: "chat", captureRecoveryInput: () => ({}),
      async ensure(ctx) {
        backing.add(ctx.operationId);
        calls++;
        if (calls === 1) {
          entered.resolve(undefined);
          await resume.promise;
        }
        return { metadata: {}, release: released };
      }, restore: () => Promise.reject(new Error("Interrupted ensure needs its original key.")), destroy: () => Promise.resolve() };
    const provider: SessionProvider = { ...mockProvider, drivers: [driver], startSession: (v) => {
      input = v;
      return Promise.resolve({ dispose() {} });
    },
    restoreSession: (v) => {
      input = v;
      return Promise.resolve({ dispose() {} });
    } };
    const demo = sessionHost(storage, provider);
    const other = sessionHost(storage, provider);
    try {
      await demo.host.start();
      await demo.provision();
      assert.ok(input?.resources);
      const old = input.resources;
      const creating = old.create({ kind: "chat", id: "child", driver, parent: demo.origin() });
      const rejected = expect(creating).rejects.toThrow();
      await entered.promise;
      await demo.stop();
      await rejected;
      expect(released).not.toHaveBeenCalled();
      resume.resolve(undefined);
      await vi.waitFor(() => {
        expect(released).toHaveBeenCalledTimes(1);
      });
      await other.host.start();
      expect(other.host.sessions.authorization?.getResource(channel)).toEqual(demo.origin());
      expect(calls).toBe(2);
      expect(backing.size).toBe(1);
      expect(input.resources).not.toBe(old);
      await expect(old.readData(demo.origin())).rejects.toThrow();
    } finally {
      resume.resolve(undefined);
      await demo.stop();
      await other.stop();
    }
  });
  it("P0-19 keeps a timed-out driver's slot until actual settlement", async () => {
    const wait = Promise.withResolvers<undefined>();
    let input: ProviderSessionInput | undefined;
    const ensure = vi.fn(async () => {
      await wait.promise;
      return { metadata: {}, release() {} };
    });
    const driver = { kind: "chat", key: "chat", version: 1, captureRecoveryInput: () => ({}), ensure, restore: ensure, destroy: () => Promise.resolve() };
    const demo = sessionHost(createMemoryDurableStorage(), { ...mockProvider, drivers: [driver], startSession: (v) => {
      input = v;
      return Promise.resolve({ dispose() {} });
    } },
    { maxCallbacks: 1, callbackDeadlineMs: 40 });
    try {
      await demo.host.start();
      await demo.provision();
      assert.ok(input?.resources);
      const resources = input.resources;
      const create = (id: string) => resources.create({ kind: "chat", id, driver, parent: demo.origin() });
      await expect(create("hanging")).rejects.toThrow();
      await expect(create("busy")).rejects.toThrow();
      expect(ensure).toHaveBeenCalledTimes(1);
      wait.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(create("free")).resolves.toMatchObject({ id: "free" });
    } finally {
      wait.resolve(undefined);
      await demo.stop();
    }
  });
  it("P0-06 fences child installation when a retirement beats the activation acknowledgement", async () => {
    const committed = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const w = observableStorage((h) => ({ ...h, resources: { ...h.resources, async activate(i, a) {
      await h.resources.activate(i, a);
      committed.resolve(undefined);
      await resume.promise;
    } } }));
    const release = vi.fn();
    let input: ProviderSessionInput | undefined;
    let ref: import("@authorization").ResourceRef | undefined;
    const driver: RuntimeResourceDriver = { key: "driver", version: 1, kind: "chat", captureRecoveryInput: () => ({}),
      ensure(ctx) {
        ref = ctx.resource;
        return Promise.resolve({ metadata: {}, release });
      }, restore: () => Promise.reject(new Error()), destroy: () => Promise.resolve() };
    const demo = sessionHost(w.storage, { ...mockProvider, drivers: [driver], startSession(v) {
      input = v;
      return Promise.resolve({ dispose() {} });
    } });
    try {
      await demo.host.start();
      await demo.provision();
      assert.ok(input?.resources);
      const request = input.resources.create({ kind: "chat", id: "late", driver, parent: demo.origin() });
      await committed.promise;
      assert.ok(ref);
      await input.resources.retire(ref);
      resume.resolve(undefined);
      await expect(request).rejects.toThrow();
      expect(release).toHaveBeenCalledOnce();
      expect((await w.current().resources.get(ref))?.lifecycle).toBe("retired");
    } finally {
      resume.resolve(undefined);
      await demo.stop();
    }
  });
  it("P0-19 releases an unrelated live backend while a child callback occupies the last provision slot", async () => {
    let input: ProviderSessionInput | undefined;
    const parked = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const release = vi.fn();
    const dispose = vi.fn();
    const ensure = async () => {
      entered.resolve(undefined);
      await parked.promise;
      return { metadata: {}, release };
    };
    const driver = { kind: "chat", key: "chat", version: 1, captureRecoveryInput: () => ({}), ensure, restore: ensure, destroy: () => Promise.resolve() };
    const demo = sessionHost(createMemoryDurableStorage(), { ...mockProvider, drivers: [driver], startSession(v) {
      input = v;
      return Promise.resolve({ dispose });
    } }, { maxCallbacks: 1 });
    try {
      await demo.host.start();
      await demo.provision();
      assert.ok(input?.resources);
      const rejected = expect(input.resources.create({ kind: "chat", id: "parked", driver, parent: demo.origin() })).rejects.toThrow();
      await entered.promise;
      await demo.stop();
      await rejected;
      expect(dispose).toHaveBeenCalledOnce();
      expect(release).not.toHaveBeenCalled();
      parked.resolve(undefined);
      await vi.waitFor(() => {
        expect(release).toHaveBeenCalledOnce();
      });
    } finally {
      parked.resolve(undefined);
      await demo.stop();
    }
  });
  it("retains one disposal marker until the exact session's retirement settles", async () => {
    const entered = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    let retirements = 0;
    const w = observableStorage((h) => ({ ...h, sessions: { ...h.sessions, async beginRetirement(ref, admit) {
      const rows = await h.sessions.beginRetirement(ref, admit);
      if (++retirements === 1) {
        entered.resolve(undefined);
        await resume.promise;
      }
      return rows;
    } } }));
    const demo = sessionHost(w.storage);
    let first: Promise<boolean> | undefined;
    try {
      await demo.host.start();
      await demo.provision();
      const original = demo.origin();
      const auth = demo.host.sessions.authorization;
      assert.ok(auth);
      first = auth.disposeSession(original);
      await entered.promise;
      expect(await auth.disposeSession(original)).toBe(false);
      expect(retirements).toBe(1);
      expect(auth.isSettling(channel)).toBe(true);
      await expect(demo.provision()).rejects.toThrow();
      resume.resolve(undefined);
      expect(await first).toBe(true);
      await demo.provision();
      expect(demo.origin().instanceId).not.toBe(original.instanceId);
      expect(auth.isReady(demo.origin())).toBe(true);
    } finally {
      resume.resolve(undefined);
      await first?.catch(() => undefined);
      await demo.stop();
    }
  });
  it("withdraws a failed ready publication and frees the sequence while backend cleanup is pending", async () => {
    const cleaning = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const w = observableStorage((h) => ({ ...h, sessions: { ...h.sessions,
      commitState() { return Promise.reject(new Error("Ready state commit failed")); },
    } }));
    const demo = sessionHost(w.storage, { ...mockProvider, startSession: () => Promise.resolve({
      dispose() {
        cleaning.resolve(undefined);
        return resume.promise;
      },
    }) });
    let creating: Promise<void> | undefined;
    try {
      await demo.host.start();
      creating = demo.provision().catch(() => undefined);
      await cleaning.promise;
      expect(demo.host.sessions.authorization?.getResource(channel)).toBeUndefined();
      expect(demo.host.sessions.getSessionSnapshot(channel)).toBeUndefined();
      const publish = vi.fn();
      await demo.host.sessions.durability?.publishWorkReady(publish);
      expect(publish).toHaveBeenCalledOnce();
    } finally {
      resume.resolve(undefined);
      await creating;
      await demo.stop();
    }
  });
  it.each(["state", "retirement"])("withdraws authority on an uncertain %s commit and reconciles on restart", async (command) => {
    let armed = false;
    function unknown() {
      const error = new Error("lost acknowledgement");
      error.name = "DurableCommitUncertain";
      throw error;
    }
    const w = observableStorage((h) => ({ ...h, sessions: { ...h.sessions,
      async commitState(i, a) {
        const revision = await h.sessions.commitState(i, a);
        if (armed) unknown();
        return revision;
      },
      async beginRetirement(s, a) {
        const rows = await h.sessions.beginRetirement(s, a);
        if (armed) unknown();
        return rows;
      },
    } }));
    const demo = sessionHost(w.storage), recovered = sessionHost(w.storage);
    try {
      await demo.host.start();
      await demo.provision();
      const original = demo.origin();
      armed = true;
      const write = command === "state"
        ? demo.host.sessions.dispatchAction({ channel, clientId: "x", clientSeq: 1, action: { type: "session/titleChanged", title: "committed" } })
        : demo.host.sessions.authorization?.disposeSession(original);
      await expect(write).rejects.toThrow();
      expect(demo.host.sessions.getSessionSnapshot(channel)).toBeUndefined();
      expect(demo.host.sessions.authorization?.isReady(original)).toBe(false);
      armed = false;
      await demo.stop();
      await recovered.host.start();
      if (command === "state") expect(recovered.host.sessions.getSessionSnapshot(channel)?.state.title).toBe("committed");
      else expect((await w.current().sessions.get(original))?.lifecycle).toBe("retired");
    } finally {
      await demo.stop();
      await recovered.stop();
    }
  });
  it("P0-11/21 fences data CAS and cancels positive anchors across grant parents", async () => {
    const work = new Map<string, import("@persistence/helpers/durability/workTypes").StoredWork>();
    const storage = createMemoryDurableStorage(work);
    let input: ProviderSessionInput | undefined;
    const driver = { key: "chat", version: 1, kind: "chat", captureRecoveryInput: () => ({}), ensure: () => Promise.resolve({ metadata: {}, release() {} }),
      restore: () => Promise.resolve({ metadata: {}, release() {} }), destroy: () => Promise.resolve() };
    const demo = sessionHost(storage, { ...mockProvider, drivers: [driver], startSession(v) {
      input = v;
      return Promise.resolve({ dispose() {} });
    } });
    try {
      await demo.host.start();
      await demo.provision();
      assert.ok(input?.resources);
      const resources = input.resources;
      const root = demo.origin();
      const parent = await resources.create({ kind: "chat", id: "parent", parent: root, grantParent: root, driver });
      const nested = await resources.create({ kind: "chat", id: "dependent", parent: root, grantParent: parent, driver });
      const events = vi.fn();
      demo.host.sessions.onSessionEnvelope(events);
      const change = { expectedDataRevision: "1", data: { list: ["雪", {}] } };
      await expect(resources.replaceData(nested, change, () => false)).rejects.toThrow();
      expect((await resources.readData(nested)).dataRevision).toBe("1");
      const first = resources.replaceData(nested, change);
      change.data.list.length = 0;
      const second = resources.replaceData(nested, { expectedDataRevision: "1", data: {} });
      expect((await Promise.all([first, second])).map((x) => x.status)).toEqual(["updated", "conflict"]);
      expect(await resources.readData(nested)).toEqual({ dataRevision: "2", data: { list: ["雪", {}] } });
      expect(events).not.toHaveBeenCalled();
      const job = { id: "leased", session: root, requestKey: "review", kind: "review", input: {}, data: {}, submittedData: {}, priority: 0, targetAgentId: null,
        maxAttempts: 3, attemptCount: 1, owner: "owner", submitter: { kind: "user" as const, principal: { domainId: root.domainId, subject: "owner" } },
        revision: "2", dataRevision: "1", createdAt: "2020-01-01", updatedAt: "2020-01-01", announce: [],
        scope: [{ resource: nested, include: true, includeDescendants: false }], status: "leased" as const,
        lease: { registrationId: "test", executionEpoch: "1", attempt: 1, leaseToken: "test", expiresAt: "2030-01-01" } };
      work.set("leased", job);
      const dynamic = { ...job, id: "dynamic", lease: undefined, status: "queued" as const, scope: [{ resource: root, include: true, includeDescendants: true }] };
      work.set("dynamic", dynamic);
      work.set("announce", { ...dynamic, id: "announce", announce: [{ resource: nested, include: true, includeDescendants: false }] });
      await resources.retire(parent);
      expect(work.get("leased")?.status).toBe("cancelled");
      expect(work.get("leased")?.lease).toBeUndefined();
      expect(work.get("dynamic")?.status).toBe("queued");
      expect(work.get("announce")?.status).toBe("queued");
      await expect(resources.readData(nested)).rejects.toThrow();
      await expect(resources.replaceData(nested, { expectedDataRevision: "2", data: {} })).rejects.toThrow();
      expect(await resources.readData(root)).toMatchObject({ dataRevision: "1" });
    } finally { await demo.stop(); }
  });
  it("releases every ready session with one cleanup slot", async () => {
    const disposed: string[] = [];
    const demo = sessionHost(createMemoryDurableStorage(), { ...mockProvider, startSession(input) {
      return Promise.resolve({ dispose() {
        disposed.push(input.sessionUri);
      } });
    } }, { maxCallbacks: 1 });
    try {
      await demo.host.start();
      await demo.provision();
      const other = "ahp-session:/second";
      const context = { actor: actorFor("senior"), connectionId: "trusted", authRevision: "one" };
      await demo.host.sessions.authorization?.createSession({ channel: other }, { context, connectionId: context.connectionId, connectionGeneration: 1,
        validUntil: Date.now() + 30000, signal: new AbortController().signal, isCurrent: () => true });
      await demo.stop();
      expect(disposed).toEqual([channel, other]);
    } finally { await demo.stop(); }
  });
});

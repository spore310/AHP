import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import type { ResourceRef } from "@authorization";
import type { ProviderSessionInput, RuntimeResourceDriver } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { actorFor, channel, createReviewHost } from "../../../examples/advanced/host";
import { observableStorage, sessionHost } from "./durableFixture";

function resourceDriver(overrides: Partial<RuntimeResourceDriver> = {}): RuntimeResourceDriver {
  return { kind: "chat", key: "chat", version: 1, captureRecoveryInput: () => ({}),
    ensure: () => Promise.resolve({ metadata: {}, release() {} }),
    restore: () => Promise.resolve({ metadata: {}, release() {} }),
    destroy: () => Promise.resolve(), ...overrides };
}

it("replays an interrupted session start with the exact child and a single process attachment", async () => {
  const store = observableStorage();
  const beforeReceipt = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const childRefs: ResourceRef[] = [];
  const backing = new Set<string>();
  const restore = vi.fn<RuntimeResourceDriver["restore"]>((ctx) => {
    assert.ok(backing.has(ctx.operationId));
    return Promise.resolve({ metadata: {}, release() {} });
  });
  const driver = resourceDriver({ ensure(ctx) {
    backing.add(ctx.operationId);
    return Promise.resolve({ metadata: {}, release() {} });
  }, restore });
  const provider = { ...mockProvider, drivers: [driver], async startSession(input: ProviderSessionInput) {
    assert.ok(input.resources && input.session);
    childRefs.push(await input.resources.create({ kind: "chat", id: "nested", parent: input.session, driver }));
    if (childRefs.length === 1) {
      beforeReceipt.resolve(undefined);
      await resume.promise;
    }
    return { dispose() {} };
  } };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    const provisioning = first.provision().catch(() => undefined);
    await beforeReceipt.promise;
    await first.stop();
    resume.resolve(undefined);
    await provisioning;
    await second.host.start();
    const session = second.host.sessions.authorization?.getResource(channel);
    assert.ok(session);
    expect(second.host.sessions.authorization?.isReady(session)).toBe(true);
    expect(childRefs).toEqual([childRefs[0], childRefs[0]]);
    expect(backing.size).toBe(1);
    expect(restore).toHaveBeenCalledOnce();
    expect(await store.current().resources.listSession(session)).toHaveLength(2);
  } finally {
    resume.resolve(undefined);
    await first.stop();
    await second.stop();
  }
});

it("reconciles a failed child without a receipt with its original operation key", async () => {
  const store = observableStorage();
  const attempts: string[] = [];
  const driver = resourceDriver({ ensure(ctx) {
    attempts.push(ctx.operationId);
    if (attempts.length === 1) return Promise.reject(new Error("Provisioning failed"));
    return Promise.resolve({ metadata: {}, release() {} });
  }, restore: () => Promise.reject(new Error("No backing resource exists")) });
  let context: ProviderSessionInput | undefined;
  const provider = { ...mockProvider, drivers: [driver], startSession(input: ProviderSessionInput) {
    context = input;
    return Promise.resolve({ dispose() {} });
  } };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    await first.provision();
    assert.ok(context?.resources && context.session);
    await expect(context.resources.create({ kind: "chat", id: "child", parent: context.session, driver })).rejects.toThrow();
    await first.stop();
    await second.host.start();
    expect(second.host.sessions.authorization?.isReady(first.origin())).toBe(true);
    expect(attempts).toEqual([attempts[0], attempts[0]]);
  } finally {
    await first.stop();
    await second.stop();
  }
});

it("shares an in-flight child attachment with the recovery scan", async () => {
  const store = observableStorage();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const ensure = vi.fn<RuntimeResourceDriver["ensure"]>(async () => {
    entered.resolve(undefined);
    await resume.promise;
    return { metadata: {}, release() {} };
  });
  const driver = resourceDriver({ ensure });
  let creation: Promise<ResourceRef | undefined> | undefined;
  const first = sessionHost(store.storage);
  const second = sessionHost(store.storage, { ...mockProvider, drivers: [driver], async restoreSession(input) {
    assert.ok(input.resources && input.session);
    creation = input.resources.create({ kind: "chat", id: "during-restore", parent: input.session, driver }).catch(() => undefined);
    await entered.promise;
    return { dispose() {} };
  } });
  try {
    await first.host.start();
    await first.provision();
    await first.stop();
    const startup = second.host.start();
    await entered.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    resume.resolve(undefined);
    await startup;
    expect(ensure).toHaveBeenCalledOnce();
    expect(await creation).toMatchObject({ id: "during-restore" });
    expect(second.host.sessions.authorization?.isReady(first.origin())).toBe(true);
  } finally {
    resume.resolve(undefined);
    await first.stop();
    await second.stop();
  }
});

it("closes resources and releases late child handles when parent provisioning fails", async () => {
  const store = observableStorage();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const release = vi.fn();
  let context: ProviderSessionInput | undefined;
  let pending: Promise<unknown> | undefined;
  let child: ResourceRef | undefined;
  const driver = resourceDriver({ async ensure(ctx) {
    child = ctx.resource;
    entered.resolve(undefined);
    await resume.promise;
    return { metadata: {}, release };
  } });
  const demo = sessionHost(store.storage, { ...mockProvider, drivers: [driver], async startSession(input) {
    assert.ok(input.resources && input.session);
    context = input;
    pending = input.resources.create({ kind: "chat", id: "child", parent: input.session, driver }).then(() => "attached", () => "unavailable");
    await entered.promise;
    throw new Error("Session failed");
  } });
  try {
    await demo.host.start();
    await demo.provision();
    assert.ok(child && context?.resources);
    resume.resolve(undefined);
    expect(await pending).toBe("unavailable");
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });
    expect((await store.current().resources.get(child))?.lifecycle).not.toBe("active");
    expect(demo.registry.owner(child)).toBeUndefined();
    await expect(context.resources.readData(child)).rejects.toThrow();
    await expect(context.resources.retire(child)).rejects.toThrow();
  } finally {
    resume.resolve(undefined);
    await demo.stop();
  }
});

it("continues an interrupted start that provisions a new child after a previous root failure", async () => {
  const store = observableStorage();
  let fail = true;
  const children: ResourceRef[] = [];
  const driver = resourceDriver();
  const provider = { ...mockProvider, drivers: [driver], async startSession(input: ProviderSessionInput) {
    assert.ok(input.session && input.resources);
    children.push(await input.resources.create({ kind: "chat", id: "first", parent: input.session, driver }));
    if (fail) throw new Error("Failed before second child");
    children.push(await input.resources.create({ kind: "chat", id: "second", parent: input.session, driver }));
    return { dispose() {} };
  } };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    await first.provision();
    expect((await store.current().sessions.get(first.origin()))?.lifecycle).toBe("failed");
    await first.stop();
    fail = false;
    await second.host.start();
    expect(second.host.sessions.authorization?.isReady(first.origin())).toBe(true);
    expect(children).toEqual([children[0], children[0], expect.objectContaining({ id: "second" })]);
    expect(await store.current().resources.listSession(first.origin())).toHaveLength(3);
  } finally {
    await first.stop();
    await second.stop();
  }
});

it("keeps a previously rejected child unavailable when its provisioning still fails", async () => {
  const store = observableStorage();
  const driver = resourceDriver({ ensure: () => Promise.reject(new Error("Unavailable")) });
  let context: ProviderSessionInput | undefined;
  const provider = { ...mockProvider, drivers: [driver], startSession(input: ProviderSessionInput) {
    context = input;
    return Promise.resolve({ dispose() {} });
  } };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    await first.provision();
    assert.ok(context?.resources);
    await expect(context.resources.create({ kind: "chat", id: "unused", parent: first.origin(), driver })).rejects.toThrow();
    await first.stop();
    await second.host.start();
    expect(second.host.sessions.authorization?.isReady(first.origin())).toBe(true);
    const child = (await store.current().resources.listSession(first.origin())).find((row) => row.ref.id === "unused");
    assert.ok(child);
    expect(child.lifecycle).toBe("failed");
    expect(second.registry.owner(child.ref)).toBeUndefined();
  } finally {
    await first.stop();
    await second.stop();
  }
});

it("finishes committed retirement after restart without restoring or issuing fresh grants", async () => {
  const store = observableStorage();
  let fail = true;
  const retire = vi.fn(() => fail ? Promise.reject(new Error("Retry")) : Promise.resolve());
  const provider = { ...mockProvider, retireSession: retire };
  const first = sessionHost(store.storage, provider);
  const second = createReviewHost("direct", { durability: { storage: store.storage, hostId: "test" }, provider });
  try {
    await first.host.start();
    await first.provision();
    await expect(first.host.sessions.authorization?.disposeSession(first.origin())).rejects.toThrow();
    await first.stop();
    fail = false;
    await second.host.start();
    expect((await store.current().sessions.get(first.origin()))?.lifecycle).toBe("retired");
    expect(retire).toHaveBeenCalledTimes(2);
    expect(second.host.sessions.authorization?.getResource(channel)).toBeUndefined();
  } finally {
    await first.stop();
    await second.stop();
  }
});

it("isolates a failed restoration even when releasing its backend also fails", async () => {
  const store = observableStorage();
  const driver = resourceDriver({ restore: () => Promise.reject(new Error("Cannot restore child")) });
  let context: ProviderSessionInput | undefined;
  const provider = { ...mockProvider, drivers: [driver], startSession(input: ProviderSessionInput) {
    context = input;
    return Promise.resolve({ dispose() {} });
  }, restoreSession(input: ProviderSessionInput) {
    return Promise.resolve({ dispose() {
      if (input.sessionUri === channel) throw new Error("Release failed");
    } });
  } };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    await first.provision();
    assert.ok(context?.resources);
    await context.resources.create({ kind: "chat", id: "child", parent: first.origin(), driver });
    const healthy = "ahp-session:/healthy";
    await first.host.sessions.authorization?.createSession({ channel: healthy }, {
      context: { actor: actorFor("senior"), connectionId: "setup", authRevision: "1" }, connectionId: "setup", connectionGeneration: 1,
      validUntil: Date.now() + 30000, signal: new AbortController().signal, isCurrent: () => true,
    });
    await first.stop();
    await second.host.start();
    expect(second.host.sessions.authorization?.getResource(channel)).toBeUndefined();
    expect((await store.current().sessions.get(first.origin()))?.lifecycle).toBe("suspended");
    const other = second.host.sessions.authorization?.getResource(healthy);
    assert.ok(other);
    expect(second.host.sessions.authorization?.isReady(other)).toBe(true);
  } finally {
    await first.stop();
    await second.stop();
  }
});

it.each([
  { grant: false, fail: true }, { grant: true, fail: true },
  { grant: false, fail: false }, { grant: true, fail: false },
])("waits for a nested resource's non-root ancestors (grant=$grant, failure=$fail)", async ({ grant, fail }) => {
  const store = observableStorage();
  const nested = Promise.withResolvers<ResourceRef | undefined>();
  const resume = Promise.withResolvers<undefined>();
  const provisioned: string[] = [];
  let context: ProviderSessionInput | undefined;
  let parentRef: ResourceRef | undefined;
  const driver: RuntimeResourceDriver = resourceDriver({ async ensure({ resource, session }) {
    provisioned.push(resource.id);
    if (resource.id === "parent") {
      parentRef = resource;
      assert.ok(context?.resources);
      nested.resolve(await context.resources.create({ kind: "chat", id: "nested", parent: grant ? session : resource,
        ...(grant ? { grantParent: resource } : {}), driver }).catch(() => undefined));
      await resume.promise;
      if (fail) throw new Error("Parent failed");
    }
    return { metadata: {}, release() {} };
  } });
  const demo = sessionHost(store.storage, { ...mockProvider, drivers: [driver], startSession(input) {
    context = input;
    return Promise.resolve({ dispose() {} });
  } });
  try {
    await demo.host.start();
    await demo.provision();
    assert.ok(context?.resources);
    const resources = context.resources;
    const result = resources.create({ kind: "chat", id: "parent", parent: demo.origin(), grantParent: demo.origin(), driver }).then(() => "active", () => "failed");
    const child = await nested.promise;
    assert.ok(child && parentRef);
    expect(demo.registry.owner(child)).toBeUndefined();
    expect((await store.current().resources.get(child))?.lifecycle).toBe("creating");
    await expect(resources.readData(child)).rejects.toThrow();
    await expect(resources.replaceData(child, { expectedDataRevision: "1", data: {} })).rejects.toThrow();
    resume.resolve(undefined);
    expect(await result).toBe(fail ? "failed" : "active");
    if (fail) {
      expect(demo.registry.owner(child)).toBeUndefined();
      expect(provisioned).toEqual(["parent"]);
      await expect(resources.readData(child)).rejects.toThrow();
      await expect(resources.replaceData(child, { expectedDataRevision: "1", data: {} })).rejects.toThrow();
    } else {
      await vi.waitFor(() => {
        expect(demo.registry.owner(child)).toBeDefined();
      });
      expect(provisioned).toEqual(["parent", "nested"]);
      expect(await resources.readData(child)).toMatchObject({ dataRevision: "1" });
    }
    await resources.retire(parentRef);
    expect((await store.current().resources.get(child))?.lifecycle).toBe("retired");
    expect(demo.registry.owner(child)).toBeUndefined();
  } finally {
    resume.resolve(undefined);
    await demo.stop();
  }
});

it("replays a pending intermediate parent with the same reserved nested child", async () => {
  const store = observableStorage();
  const waiting = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let context: ProviderSessionInput | undefined;
  const children: ResourceRef[] = [];
  const driver = resourceDriver({ async ensure({ resource }) {
    if (resource.id === "intermediate") {
      assert.ok(context?.resources);
      children.push(await context.resources.create({ kind: "chat", id: "nested", parent: resource, driver }));
      if (children.length === 1) {
        waiting.resolve(undefined);
        await resume.promise;
      }
    }
    return { metadata: {}, release() {} };
  } });
  const start = (input: ProviderSessionInput) => {
    context = input;
    return Promise.resolve({ dispose() {} });
  };
  const provider = { ...mockProvider, drivers: [driver], startSession: start, restoreSession: start };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    await first.provision();
    assert.ok(context?.resources);
    const create = context.resources.create({ kind: "chat", id: "intermediate", parent: first.origin(), driver }).catch(() => undefined);
    await waiting.promise;
    await first.stop();
    resume.resolve(undefined);
    await create;
    await second.host.start();
    expect(second.host.sessions.authorization?.isReady(first.origin())).toBe(true);
    expect(children).toEqual([children[0], children[0]]);
    assert.ok(children[0]);
    expect(second.registry.owner(children[0])).toBeDefined();
    expect(await store.current().resources.listSession(first.origin())).toHaveLength(3);
  } finally {
    resume.resolve(undefined);
    await first.stop();
    await second.stop();
  }
});

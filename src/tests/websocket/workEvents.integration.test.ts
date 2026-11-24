import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createMemoryDurableStorage, type DurableHost, type DurableStorage } from "@persistence";
import { mockProvider } from "@sessions/mock";
import { channel, createReviewHost } from "../../../examples/advanced/host";
import { FrameLog, methodFrame, responseWithId } from "./helpers";
import type { WebSocketConnectionContext } from "@websocket";

// Preserve the real binding and socket, installing deterministic scheduling barriers.
const taps = vi.hoisted(() => ({ context: undefined as WebSocketConnectionContext | undefined,
  nextVisibility: undefined as (() => Promise<void>) | undefined }));
vi.mock("@websocket/helpers/ahp", async (load) => {
  const actual = await load<typeof import("@websocket/helpers/ahp")>();
  return { ...actual, createAHPBinding: (...[factory, report, options]: Parameters<typeof actual.createAHPBinding>) => {
    const policy = options?.protectedViews;
    const binding = actual.createAHPBinding(factory, report, !policy
      ? options
      : { ...options, protectedViews: { ...policy,
          async resolve(input) {
            const pause = taps.nextVisibility;
            taps.nextVisibility = undefined;
            if (pause) await pause();
            return policy.resolve(input);
          } } });
    return { ...binding, onConnection(context: WebSocketConnectionContext) {
      taps.context = context;
      binding.onConnection(context);
    } };
  } };
});

async function connect(port: number) {
  const socket = new WebSocket("ws://127.0.0.1:" + String(port), "demo-senior");
  const frames = new FrameLog(socket);
  await once(socket, "open");
  let id = 0;
  return {
    frames, socket, rpc(method: string, params: object) {
      const request = ++id;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request, method, params }));
      return frames.waitFor(responseWithId(request), 5000);
    },
  };
}
const resource = { kind: "session", id: channel };
const header = { version: 1 };
const accepted = z.object({ result: z.object({ subscriptionId: z.uuid(), streamEpoch: z.uuid(), items: z.array(z.object({ id: z.uuid(), revision: z.string() })) }) });
const changed = z.object({ method: z.literal("x-ahp/work/changed"), params: z.object({ workId: z.uuid(), revision: z.string(), subscriptionId: z.uuid() }) });

async function watch(native = true, storage: DurableStorage = createMemoryDurableStorage()) {
  const demo = createReviewHost("direct", { durability: { storage, hostId: "work-view-egress" }, provider: mockProvider });
  const { port } = await demo.host.start();
  await demo.provision();
  const peer = await connect(port);
  assert.ok("result" in (await peer.rpc("initialize", { channel: "ahp-root://", clientId: "egress", protocolVersions: ["1.0.0"],
    initialSubscriptions: native ? [channel] : [] }) as object));
  const page = accepted.parse(await peer.rpc("x-ahp/work/subscribe", { version: 1, resource })).result;
  const caller = { context: demo.connection("senior").context, signal: new AbortController().signal, isCurrent: () => true };
  const work = demo.host.work;
  assert.ok(work);
  return { demo, peer, page, caller, work, submit: () => work.submit(caller, { kind: "code.review", requestKey: "egress", input: {},
    scope: [{ resource, include: true }], announce: [{ resource, include: true }] }), async close() {
    taps.nextVisibility = undefined;
    peer.socket.close();
    await demo.stop();
  } };
}

it("uses the same public error for absent and unreadable announcement targets", async () => {
  const f = await watch(false);
  try {
    expect(f.demo.registry.removeBinding({ bindingId: "demo-senior", scope: f.demo.origin(), revision: 1 })).toBe(true);
    for (const target of [resource, { ...resource, id: "ahp-session:/missing" }]) {
      for (const [method, params] of [["list", { announceTo: target }], ["subscribe", { resource: target }]] as const) {
        expect(await f.peer.rpc("x-ahp/work/" + method, { ...header, ...params })).toHaveProperty("error", { code: -32602, message: "Request rejected" });
      }
    }
  } finally { await f.close(); }
});

it("includes graph resolution and target visibility in the same five-second request budget", async () => {
  const source = createMemoryDurableStorage();
  let slowGraph = false;
  const storage: DurableStorage = { async acquire(...args) {
    const host = await source.acquire(...args);
    return { ...host, work: { ...host.work, async graph(...key) {
      if (slowGraph) {
        slowGraph = false;
        await vi.advanceTimersByTimeAsync(4000);
      }
      return host.work.graph(...key);
    } } };
  } };
  const f = await watch(false, storage);
  const resume = Promise.withResolvers<undefined>();
  try {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const entered = Promise.withResolvers<undefined>();
    taps.nextVisibility = () => {
      entered.resolve(undefined);
      return resume.promise;
    };
    slowGraph = true;
    f.peer.socket.send(JSON.stringify({ jsonrpc: "2.0", id: "deadline", method: "x-ahp/work/subscribe", params: { ...header, resource } }));
    await entered.promise;
    await vi.advanceTimersByTimeAsync(1001);
    await wait(40);
    expect(f.peer.frames.frames.find(responseWithId("deadline"))).toHaveProperty("error");
  } finally {
    resume.resolve(undefined);
    vi.useRealTimers();
    await f.close();
  }
});

it("withdraws the work grant at the actual socket send and emits only a known-subscription reset", async () => {
  const f = await watch();
  try {
    const ctx = taps.context;
    assert.ok(ctx);
    const original = ctx.send.bind(ctx);
    let cut = false;
    vi.spyOn(ctx, "send").mockImplementation((message, guard) => {
      if (!cut && "method" in message && message.method === "x-ahp/work/changed") {
        cut = true;
        f.demo.registry.invalidateExternal("work-view-withdrawn");
      }
      return original(message, guard);
    });
    await f.submit();
    const reset = await f.peer.frames.waitFor(methodFrame("x-ahp/work/reset"));
    expect(reset).toEqual({ jsonrpc: "2.0", method: "x-ahp/work/reset",
      params: { version: 1, subscriptionId: f.page.subscriptionId, streamEpoch: f.page.streamEpoch } });
    expect(cut).toBe(true);
    expect(f.peer.frames.frames.some(methodFrame("x-ahp/work/changed"))).toBe(false);
  } finally { await f.close(); }
});

it("closes a stalled peer when native actions and work hints together exceed the shared entry budget", async () => {
  const f = await watch();
  const resume = Promise.withResolvers<undefined>();
  try {
    const entered = Promise.withResolvers<undefined>();
    taps.nextVisibility = () => {
      entered.resolve(undefined);
      return resume.promise;
    };
    const rename = (i: number) => f.demo.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: i,
      action: { type: "session/titleChanged", title: "queue-" + String(i) } });
    await rename(1);
    await entered.promise;
    const { id } = await f.submit();
    const closed = once(f.peer.socket, "close");
    for (let i = 2; i <= 130; i++) {
      await rename(i);
      await f.work.updateData(f.caller, id, { expectedDataRevision: String(i - 1), data: {} });
      if (i === 100) expect(f.peer.socket.readyState).toBe(WebSocket.OPEN);
    }
    await closed;
    expect(f.peer.frames.frames.some(methodFrame("x-ahp/work/changed"))).toBe(false);
  } finally {
    resume.resolve(undefined);
    await f.close();
  }
});

it("drops an in-flight hint on unsubscribe and authorizes a fresh subscription independently", async () => {
  const f = await watch();
  const resume = Promise.withResolvers<undefined>();
  try {
    const entered = Promise.withResolvers<undefined>();
    taps.nextVisibility = () => {
      entered.resolve(undefined);
      return resume.promise;
    };
    const { id } = await f.submit();
    await entered.promise;
    expect(await f.peer.rpc("x-ahp/work/unsubscribe", { version: 1, subscriptionId: f.page.subscriptionId })).toHaveProperty("result", null);
    const next = accepted.parse(await f.peer.rpc("x-ahp/work/subscribe", { version: 1, resource })).result;
    expect(next.subscriptionId).not.toBe(f.page.subscriptionId);
    expect(next.items).toContainEqual({ id, revision: "1" });
    resume.resolve(undefined);
    await f.work.cancel(f.caller, id);
    const latest = changed.parse(await f.peer.frames.waitFor(methodFrame("x-ahp/work/changed")));
    expect(latest.params).toEqual({ subscriptionId: next.subscriptionId, workId: id, revision: "2" });
    expect(f.peer.frames.frames.filter(methodFrame("x-ahp/work/changed"))).toHaveLength(1);
  } finally {
    resume.resolve(undefined);
    await f.close();
  }
});

it("requires a fresh subscription after retirement and reuse of a session URI", async () => {
  const f = await watch(false);
  try {
    const original = f.demo.origin();
    const old = { kind: original.kind, id: original.id, instanceId: original.instanceId };
    assert.ok(await f.demo.host.sessions.authorization?.disposeSession(original));
    await f.peer.frames.waitFor(methodFrame("x-ahp/work/reset"));
    await f.demo.provision();
    expect(f.demo.origin().instanceId).not.toBe(original.instanceId);
    expect(await f.peer.rpc("x-ahp/work/subscribe", { version: 1, resource: old })).toHaveProperty("error");
    const { id } = await f.submit();
    const next = accepted.parse(await f.peer.rpc("x-ahp/work/subscribe", { version: 1, resource })).result;
    expect(next.subscriptionId).not.toBe(f.page.subscriptionId);
    expect(next.items).toEqual([{ id, revision: "1" }]);
    expect(f.peer.frames.frames.some(methodFrame("x-ahp/work/changed"))).toBe(false);
  } finally { await f.close(); }
});

it.each([
  { permitted: true, withdraw: false }, { permitted: false, withdraw: false }, { permitted: true, withdraw: true },
])("guards the pending public subscription with cursor permission $permitted and withdrawal $withdraw", async ({ permitted, withdraw }) => {
  const source = createMemoryDurableStorage();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let park = false;
  let durable: DurableHost | undefined;
  const storage: DurableStorage = {
    async acquire(...args) {
      durable = await source.acquire(...args);
      const underlying = durable.work;
      return {
        ...durable, work: {
          ...underlying, async pageKeys(...key) {
            const page = await underlying.pageKeys(...key);
            if (park) {
              park = false;
              entered.resolve(undefined);
              await resume.promise;
            }
            return page;
          },
        },
      };
    },
  };
  const demo = createReviewHost("direct", {
    durability: { storage, hostId: "work-events" }, provider: mockProvider,
    initialAuthority: {
      prepare: ({ signal }) => Promise.resolve({
        scopes: [], signal, allowGlobalSequence: permitted,
        validUntil: Date.now() + 60000, isCurrent: () => !signal.aborted, release() { },
      }),
    },
  });
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    client = await connect(port);
    const initialized = await client.rpc("initialize", { channel: "ahp-root://", clientId: "view", protocolVersions: ["1.0.0"], initialSubscriptions: [] });
    expect(initialized).toHaveProperty(permitted ? "result" : "error");
    const caller = { context: demo.connection("senior").context, signal: new AbortController().signal, isCurrent: () => true };
    const work = demo.host.work;
    assert.ok(work);
    const submit = (requestKey: string, announce: boolean) => work.submit(caller, {
      kind: "code.review", requestKey,
      input: { secret: "private-event-input" }, scope: [{ resource, include: true }], announce: announce ? [{ resource, include: true }] : [],
    });
    const unannounced = await submit("unannounced", false);
    park = true;
    const reply = client.rpc("x-ahp/work/subscribe", { ...header, resource });
    await Promise.race([entered.promise, reply.then(() => {
      throw new Error("Snapshot did not reach the page query.");
    })]);
    const job = await submit("announced", true);
    expect(client.frames.frames.some(methodFrame("x-ahp/work/changed"))).toBe(false);
    if (withdraw) {
      demo.registry.invalidateExternal("pending-work-snapshot");
      resume.resolve(undefined);
      expect(await reply).toHaveProperty("error");
      await client.rpc("x-ahp/work/list", { ...header, session: resource });
      expect(client.frames.frames.some(methodFrame("x-ahp/work/changed"))).toBe(false);
      expect(client.frames.frames.some(methodFrame("x-ahp/work/reset"))).toBe(false);
      const retry = accepted.parse(await client.rpc("x-ahp/work/subscribe", { ...header, resource })).result;
      expect(retry.items).toEqual([{ id: job.id, revision: "1" }]);
      return;
    }
    resume.resolve(undefined);
    const result = accepted.parse(await reply).result;
    expect(result.items).toEqual([]);
    const hint = await client.frames.waitFor(methodFrame("x-ahp/work/changed"), 5000);
    expect(changed.parse(hint).params).toMatchObject({ workId: job.id, revision: "1", subscriptionId: result.subscriptionId });
    const keys = Object.keys((hint as { params: object }).params).sort();
    expect(keys).toEqual(["version", "subscriptionId", "streamEpoch", "workId", "revision", "change", ...(permitted ? ["serverSeq"] : [])].sort());
    const list = await client.rpc("x-ahp/work/list", { ...header, session: resource });
    expect(JSON.stringify(list)).toContain(unannounced.id);
    expect(JSON.stringify(list)).not.toContain("private-event-input");
    if (!permitted) {
      const detail = await client.rpc("x-ahp/work/get", { ...header, workId: job.id });
      expect(detail).toHaveProperty("result.work.id", job.id);
      expect(JSON.stringify(detail)).not.toContain("serverSeq");
      expect(await client.rpc("createSession", { channel: "ahp-session:/unapproved" })).toHaveProperty("error");
    }
    expect(await client.rpc("x-ahp/work/unsubscribe", { ...header, subscriptionId: result.subscriptionId })).toHaveProperty("result", null);
    await work.cancel(caller, job.id);
    await client.rpc("x-ahp/work/list", { ...header, session: resource });
    expect(client.frames.frames.filter(methodFrame("x-ahp/work/changed"))).toHaveLength(1);
    expect(await durable?.work.get(demo.origin().domainId, job.id)).toMatchObject({ status: "cancelled" });
  } finally {
    resume.resolve(undefined);
    client?.socket.close();
    await demo.stop();
  }
});

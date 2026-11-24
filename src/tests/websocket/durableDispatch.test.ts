import { AhpClient, type AhpTransport } from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { expect, it } from "vitest";
import { createMemoryDurableStorage } from "@persistence/helpers/durability/memory";
import type { DurableHost, DurableStorage } from "@persistence/helpers/durability/types";
import { mockProvider } from "@sessions/mock";
import { ACTION_TYPE_SESSION_TITLE_CHANGED } from "@sessions/constants";
import { channel, createReviewHost } from "../../../examples/advanced/host";

it("allows native retirement of a failed exact session with current disposal permission", async () => {
  let allowed = false;
  const demo = createReviewHost("direct", { durability: { storage: createMemoryDurableStorage(), hostId: "failed-session" },
    provider: { ...mockProvider, startSession: () => Promise.reject(new Error("Provider unavailable")) },
    nativeWrites: { admit: ({ command }) => allowed && command.type === "disposeSession" } });
  let client: AhpClient | undefined;
  try {
    const address = await demo.host.start();
    await demo.provision();
    const ref = demo.origin();
    expect(demo.host.sessions.authorization?.isReady(ref)).toBe(false);
    client = new AhpClient(await WebSocketTransport.connect("ws://127.0.0.1:" + String(address.port), { protocols: "demo-senior" }));
    client.connect();
    await client.initialize({ clientId: "failed-session-owner", protocolVersions: ["1.0.0"] });
    await expect(client.request("disposeSession", { channel })).rejects.toThrow();
    expect(demo.host.sessions.authorization?.getResource(channel)).toEqual(ref);
    allowed = true;
    await client.request("disposeSession", { channel });
    expect(demo.host.sessions.authorization?.getResource(channel)).toBeUndefined();
  } finally {
    await client?.shutdown();
    await demo.stop();
  }
});

it("P0-18 waits for durable admission and commit before delivering a pinned SDK native action", async () => {
  const memory = createMemoryDurableStorage();
  let owner: DurableHost | undefined;
  let allowWrite = true;
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const parkedDenied = Promise.withResolvers<undefined>();
  const resumeDenied = Promise.withResolvers<undefined>();
  const storage: DurableStorage = { async acquire(id, onLost) {
    const acquired = await memory.acquire(id, onLost);
    owner = acquired;
    return { ...acquired, sessions: { ...acquired.sessions, async commitState(write, admit) {
      if (write.state.title === "Committed through SDK") {
        entered.resolve(undefined);
        await release.promise;
      }
      if (write.state.title === "Denied SDK mutation") {
        parkedDenied.resolve(undefined);
        await resumeDenied.promise;
      }
      return acquired.sessions.commitState(write, admit);
    } } };
  } };
  const demo = createReviewHost("direct", { durability: { storage, hostId: "sdk-test" }, provider: mockProvider,
    nativeWrites: { admit: ({ context, session }) => allowWrite && context.actor.principal.subject === "senior" && session.id === channel } });
  let client: AhpClient | undefined;
  try {
    const address = await demo.host.start();
    await demo.provision();
    const ref = demo.origin();
    const inner = await WebSocketTransport.connect("ws://127.0.0.1:" + String(address.port), { protocols: "demo-senior" });
    const wire: string[] = [];
    const transport: AhpTransport = {
      send: (message) => {
        inner.send(typeof message === "string" ? message : JSON.stringify(message));
      },
      close: () => inner.close(), recv: async () => {
        const frame = await inner.recv();
        if (frame?.kind === "text") wire.push(frame.text);
        return frame;
      },
    };
    client = new AhpClient(transport);
    client.connect();
    await client.initialize({ clientId: "sdk-writer", protocolVersions: ["1.0.0"], initialSubscriptions: [channel] });
    const before = demo.host.sessions.getSessionSnapshot(channel);
    const saved = await owner?.sessions.get(ref);
    expect(saved).toBeDefined();
    const action = { type: ACTION_TYPE_SESSION_TITLE_CHANGED, title: "Committed through SDK" } as const;
    const dispatched = client.dispatch(channel, action);
    const barrier = client.ping();
    expect(await Promise.race([entered.promise.then(() => "entered"), barrier.then(() => "processed")])).toBe("entered");
    expect(demo.host.sessions.getSessionSnapshot(channel)).toEqual(before);
    expect(await owner?.sessions.get(ref)).toEqual(saved);
    expect(wire.join("")).not.toContain(action.title);
    release.resolve(undefined);
    await barrier;
    const snapshot = (await client.subscribe(channel)).result.snapshot;
    expect(snapshot?.state).toMatchObject({ title: action.title });
    const stored = await owner?.sessions.get(ref);
    expect(stored?.state.title).toBe(action.title);
    expect(stored?.stateRevision).not.toBe(saved?.stateRevision);
    const accepted = wire.map((line) => JSON.parse(line) as { method?: string; params?: { action?: { title?: string } } })
      .find((frame) => frame.method === "action" && frame.params?.action?.title === action.title);
    expect(accepted?.params).toMatchObject({ action, serverSeq: stored?.lastServerSeq,
      origin: { clientId: "sdk-writer", clientSeq: dispatched.clientSeq } });
    client.dispatch(channel, { type: ACTION_TYPE_SESSION_TITLE_CHANGED, title: "Denied SDK mutation" });
    await parkedDenied.promise;
    allowWrite = false;
    resumeDenied.resolve(undefined);
    await client.ping();
    expect(await owner?.sessions.get(ref)).toEqual(stored);
    expect(demo.host.sessions.getSessionSnapshot(channel)?.state.title).toBe(action.title);
    expect(wire.join("")).not.toContain("Denied SDK mutation");
    await expect(client.request("disposeSession", { channel })).rejects.toThrow();
    expect(await owner?.sessions.get(ref)).toEqual(stored);
    await client.unsubscribe(channel);
    allowWrite = true;
    await client.request("disposeSession", { channel });
    expect((await owner?.sessions.get(ref))?.lifecycle).toBe("retired");
    expect(demo.host.sessions.getSessionSnapshot(channel)).toBeUndefined();
  } finally {
    release.resolve(undefined);
    resumeDenied.resolve(undefined);
    await client?.shutdown();
    await demo.stop();
  }
});

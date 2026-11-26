import { describe, expect, it } from "vitest";
import { HOST_HEALTH_LIVE_PATH, HOST_HEALTH_READY_PATH, HOST_HEALTH_STARTUP_PATH, createAHPServer } from "@host";
import { createAHPServer as legacyCreateAHPServer } from "@websocket";
import { mockProvider } from "@sessions/mock";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, sessionUri, sharePersistence } from "../../../examples/host/support";
import { eventually, onCleanup } from "./cluster";

const probe = async (port: number, path: string): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
  return { status: response.status, body: await response.json().catch(() => undefined) };
};
const namespaceId = "ahp-namespace:review-app/production";

function replicas() {
  const membership = createExampleMembership(namespaceId, [{ hostId: "review-app", maxInstances: 2 }]);
  const { provider } = createExamplePersistence();
  const storage = provider.durability;
  if (!storage) throw new Error("fixture");
  const replica = (instanceId: string) => {
    const node = createExampleNode({ hostId: "review-app", mode: "replicated", namespaceId, membership, storage, persistence: sharePersistence(provider),
      instanceId, standbyRetryMs: 20 });
    onCleanup(() => node.stop());
    return node;
  };
  return { replica, membership, storage, provider };
}

describe("single and replicated host lifecycle", () => {
  it("H0-01 H1-01 H3-01 keeps the default single host unchanged through old and new imports", async () => {
    expect(legacyCreateAHPServer).toBe(createAHPServer);
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] } });
    onCleanup(() => host.stop());
    const address = await host.start();
    expect(host.status()).toMatchObject({ mode: "single", phase: "active", ready: true });
    expect(host.status().hostId).toBeUndefined();
    // Without a topology there are no probes, no membership and no routing: plain HTTP keeps its fixed reply.
    expect((await fetch(`http://127.0.0.1:${String(address.port)}${HOST_HEALTH_READY_PATH}`)).status).toBe(426);
    expect(host.routingStats()).toEqual({ connections: 0, links: 0, pending: 0, held: 0 });
    await expect(host.members()).rejects.toThrow();
    await Promise.all([host.stop(), host.stop()]);
    expect(host.status().phase).toBe("stopped");
    await expect(host.start()).rejects.toThrow();
  });

  it("H1-01 H1-02 starts one named host with a derived namespace and no distributed dependency", async () => {
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, topology: { hostId: "support-app" } });
    onCleanup(() => host.stop());
    const address = await host.start();
    expect(host.status()).toMatchObject({ mode: "single", phase: "active", ready: true, hostId: "support-app", namespaceId: "ahp-namespace:support-app/default" });
    expect((await probe(address.port, HOST_HEALTH_READY_PATH)).status).toBe(200);
    expect((await probe(address.port, HOST_HEALTH_LIVE_PATH)).body).toEqual({ status: "ok", phase: "active" });
  });

  it("H3-02 H3-03 H3-05 H3-06 H1-07 runs one active replica and one healthy standby, then takes over", async () => {
    const { replica } = replicas();
    const first = replica("pod-1");
    const second = replica("pod-2");
    const firstAddress = await first.host.start();
    await eventually(() => first.host.status().ready ? true : undefined, "first replica active");
    const alpha = sessionUri("alpha");
    const peer = await ExamplePeer.connect(`ws://127.0.0.1:${String(firstAddress.port)}/`, "senior");
    onCleanup(() => peer.close());
    await peer.initialize("writer");
    await peer.call("createSession", { channel: alpha });
    const identity = first.host.sessions.authorization?.getResource(alpha);

    // start() resolves for a standby: the listener is bound and observable before it owns anything.
    const secondAddress = await second.host.start();
    await eventually(() => second.host.status().phase === "standby" ? true : undefined, "standby");
    expect(second.host.status()).toMatchObject({ ready: false, hostId: "review-app", instanceId: "pod-2" });
    expect(first.host.status()).toMatchObject({ ready: true, hostId: "review-app", instanceId: "pod-1" });
    // A healthy standby is alive and started, and not ready. It is not a deadlock or a crash loop.
    expect((await probe(secondAddress.port, HOST_HEALTH_LIVE_PATH)).status).toBe(200);
    expect((await probe(secondAddress.port, HOST_HEALTH_STARTUP_PATH)).status).toBe(200);
    expect(await probe(secondAddress.port, HOST_HEALTH_READY_PATH)).toEqual({ status: 503, body: { status: "unavailable", phase: "standby" } });
    await expect(ExamplePeer.connect(`ws://127.0.0.1:${String(secondAddress.port)}/`, "senior")).rejects.toThrow(/503/);
    expect(second.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    // A third instance exceeds the configured limit for this logical host.
    const third = replica("pod-3");
    await third.host.start().catch(() => undefined);
    await eventually(() => third.host.status().phase === "stopped" ? true : undefined, "third replica refused");
    // The same instance identity cannot join twice.
    const duplicate = replica("pod-2");
    await duplicate.host.start().catch(() => undefined);
    await eventually(() => duplicate.host.status().phase === "stopped" ? true : undefined, "duplicate instance refused");

    const firstEpoch = first.host.status().epoch;
    const firstGeneration = first.host.status().generation;
    await first.stop();
    // Readiness follows valid ownership and finished recovery, in that order.
    await eventually(() => second.host.status().ready ? true : undefined, "takeover");
    expect((await probe(secondAddress.port, HOST_HEALTH_READY_PATH)).status).toBe(200);
    expect(BigInt(second.host.status().epoch ?? "0")).toBe(BigInt(firstEpoch ?? "0") + 1n);
    expect(second.host.status().generation).not.toBe(firstGeneration);
    expect(second.host.sessions.authorization?.getResource(alpha)).toEqual(identity);
    const after = await ExamplePeer.connect(`ws://127.0.0.1:${String(secondAddress.port)}/`, "senior");
    onCleanup(() => after.close());
    await after.initialize("reader");
    const snapshot = await after.call<{ snapshot: { state: { lifecycle: string } } }>("subscribe", { channel: alpha });
    expect(snapshot.snapshot.state.lifecycle).toBe("ready");
    // Stop and drain are idempotent and bounded.
    await Promise.all([second.host.drain(), second.host.stop(), second.host.drain()]);
    expect(second.host.status().phase).toBe("stopped");
    expect((await fetch(`http://127.0.0.1:${String(secondAddress.port)}${HOST_HEALTH_LIVE_PATH}`).catch(() => undefined))).toBeUndefined();
  });

  it("H3-05 stops a standby that never became active without leaving ownership behind", async () => {
    const { replica } = replicas();
    const first = replica("pod-1");
    const second = replica("pod-2");
    await first.host.start();
    await second.host.start();
    await eventually(() => second.host.status().phase === "standby" ? true : undefined, "standby");
    await second.stop();
    expect(second.host.status().phase).toBe("stopped");
    expect((await first.host.members()).map((member) => member.instanceId)).toEqual(["pod-1"]);
    expect(first.host.status().ready).toBe(true);
  });

  it("H4-01 H4-04 H9-03 isolates two application namespaces that use identical identifiers", async () => {
    const review = sessionUri("review");
    const start = async (hostId: string, name: string) => {
      const id = `ahp-namespace:support/${name}`;
      const { provider } = createExamplePersistence();
      const storage = provider.durability;
      if (!storage) throw new Error("fixture");
      const node = createExampleNode({ hostId, mode: "partitioned", namespaceId: id, membership: createExampleMembership(id, [{ hostId }]), storage, persistence: provider });
      onCleanup(() => node.stop());
      const address = await node.host.start();
      const peer = await ExamplePeer.connect(`ws://127.0.0.1:${String(address.port)}/`, "senior");
      onCleanup(() => peer.close());
      await peer.initialize(`senior@${name}`);
      return { node, peer, storage, provider, id };
    };
    // One process serves both namespaces, each on its own endpoint with its own store and security composition.
    const production = await start("support-production", "production");
    const staging = await start("support-staging", "staging");
    await production.peer.call("createSession", { channel: review });
    await staging.peer.call("createSession", { channel: review });
    await production.peer.call("subscribe", { channel: review });
    production.peer.notify("dispatchAction", { channel: review, clientSeq: 1, action: { type: "session/titleChanged", title: "Production only" } });
    await production.peer.wait(() => production.peer.actions(review).find((envelope) => envelope.action.title === "Production only"), 5_000, "title");
    const a = production.node.host.sessions.authorization?.getResource(review);
    const b = staging.node.host.sessions.authorization?.getResource(review);
    expect(a?.id).toBe(b?.id);
    expect(a?.instanceId).not.toBe(b?.instanceId);
    expect(staging.node.host.sessions.getSessionSnapshot(review)?.state.title).not.toBe("Production only");
    expect(staging.peer.actions(review)).toHaveLength(0);
    expect(production.node.host.status().namespaceId).toBe("ahp-namespace:support/production");
    expect(staging.node.host.status().namespaceId).toBe("ahp-namespace:support/staging");

    // H4-02 H4-07: a store bound to one namespace refuses a host configured for another, whatever it calls itself.
    const intruder = createExampleNode({ hostId: "support-staging", mode: "partitioned", namespaceId: staging.id,
      membership: createExampleMembership(staging.id, [{ hostId: "support-staging" }]), storage: production.storage, persistence: sharePersistence(production.provider) });
    onCleanup(() => intruder.stop());
    await expect(intruder.host.start()).rejects.toThrow();
    expect(production.node.host.sessions.getSessionSnapshot(review)?.state.title).toBe("Production only");
  });

  it("H1-09 H8-05 accepts one trusted configuration per revision and fences members left on an older one", async () => {
    const { provider } = createExamplePersistence();
    const storage = provider.durability;
    if (!storage) throw new Error("fixture");
    const hosts = [{ hostId: "review-a", endpoint: "ws://127.0.0.1:1/" }, { hostId: "review-b", endpoint: "ws://127.0.0.1:2/" }];
    const shared = "ahp-namespace:review/shared";
    const first = createExampleMembership(shared, hosts, 1);
    const node = (hostId: string, membership: ReturnType<typeof createExampleMembership>, port: number) => {
      const created = createExampleNode({ hostId, mode: "distributed", namespaceId: shared, membership, storage, persistence: sharePersistence(provider),
        routing: { host: "127.0.0.1", port: 0, endpoint: `ws://127.0.0.1:${String(port)}/` } });
      onCleanup(() => created.stop());
      return created;
    };
    const a = node("review-a", first, 1);
    await a.host.start();
    // Same revision, different content: a second root of trust is refused, whoever joins first.
    const conflicting = createExampleMembership(shared, hosts, 1);
    await expect(node("review-b", conflicting, 2).host.start()).rejects.toThrow();
    expect(a.host.status().ready).toBe(true);
    // A newer revision supersedes: the member still running the old configuration is fenced.
    const next = createExampleMembership(shared, hosts, 2);
    const b = node("review-b", next, 2);
    await b.host.start();
    expect(b.host.status().ready).toBe(true);
    await eventually(() => a.host.status().phase === "stopped" ? true : undefined, "stale member fenced", 10_000);
    // An older revision can never rejoin.
    await expect(node("review-a", first, 1).host.start()).rejects.toThrow();
    const rejoined = node("review-a", next, 1);
    await rejoined.host.start();
    expect((await b.host.members()).map((member) => member.hostId)).toEqual(["review-a", "review-b"]);
  });
});

import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import type { HostEventDelivery } from "@persistence";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, freePort, sessionUri, sharePersistence } from "../../../examples/host/support";
import { eventually, onCleanup } from "./cluster";
import { createSelfSignedCertificate } from "./tlsFixture";

const namespaceId = "ahp-namespace:review/secure";
const hostIds = ["review-a", "review-b", "review-c", "review-d"] as const;
interface Snapshot { snapshot: { fromSeq: number; state: { title?: string; lifecycle: string } } }

/** Plain `ws:` to a TLS listener, as a peer that ignores the policy would dial it. */
const dialPlain = (endpoint: string): Promise<"open" | "refused"> => new Promise((resolve) => {
  const socket = new WebSocket(endpoint.replace("wss:", "ws:"), { handshakeTimeout: 2_000 });
  socket.once("open", () => {
    socket.terminate();
    resolve("open");
  });
  socket.once("error", () => {
    resolve("refused");
  });
  socket.once("unexpected-response", () => {
    socket.terminate();
    resolve("refused");
  });
});

describe("TLS between hosts", () => {
  it("H5-10 H1-08 routes between hosts over TLS only, and fails closed and sanitized for a member that does not trust the deployment", async () => {
    const deployment = createSelfSignedCertificate();
    const another = createSelfSignedCertificate();
    const endpoints = new Map<string, string>();
    const ports = new Map<string, number>();
    for (const hostId of hostIds) {
      const port = await freePort();
      ports.set(hostId, port);
      endpoints.set(hostId, `wss://localhost:${String(port)}/`);
    }
    const membership = createExampleMembership(namespaceId, hostIds.map((hostId) => ({ hostId, endpoint: endpoints.get(hostId) })));
    const { provider } = createExamplePersistence();
    const storage = provider.durability;
    if (!storage) throw new Error("fixture");
    const node = (hostId: string, clientTls?: { ca: string }, options: { requireTls?: boolean; tls?: boolean } = {}) => createExampleNode({
      hostId, mode: "distributed", namespaceId, membership, storage, persistence: sharePersistence(provider), requireTls: options.requireTls ?? true,
      routing: { host: "127.0.0.1", port: ports.get(hostId) ?? 0, endpoint: endpoints.get(hostId) ?? "",
        ...(options.tls === false ? {} : { tls: { key: deployment.key, cert: deployment.cert } }), ...(clientTls === undefined ? {} : { clientTls }), requestTimeoutMs: 3_000 } });
    const start = async (hostId: string, clientTls?: { ca: string }) => {
      const started = node(hostId, clientTls);
      onCleanup(() => started.stop());
      const address = await started.host.start();
      return { node: started, url: `ws://127.0.0.1:${String(address.port)}/` };
    };
    const connect = async (url: string, subject: string, clientId: string): Promise<ExamplePeer> => {
      const peer = await ExamplePeer.connect(url, subject);
      onCleanup(() => peer.close());
      await peer.initialize(clientId);
      return peer;
    };

    // Configuration is refused before anything listens: TLS required with a cleartext listener, or with a cleartext endpoint in policy.
    expect(() => node("review-a", { ca: deployment.cert }, { tls: false })).toThrow(/TLS is required/);
    const cleartext = createExampleMembership(namespaceId, hostIds.map((hostId) => ({ hostId, endpoint: (endpoints.get(hostId) ?? "").replace("wss:", "ws:") })));
    expect(() => createExampleNode({ hostId: "review-a", mode: "distributed", namespaceId, membership: cleartext, storage, persistence: sharePersistence(provider), requireTls: true,
      routing: { host: "127.0.0.1", port: ports.get("review-a") ?? 0, endpoint: (endpoints.get("review-a") ?? "").replace("wss:", "ws:"), tls: { key: deployment.key, cert: deployment.cert } } })).toThrow(/must use TLS/);

    const a = await start("review-a", { ca: deployment.cert });
    const b = await start("review-b", { ca: deployment.cert });
    // review-c has the host credential but does not trust the deployment's certificate authority; review-d trusts a different one.
    const c = await start("review-c");
    const d = await start("review-d", { ca: another.cert });
    const events: HostEventDelivery[] = [];
    a.node.host.onHostEvent((delivery) => events.push(delivery));
    const alpha = sessionUri("alpha");
    const owner = await connect(a.url, "senior", "owner");
    await owner.call("createSession", { channel: alpha });

    // The internal endpoint speaks TLS only.
    expect(await dialPlain(endpoints.get("review-a") ?? "")).toBe("refused");

    // A request through review-b reaches the owner over a TLS link, and its actions come back the same way.
    const viaB = await connect(b.url, "senior", "via-b");
    const subscribed = await viaB.call<Snapshot>("subscribe", { channel: alpha });
    expect(subscribed.snapshot.state.lifecycle).toBe("ready");
    viaB.notify("dispatchAction", { channel: alpha, clientSeq: 1, action: { type: "session/titleChanged", title: "Over TLS" } });
    const action = await viaB.wait(() => viaB.actions(alpha).find((envelope) => envelope.action.title === "Over TLS"), 5_000, "routed action over TLS");
    expect(action.serverSeq).toBeGreaterThan(subscribed.snapshot.fromSeq);
    expect(a.node.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe("Over TLS");
    expect(b.node.host.routingStats()).toMatchObject({ connections: 1, links: 1 });
    // The transfer and the reverse direction also run over TLS.
    await a.node.host.transferSession(alpha, "review-b");
    await eventually(() => b.node.host.sessions.getSessionSnapshot(alpha), "session moved to review-b");
    const viaA = await connect(a.url, "observer", "via-a");
    expect((await viaA.call<Snapshot>("subscribe", { channel: alpha })).snapshot.state.title).toBe("Over TLS");
    expect(a.node.host.routingStats().links).toBe(1);

    // A member that cannot verify the owner's certificate never sends the caller's request anywhere.
    for (const [label, untrusting] of [["no certificate authority", c], ["another certificate authority", d]] as const) {
      const peer = await connect(untrusting.url, "senior", `untrusting ${label}`);
      const reply = await peer.request("subscribe", { channel: alpha });
      expect(reply.result).toBeUndefined();
      // One generic refusal: no certificate text, no endpoint, no host name, no credential identifier.
      expect(reply.error?.message).toBe("Routed request unavailable");
      expect(JSON.stringify(peer.frames)).not.toMatch(/certificate|self.signed|CERT|localhost|wss:|review-b-key|issuer/iu);
      expect(untrusting.node.host.routingStats()).toMatchObject({ links: 0, pending: 0 });
      expect(untrusting.node.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    }
    expect(b.node.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe("Over TLS");
    // Namespace events never carry key material or credential identifiers.
    const recorded = JSON.stringify(events);
    expect(events.length).toBeGreaterThan(0);
    expect(recorded).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE|-key-1|demo-senior|leaseToken/u);
  });
});

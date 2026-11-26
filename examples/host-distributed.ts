/**
 * Scenario D: two logical hosts are active in one shared namespace. Each
 * session has one owning host, and a request that reaches the other host is
 * routed to the owner.
 *
 *   pnpm exec vite-node examples/host-distributed.ts
 *
 * Both hosts share one in-memory store here. Separate processes need a shared
 * database: see examples/host/docker-compose.yaml and examples/host/acceptance.ts.
 */
import assert from "node:assert/strict";
import { createExamplePersistence } from "./advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, freePort, sessionUri, sharePersistence } from "./host/support";

// An explicit canonical identifier lets differently named hosts share one namespace.
const namespaceId = "ahp-namespace:support/shared";
const hosts = ["support-api", "support-tools"];
const endpoints = new Map<string, { port: number; endpoint: string }>();
for (const hostId of hosts) {
  const port = await freePort();
  endpoints.set(hostId, { port, endpoint: `ws://127.0.0.1:${String(port)}/` });
}
// Trusted policy lists each member, its public verifier and the exact endpoint it may advertise.
const membership = createExampleMembership(namespaceId, hosts.map((hostId) => ({ hostId, endpoint: endpoints.get(hostId)?.endpoint })));
const { provider } = createExamplePersistence();
const start = async (hostId: string) => {
  const internal = endpoints.get(hostId) ?? assert.fail("endpoint");
  const node = createExampleNode({
    hostId, mode: "distributed", namespaceId, membership,
    storage: provider.durability ?? assert.fail("storage"), persistence: sharePersistence(provider),
    routing: { host: "127.0.0.1", port: internal.port, endpoint: internal.endpoint },
  });
  const address = await node.host.start();
  return { node, url: `ws://127.0.0.1:${String(address.port)}/` };
};

const api = await start("support-api");
const tools = await start("support-tools");
const peers: ExamplePeer[] = [];
try {
  const connect = async (url: string, clientId: string): Promise<ExamplePeer> => {
    const peer = await ExamplePeer.connect(url, "senior");
    peers.push(peer);
    await peer.initialize(clientId);
    return peer;
  };
  const tickets = sessionUri("tickets");
  // The host that receives the create request becomes the owner.
  await (await connect(api.url, "creator")).call("createSession", { channel: tickets });
  assert.ok(api.node.host.sessions.getSessionSnapshot(tickets));
  assert.equal(tools.node.host.sessions.getSessionSnapshot(tickets), undefined);

  // The same caller reaches the session through the other host.
  const viaTools = await connect(tools.url, "elsewhere");
  await viaTools.call("subscribe", { channel: tickets });
  viaTools.notify("dispatchAction", { channel: tickets, clientSeq: 1, action: { type: "session/titleChanged", title: "Routed to the owner" } });
  await viaTools.wait(() => viaTools.actions(tickets).find((envelope) => envelope.action.title === "Routed to the owner"));
  assert.equal(api.node.host.sessions.getSessionSnapshot(tickets)?.state.title, "Routed to the owner");

  // Ownership can move. Identity and state are preserved; the old owner only routes afterwards.
  const identity = api.node.host.sessions.authorization?.getResource(tickets);
  await api.node.host.transferSession(tickets, "support-tools");
  for (let attempt = 0; attempt < 500 && !tools.node.host.sessions.getSessionSnapshot(tickets); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(tools.node.host.sessions.authorization?.getResource(tickets), identity);
  assert.equal(api.node.host.sessions.getSessionSnapshot(tickets), undefined);
  process.stdout.write(`${tickets} was created on support-api, written through support-tools and then transferred to it.\n`);
} finally {
  for (const peer of peers) await peer.close();
  await api.node.stop();
  await tools.node.stop();
}

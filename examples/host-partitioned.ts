/**
 * Scenario C: two application namespaces, each with its own host and store.
 * The same session identifier exists in both and never crosses over.
 *
 *   pnpm exec vite-node examples/host-partitioned.ts
 */
import assert from "node:assert/strict";
import { createExamplePersistence } from "./advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, sessionUri } from "./host/support";

const review = sessionUri("review");
const open = async (hostId: string, name: string) => {
  // The application chooses the namespace. Both share the `support` application segment.
  const namespaceId = `ahp-namespace:support/${name}`;
  const { provider } = createExamplePersistence();
  const node = createExampleNode({
    hostId, mode: "partitioned", namespaceId, membership: createExampleMembership(namespaceId, [{ hostId }]),
    storage: provider.durability ?? assert.fail("storage"), persistence: provider,
  });
  const address = await node.host.start();
  const peer = await ExamplePeer.connect(`ws://127.0.0.1:${String(address.port)}/`, "senior");
  await peer.initialize(`senior@${name}`);
  await peer.call("createSession", { channel: review });
  return { node, peer };
};

const production = await open("support-production", "production");
const staging = await open("support-staging", "staging");
try {
  await production.peer.call("subscribe", { channel: review });
  production.peer.notify("dispatchAction", { channel: review, clientSeq: 1, action: { type: "session/titleChanged", title: "Production only" } });
  await production.peer.wait(() => production.peer.actions(review).find((envelope) => envelope.action.title === "Production only"));
  const [a, b] = [production, staging].map(({ node }) => node.host.sessions.authorization?.getResource(review));
  assert.equal(a?.id, b?.id);
  assert.notEqual(a?.instanceId, b?.instanceId);
  assert.notEqual(staging.node.host.sessions.getSessionSnapshot(review)?.state.title, "Production only");
  process.stdout.write(`${review} exists independently in ${String(production.node.host.status().namespaceId)} and ${String(staging.node.host.status().namespaceId)}.\n`);
} finally {
  for (const { node, peer } of [production, staging]) {
    await peer.close();
    await node.stop();
  }
}

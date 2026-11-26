/**
 * Scenario B: two replicas of one logical host. One is active, the other is a
 * healthy standby that takes over when the active one stops.
 *
 *   pnpm exec vite-node examples/host-replicated.ts
 *
 * Both replicas share one in-memory store here. Separate processes need a
 * shared database: see examples/host/docker-compose.yaml.
 */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createExamplePersistence } from "./advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, sessionUri, sharePersistence } from "./host/support";

const namespaceId = "ahp-namespace:support-app/production";
// Trusted, application-owned membership: one logical host, at most two instances.
const membership = createExampleMembership(namespaceId, [{ hostId: "support-app", maxInstances: 2 }]);
const { provider } = createExamplePersistence();
assert.ok(provider.durability);
const replica = (instanceId: string) => createExampleNode({
  hostId: "support-app", mode: "replicated", namespaceId, instanceId, membership,
  storage: provider.durability ?? assert.fail("storage"), persistence: sharePersistence(provider), standbyRetryMs: 20,
});
const until = async (check: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 500 && !check(); attempt += 1) await delay(10);
  assert.ok(check(), label);
};

const first = replica("pod-1");
const second = replica("pod-2");
try {
  const firstAddress = await first.host.start();
  const secondAddress = await second.host.start();
  await until(() => first.host.status().ready && second.host.status().phase === "standby", "one active, one standby");
  // The standby is alive and not ready, so a load balancer sends it no traffic.
  const probe = async (path: string): Promise<number> => (await fetch(`http://127.0.0.1:${String(secondAddress.port)}${path}`)).status;
  assert.deepEqual([await probe("/livez"), await probe("/readyz")], [200, 503]);

  const review = sessionUri("review");
  const writer = await ExamplePeer.connect(`ws://127.0.0.1:${String(firstAddress.port)}/`, "senior");
  await writer.initialize("writer");
  await writer.call("createSession", { channel: review });
  await writer.close();
  const epoch = first.host.status().epoch;

  await first.stop();
  await until(() => second.host.status().ready, "the standby took over");
  assert.equal(BigInt(second.host.status().epoch ?? "0"), BigInt(epoch ?? "0") + 1n);
  const reader = await ExamplePeer.connect(`ws://127.0.0.1:${String(secondAddress.port)}/`, "senior");
  await reader.initialize("reader");
  const { snapshot } = await reader.call<{ snapshot: { state: { lifecycle: string } } }>("subscribe", { channel: review });
  assert.equal(snapshot.state.lifecycle, "ready");
  await reader.close();
  process.stdout.write(`Replica pod-2 took over ${review} at ownership epoch ${String(second.host.status().epoch)}.\n`);
} finally {
  await first.stop();
  await second.stop();
}

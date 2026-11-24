import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { mockProvider } from "@sessions/mock";
import { backupWorker, channel, createReviewHost, reviewWorkerKey } from "./advanced/host";
import { createExamplePersistence } from "./advanced/persistence";
import { claimedLease, execution, openWorkClient } from "./advanced/work";

const { provider } = createExamplePersistence();
assert.ok(provider.durability);
const demo = createReviewHost("direct", { persistence: provider, provider: mockProvider,
  durability: { storage: provider.durability, hostId: "capacity-example" },
  capacityDemo: { leaseMs: 4000, configuration: { identities: [{ identity: backupWorker, maxActiveClaims: 1, allowedKinds: ["code.review"] }] } } });
const second = "ahp-session:/review-overflow";
const peers: Awaited<ReturnType<typeof openWorkClient>>[] = [];
try {
  const { port } = await demo.host.start();
  await demo.provision();
  await demo.provision(undefined, second);
  const connect = async (subject: "junior" | "backup" | "pm") => {
    const peer = await openWorkClient(`ws://127.0.0.1:${String(port)}`, subject, subject + "-capacity");
    peers.push(peer);
    return peer;
  };
  const pm = await connect("pm");
  const junior = await connect("junior");
  const backup = await connect("backup");
  type Peer = typeof junior;
  const register = async (peer: Peer, agentKey: string) => z.object({ agentId: z.uuid() }).parse(await peer.request("x-ahp/agents/register", { agentKey })).agentId;
  const primaryId = await register(junior, reviewWorkerKey);
  const backupId = await register(backup, backupWorker.agentKey);
  const session = (id: string) => ({ kind: "session", id });
  const submit = async (id: string, targetAgentId: string, priority: number, requestKey: string) => {
    const result = await pm.request("x-ahp/work/submit", { session: session(id), scope: [{ resource: session(id), include: true }],
      requestKey, kind: "code.review", targetAgentId, priority, input: { topic: requestKey } });
    return z.object({ workId: z.uuid() }).parse(result).workId;
  };
  const claim = (peer: Peer, id: string) => peer.request("x-ahp/work/claim", { session: session(id) });
  const take = async (peer: Peer, id: string) => claimedLease.parse(await claim(peer, id)).lease;
  await submit(channel, primaryId, 1, "routine");
  const urgent = await submit(channel, primaryId, 10, "urgent");
  await submit(second, primaryId, 5, "follow-up");
  await submit(second, primaryId, 1, "deferred-review");
  await submit(second, backupId, 2, "backup-review");
  await submit(channel, backupId, 1, "backup-review-next");

  const first = await take(junior, channel);
  assert.equal(first.workId, urgent);
  await take(junior, second);
  await take(junior, channel);
  assert.deepEqual(await claim(junior, second), { version: 1, status: "capacity" });
  const alternate = await take(backup, second);
  assert.deepEqual(await claim(backup, channel), { version: 1, status: "capacity" });
  assert.equal(await backup.request("x-ahp/work/complete", { ...execution(alternate), result: { reviewed: true } }), null);

  await junior.request("x-ahp/agents/unregister", {});
  await junior.client.shutdown();
  const reconnected = await connect("junior");
  assert.equal(await register(reconnected, reviewWorkerKey), primaryId);
  await assert.rejects(reconnected.request("x-ahp/work/renew", execution(first)));
  assert.deepEqual(await claim(reconnected, second), { version: 1, status: "capacity" });
  await setTimeout(Math.max(0, Date.parse(first.leaseExpiresAt) - Date.now()) + 20);
  const replacement = await take(reconnected, channel);
  assert.equal(replacement.workId, first.workId);
  assert.equal(replacement.attempt, first.attempt + 1);
  assert.notEqual(replacement.leaseToken, first.leaseToken);
  await assert.rejects(reconnected.request("x-ahp/work/complete", { ...execution(first), result: {} }));
  assert.equal(await reconnected.request("x-ahp/work/complete", { ...execution(replacement), result: { reviewed: true } }), null);
  process.stdout.write("Two sessions shared the junior's three active claims. The backup used its one-claim override. The reconnected junior reclaimed the expired priority review and completed its new attempt.\n");
} finally {
  await Promise.allSettled(peers.map(({ client }) => client.shutdown()));
  await demo.stop();
}

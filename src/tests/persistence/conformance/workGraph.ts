import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DurableHost, DurableStorage, ResourceRecord, StoredSession } from "@persistence";
import { createWorkSelectionGraph } from "@work/helpers/selections";
import { createWorkSessionFixture } from "./work";

const yes = () => true;

export async function assertWorkGraphRevisions(host: DurableHost): Promise<void> {
  const { ref, root } = await createWorkSessionFixture(host);
  async function snapshot() {
    const stored = await host.work.graph(ref.domainId, ref);
    assert.ok(stored);
    return { revision: stored.session.graphRevision, graph: createWorkSelectionGraph(ref.domainId, stored.session, stored.resources) };
  }
  const grant: ResourceRecord = { ...root, ref: { ...ref, kind: "chat", id: randomUUID(), instanceId: randomUUID() },
    parent: ref, operationId: randomUUID() };
  const child: ResourceRecord = { ...grant, ref: { ...ref, kind: "terminal", id: randomUUID(), instanceId: randomUUID() },
    grantParent: grant.ref, operationId: randomUUID() };
  await host.resources.reserve(grant, yes);
  await host.resources.reserve(child, yes);
  const creating = await snapshot();
  const change = (record: ResourceRecord, expected: "creating" | "active" | "suspended", next: "active" | "suspended") =>
    host.resources.activate({ session: ref, ref: record.ref, operationId: record.operationId, expected, next }, yes);
  await change(grant, "creating", "active");
  const liveGrant = await snapshot();
  assert.notEqual(creating.revision, liveGrant.revision, "activation must invalidate the prepared graph");
  await change(child, "creating", "active");
  const allActive = await snapshot();
  const positive = [{ resource: child.ref, include: true, includeDescendants: false }];
  assert.ok(allActive.graph.selected(child.ref, positive, allActive.revision));
  assert.ok(allActive.graph.hasActivePositiveScope(positive, allActive.revision));
  await change(grant, "active", "active");
  assert.equal((await snapshot()).revision, allActive.revision, "refreshing the same lifecycle preserves membership");
  await change(grant, "active", "suspended");
  const suspended = await snapshot();
  assert.equal(allActive.graph.selected(child.ref, positive, suspended.revision), false);
  assert.equal(allActive.graph.hasActivePositiveScope(positive, suspended.revision), false);
  assert.equal(suspended.graph.hasActivePositiveScope(positive, suspended.revision), false);
  await change(grant, "suspended", "active");
  const restored = await snapshot();
  assert.notEqual(restored.revision, suspended.revision);
  assert.ok(restored.graph.hasActivePositiveScope(positive, restored.revision));
  await change(root, "active", "suspended");
  assert.equal(await host.work.graph(ref.domainId, ref), undefined);
  const paused = await host.sessions.get(ref);
  assert.ok(paused);
  assert.equal(restored.graph.hasActivePositiveScope(positive, paused.graphRevision), false);
  await change(root, "suspended", "active");
  assert.notEqual((await snapshot()).revision, paused.graphRevision);
  await host.resources.beginRetirement(ref, grant.ref, yes);
  const retiring = await snapshot();
  await host.resources.beginRetirement(ref, grant.ref, yes);
  assert.equal((await snapshot()).revision, retiring.revision);
  await host.resources.finishRetirement(ref, child.ref);
  assert.notEqual((await snapshot()).revision, retiring.revision);
}

export async function assertTypeManifestPinning(storage: DurableStorage, hostId: string): Promise<void> {
  const first = await storage.acquire(hostId, () => {});
  let original: Awaited<ReturnType<typeof createWorkSessionFixture>>;
  try {
    original = await createWorkSessionFixture(first);
    await first.sessions.beginRetirement(original.ref, yes);
    await first.sessions.finishRetirement(original.ref);
    assert.ok(await first.sessions.purge(original.ref, "9999-01-01T00:00:00Z"));
  } finally { await first.release(); }
  const next = await storage.acquire(hostId, () => {});
  try {
    async function reserve(type: StoredSession["type"], providerId = original.session.providerId) {
      const instanceId = randomUUID();
      const ref = { ...original.ref, id: `ahp-session:/${instanceId}`, instanceId };
      await next.sessions.reserve({ ...original.session, ref, type, providerId },
        { ...original.root, ref, session: ref, operationId: randomUUID(), providerId }, yes);
      return ref;
    }
    const type = original.session.type;
    await assert.rejects(reserve({ ...type, workManifest: [{ kind: "review", maxAttempts: 4 }] }));
    await assert.rejects(reserve({ ...type, id: randomUUID() }));
    await assert.rejects(reserve({ ...type, key: `other-${type.key}` }));
    await assert.rejects(reserve(type, "other-provider"));
    const matching = await reserve({ ...type, workManifest: [{ maxAttempts: 3, kind: "review" }] });
    assert.deepEqual((await next.sessions.get(matching))?.type, type);
    await reserve({ ...type, id: randomUUID(), version: type.version + 1, workManifest: [{ kind: "review", maxAttempts: 4 }] });
  } finally { await next.release(); }
}

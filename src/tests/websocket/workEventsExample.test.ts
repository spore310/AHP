import { expect, it } from "vitest";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { mockProvider } from "@sessions/mock";
import { createWorkClient } from "@work/helpers/client";
import { createReviewHost } from "../../../examples/advanced/host";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { openWorkClient } from "../../../examples/advanced/work";
import { runWorkEventsExample } from "../../../examples/advanced/workEvents";

it("projects authorized work through the pinned SDK and recovers a dropped final hint and a disconnect", async () => {
  expect(await runWorkEventsExample()).toMatchObject({ dropped: 1, presented: 2, restored: "ready", excluded: 0, observer: 0 });
}, 20000);

it("recovers an active work view after the final reset hint is lost with no further mutation", async () => {
  const { provider } = createExamplePersistence();
  assert.ok(provider.durability);
  const demo = createReviewHost("direct", { provider: mockProvider, persistence: provider,
    durability: { storage: provider.durability, hostId: "lost-final-reset" } });
  let peer: Awaited<ReturnType<typeof openWorkClient>> | undefined;
  let client: ReturnType<typeof createWorkClient> | undefined;
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    peer = await openWorkClient("ws://127.0.0.1:" + String(port), "senior", "lost-final-reset");
    const transport = peer.workPort;
    let lost = 0;
    client = createWorkClient({ request: transport.request.bind(transport), onClose: transport.onClose.bind(transport),
      onNotification: (method, receive) => transport.onNotification(method, (params) => {
        if (method === "x-ahp/work/reset" && !lost) {
          lost++;
          return;
        }
        return receive(params);
      }) }, { reconcileIntervalMs: 5000 });
    const { kind, id, instanceId } = demo.origin(), resource = { kind, id, instanceId };
    await peer.request("x-ahp/work/submit", { session: resource, requestKey: "existing", kind: "code.review", input: {},
      scope: [{ resource, include: true }], announce: [{ resource, include: true }] });
    const original = await client.subscribe({ resource });
    assert.ok(original.subscriptionId);
    expect(original.items).toHaveLength(1);
    demo.registry.invalidateExternal("work-view-reset");
    const deadline = performance.now() + 7500;
    while (performance.now() < deadline && (client.snapshot().subscriptionId === original.subscriptionId || !client.snapshot().subscriptionId)) await setTimeout(25);
    expect(lost).toBe(1);
    const recovered = client.snapshot();
    expect(recovered.status).toBe("ready");
    expect(recovered.subscriptionId).toBeTruthy();
    expect(recovered.subscriptionId).not.toBe(original.subscriptionId);
    expect(recovered.items).toEqual(original.items);
  } finally {
    await client?.dispose();
    await peer?.connection.shutdown();
    await demo.stop();
  }
}, 12000);

it("invalidates refresh cursors on disposal and preserves a live continuation for a bounded view", async () => {
  const { provider } = createExamplePersistence();
  assert.ok(provider.durability);
  const demo = createReviewHost("direct", { provider: mockProvider, persistence: provider,
    durability: { storage: provider.durability, hostId: "client-cursor-lifetime" } });
  let peer: Awaited<ReturnType<typeof openWorkClient>> | undefined;
  let client: ReturnType<typeof createWorkClient> | undefined;
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    peer = await openWorkClient("ws://127.0.0.1:" + String(port), "senior", "client-cursor-lifetime");
    const { kind, id, instanceId } = demo.origin(), resource = { kind, id, instanceId };
    // Drop hints to force a new full refresh of an already active subscription.
    client = createWorkClient({ request: peer.workPort.request.bind(peer.workPort), onNotification: () => () => undefined,
      onClose: peer.workPort.onClose.bind(peer.workPort) }, { maxPages: 1 });
    const initial = await client.subscribe({ resource, limit: 1 });
    expect(initial).toMatchObject({ status: "ready", items: [] });
    const sender = peer;
    const submit = (key: string) => sender.request("x-ahp/work/submit", { session: resource, requestKey: key, kind: "code.review",
      input: {}, scope: [{ resource, include: true }], announce: [{ resource, include: true }] });
    const ids: string[] = [];
    for (const key of ["first", "second"]) ids.push(z.object({ workId: z.uuid() }).parse(await submit(key)).workId);
    const refresh = await client.refresh();
    expect(refresh).toMatchObject({ status: "limit", subscriptionId: initial.subscriptionId });
    assert.ok(refresh.nextCursor);
    await client.dispose();
    const continuation = { announceTo: resource, cursor: refresh.nextCursor, limit: 1 };
    await expect(peer.request("x-ahp/work/list", continuation)).rejects.toThrow();
    await expect(peer.request("x-ahp/work/list", { ...continuation, subscriptionId: initial.subscriptionId })).rejects.toThrow();
    for (const key of ["third", "fourth", "fifth"]) ids.push(z.object({ workId: z.uuid() }).parse(await submit(key)).workId);
    client = createWorkClient(peer.connection, { maxTrackedItems: 3 });
    const limited = await client.subscribe({ resource, limit: 2 });
    expect(limited.status).toBe("limit");
    expect(limited.items).toHaveLength(3);
    expect(limited.remainingItems).toHaveLength(1);
    assert.ok(limited.nextCursor);
    const final = z.object({ items: z.array(z.object({ id: z.uuid() })) }).parse(await peer.request("x-ahp/work/list",
      { announceTo: resource, limit: 2, subscriptionId: limited.subscriptionId, cursor: limited.nextCursor }));
    expect([...limited.items, ...(limited.remainingItems ?? []), ...final.items].map((item) => item.id).sort()).toEqual(ids.sort());
  } finally {
    await client?.dispose();
    await peer?.connection.shutdown();
    await demo.stop();
  }
});

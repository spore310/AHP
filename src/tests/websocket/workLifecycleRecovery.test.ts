import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { RuntimeResourceDriver } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createWorkClient } from "@work";
import { createReviewHost } from "../../../examples/advanced/host";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { openWorkClient } from "../../../examples/advanced/work";

it("recovers the same connected SDK view on a periodic tick after a rejected duplicate resource reservation", async () => {
  const { provider } = createExamplePersistence();
  assert.ok(provider.durability);
  const driver: RuntimeResourceDriver = { key: "review-chat", kind: "chat", version: 1,
    registration: ({ resource }) => ({ route: { origin: resource, targets: [resource] }, externalAuthority: "none" }),
    captureRecoveryInput: () => ({}), ensure: () => Promise.resolve({ metadata: {}, release() {} }),
    restore: () => Promise.resolve({ metadata: {}, release() {} }), destroy: () => Promise.resolve() };
  const demo = createReviewHost("direct", { persistence: provider, durability: { storage: provider.durability, hostId: "rejected-resource-view" },
    provider: { ...mockProvider, drivers: [driver] } });
  let peer: Awaited<ReturnType<typeof openWorkClient>> | undefined;
  let view: ReturnType<typeof createWorkClient> | undefined;
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    const chat = await demo.createReviewChat("ahp-chat:/review/recovery", driver);
    const { kind, id, instanceId } = chat, resource = { kind, id, instanceId };
    peer = await openWorkClient("ws://127.0.0.1:" + String(port), "senior", "rejected-reservation");
    const job = z.object({ workId: z.uuid() }).parse(await peer.request("x-ahp/work/submit", { requestKey: "existing", kind: "code.review",
      input: {}, scope: [{ resource, include: true }], announce: [{ resource, include: true }] }));
    const reset = vi.fn();
    const stopListening = peer.workPort.onNotification("x-ahp/work/reset", reset);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const projection = createWorkClient(peer.connection, { reconcileIntervalMs: 5000 });
    view = projection;
    const initial = await projection.subscribe({ resource });
    const summaries = [{ id: job.workId, revision: "1" }];
    expect(initial).toMatchObject({ status: "ready", items: summaries });
    assert.ok(initial.subscriptionId);
    const list = { announceTo: resource, subscriptionId: initial.subscriptionId };
    expect(await peer.request("x-ahp/work/list", list)).toMatchObject({ items: summaries });
    await expect(demo.createReviewChat(chat.id, driver)).rejects.toThrow("Durable operation unavailable.");
    await expect(peer.request("x-ahp/work/list", list)).rejects.toThrow();
    expect(await peer.request("x-ahp/work/list", { announceTo: resource })).toMatchObject({ items: summaries });
    expect(projection.snapshot()).toMatchObject({ subscriptionId: initial.subscriptionId, items: summaries });
    for (let i = 0; i < 3; i++) {
      const completed = Promise.withResolvers<undefined>();
      const stop = projection.onChange(() => {
        completed.resolve(undefined);
      });
      await vi.advanceTimersByTimeAsync(5000);
      await completed.promise;
      stop();
      if (projection.snapshot().subscriptionId !== initial.subscriptionId && projection.snapshot().status === "ready") break;
    }
    const recovered = projection.snapshot();
    expect(recovered).toMatchObject({ status: "ready", items: summaries });
    expect(z.uuid().safeParse(recovered.subscriptionId).success).toBe(true);
    expect(recovered.subscriptionId).not.toBe(initial.subscriptionId);
    expect(reset).not.toHaveBeenCalled();
    stopListening();
  } finally {
    await view?.dispose();
    await peer?.connection.shutdown();
    await demo.stop();
    vi.useRealTimers();
  }
});

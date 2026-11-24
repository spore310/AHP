import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { MessageKind } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import type { RuntimeResourceDriver } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createWorkClient, type WorkChatProjectionOptions, type WorkClient, type WorkExtensionPort } from "@work";
import { channel, createReviewHost } from "./host";
import { createExamplePersistence } from "./persistence";
import { openWorkClient } from "./work";

async function until(check: () => boolean, timeout: number) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error("Timed out waiting for work reconciliation.");
    await setTimeout(25);
  }
}

export async function runWorkEventsExample() {
  const { provider } = createExamplePersistence();
  assert.ok(provider.durability);
  const delivered: { subject: string; chat: string; text: string }[] = [];
  const presentation: WorkChatProjectionOptions = { deliver(message, { recipient, chat }) {
    assert.equal(message.origin.kind, MessageKind.SystemNotification);
    delivered.push({ subject: recipient.actor.principal.subject, chat: chat.id, text: message.text });
  } };
  const driver: RuntimeResourceDriver = { key: "review-chat", kind: "chat", version: 1,
    registration: ({ resource }) => ({ route: { origin: resource, targets: [resource] }, externalAuthority: "none" }), captureRecoveryInput: () => ({}),
    ensure: () => Promise.resolve({ metadata: {}, release() {} }), restore: () => Promise.resolve({ metadata: {}, release() {} }),
    destroy: () => Promise.resolve() };
  const demo = createReviewHost("direct", { persistence: provider, durability: { storage: provider.durability, hostId: "work-events-example" },
    provider: { ...mockProvider, drivers: [driver] }, chatProjection: presentation });
  const peers: Awaited<ReturnType<typeof openWorkClient>>[] = [];
  const projections: WorkClient[] = [];
  const nativeActions: string[] = [];
  const stopNative = demo.host.sessions.onSessionEnvelope((envelope) => {
    nativeActions.push(envelope.action.type);
  });
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    const included = await demo.createReviewChat("ahp-chat:/review/updates", driver);
    const excluded = await demo.createReviewChat("ahp-chat:/review/private", driver);
    const locate = ({ kind, id, instanceId }: typeof included) => ({ kind, id, instanceId });
    const connect = async (subject: "senior" | "observer", label: string) => {
      const peer = await openWorkClient("ws://127.0.0.1:" + String(port), subject, label);
      peers.push(peer);
      return peer;
    };
    const senior = await connect("senior", "work-events-senior");
    const observer = await connect("observer", "work-events-observer");
    let dropped = 0;
    const fault: WorkExtensionPort = { request: senior.transport.request.bind(senior.transport),
      onClose: senior.transport.onClose.bind(senior.transport),
      onNotification: (method, receive) => senior.transport.onNotification(method, (params) => {
        if (method.endsWith("/changed") && z.object({ change: z.literal("cancelled") }).safeParse(params).success) {
          dropped++;
          return;
        }
        return receive(params);
      }) };
    const project = (source: WorkExtensionPort) => {
      const projection = createWorkClient(source, { reconcileIntervalMs: 5000 });
      projections.push(projection);
      return projection;
    };
    const visible = project(fault), hidden = project(observer.transport), excepted = project(senior.transport);
    const [initial, denied, privateChat, native] = await Promise.all([
      visible.subscribe({ resource: locate(included) }), hidden.subscribe({ resource: locate(included) }),
      excepted.subscribe({ resource: locate(excluded) }), senior.client.subscribe(channel),
    ]);
    assert.ok(native.result.snapshot);
    for (const view of [initial, denied, privateChat]) assert.equal(view.status, "ready");
    const concealed: unknown[] = [];
    const captureHint = (id: string | undefined) => (params: unknown) => {
      if (z.object({ subscriptionId: z.literal(id) }).safeParse(params).success) concealed.push(params);
    };
    const stopHidden = observer.transport.onNotification("x-ahp/work/changed", captureHint(denied.subscriptionId));
    const stopExcluded = senior.transport.onNotification("x-ahp/work/changed", captureHint(privateChat.subscriptionId));
    const session = locate(demo.origin());
    const submitted = await senior.request("x-ahp/work/submit", { session, requestKey: "announced-review", kind: "code.review",
      scope: [{ resource: session, include: true }], announce: [
        { resource: session, include: true, includeDescendants: true }, { resource: locate(excluded), include: false }],
      input: { topic: "release notes" } });
    const workId = z.object({ workId: z.uuid() }).parse(submitted).workId;
    const state = () => visible.snapshot().items.find((item) => item.id === workId)?.status;
    await until(() => state() === "queued", 3000);
    await senior.request("x-ahp/work/cancel", { workId });
    await until(() => dropped > 0, 3000);
    assert.equal(state(), "queued");
    await until(() => state() === "cancelled", 7500);
    const observerCount = (await hidden.refresh()).items.length, excludedCount = (await excepted.refresh()).items.length;
    assert.equal(observerCount, 0);
    assert.equal(excludedCount, 0);
    assert.deepEqual(concealed, []);
    stopHidden();
    stopExcluded();
    assert.ok(nativeActions.every((action) => !action.startsWith("chat/")));
    assert.ok(delivered.some((entry) => entry.text.includes("cancelled")));
    assert.ok(delivered.every((entry) => entry.subject === "senior" && entry.chat === included.id));
    await senior.client.shutdown();
    assert.equal(visible.snapshot().status, "disconnected");
    const next = await connect("senior", "work-events-reconnected");
    const restored = await visible.reconnect(next.transport);
    assert.equal(restored.items.find((item) => item.id === workId)?.status, "cancelled");
    return { dropped, restored: restored.status, presented: delivered.length, excluded: excludedCount, observer: observerCount };
  } finally {
    stopNative();
    await Promise.allSettled(projections.map((client) => client.dispose()));
    await Promise.allSettled(peers.map(({ client }) => client.shutdown()));
    await demo.stop();
  }
}

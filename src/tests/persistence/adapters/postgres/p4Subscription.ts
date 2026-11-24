import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { z } from "zod";
import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";
import { mockProvider } from "@sessions/mock";
import { actorFor, createReviewHost } from "../../../../../examples/advanced/host";
import { FrameLog, methodFrame, responseWithId } from "../../../websocket/helpers";

/** Hold a completed SQL read while a second public command commits, then restart the store owner. */
export async function verifyWorkSubscription(connectionString: string) {
  const resource = { kind: "session", id: "ahp-session:/postgres-work-stream" };
  let parkId: string | undefined;
  const sampled = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  async function start() {
    const provider = await createPostgresPersistenceProvider({ connectionString });
    const store = provider.durability;
    assert.ok(store);
    const demo = createReviewHost("direct", { provider: mockProvider, persistence: provider,
      restoration: { prepare: () => Promise.resolve({ bindings: [], isCurrent: () => true }) },
      durability: { hostId: "p0-conformance", storage: { async acquire(...args) {
        const host = await store.acquire(...args);
        return { ...host, work: { ...host.work, async get(domain, id) {
          const row = await host.work.get(domain, id);
          if (parkId === id) {
            parkId = undefined;
            assert.equal(row?.revision, "4");
            sampled.resolve(undefined);
            await resume.promise;
          }
          return row;
        } } };
      } } } });
    const { port } = await demo.host.start();
    const socket = new WebSocket("ws://127.0.0.1:" + String(port), "demo-senior");
    const frames = new FrameLog(socket);
    await once(socket, "open");
    let next = 0;
    const request = (method: string, params: object) => {
      const id = ++next;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
      return frames.waitFor(responseWithId(id), 7000);
    };
    assert.ok(z.object({ result: z.object({ snapshots: z.array(z.unknown()) }) }).safeParse(await request("initialize", {
      channel: "ahp-root://", clientId: "sql-view", protocolVersions: ["1.0.0"], initialSubscriptions: [],
    })).success);
    return { demo, request, frames, async close() {
      socket.close();
      await demo.stop();
    } };
  }
  const initial = await start();
  const subscription = z.object({ result: z.object({ subscriptionId: z.uuid(), streamEpoch: z.uuid(), nextCursor: z.uuid().optional(),
    items: z.array(z.object({ id: z.uuid(), revision: z.string() })) }) });
  try {
    await initial.demo.provision(undefined, resource.id);
    const root = initial.demo.host.sessions.authorization?.getResource(resource.id);
    assert.ok(root);
    const grants = initial.demo.registry.readBindings({ actor: actorFor("senior"), scope: root }).bindings;
    const caller = { ...initial.demo.connection("senior"), signal: new AbortController().signal, isCurrent: () => true };
    const work = initial.demo.host.work;
    assert.ok(work);
    const insert = (requestKey: string) => work.submit(caller, { kind: "code.review", requestKey, input: {},
      scope: [{ resource, include: true }], announce: [{ resource, include: true }] });
    const { id } = await insert("snapshot-race");
    for (const revision of ["1", "2", "3"]) await work.updateData(caller, id, { expectedDataRevision: revision, data: {} });
    await insert("continuation");
    parkId = id;
    const params = { version: 1, resource, limit: 1 };
    const firstPage = initial.request("x-ahp/work/subscribe", params);
    await Promise.race([sampled.promise, firstPage.then(() => {
      throw new Error("The first SQL row was not sampled.");
    })]);
    await work.updateData(caller, id, { expectedDataRevision: "4", data: { change: true } });
    resume.resolve(undefined);
    const page = subscription.parse(await firstPage).result;
    assert.deepEqual(page.items, [{ id, revision: "5" }]);
    assert.ok(page.nextCursor);
    await work.updateData(caller, id, { expectedDataRevision: "5", data: {} });
    const changed = await initial.frames.waitFor((frame) => methodFrame("x-ahp/work/changed")(frame)
      && z.object({ params: z.object({ workId: z.literal(id), revision: z.literal("6") }) }).safeParse(frame).success, 5000);
    assert.ok(changed);
    await initial.close();
    const restarted = await start();
    try {
      const restored = restarted.demo.host.sessions.authorization?.getResource(resource.id);
      assert.deepEqual(restored, root);
      // Restore this application's explicit current read grants on the new owner.
      for (const binding of grants) restarted.demo.registry.installBinding(binding);
      assert.ok(z.object({ error: z.object({ code: z.number() }) }).safeParse(await restarted.request("x-ahp/work/list",
        { version: 1, announceTo: resource, limit: 1, cursor: page.nextCursor })).success);
      const next = subscription.parse(await restarted.request("x-ahp/work/subscribe", params)).result;
      assert.notEqual(next.streamEpoch, page.streamEpoch);
      assert.notEqual(next.subscriptionId, page.subscriptionId);
      assert.deepEqual(next.items, [{ id, revision: "6" }]);
    } finally { await restarted.close(); }
  } finally {
    resume.resolve(undefined);
    await initial.close();
  }
}

import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { openWorkClient } from "../../../examples/advanced/work";
import { observableStorage, sessionHost } from "../sessions/durableFixture";

it("reads the canonical work detail only for the ready incarnation's owner and keeps remote mutations closed", async () => {
  const pending = Promise.withResolvers<undefined>();
  const deliver = Promise.withResolvers<undefined>();
  let park = false;
  const mutations = vi.fn();
  const database = observableStorage((host) => ({
    ...host,
    work: {
      ...host.work,
      submit(...args) {
        mutations("submit");
        return host.work.submit(...args);
      },
      replaceData(...args) {
        mutations("replaceData");
        return host.work.replaceData(...args);
      },
      settle(...args) {
        mutations("settle");
        return host.work.settle(...args);
      },
      async inspect(domain, id) {
        const row = await host.work.inspect(domain, id);
        if (park) {
          pending.resolve(undefined);
          await deliver.promise;
        }
        return row;
      },
    },
  }));
  const demo = sessionHost(database.storage);
  const clients: Awaited<ReturnType<typeof openWorkClient>>[] = [];
  try {
    const address = await demo.host.start();
    await demo.provision();
    const session = demo.origin();
    const work = database.current().work;
    const graph = await work.graph(session.domainId, session);
    assert.ok(graph);
    const submitter = { kind: "user" as const, principal: { domainId: session.domainId, subject: "senior" } };
    const scope = [{ resource: session, include: true, includeDescendants: false }];
    const { id } = await work.submit({ session, kind: "code.review", requestKey: "private-request", priority: 13, input: { item: "visible" },
      submittedData: { original: true }, targetAgentId: null, maxAttempts: 3, submitter, scope, announce: [] },
    graph.session.graphRevision, { host: 100, session: 10 }, () => true);
    await work.replaceData({ id, session, revision: "1" }, { data: { progress: 1 }, expectedDataRevision: "1" }, () => true);
    const before = await work.get(session.domainId, id);
    assert.ok(before);
    const url = "ws://127.0.0.1:" + String(address.port);
    const owner = await openWorkClient(url, "senior", "same-client-label");
    clients.push(owner);
    const other = await openWorkClient(url, "junior", "same-client-label");
    clients.push(other);
    const body = { workId: id };
    const expected = { version: 1, work: { id, session, kind: "code.review", status: "queued", priority: 13, input: { item: "visible" },
      data: { progress: 1 }, dataRevision: "2", revision: "2", scope, announce: [], entities: { owner: submitter.principal, submitter },
      attemptCount: 0, maxAttempts: 3, createdAt: before.createdAt, updatedAt: before.updatedAt } };
    expect(await owner.request("x-ahp/work/get", body)).toEqual(expected);
    expect(await other.request("x-ahp/work/get", body)).toEqual({ version: 1, work: null });
    const locator = { kind: session.kind, id: session.id, instanceId: session.instanceId };
    const execution = { ...body, attempt: 1, leaseToken: id };
    const requests = {
      submit: { requestKey: "new-request", kind: "code.review", input: {}, scope: [{ resource: locator, include: true }] },
      updateData: { ...body, expectedDataRevision: "2", data: { progress: 2 } },
      claim: { session: locator },
      renew: execution,
      complete: { ...execution, result: {} },
      fail: { ...execution, retryable: false },
      cancel: body,
    };
    for (const [method, params] of Object.entries(requests)) {
      await expect(owner.request("x-ahp/work/" + method, params)).rejects.toThrow();
    }
    expect(mutations).not.toHaveBeenCalled();
    expect(await work.get(session.domainId, id)).toEqual(before);
    park = true;
    const delayed = owner.request("x-ahp/work/get", body);
    await pending.promise;
    await demo.host.sessions.authorization?.disposeSession(session);
    await demo.provision();
    expect(demo.origin().instanceId).not.toBe(session.instanceId);
    deliver.resolve(undefined);
    expect(await delayed).toEqual({ version: 1, work: null });
  } finally {
    deliver.resolve(undefined);
    await Promise.allSettled(clients.map((peer) => peer.client.shutdown()));
    await demo.stop();
  }
});

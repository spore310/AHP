import { expect, it } from "vitest";
import { RepositoryError } from "@persistence";
import { workFixture } from "./commandsFixture";
import type { WorkApproval } from "@work";

it("withdraws a prepared detail response after a direct write changes visibility", async () => {
  const f = await workFixture({ prepare: (_caller, op, _intent, row) => Promise.resolve({
    isCurrent: () => op !== "read" || row?.data.private !== true, release() {} }) });
  const { id } = await f.service.submit(f.caller, f.request);
  const receipts: WorkApproval[] = [];
  const reader = { ...f.caller, retainReply(approval: WorkApproval) {
    receipts.push(approval);
  } };
  expect(await f.service.get(reader, id)).toMatchObject({ id });
  expect(receipts[0]?.isCurrent()).toBe(true);
  await f.host.work.replaceData({ session: f.ref, id, revision: "1" }, { expectedDataRevision: "1", data: { private: true } }, () => true);
  expect(receipts[0]?.isCurrent()).toBe(false);
  expect(await f.service.get(reader, id)).toBeNull();
  receipts[0]?.release();
  await f.host.release();
});

it.each(["cancel", "complete", "data"] as const)("keeps earlier proofs unusable after lost %s acknowledgement", async (operation) => {
  const f = await workFixture();
  const { id } = await f.service.submit(f.caller, f.request);
  const { worker, execution } = f.lease(id);
  const route = { origin: f.ref, targets: [] };
  const proof = await f.service.prepareExecutionGuard(worker, execution, route);
  const store = f.host.work;
  const unknown = (): never => {
    throw new RepositoryError("outcome_unknown", "Uncertain.");
  };
  try {
    let done: Promise<unknown>;
    if (operation === "cancel") {
      const change = store.disposition.bind(store);
      store.disposition = (...args) => change(...args).then(unknown);
      done = f.service.cancel(f.caller, id);
    } else if (operation === "complete") {
      const change = store.settle.bind(store);
      store.settle = (...args) => change(...args).then(unknown);
      done = f.service.complete(worker, execution, { result: {} });
    } else {
      const change = store.replaceData.bind(store);
      store.replaceData = (...args) => change(...args).then(unknown);
      done = f.service.updateData(f.caller, id, { expectedDataRevision: "1", data: {} });
    }
    await expect(done).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(proof.current()).toBe(false);
    const prepared = f.service.prepareExecutionGuard(worker, execution, route);
    if (operation === "data") (await prepared).release();
    else await expect(prepared).rejects.toThrow();
  } finally {
    proof.release();
    await f.host.release();
  }
});

it("withholds the reply when revocation follows admission to a durable write", async () => {
  const f = await workFixture();
  const { id } = await f.service.submit(f.caller, f.request);
  let current = true;
  const store = f.host.work;
  const write = store.replaceData.bind(store);
  store.replaceData = async (...args) => {
    const outcome = await write(...args);
    current = false;
    return outcome;
  };
  const caller = { ...f.caller, isCurrent: () => current };
  await expect(f.service.updateData(caller, id, { expectedDataRevision: "1", data: { observed: true } })).rejects.toThrow();
  expect((await store.get(f.ref.domainId, id))?.data).toEqual({ observed: true });
  await f.host.release();
});

it("invalidates a prepared guard when an acquired host releases or a scope is retired", async () => {
  for (const action of ["release", "retire"]) {
    const f = await workFixture();
    const { id } = await f.service.submit(f.caller, f.request);
    const { worker, execution } = f.lease(id);
    const proof = await f.service.prepareExecutionGuard(worker, execution, { origin: f.ref, targets: [] });
    if (action === "retire") await f.host.sessions.beginRetirement(f.ref, () => true);
    else await f.host.release();
    expect(proof.fence()).toBe(false);
    proof.release();
    await f.host.release();
  }
});

it("combines exact target membership and the active attempt with a local execution fence", async () => {
  const fixture = await workFixture();
  const { id } = await fixture.service.submit(fixture.caller, fixture.request);
  const { worker, execution } = fixture.lease(id);
  const route = { origin: fixture.ref, targets: [] };
  const guard = await fixture.service.prepareExecutionGuard(worker, execution, route);
  expect(guard.current()).toBe(true);
  await expect(fixture.service.prepareExecutionGuard(worker, execution, { ...route, origin: { ...fixture.ref, instanceId: "other" } })).rejects.toThrow();
  await expect(fixture.service.prepareExecutionGuard(worker, execution, { ...route, targets: [fixture.ref, { ...fixture.ref, instanceId: "other" }] })).rejects.toThrow();
  await expect(fixture.service.prepareExecutionGuard(worker, { ...execution, attempt: 2 }, route)).rejects.toThrow();
  await fixture.service.updateData(worker, id, { expectedDataRevision: "1", data: { done: true } }, execution);
  expect(guard.current()).toBe(false);
  guard.release();
  await fixture.host.release();
});

it("invalidates guards before an uncertain mutation and waits for locked reconciliation before issuing another", async () => {
  const fixture = await workFixture();
  const store = fixture.host.work;
  const { id } = await fixture.service.submit(fixture.caller, fixture.request);
  const { worker, execution } = fixture.lease(id);
  const route = { origin: fixture.ref, targets: [] };
  const guard = await fixture.service.prepareExecutionGuard(worker, execution, route);
  const gate = Promise.withResolvers<undefined>();
  const entered = Promise.withResolvers<undefined>();
  const replace = store.replaceData.bind(store);
  store.replaceData = async (...args) => {
    entered.resolve(undefined);
    await gate.promise;
    await replace(...args);
    throw new RepositoryError("outcome_unknown", "Unknown outcome.");
  };
  const write = fixture.service.updateData(worker, id, { expectedDataRevision: "1", data: {} }, execution);
  await entered.promise;
  expect(guard.fence()).toBe(false);
  const stranger = { ...fixture.caller, context: { ...fixture.caller.context, actor: { kind: "user" as const, principal: {
    domainId: "other", subject: "stranger" } } } };
  expect(await fixture.service.get(stranger, id)).toBeNull();
  await expect(fixture.service.prepareExecutionGuard(worker, execution, route)).rejects.toThrow();
  gate.resolve(undefined);
  await expect(write).rejects.toMatchObject({ code: "outcome_unknown" });
  const locked = Promise.withResolvers<undefined>();
  const reading = Promise.withResolvers<undefined>();
  const inspect = store.inspect.bind(store);
  store.inspect = async (...args) => {
    reading.resolve(undefined);
    await locked.promise;
    return inspect(...args);
  };
  const pending = fixture.service.prepareExecutionGuard(worker, execution, route);
  await reading.promise;
  expect(guard.fence()).toBe(false);
  locked.resolve(undefined);
  const fresh = await pending;
  expect(fresh.current()).toBe(true);
  expect(guard.fence()).toBe(false);
  fresh.release();
  guard.release();
  await fixture.host.release();
});

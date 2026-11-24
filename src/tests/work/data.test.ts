import { expect, it, vi } from "vitest";
import { createMemoryDurableStorage, type AgentRegistrationRecord } from "@persistence";
import { assertWorkDataConformance, assertTargetReplayConformance } from "../persistence/conformance/work";
import { workFixture } from "./commandsFixture";
import { workSummary } from "@work";

it("admits exact-instance work, replays immutable intent and serializes data CAS", async () => {
  const registrations = new Map<string, AgentRegistrationRecord>();
  const host = await createMemoryDurableStorage(undefined, registrations).acquire("work-conformance", () => undefined);
  try {
    await assertWorkDataConformance(host);
    await assertTargetReplayConformance(host, (record) => {
      registrations.set(record.id, record);
      return Promise.resolve();
    });
  } finally { await host.release(); }
});

it.each(["complete", "fail"] as const)("settles %s and final data in one fenced write and replays in the terminal state", async (action) => {
  const f = await workFixture();
  try {
    const { id } = await f.service.submit(f.caller, f.request);
    const { worker, execution } = f.lease(id);
    const settle = (expectedDataRevision: string) => {
      const data = { expectedDataRevision, data: { progress: 100 } };
      return action === "complete"
        ? f.service.complete(worker, execution, { result: { done: true }, data })
        : f.service.fail(worker, execution, { retryable: false, message: "private worker message", data });
    };
    const before = structuredClone(f.rows.get(id));
    await expect(settle("7")).rejects.toMatchObject({ code: "conflict" });
    expect(f.rows.get(id)).toEqual(before);
    await settle("1");
    const row = f.rows.get(id);
    if (!row) throw new Error("Missing work after settlement");
    expect(row).toMatchObject({ revision: "3", dataRevision: "2", data: { progress: 100 }, submittedData: { progress: 0 }, status: action === "complete" ? "completed" : "failed" });
    expect(row.lease).toBeUndefined();
    const view = await f.service.get(f.caller, id);
    expect(view).toMatchObject({ revision: "3", dataRevision: "2", data: { progress: 100 } });
    for (const value of ["leaseToken", "submittedData", "executionEpoch", "private worker message"]) expect(JSON.stringify(view)).not.toContain(value);
    expect(Object.keys(workSummary(row)).sort()).toEqual(["createdAt", "id", "kind", "priority", "revision", "session", "status", "updatedAt"]);
    await expect(f.service.submit(f.caller, f.request)).resolves.toEqual({ id });
    expect(f.rows.get(id)).toEqual(row);
    await expect(f.service.updateData(worker, id, { expectedDataRevision: "2", data: {} }, execution)).rejects.toMatchObject({ code: "conflict" });
    await expect(f.service.updateData(f.caller, id, { expectedDataRevision: "2", data: {} })).resolves.toMatchObject({ dataRevision: "3" });
  } finally { await f.host.release(); }
});

it("captures caller data before graph lookup and preserves idempotency after an acknowledgement is lost at full capacity", async () => {
  const f = await workFixture({ limits: { host: 1, session: 1 } });
  try {
    const entered = Promise.withResolvers<undefined>();
    const unlock = Promise.withResolvers<undefined>();
    const graph = f.host.work.graph.bind(f.host.work);
    vi.spyOn(f.host.work, "graph").mockImplementationOnce(async (...args) => {
      entered.resolve(undefined);
      await unlock.promise;
      return graph(...args);
    });
    const submit = f.host.work.submit.bind(f.host.work);
    vi.spyOn(f.host.work, "submit").mockImplementationOnce(async (...args) => {
      await submit(...args);
      throw Object.assign(new Error("Acknowledgement unavailable"), { name: "DurableCommitUncertain" });
    });
    const retry = structuredClone(f.request);
    const pending = f.service.submit(f.caller, f.request);
    await entered.promise;
    f.request.input.note = "changed";
    f.request.data.progress = 77;
    f.request.scope.length = 0;
    unlock.resolve(undefined);
    await expect(pending).rejects.toMatchObject({ name: "DurableCommitUncertain" });
    await expect(f.service.submit(f.caller, { ...retry, requestKey: "another" })).rejects.toMatchObject({ code: "conflict" });
    const { id } = await f.service.submit(f.caller, retry);
    expect(f.rows.size).toBe(1);
    expect(f.rows.get(id)).toMatchObject({ data: { progress: 0 }, input: { note: "initial" }, revision: "1" });
    const landed = f.rows.get(id);
    if (!landed) throw new Error("Missing work");
    f.rows.set(id, { ...landed, status: "cancelled", revision: "2" });
    await expect(f.service.submit(f.caller, retry)).resolves.toEqual({ id });
    expect(f.rows.get(id)?.status).toBe("cancelled");
  } finally { await f.host.release(); }
});

it("replays reordered rules and keeps today's equivalent expanded scope distinct", async () => {
  const f = await workFixture();
  try {
    const ref = { ...f.ref, kind: "chat", id: "chat:/review", instanceId: crypto.randomUUID() };
    const child = { ...f.root, ref, parent: f.ref, operationId: crypto.randomUUID() };
    await f.host.resources.reserve(child, () => true);
    await f.host.resources.activate({ ref, session: f.ref, operationId: child.operationId, expected: "creating", next: "active" }, () => true);
    const subtree = { resource: { kind: f.ref.kind, id: f.ref.id }, include: true, includeDescendants: true };
    const narrow = { resource: { kind: ref.kind, id: ref.id }, include: true };
    const command = { ...f.request, scope: [subtree], announce: [subtree, narrow] };
    const created = await f.service.submit(f.caller, command);
    await expect(f.service.submit(f.caller, { ...command, scope: [subtree, subtree], announce: [narrow, subtree, narrow] })).resolves.toEqual(created);
    await expect(f.service.submit(f.caller, { ...command, scope: [{ ...subtree, includeDescendants: false }, narrow] })).rejects.toMatchObject({ code: "conflict" });
    expect(f.rows.size).toBe(1);
  } finally { await f.host.release(); }
});

it("recovers cancelled work through its retired chat and cannot submit a new job for the retired instance", async () => {
  const f = await workFixture();
  try {
    const ref = { ...f.ref, kind: "chat", id: "chat:/retired", instanceId: crypto.randomUUID() };
    const child = { ...f.root, ref, parent: f.ref, operationId: crypto.randomUUID() };
    await f.host.resources.reserve(child, () => true);
    await f.host.resources.activate({ ref, session: f.ref, operationId: child.operationId, expected: "creating", next: "active" }, () => true);
    const command = { ...f.request, scope: [{ resource: { kind: ref.kind, id: ref.id, instanceId: ref.instanceId }, include: true }] };
    const created = await f.service.submit(f.caller, command);
    await f.host.resources.beginRetirement(f.ref, ref, () => true);
    await f.host.resources.finishRetirement(f.ref, ref);
    const cancelled = structuredClone(f.rows.get(created.id));
    expect(cancelled?.status).toBe("cancelled");
    await expect(f.service.submit(f.caller, command)).resolves.toEqual(created);
    await expect(f.service.submit(f.caller, { ...command, requestKey: "new" })).rejects.toThrow();
    const foreign = { ...f.caller, context: { ...f.caller.context, actor: { kind: "user" as const, principal: { domainId: f.ref.domainId, subject: "stranger" } } } };
    await expect(f.service.submit(foreign, command)).rejects.toThrow();
    expect(f.rows.get(created.id)).toEqual(cancelled);
    expect(f.rows.size).toBe(1);
  } finally { await f.host.release(); }
});

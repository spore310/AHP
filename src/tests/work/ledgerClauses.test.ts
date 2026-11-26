import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { createReferenceAuthorizer, type ResourceRef } from "@authorization";
import { createPolicyFactory } from "@authorization/policies";
import type { ResourceRecord, StoredSession } from "@persistence/helpers/durability/types";
import { captureWorkIntent } from "@persistence/helpers/durability/workIntent";
import { captureCreationPolicy } from "@sessions/helpers/creation";
import { createWorkAuthorizer } from "@work/helpers/authorization";
import { createWorkSelectionGraph } from "@work/helpers/selections";
import { workFixture } from "./commandsFixture";

const root = { domainId: "d", kind: "session", id: "session:/root", instanceId: "root" } as const;
const session: StoredSession = { ref: root, type: { id: "type", key: "review", version: 1 }, owner: "owner", providerId: "provider",
  lifecycle: "active", state: {}, graphRevision: "2", stateRevision: "1", lastServerSeq: 0, createdAt: "", modifiedAt: "" };
function row(resource: ResourceRef, parent?: ResourceRef, grantParent?: ResourceRef): ResourceRecord {
  return { ref: resource, session: root, parent, grantParent, owner: session.owner, providerId: session.providerId, registration: {},
    driver: { key: resource.kind, version: 1 }, operationId: resource.instanceId, lifecycle: "active", resourceRevision: "1", dataRevision: "1",
    data: {}, recoveryInput: {}, runtimeMetadata: {}, createdAt: "", modifiedAt: "" };
}
/** The root followed by `depth` resources, each one level below the previous one along the chosen edge. */
function chain(depth: number, edge: "parent" | "grantParent" = "parent"): ResourceRecord[] {
  const rows = [row(root)];
  for (let level = 1; level <= depth; level++) {
    const above = rows[level - 1]?.ref ?? root;
    const ref = { domainId: "d", kind: "chat", id: `chat:/${String(level)}`, instanceId: String(level) };
    rows.push(edge === "parent" ? row(ref, above) : row(ref, root, above));
  }
  return rows;
}
function failure(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}
const invalidSelection = { name: "WorkError", code: "invalid", message: "Invalid work resource selection." };
const denied = { name: "WorkError", code: "unauthorized" };

type Fixture = Awaited<ReturnType<typeof workFixture>>;
async function addChat(f: Fixture, id: string, parent: ResourceRef = f.ref): Promise<ResourceRef> {
  const ref = { ...f.ref, kind: "chat", id, instanceId: crypto.randomUUID() };
  const operationId = crypto.randomUUID();
  await f.host.resources.reserve({ ...f.root, ref, parent, operationId }, () => true);
  await f.host.resources.activate({ ref, session: f.ref, operationId, expected: "creating", next: "active" }, () => true);
  return ref;
}

it("P1-19 the selection graph accepts the default depth of 32 and rejects depth 33 along either parent edge", () => {
  for (const edge of ["parent", "grantParent"] as const) {
    const atLimit = chain(32, edge);
    const deepest = atLimit.at(-1)?.ref ?? root;
    const graph = createWorkSelectionGraph("d", session, atLimit);
    const { scope, graphRevision } = graph.normalize({ scope: [{ resource: { kind: deepest.kind, id: deepest.id }, include: true }] });
    expect(graph.selected(deepest, scope, graphRevision)).toBe(true);
    expect(failure(() => createWorkSelectionGraph("d", session, atLimit.toReversed()))).toBeUndefined();
    // Both storage orders are tried: a leaf-first listing reaches the limit on the recursion path, a root-first one on the stored height.
    for (const rows of [chain(33, edge), chain(33, edge).reverse()]) {
      expect(failure(() => createWorkSelectionGraph("d", session, rows))).toMatchObject(invalidSelection);
    }
  }
});

it("P1-19 a trusted depth override moves the boundary and cannot be raised above 64", () => {
  expect(failure(() => createWorkSelectionGraph("d", session, chain(2), { maxDepth: 2 }))).toBeUndefined();
  expect(failure(() => createWorkSelectionGraph("d", session, chain(3), { maxDepth: 2 }))).toMatchObject(invalidSelection);
  expect(failure(() => createWorkSelectionGraph("d", session, chain(64), { maxDepth: 64 }))).toBeUndefined();
  expect(failure(() => createWorkSelectionGraph("d", session, chain(65), { maxDepth: 64 }))).toMatchObject(invalidSelection);
  expect(() => createWorkSelectionGraph("d", session, chain(1), { maxDepth: 65 })).toThrow(TypeError);
});

it("P1-19 work submission enforces the configured selection depth on the stored resource graph", async () => {
  const f = await workFixture({ selectionLimits: { maxDepth: 2 } });
  try {
    const second = await addChat(f, "chat:/level-2", await addChat(f, "chat:/level-1"));
    await expect(f.service.submit(f.caller, { ...f.request, requestKey: "at-limit" })).resolves.toHaveProperty("id");
    await addChat(f, "chat:/level-3", second);
    await expect(f.service.submit(f.caller, { ...f.request, requestKey: "too-deep" })).rejects.toMatchObject({ name: "WorkError", code: "invalid" });
    expect(f.rows.size).toBe(1);
  } finally { await f.host.release(); }
});

it("P2-12 an execution guard refuses a target excluded beneath an included ancestor and admits its included sibling", async () => {
  const f = await workFixture();
  try {
    const included = await addChat(f, "chat:/included");
    const excluded = await addChat(f, "chat:/excluded");
    const subtree = { resource: { kind: f.ref.kind, id: f.ref.id }, include: true, includeDescendants: true };
    const { id } = await f.service.submit(f.caller, { ...f.request, scope: [subtree, { resource: { kind: excluded.kind, id: excluded.id }, include: false }] });
    expect(f.rows.get(id)?.scope.filter((rule) => !rule.include).map((rule) => rule.resource)).toEqual([excluded]);
    const { worker, execution } = f.lease(id);
    const guard = await f.service.prepareExecutionGuard(worker, execution, { origin: f.ref, targets: [included] });
    expect(guard.current()).toBe(true);
    guard.release();
    await expect(f.service.prepareExecutionGuard(worker, execution, { origin: f.ref, targets: [excluded] })).rejects.toMatchObject(denied);
    await expect(f.service.prepareExecutionGuard(worker, execution, { origin: f.ref, targets: [included, excluded] })).rejects.toMatchObject(denied);
    await expect(f.service.prepareExecutionGuard(worker, execution, { origin: excluded, targets: [] })).rejects.toMatchObject(denied);
    // The same target is guardable for work whose scope carries no exclusion, so the refusals above come from the selector rule.
    const open = await f.service.submit(f.caller, { ...f.request, requestKey: "no-exclusion", scope: [subtree] });
    const unrestricted = f.lease(open.id);
    const control = await f.service.prepareExecutionGuard(unrestricted.worker, unrestricted.execution, { origin: f.ref, targets: [excluded] });
    expect(control.current()).toBe(true);
    control.release();
  } finally { await f.host.release(); }
});

it("P2-14 an execution guard lives for the lease time left on the store clock, not on the local wall clock", async () => {
  const f = await workFixture();
  const { id } = await f.service.submit(f.caller, f.request);
  const { worker, execution } = f.lease(id);
  const route = { origin: f.ref, targets: [] };
  const expiresAt = Date.parse(f.rows.get(id)?.lease?.expiresAt ?? "");
  // Every locked inspection carries the store's own clock. Only that sample is replaced here.
  let remainingOnStoreClock = 0;
  const store = f.host.work;
  const inspect = store.inspect.bind(store);
  store.inspect = async (...args) => {
    const observed = await inspect(...args);
    return observed && { ...observed, databaseTime: expiresAt - remainingOnStoreClock };
  };
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  try {
    // The local wall clock still shows most of the 60-second lease, while the store clock has reached its expiry.
    expect(expiresAt - Date.now()).toBeGreaterThan(50_000);
    await expect(f.service.prepareExecutionGuard(worker, execution, route)).rejects.toMatchObject(denied);
    remainingOnStoreClock = 30_000;
    const guard = await f.service.prepareExecutionGuard(worker, execution, route);
    expect(guard.current()).toBe(true);
    // A wall clock that jumps a day past the recorded expiry does not end a lease the store clock still holds open.
    vi.setSystemTime(expiresAt + 86_400_000);
    expect(Date.now()).toBeGreaterThan(expiresAt);
    expect(guard.current()).toBe(true);
    vi.advanceTimersByTime(29_999);
    expect(guard.fence()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(guard.fence()).toBe(false);
    expect(guard.current()).toBe(false);
    guard.release();
  } finally {
    vi.useRealTimers();
    await f.host.release();
  }
});

it("P2-14 a renewal approval judges lease expiry by the sampleLease store clock and fails closed without a sample", async () => {
  const f = await workFixture();
  const { id } = await f.service.submit(f.caller, f.request);
  const leased = f.lease(id);
  const worker = { ...leased.worker, context: { ...leased.worker.context, agentGeneration: 1 } };
  const permit = { id: "work.renew", revision: 1 };
  const purpose = { actor: { mode: "direct-grant" as const, actors: ["user" as const, "agent" as const] }, reveal: true };
  const rules = { admitted: { policies: [permit], namespaces: [] }, mandatory: [] };
  const admission = { sessionType: f.session.type, providerId: f.session.providerId };
  const policies = createPolicyFactory({ policies: [{ ...permit, operations: { execute: purpose }, challenge: { required: false } }],
    bindings: [{ ...admission, ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now: Date.now });
  registry.installAdmission(admission);
  registry.installResource({ resource: f.ref, owner: f.caller.context.actor.principal, externalAuthority: "none", admission, route: { origin: f.ref, targets: [f.ref] } });
  registry.installBinding({ id: "worker", actor: worker.context.actor, scope: f.ref, revision: 1, roles: [], policies: [permit],
    authority: { kind: "host-policy", policy: permit } });
  const policy = captureCreationPolicy({ rules, work: { operations: { renew: { purpose: "execute", policies: [permit] } } },
    creation: { capability: { key: "create", revision: 1 }, prepare: () => Promise.resolve({ effect: "deny", release() {} }) } });
  const options = { registry, policies, ceiling: rules, allowedKinds: ["review"], resolveType: () => ({ ...f.type, policy }),
    session: (ref: typeof f.ref) => f.host.sessions.get(ref), isSessionCurrent: () => true };
  // The store's own sample supplies the lease expiry. Only its clock reading is replaced here.
  let remainingOnStoreClock = 0;
  const sampled = createWorkAuthorizer({ ...options, async sampleLease(fence) {
    const sample = await f.host.work.sampleLease(fence);
    return sample && { ...sample, databaseTime: Date.parse(sample.expiresAt) - remainingOnStoreClock };
  } });
  const renew = (authorizer: typeof sampled) => {
    const current = f.rows.get(id);
    assert.ok(current);
    return authorizer.prepare(worker, "renew", captureWorkIntent(current), current);
  };
  vi.useFakeTimers({ toFake: ["performance"] });
  try {
    const stored = f.rows.get(id);
    assert.ok(stored?.lease);
    // The local wall clock shows a live lease. No store sample, or a store clock at the expiry, still refuses the renewal.
    expect(Date.parse(stored.lease.expiresAt) - Date.now()).toBeGreaterThan(50_000);
    await expect(renew(createWorkAuthorizer(options))).rejects.toMatchObject(denied);
    await expect(renew(sampled)).rejects.toMatchObject(denied);
    // Moving only the store clock back inside the lease admits the same renewal.
    remainingOnStoreClock = 30_000;
    (await renew(sampled)).release();
    // The local wall clock is years past the recorded expiry. The store clock leaves 30 seconds, and exactly those are granted.
    f.rows.set(id, { ...stored, lease: { ...stored.lease, expiresAt: "2020-01-01T00:00:00.000Z" } });
    const approval = await renew(sampled);
    expect(approval.isCurrent()).toBe(true);
    vi.advanceTimersByTime(29_999);
    expect(approval.fence()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(approval.fence()).toBe(false);
    expect(approval.isCurrent()).toBe(false);
    approval.release();
  } finally {
    vi.useRealTimers();
    await f.host.release();
  }
});

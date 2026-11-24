import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import type { DurableHost } from "@persistence";
import { workFixture } from "../../work/commandsFixture";
import { createReferenceAuthorizer } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import { createWorkAuthorizer } from "@work/helpers/authorization";
import { captureCreationPolicy } from "@sessions/helpers/creation";
import { createWorkViews, type WorkListRequest } from "@work/helpers/views";
import type { WorkApproval, WorkRequestContext } from "@work";

export async function assertFiniteWorkPages(host: DurableHost) {
  const f = await workFixture({}, host);
  try {
    const keys = [];
    for (let i = 0; i < 4; i++) keys.push((await f.service.submit(f.caller, { ...f.request, requestKey: String(i) })).id);
    const first = await host.work.pageKeys(f.ref, 2);
    assert.ok(first.upper && first.rows.length === 2);
    await setTimeout(2);
    await f.service.submit(f.caller, { ...f.request, requestKey: "later" });
    const second = await host.work.pageKeys(f.ref, 2, first.rows[1], first.upper);
    assert.equal(second.rows.length, 2);
    assert.deepEqual(new Set([...first.rows, ...second.rows].map((r) => r.id)), new Set(keys));
    assert.deepEqual(second.rows[1], first.upper);
    assert.deepEqual((await host.work.pageKeys(f.ref, 2, first.upper, first.upper)).rows, []);
    await assert.rejects(host.work.pageKeys({ ...f.ref, id: "wrong-session" }, 2));
  } finally { f.service.close(); }
}

export async function assertWorkPageProjection(host: DurableHost) {
  const f = await workFixture({}, host);
  const policy = { id: "review.list", revision: 1 };
  const rules = { admitted: { policies: [policy], namespaces: [] }, mandatory: [] };
  const purpose = { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, reveal: true };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: { discover: purpose }, challenge: { required: false } }],
    bindings: [{ sessionType: f.session.type, providerId: f.session.providerId, ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now: Date.now });
  const admission = { sessionType: f.session.type, providerId: f.session.providerId };
  registry.installAdmission(admission);
  registry.installResource({ resource: f.ref, owner: f.caller.context.actor.principal, externalAuthority: "none", admission, route: { origin: f.ref, targets: [f.ref] } });
  registry.installBinding({ id: "read", actor: f.caller.context.actor, scope: f.ref, revision: 1, roles: [], policies: [policy],
    authority: { kind: "host-policy", policy } });
  let indeterminate = false, pollOnly = false, generation = 1;
  const captured = captureCreationPolicy({ rules, creation: { capability: { key: "create", revision: 1 },
    prepare: () => Promise.resolve({ effect: "deny", release() {} }) }, work: {
    operations: { read: { purpose: "discover", policies: [policy] } }, prepare: (facts) => {
      if (indeterminate) throw new Error("private-policy-failure");
      if (pollOnly) return Promise.resolve({ effect: "allow" as const, isCurrent: () => true, validUntil: Date.now() + 60000, release() {} });
      return Promise.resolve(facts.input.visible === true
        ? { effect: "allow" as const, invalidation: "registry" as const, isCurrent: () => true, validUntil: Date.now() + 60000, release() {} }
        : { effect: "deny" as const, release() {} });
    } } });
  const resolveType = () => ({ ...f.type, policy: captured });
  const auth = createWorkAuthorizer({ registry, policies, ceiling: rules, allowedKinds: ["review"], resolveType,
    session: (ref) => host.sessions.get(ref), isSessionCurrent: () => true });
  const views = createWorkViews({ repository: () => host.work, resolveType, allowedKinds: ["review"],
    prepare: auth.prepareViewRead.bind(auth), captureAuthority() {
      const version = generation;
      return () => version === generation;
    } });
  const receipts: WorkApproval[] = [];
  const caller: WorkRequestContext = { ...f.caller, retainReply(proof) {
    receipts.push(proof);
  } };
  const visibility = { isCurrent: () => true, fence: () => true, release() {} };
  const request: WorkListRequest = { version: 1, announceTo: { kind: "session", id: f.ref.id }, limit: 1 };
  const read = async (r: WorkListRequest, recipient = caller, subscription?: string) => {
    const target = await views.resolve(recipient, r);
    try {
      return await views.list(recipient, r, target, visibility, subscription);
    } finally {
      target.release();
    }
  };
  try {
    const announce = f.request.scope;
    for (let i = 0; i < 129; i++) await f.service.submit(f.caller, { ...f.request, announce, requestKey: "hidden-" + String(i) });
    await setTimeout(2);
    const allowed = await f.service.submit(f.caller, { ...f.request, announce, requestKey: "visible", input: { visible: true }, data: { private: true } });
    const prefix = await read(request, caller, "subscription");
    assert.deepEqual(prefix.items, []);
    assert.ok(prefix.nextCursor);
    const continuation = { ...request, cursor: prefix.nextCursor };
    await assert.rejects(read(continuation, { ...caller, context: { ...caller.context, connectionId: "foreign" } }), { code: "stale" });
    await assert.rejects(read({ ...continuation, limit: 2 }), { code: "stale" });
    const otherSignal = { ...caller, signal: new AbortController().signal };
    const page = await read(continuation, otherSignal);
    assert.deepEqual(page.items.map((item) => item.id), [allowed.id]);
    assert.equal(page.nextCursor, undefined);
    assert.deepEqual(Object.keys(page.items[0] ?? {}).sort(), ["createdAt", "id", "kind", "priority", "revision", "session", "status", "updatedAt"]);
    const next = await read(request, caller, "subscription");
    views.releaseSubscription(caller.context.connectionId, "subscription");
    await assert.rejects(read({ ...request, cursor: next.nextCursor }), { code: "stale" });
    const previous = await read(request);
    generation++;
    await assert.rejects(read({ ...request, cursor: previous.nextCursor }), { code: "stale" });
    indeterminate = true;
    await assert.rejects(read(request), { code: "exhausted" });
    indeterminate = false;
    pollOnly = true;
    const row = await host.work.get(f.ref.domainId, allowed.id);
    assert.ok(row);
    const single = await auth.prepare(caller, "read", row, row);
    assert.equal(single.isCurrent(), true);
    single.release();
    await assert.rejects(read(request), { code: "exhausted" });
  } finally {
    for (const proof of receipts) proof.release();
    views.close();
    f.service.close();
  }
}

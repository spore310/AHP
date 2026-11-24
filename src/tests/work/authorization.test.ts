import { expect, it, vi } from "vitest";
import { createReferenceAuthorizer, type PolicyActorRef } from "@authorization";
import { captureWorkIntent } from "@persistence/helpers/durability/workIntent";
import { createToolPolicyFactory } from "@toolPolicy";
import { captureCreationPolicy, captureCreationSecurity, validateCreationRegistrations } from "@sessions/helpers/creation";
import { createWorkAuthorizer, type SessionWorkPolicyRegistration, type WorkPolicyFacts, type WorkPolicyRestriction } from "@work/helpers/authorization";
import { workFixture } from "./commandsFixture";
import { createAuthorityLossMonitor, lostWorkPolicy } from "@work/helpers/authorityLoss/helpers";

const permit = { id: "work.review", revision: 1 };
const extra = { id: "tool.ordinary", revision: 1 };
const challenge = { id: "work.challenge", revision: 1 };
const purpose = { actor: { mode: "direct-grant" as const, actors: ["user" as const, "agent" as const] }, reveal: true };
const operations = { submit: { purpose: "invoke" as const, policies: [permit] }, read: { purpose: "discover" as const, policies: [permit] } };
const rules = { admitted: { policies: [permit, extra], namespaces: [] }, mandatory: [] };
it("distinguishes a proved denial from an unavailable authority source or exhausted slot", async () => {
  const parked = Promise.withResolvers<undefined>();
  const entered = Promise.withResolvers<undefined>();
  const f = await setup({ operations, prepare: async () => {
    entered.resolve(undefined);
    await parked.promise;
    return { effect: "deny", release() {} };
  } });
  f.grant();
  const auth = createWorkAuthorizer({ ...f.options, maxPending: 1 });
  const { id } = await f.service.submit(f.caller, f.request);
  const { worker } = f.lease(id);
  const before = structuredClone(f.rows.get(id));
  const hook = vi.fn(() => ({ action: "cancel" as const }));
  let source = auth;
  const monitor = createAuthorityLossMonitor({ hooks: { onLeaseAuthorityLost: hook }, repository: () => f.host.work, mutate: (_id, run) => run(),
    assess: async () => await lostWorkPolicy(() => source.prepare(f.caller, "read", f.intent))
      ? { executor: worker.agent, reason: "policy-changed" }
      : undefined });
  const first = auth.prepare(f.caller, "read", f.intent);
  await entered.promise;
  await expect(auth.prepare(f.caller, "read", f.intent)).rejects.toMatchObject({ name: "WorkError" });
  monitor.signal();
  await monitor.idle();
  expect(hook).not.toHaveBeenCalled();
  parked.resolve(undefined);
  await expect(first).rejects.toMatchObject({ name: "ConfirmedWorkDenial" });
  const unavailable = createWorkAuthorizer({ ...f.options, session: () => Promise.reject(new Error("storage unavailable")) });
  source = unavailable;
  monitor.signal();
  await monitor.idle();
  expect(hook).not.toHaveBeenCalled();
  expect(f.rows.get(id)).toEqual(before);
  await expect(unavailable.prepare(f.caller, "read", f.intent)).rejects.toMatchObject({ name: "WorkError" });
  source = auth;
  monitor.signal();
  await monitor.idle();
  expect(hook).toHaveBeenCalledOnce();
  expect(f.rows.get(id)?.status).toBe("cancelled");
  monitor.close();
  await f.host.release();
});

it("withholds work details when the canonical discovery decision permits the operation but withholds disclosure", async () => {
  const f = await setup(undefined, false, undefined, false, true);
  f.grant();
  f.grant(extra);
  expect((await f.registry.evaluate({ actor: f.caller.context, scope: f.ref, route: { origin: f.ref, targets: [f.ref] },
    operation: "discover", policyRef: permit, bindingId: permit.id })).decision).toMatchObject({ effect: "allow", reveal: false });
  await expect(createWorkAuthorizer(f.options).prepare(f.caller, "read", f.intent)).rejects.toMatchObject({ code: "unauthorized" });
});
async function setup(work: SessionWorkPolicyRegistration = { operations }, dynamicChallenge = false, namespace?: () => typeof permit[],
  missingEvaluator = false, conceal = false) {
  const f = await workFixture();
  const { kind, input, requestKey } = f.request;
  const intent = { session: f.ref, kind, input, submittedData: {}, requestKey, submitter: f.caller.context.actor,
    scope: [{ resource: f.ref, include: true, includeDescendants: false }], announce: [], maxAttempts: 3, priority: 0, targetAgentId: null };
  const compiled = [permit, extra, challenge].map((ref) => ({
    ...ref, operations: { invoke: { ...purpose, ...(missingEvaluator ? { requiredPermissions: ["work.check"] } : {}) },
      discover: { ...purpose, reveal: !(conceal && ref === extra) }, execute: purpose },
    challenge: { required: ref === challenge },
  }));
  const policies = createToolPolicyFactory({ policies: compiled,
    ...(namespace && { namespaces: [{ name: "work.ceiling", revision: 1, policies: compiled, resolve: namespace }] }),
    bindings: [{ sessionType: f.session.type, providerId: f.session.providerId, ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now: Date.now });
  registry.installAdmission({ sessionType: f.session.type, providerId: f.session.providerId });
  registry.installResource({ resource: f.ref, owner: f.caller.context.actor.principal, externalAuthority: "none",
    admission: { sessionType: f.session.type, providerId: f.session.providerId }, route: { origin: f.ref, targets: [f.ref] },
    ...(dynamicChallenge ? { mandatory: [{ ref: challenge, applicable: true }] } : {}),
    ...(conceal ? { mandatory: [{ ref: extra, applicable: true }] } : {}) });
  function grant(ref = permit, actor: PolicyActorRef = f.caller.context.actor, id = ref.id) {
    registry.installBinding({ id, actor, scope: f.ref, revision: 1, roles: [], policies: [ref],
      authority: { kind: "host-policy", policy: ref } });
  }
  const captured = captureCreationPolicy({ rules, work, creation: { capability: { key: "create", revision: 1 },
    prepare: () => Promise.resolve({ effect: "deny", release() {} }) } });
  const options = { registry, policies, ceiling: rules, allowedKinds: ["review"], resolveType: () => ({ ...f.type, policy: captured }),
    session: (ref: typeof f.ref) => f.host.sessions.get(ref), isSessionCurrent: () => true };
  return { ...f, grant, options, registry, captured, intent };
}

it("requires explicit work grants and extinguishes a genuine approval after revocation", async () => {
  const f = await setup();
  const auth = createWorkAuthorizer(f.options);
  f.grant(extra);
  await expect(auth.prepare(f.caller, "submit", f.intent)).rejects.toMatchObject({ code: "unauthorized" });
  f.grant();
  const approval = await auth.prepare(f.caller, "submit", f.intent);
  expect(approval.isCurrent()).toBe(true);
  expect(approval.fence()).toBe(true);
  expect(f.registry.removeBinding({ bindingId: permit.id, scope: f.ref, revision: 1 })).toBe(true);
  expect(approval.isCurrent()).toBe(false);
  expect(approval.fence()).toBe(false);
  approval.release();
});

it("denies an unregistered operation, a narrowed kind and a dynamic mandatory challenge", async () => {
  const f = await setup(undefined, true);
  f.grant();
  f.grant(challenge);
  for (const [operation, allowedKinds] of [["submit", ["review"]], ["claim", ["review"]], ["read", []]] as const) {
    await expect(createWorkAuthorizer({ ...f.options, allowedKinds }).prepare(f.caller, operation, f.intent)).rejects.toMatchObject({ code: "unauthorized" });
  }
});

it("keeps submission, reading and publication independent and gives consumers detached participant facts", async () => {
  const captured: WorkPolicyFacts[] = [];
  const release = vi.fn();
  let permitted = true;
  const f = await setup({ operations: { submit: operations.submit },
    prepare: (facts) => {
      captured.push(facts);
      return Promise.resolve({ effect: "allow", isCurrent: () => permitted, validUntil: Date.now() + 60000, release });
    } });
  f.grant();
  const auth = createWorkAuthorizer(f.options);
  const detail = await f.service.submit(f.caller, f.request);
  const row = f.rows.get(detail.id);
  if (!row) throw new Error("Missing seeded row");
  const approval = await auth.prepare(f.caller, "submit", captureWorkIntent(row), row);
  expect(captured).toHaveLength(1);
  const facts = captured[0];
  expect(facts?.entities).toEqual({ submitter: f.caller.context.actor, owner: f.caller.context.actor.principal });
  expect(facts?.work).toEqual({ id: detail.id, status: "queued", revision: "1", dataRevision: "1", attempt: 0 });
  expect(facts).not.toHaveProperty("lease");
  expect(facts).not.toHaveProperty("requestKey");
  expect(Object.isFrozen(facts?.input)).toBe(true);
  permitted = false;
  expect(approval.isCurrent()).toBe(false);
  approval.release();
  approval.release();
  expect(release).toHaveBeenCalledTimes(1);
  await expect(auth.prepare(f.caller, "read", f.intent, row)).rejects.toMatchObject({ code: "unauthorized" });
  await expect(auth.prepare(f.caller, "submit", { ...f.intent, announce: f.intent.scope })).rejects.toMatchObject({ code: "unauthorized" });
  expect(captured).toHaveLength(1);
});

it("runs narrowing only after canonical authorization and discards results that arrive after revocation", async () => {
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const release = vi.fn();
  const f = await setup({ operations, prepare: async () => {
    entered.resolve(undefined);
    await resume.promise;
    return { effect: "allow", validUntil: Date.now() + 60000, isCurrent: () => true, release };
  } });
  const auth = createWorkAuthorizer(f.options);
  await expect(auth.prepare(f.caller, "read", f.intent)).rejects.toMatchObject({ code: "unauthorized" });
  f.grant();
  const result = auth.prepare(f.caller, "read", f.intent);
  await entered.promise;
  f.registry.removeBinding({ bindingId: permit.id, scope: f.ref, revision: 1 });
  resume.resolve(undefined);
  await expect(result).rejects.toMatchObject({ code: "unauthorized" });
  expect(release).toHaveBeenCalledTimes(1);
});

it("requires a real evaluator and evaluates a distinct host namespace against the work facts", async () => {
  const missing = await setup(undefined, false, undefined, true);
  missing.grant();
  await expect(createWorkAuthorizer(missing.options).prepare(missing.caller, "submit", missing.intent)).rejects.toMatchObject({ code: "unauthorized" });
  const select = vi.fn<() => typeof permit[]>(() => []);
  const f = await setup(undefined, false, select);
  f.grant();
  const auth = createWorkAuthorizer({ ...f.options, ceiling: { admitted: { policies: [], namespaces: [{ name: "work.ceiling", revision: 1 }] }, mandatory: [] } });
  await expect(auth.prepare(f.caller, "submit", f.intent)).rejects.toMatchObject({ code: "unauthorized" });
  select.mockReturnValue([permit]);
  const approval = await auth.prepare(f.caller, "submit", f.intent);
  expect(approval.isCurrent()).toBe(true);
  approval.release();
});

it("authorizes a cross-principal agent only with a canonical scoped executor grant", async () => {
  const seen: WorkPolicyFacts[] = [];
  const f = await setup({ operations: { claim: { purpose: "execute", policies: [permit] } }, prepare: (facts) => {
    seen.push(facts);
    return Promise.resolve({ effect: "allow", validUntil: Date.now() + 60000, isCurrent: () => true, release() {} });
  } });
  const principal = { domainId: f.ref.domainId, subject: "remote-worker" };
  const actor = { kind: "agent" as const, agentId: "canonical-reviewer", principal };
  const worker = { ...f.caller, context: { ...f.caller.context, actor, agentGeneration: 1 }, executionEpoch: "2",
    agent: { actorAgentId: actor.agentId, principal, registrationId: crypto.randomUUID(), agentKey: "review" } };
  const auth = createWorkAuthorizer(f.options);
  f.grant();
  await expect(auth.prepare(worker, "claim", f.intent)).rejects.toMatchObject({ code: "unauthorized" });
  f.grant(permit, actor, "cross-principal-review");
  const receipt = await auth.prepare(worker, "claim", f.intent);
  expect(seen[0]?.entities).toEqual({ owner: f.caller.context.actor.principal, submitter: f.caller.context.actor, executor: worker.agent });
  receipt.release();
});

it("fails registration before installing admissions when a work or mandatory reference requires a challenge", async () => {
  const f = await setup();
  const security = captureCreationSecurity({ policies: f.options.policies, registry: f.registry });
  if (!security) throw new Error("Expected canonical security");
  for (const ref of [challenge, { id: "unknown", revision: 1 }]) {
    const policy = { ...f.captured, work: { operations: { submit: { purpose: "invoke" as const, policies: [ref] } } } };
    const resolved = { ...f.type, policy };
    expect(() => {
      validateCreationRegistrations(security, { catalogue: {
        list: () => [f.type.definition], resolveExisting: () => resolved, resolveForCreation: () => resolved,
      } });
    }).toThrow();
  }
  expect(() => createWorkAuthorizer({ ...f.options, ceiling: { ...rules, mandatory: [challenge] } })).toThrow();
  for (const mandatory of [[], [challenge]]) {
    const admitted = { policies: [permit, challenge], namespaces: [] };
    const policies = createToolPolicyFactory({ policies: [permit, challenge].map((ref) => ({ ...ref,
      operations: { invoke: purpose }, challenge: { required: ref === challenge } })),
    bindings: [{ sessionType: f.type.definition, providerId: f.type.definition.providerId, admitted, mandatory }] });
    const registry = createReferenceAuthorizer({ policies, now: Date.now });
    const install = vi.spyOn(registry, "installAdmissions");
    const scope = captureCreationSecurity({ policies, registry });
    if (!scope) throw new Error("Expected creation security");
    const selected = mandatory.length ? permit : challenge;
    const policy = { ...f.captured, rules: { admitted, mandatory }, work: { operations: { submit: { purpose: "invoke" as const, policies: [selected] } } } };
    const resolved = { ...f.type, policy };
    expect(() => {
      validateCreationRegistrations(scope, { catalogue: { list: () => [f.type.definition], resolveExisting: () => resolved, resolveForCreation: () => resolved } });
    }).toThrow();
    expect(install).not.toHaveBeenCalled();
  }
});

it("rejects malformed, expired, denied and failing restrictions independently", async () => {
  const release = vi.fn();
  let returned: unknown;
  const f = await setup({ operations, prepare: () => {
    if (returned instanceof Error) throw returned;
    return Promise.resolve(returned as WorkPolicyRestriction);
  } });
  f.grant();
  const run = () => createWorkAuthorizer(f.options).prepare(f.caller, "read", f.intent);
  for (const invalid of [null, { effect: "deny", release }, { effect: "allow", validUntil: 1, release, isCurrent: () => true },
    { effect: "allow", validUntil: Date.now() + 30000, release, isCurrent: () => false },
    { effect: "allow", validUntil: Date.now() + 30000, release, isCurrent: () => Promise.resolve(true) },
    { effect: "allow", validUntil: Date.now() + 30000, release }, new Error("private callback error")]) {
    returned = invalid;
    await expect(run()).rejects.toMatchObject({ code: "unauthorized" });
  }
  expect(release).toHaveBeenCalledTimes(5);
});

it("replays an exact retired anchor only after checking current session authority and the immutable intent", async () => {
  const f = await setup();
  const target = { ...f.ref, kind: "chat", id: "chat:/review", instanceId: crypto.randomUUID() };
  const op = crypto.randomUUID();
  await f.host.resources.reserve({ ...f.root, ref: target, operationId: op, parent: f.ref }, () => true);
  await f.host.resources.activate({ session: f.ref, ref: target, operationId: op, expected: "creating", next: "active" }, () => true);
  f.registry.installResource({ resource: target, owner: f.caller.context.actor.principal, externalAuthority: "none",
    admission: { sessionType: f.session.type, providerId: f.session.providerId }, route: { origin: f.ref, targets: [target] } });
  const item = await f.service.submit(f.caller, { ...f.request, scope: [{ include: true, resource: { kind: target.kind, id: target.id } }] });
  const row = f.rows.get(item.id);
  if (!row) throw new Error("Missing seeded row");
  const auth = createWorkAuthorizer({ ...f.options, resource: (ref) => f.host.resources.get(ref) });
  const requested = { ...f.intent, input: row.input, submittedData: row.submittedData, scope: row.scope };
  f.grant();
  await expect(auth.prepare(f.caller, "submit", requested, row)).rejects.toMatchObject({ code: "unauthorized" });
  await f.host.resources.beginRetirement(f.ref, target, () => true);
  await f.host.resources.finishRetirement(f.ref, target);
  f.registry.teardown(target);
  await expect(auth.prepare(f.caller, "submit", { ...requested, input: { changed: true } }, row)).rejects.toMatchObject({ code: "unauthorized" });
  const replay = await auth.prepare(f.caller, "submit", requested, row);
  expect(replay.isCurrent()).toBe(true);
  replay.release();
  f.registry.removeBinding({ bindingId: permit.id, scope: f.ref, revision: 1 });
  await expect(auth.prepare(f.caller, "submit", requested, row)).rejects.toMatchObject({ code: "unauthorized" });
});

it("bounds preparation, retains unsettled capacity, and releases a late restriction once", async () => {
  const waiting = Promise.withResolvers<{ effect: "deny"; release(): void }>();
  const prepare = vi.fn(() => waiting.promise);
  const f = await setup({ operations, prepare });
  f.grant();
  const auth = createWorkAuthorizer({ ...f.options, prepareDeadlineMs: 40, maxPending: 1 });
  const attempt = () => auth.prepare(f.caller, "submit", f.intent);
  await expect(attempt()).rejects.toMatchObject({ code: "unauthorized" });
  await expect(attempt()).rejects.toMatchObject({ code: "unauthorized" });
  expect(prepare).toHaveBeenCalledTimes(1);
  const release = vi.fn();
  waiting.resolve({ effect: "deny", release });
  await vi.waitFor(() => {
    expect(release).toHaveBeenCalledOnce();
  });
});

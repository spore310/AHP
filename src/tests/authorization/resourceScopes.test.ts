import { afterEach, describe, expect, it, vi } from "vitest";
import { createResourceOperations } from "@authorization";
import { resourceFixture } from "./resourceFixture";

const required = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error("Missing required test value");
  return value;
};
const owned: Array<ReturnType<typeof resourceFixture>> = [];
const fixture = (options?: Parameters<typeof resourceFixture>[0]) => {
  const value = resourceFixture(options);
  owned.push(value);
  return value;
};
afterEach(() => {
  for (const item of owned.splice(0)) item.resources.dispose();
  vi.useRealTimers();
});

describe("resource operation authority", () => {
  it.each([["terminal", "input"], ["terminal", "terminate"], ["workspace", "write"], ["chat", "mutate"]])("R01 %s read cannot authorize %s", async (targetKind, operation) => {
    const f = fixture({ targetKind });
    const read = await f.resources.authorize(f.request()).ticket;
    expect(read).toBeDefined();
    expect(f.resources.commit(required(read), f.admission)).toBe(true);
    expect(await f.resources.authorize(f.request(operation)).ticket).toBeUndefined();
    for (const ref of f.refs) f.grant(ref, ["read", operation]);
    const allowed = await f.resources.authorize(f.request(operation)).ticket;
    expect(allowed).toBeDefined();
    expect(f.resources.commit(required(allowed), f.admission)).toBe(true);
    expect(f.commits).toHaveLength(2);
  });
  it("R02 shared target requires every exact origin constraint and registered route", async () => {
    const f = fixture();
    f.grant(f.target, ["read", "write"]);
    f.grant(f.second, ["read", "write"]);
    f.grant(f.otherChat, ["read", "write"]);
    expect(await f.resources.authorize(f.request("write")).ticket).toBeUndefined();
    const other = await f.resources.authorize(f.request("write", f.otherRoute)).ticket;
    expect(other).toBeDefined();
    expect(f.resources.commit(required(other), f.admission)).toBe(true);
    expect(await f.resources.authorize(f.request("write", { origin: f.first, targets: [f.target] })).ticket).toBeUndefined();
    expect(await f.resources.authorize(f.request("write", { origin: f.second, targets: [f.chat, f.target] })).ticket).toBeUndefined();
    expect(f.commits).toHaveLength(1);
  });
  it("R02 registered route updates invalidate tickets without exposing installation capabilities", async () => {
    const f = fixture();
    const ticket = await f.resources.authorize(f.request()).ticket;
    const registered = required(f.registry.readResource(f.target));
    expect(Object.isFrozen(registered)).toBe(true);
    expect(registered).not.toHaveProperty("installation");
    f.resources.install({ ...registered, allowedRoutes: [] });
    expect(f.resources.commit(required(ticket), f.admission)).toBe(false);
    expect(await f.resources.authorize(f.request("read", f.otherRoute)).ticket).toBeUndefined();
    const fresh = await f.resources.authorize(f.request()).ticket;
    expect(f.resources.commit(required(fresh), f.admission)).toBe(true);
  });
  it.each(["missing-evaluator", "provider-deny", "missing-proof", "stale-instance", "unknown-type", "unsupported-operation"])("R03 fails closed for %s", async (condition) => {
    const f = fixture({ mandatory: true, evaluator: condition !== "missing-evaluator", external: condition === "missing-proof" });
    if (condition === "provider-deny") f.provider(false);
    if (condition === "missing-proof") f.proof(false);
    if (condition === "stale-instance") f.instances.set(f.target.id, "replacement");
    if (condition === "unknown-type") {
      f.registry.teardown(f.target);
      f.registry.installResource({ resource: f.target, route: f.route, owner: { domainId: "local", subject: "owner" }, externalAuthority: "none" });
    }
    expect(await f.resources.authorize(f.request(condition === "unsupported-operation" ? "shell" : "read")).ticket).toBeUndefined();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("R03 missing kind/type registrations and invalid finite bounds fail closed", () => {
    const f = fixture();
    expect(() => createResourceOperations({ registry: f.registry, policies: f.policies, kinds: [], types: f.types })).toThrow();
    expect(() => createResourceOperations({ registry: f.registry, policies: f.policies, kinds: f.kinds, types: f.types, maxPending: 0 })).toThrow();
    expect(() => {
      f.resources.install({ ...required(f.registry.readResource(f.target)), admission: { sessionType: { key: "unregistered", version: 1 }, providerId: "provider" } });
    }).toThrow();
    expect(() => {
      f.resources.install({ ...required(f.registry.readResource(f.target)), allowedRoutes: Array.from({ length: 17 }, () => f.route) });
    }).toThrow();
  });
  it("R05 foreign/copied/replayed tickets cannot mutate, and final callbacks cannot replace instances", async () => {
    const f = fixture();
    const other = fixture();
    const ticket = await f.resources.authorize(f.request()).ticket;
    expect(other.resources.commit(required(ticket), other.admission)).toBe(false);
    expect(f.resources.commit({ ...required(ticket) }, f.admission)).toBe(false);
    f.onCurrent(() => {
      f.instances.set(f.target.id, "new");
    });
    expect(f.resources.commit(required(ticket), f.admission)).toBe(false);
    expect(f.resources.commit(required(ticket), f.admission)).toBe(false);
    expect(f.commits).toHaveLength(0);
    f.onCurrent(() => {});
    f.instances.set(f.target.id, f.target.instanceId);
    const fresh = await f.resources.authorize(f.request()).ticket;
    expect(f.resources.commit(required(fresh), f.admission)).toBe(true);
    expect(f.resources.commit(required(fresh), f.admission)).toBe(false);
  });
  it("R05 timeout retains noncooperative resolver ownership and prevents late tickets", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 5, maxPending: 1 });
    const parked = Promise.withResolvers<undefined>();
    f.onResolve(() => parked.promise);
    const first = f.resources.authorize(f.request()).ticket;
    await vi.advanceTimersByTimeAsync(6);
    expect(await first).toBeUndefined();
    expect(f.resources.stats()).toEqual({ active: 1 });
    expect(await f.resources.authorize(f.request()).ticket).toBeUndefined();
    parked.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.resources.stats()).toEqual({ active: 0 });
    expect(f.commit).not.toHaveBeenCalled();
    f.onResolve(async () => {});
    const fresh = await f.resources.authorize(f.request()).ticket;
    expect(f.resources.commit(required(fresh), f.admission)).toBe(true);
  });
});

it.each(["return", "throw"])("R05 closes retained owning-service admission after %s", async (mode) => {
  const f = fixture();
  let retained = () => false;
  f.commit.mockImplementation((_payload, _context, admission) => {
    retained = admission;
    if (mode === "throw") throw new Error("owner failure");
    return false;
  });
  const ticket = await f.resources.authorize(f.request()).ticket;
  expect(f.resources.commit(required(ticket), f.admission)).toBe(false);
  expect(retained()).toBe(false);
  expect(f.resources.stats()).toEqual({ active: 0 });
});
it.each([NaN, undefined, 0.5, -1, Infinity])("R05 cohort rejects malformed decision count %s", async (length) => {
  const f = fixture();
  const decisions = new Proxy([], { get(target, name, receiver) {
    return name === "length" ? length : (Reflect.get(target, name, receiver) as unknown);
  } });
  expect(f.registry.validateAuthorityCohort([], decisions)).toBe(false);
  const proof = await f.invoke();
  expect(f.registry.validateAuthorityCohort([], [{ stamp: proof.stamp, actor: f.request().actor }])).toBe(true);
});
it("R05 cohort captures lengths and stamp identity exactly once", async () => {
  const f = fixture();
  const proof = await f.invoke();
  let reads = 0;
  let stamps = 0;
  const member = { get stamp() {
    stamps += 1;
    return proof.stamp;
  }, actor: f.request().actor };
  const decisions = new Proxy([member], { get(target, name, receiver) {
    if (name === "length") {
      reads += 1;
      return reads === 1 ? 1 : 0;
    }
    return (Reflect.get(target, name, receiver) as unknown);
  } });
  expect(f.registry.validateAuthorityCohort([], decisions)).toBe(true);
  expect(reads).toBe(1);
  expect(stamps).toBe(1);
  const negative = new Proxy([], { get(target, name, receiver) {
    return name === "length" ? -1 : (Reflect.get(target, name, receiver) as unknown);
  } });
  expect(f.registry.validateAuthorityCohort(negative, [member, member])).toBe(false);
});
it("R02 rejects oversized extra routes before structured cloning", () => {
  const f = fixture();
  const resource = required(f.registry.readResource(f.target));
  const clone = vi.spyOn(globalThis, "structuredClone");
  try {
    expect(() => {
      f.registry.installResource({ ...resource, allowedRoutes: [{ origin: f.first, targets: Array.from({ length: 129 }, () => f.target) }] });
    }).toThrow();
    expect(clone).not.toHaveBeenCalled();
  } finally {
    clone.mockRestore();
  }
});
it("R05 pins canonical installation during asynchronous target resolution", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<undefined>();
  const parked = Promise.withResolvers<undefined>();
  f.onResolve(async () => {
    entered.resolve(undefined);
    await parked.promise;
  });
  const pending = f.resources.authorize(f.request()).ticket;
  await entered.promise;
  const resource = required(f.registry.readResource(f.target));
  f.registry.teardown(f.target);
  f.resources.install(resource);
  f.grant(f.target, ["read"]);
  parked.resolve(undefined);
  expect(await pending).toBeUndefined();
  f.onResolve(async () => {});
  const fresh = await f.resources.authorize(f.request()).ticket;
  expect(f.resources.commit(required(fresh), f.admission)).toBe(true);
});

it("R03 a distinct operation challenge cannot borrow prior invocation approval", async () => {
  const f = fixture({ challengeOperation: "write" });
  for (const ref of f.refs) f.grant(ref, ["read", "write"]);
  expect(await f.resources.authorize(f.request("write")).ticket).toBeUndefined();
  expect(f.commit).not.toHaveBeenCalled();
  const control = fixture();
  for (const ref of control.refs) control.grant(ref, ["read", "write"]);
  const ticket = await control.resources.authorize(control.request("write")).ticket;
  expect(control.resources.commit(required(ticket), control.admission)).toBe(true);
});

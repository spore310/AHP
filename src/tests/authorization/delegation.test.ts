import { describe, expect, it, vi } from "vitest";

import { createReferenceAuthorizer, type ResourceRef, type ScopedPolicyBinding } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const scope: ResourceRef = { domainId: "local", kind: "session", id: "ahp-session:/delegation", instanceId: "instance" };
const actor = { kind: "user" as const, principal: { domainId: "local", subject: "alice" } };
const caller = { actor, connectionId: "connection", authRevision: "auth" };
const policy = { id: "access", revision: 1 };
const route = { origin: scope, targets: [scope] };
const registration = { resource: scope, owner: actor.principal, route, externalAuthority: "none" as const };
const grant = (): ScopedPolicyBinding => ({ id: "bootstrap", actor, scope, roles: [], policies: [policy], revision: 1, authority: { kind: "host-policy", policy } });
const invocation = { actor: caller, operation: "invoke" as const, bindingId: "bootstrap", policyRef: policy, scope, route };
const fixture = (capacity = 1, now = () => 1000, maxInvalidationListeners = 16) => createReferenceAuthorizer({
  policies: createToolPolicyFactory({ policies: [{ ...policy, operations: { invoke: { actor: { mode: "direct-grant", actors: ["user"] } } }, challenge: { required: false } }] }),
  now,
  maxInvalidationListeners,
  caps: { maxResources: capacity, maxBindings: capacity },
});

const install = (registry: ReturnType<typeof fixture>) => {
  const resource = registry.prepareResourceInstallation(registration);
  const binding = registry.prepareBindingInstallation(grant(), resource);
  registry.installResource(registration, resource);
  registry.installBinding(grant(), binding);
  return { resource, binding };
};

describe("P06 bounded invalidation hints", () => {
  it("coalesces completed mutations without exposing authority and never needs delivery for freshness", async () => {
    const registry = fixture();
    const notices: unknown[] = [];
    const listener = vi.fn((notice) => {
      notices.push(notice);
    });
    registry.onInvalidate(listener);
    install(registry);
    expect(listener).not.toHaveBeenCalled();
    registry.drainInvalidations();
    expect(listener).toHaveBeenCalledTimes(1);
    const notice = notices[0];
    expect(Object.keys(notice !== null && typeof notice === "object" ? notice : {}).sort()).toEqual(["cause", "epoch", "grantRevision"]);
    expect(Object.isFrozen(notice)).toBe(true);
    const allowed = await registry.evaluate(invocation);
    expect(allowed.decision.effect).toBe("allow");
    registry.installBinding(grant());
    registry.drainInvalidations();
    expect(listener).toHaveBeenCalledTimes(1);
    registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.matches(allowed.stamp, caller)).toBe(false);
    registry.drainInvalidations();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("nested observer mutations leave one pending hint without automatic requeue or recursive delivery", async () => {
    const registry = fixture();
    let deliveries = 0;
    const unsubscribe = registry.onInvalidate(() => {
      deliveries += 1;
      registry.invalidateExternal(`nested-${String(deliveries)}`);
      registry.drainInvalidations();
    });
    install(registry);
    registry.drainInvalidations();
    expect(deliveries).toBe(1);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(deliveries).toBe(1);
    registry.drainInvalidations();
    expect(deliveries).toBe(2);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(deliveries).toBe(2);
    unsubscribe();
    registry.drainInvalidations();
    expect(deliveries).toBe(2);
  });

  it("quarantines a throwing listener while continuing the bounded cohort", () => {
    const registry = fixture(1, () => 1000, 2);
    const failing = vi.fn(() => {
      throw new Error("observer failure");
    });
    const healthy = vi.fn();
    registry.onInvalidate(failing);
    registry.onInvalidate(healthy);
    install(registry);
    registry.drainInvalidations();
    registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 });
    registry.drainInvalidations();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(() => registry.onInvalidate(() => undefined)).not.toThrow();
  });

  it("unsubscribe cannot free an async observer's still-running slot", async () => {
    const registry = fixture(1, () => 1000, 1);
    let settle: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const listener = vi.fn(() => pending);
    const unsubscribe = registry.onInvalidate((): unknown => listener());
    install(registry);
    registry.drainInvalidations();
    unsubscribe();
    unsubscribe();
    expect(() => registry.onInvalidate(() => undefined)).toThrow();
    registry.invalidateExternal("later");
    registry.drainInvalidations();
    expect(listener).toHaveBeenCalledTimes(1);
    settle();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(() => registry.onInvalidate(() => undefined)).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65])("rejects listener limit %s without allocating a registry", (limit) => {
    expect(() => fixture(1, () => 1000, limit)).toThrow();
  });
});

describe("P06 canonical lineage and scoped reads", () => {
  it("a late decision clock cannot refresh an old evaluation across identical binding reinstallation", async () => {
    let armed = false;
    let samples = 0;
    const registry = fixture(1, () => {
      if (armed && ++samples === 3) {
        armed = false;
        registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 });
        registry.installBinding(grant());
      }
      return 1000;
    });
    install(registry);
    const prior = await registry.evaluate(invocation);
    expect(prior.decision.effect).toBe("allow");
    armed = true;
    expect((await registry.evaluate(invocation)).decision.effect).toBe("deny");
    expect(registry.matches(prior.stamp, caller)).toBe(false);
    expect((await registry.evaluate(invocation)).decision.effect).toBe("allow");
  });
  const bob = { kind: "user" as const, principal: { domainId: "local", subject: "bob" } };
  const child = (id = "child", parentGrantId = "bootstrap", issuer = actor): ScopedPolicyBinding => ({
    ...grant(), id, actor: bob, authority: { kind: "delegation", issuer, parentGrantId },
  });
  const childInput = { ...invocation, actor: { ...caller, actor: bob }, bindingId: "child" };

  it("a real child chain allows, then exact root removal removes the whole closure without resurrection", async () => {
    const registry = fixture(4);
    install(registry);
    registry.installBinding(child());
    registry.installBinding(child("grandchild", "child", bob));
    expect((await registry.evaluate(childInput)).decision.effect).toBe("allow");
    expect((await registry.evaluate({ ...childInput, bindingId: "grandchild" })).decision.effect).toBe("allow");
    registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 });
    expect((await registry.evaluate(childInput)).decision.effect).toBe("deny");
    expect((await registry.evaluate({ ...childInput, bindingId: "grandchild" })).decision.effect).toBe("deny");
    registry.installBinding(grant());
    expect(registry.readBindings({ actor: bob, scope }).bindings).toHaveLength(0);
  });

  it("ancestor expiry invalidates real child authority without maintenance and frees expired storage", async () => {
    let now = 1000;
    const registry = fixture(2, () => now);
    registry.installResource(registration);
    registry.installBinding({ ...grant(), expiresAt: new Date(2000).toISOString() });
    registry.installBinding(child());
    const allowed = await registry.evaluate(childInput);
    expect(allowed.decision.effect).toBe("allow");
    expect(allowed.stamp.validUntil).toBeLessThanOrEqual(2000);
    now = 2000;
    expect(registry.matches(allowed.stamp, childInput.actor)).toBe(false);
    expect((await registry.evaluate(childInput)).decision.effect).toBe("deny");
    registry.installBinding(grant());
    expect((await registry.evaluate(invocation)).decision.effect).toBe("allow");
  });

  it("rejects dangling or falsely attributed delegated installs without disturbing the valid root", async () => {
    const registry = fixture(3);
    install(registry);
    const allowed = await registry.evaluate(invocation);
    expect(() => {
      registry.installBinding(child("child", "missing"));
    }).toThrow();
    expect(() => {
      registry.installBinding(child("child", "bootstrap", bob));
    }).toThrow();
    expect(registry.matches(allowed.stamp, caller)).toBe(true);
    registry.installBinding(child());
    expect((await registry.evaluate(childInput)).decision.effect).toBe("allow");
  });

  it("reads only the exact actor/scope and rejects cloned or stale snapshot receipts", async () => {
    const registry = fixture(3);
    install(registry);
    const snapshot = registry.readBindings({ actor, scope });
    expect(snapshot.bindings.map((binding) => binding.id)).toEqual(["bootstrap"]);
    expect(registry.isBindingSnapshotCurrent(snapshot)).toBe(true);
    expect(registry.isBindingSnapshotCurrent({ ...snapshot })).toBe(false);
    expect(registry.readBindings({ actor: bob, scope }).bindings).toEqual([]);
    registry.installBinding(child());
    expect(registry.isBindingSnapshotCurrent(snapshot)).toBe(false);
    expect((await registry.evaluate(childInput)).decision.effect).toBe("allow");
  });

  it("explicit descendant relationship changes invalidate old grants even when restored", async () => {
    const registry = fixture(4);
    install(registry);
    const descendant = { ...scope, kind: "document", id: "document:/one", instanceId: "document" };
    const target = { ...registration, resource: descendant, grantParent: scope,
      route: { origin: descendant, targets: [descendant] } };
    registry.installResource(target);
    registry.installBinding({ ...child(), scope: descendant });
    const input = { ...childInput, scope: descendant, route: target.route };
    expect((await registry.evaluate(input)).decision.effect).toBe("allow");
    registry.installResource({ ...target, grantParent: undefined });
    registry.installResource(target);
    expect((await registry.evaluate(input)).decision.effect).toBe("deny");
    expect(registry.readBindings({ actor: bob, scope: descendant }).bindings).toEqual([]);
  });
});

describe("P06 installation ownership", () => {
  it("prepares without authority effects and conditionally removes real installed grants", async () => {
    const registry = fixture();
    const resource = registry.prepareResourceInstallation(registration);
    const binding = registry.prepareBindingInstallation(grant(), resource);
    expect(registry.owner(scope)).toBeUndefined();
    expect(registry.isResourceInstallationCurrent(resource)).toBe(false);
    registry.installResource(registration, resource);
    registry.installBinding(grant(), binding);
    const allowed = await registry.evaluate(invocation);
    expect(allowed.decision.effect).toBe("allow");
    expect(registry.isBindingInstallationCurrent(binding)).toBe(true);
    expect(registry.removeInstalledBinding(binding)).toBe(true);
    expect(registry.matches(allowed.stamp, caller)).toBe(false);
    expect(registry.owner(scope)).toEqual(actor.principal);
    expect(registry.teardownInstalledResource(resource)).toBe(true);
    expect(registry.owner(scope)).toBeUndefined();
  });

  it("stale binding cleanup cannot delete a same-ID/scope/revision successor", async () => {
    const registry = fixture();
    const old = install(registry);
    expect(registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 })).toBe(true);
    const replacement = registry.prepareBindingInstallation(grant(), old.resource);
    registry.installBinding(grant(), replacement);
    const allowed = await registry.evaluate(invocation);
    expect(allowed.decision.effect).toBe("allow");
    expect(registry.removeInstalledBinding(old.binding)).toBe(false);
    expect(registry.matches(allowed.stamp, caller)).toBe(true);
    expect(registry.isBindingInstallationCurrent(replacement)).toBe(true);
  });

  it("stale full-resource cleanup preserves a same-text replacement and its grant", async () => {
    const registry = fixture();
    const old = install(registry);
    registry.teardown(scope);
    const replacement = install(registry);
    const allowed = await registry.evaluate(invocation);
    expect(allowed.decision.effect).toBe("allow");
    expect(registry.isResourceInstallationCurrent(old.resource)).toBe(false);
    expect(registry.teardownInstalledResource(old.resource)).toBe(false);
    expect(registry.removeInstalledBinding(old.binding)).toBe(false);
    expect(registry.matches(allowed.stamp, caller)).toBe(true);
    expect(registry.isResourceInstallationCurrent(replacement.resource)).toBe(true);
  });

  for (const stage of ["resource", "binding"] as const) {
    it(`a preknown ${stage} token compensates install-then-throw without querying ownership`, () => {
      const registry = fixture();
      const resource = registry.prepareResourceInstallation(registration);
      const binding = registry.prepareBindingInstallation(grant(), resource);
      if (stage === "resource") {
        const original = registry.installResource.bind(registry);
        registry.installResource = (...args) => {
          original(...args);
          throw new Error("after install");
        };
        expect(() => {
          registry.installResource(registration, resource);
        }).toThrow("after install");
        expect(registry.teardownInstalledResource(resource)).toBe(true);
      } else {
        registry.installResource(registration, resource);
        const original = registry.installBinding.bind(registry);
        registry.installBinding = (...args) => {
          original(...args);
          throw new Error("after install");
        };
        expect(() => {
          registry.installBinding(grant(), binding);
        }).toThrow("after install");
        expect(registry.removeInstalledBinding(binding)).toBe(true);
        expect(registry.teardownInstalledResource(resource)).toBe(true);
      }
      expect(registry.owner(scope)).toBeUndefined();
      expect(registry.removeInstalledBinding(binding)).toBe(false);
    });
  }

  it("never adopts an incumbent and consumes a failed claimed token", async () => {
    const registry = fixture();
    const existing = install(registry);
    const attempted = registry.prepareResourceInstallation(registration);
    const allowed = await registry.evaluate(invocation);
    expect(() => {
      registry.installResource(registration, attempted);
    }).toThrow();
    expect(registry.teardownInstalledResource(attempted)).toBe(false);
    expect(registry.matches(allowed.stamp, caller)).toBe(true);
    registry.teardownInstalledResource(existing.resource);
    expect(() => {
      registry.installResource(registration, attempted);
    }).toThrow();
    expect(registry.owner(scope)).toBeUndefined();
  });

  it("rejects copied/foreign/used tokens without changing a genuine allow", async () => {
    const registry = fixture();
    const owned = install(registry);
    const foreign = install(fixture());
    const allowed = await registry.evaluate(invocation);
    expect(registry.isResourceInstallationCurrent({ ...owned.resource })).toBe(false);
    expect(registry.removeInstalledBinding({ ...owned.binding })).toBe(false);
    expect(registry.teardownInstalledResource(foreign.resource)).toBe(false);
    expect(() => {
      registry.installBinding(grant(), owned.binding);
    }).toThrow();
    expect(registry.matches(allowed.stamp, caller)).toBe(true);
    registry.removeInstalledBinding(owned.binding);
    expect(() => {
      registry.installBinding(grant(), owned.binding);
    }).toThrow();
  });

  it("cannot attach a prepared binding to a replacement of its resource installation", () => {
    const registry = fixture();
    const resource = registry.prepareResourceInstallation(registration);
    const binding = registry.prepareBindingInstallation(grant(), resource);
    registry.installResource(registration, resource);
    registry.teardownInstalledResource(resource);
    const replacement = registry.prepareResourceInstallation(registration);
    registry.installResource(registration, replacement);
    expect(() => {
      registry.installBinding(grant(), binding);
    }).toThrow();
    expect(registry.removeInstalledBinding(binding)).toBe(false);
    expect(registry.isResourceInstallationCurrent(replacement)).toBe(true);
  });

  it("owned identity survives identical administrative installs and cleans expired bindings", () => {
    const registry = fixture();
    const resource = registry.prepareResourceInstallation(registration);
    const expired = { ...grant(), expiresAt: new Date(999).toISOString() };
    const binding = registry.prepareBindingInstallation(expired, resource);
    registry.installResource(registration, resource);
    registry.installBinding(expired, binding);
    registry.installResource(registration);
    registry.installBinding(expired);
    expect(registry.isResourceInstallationCurrent(resource)).toBe(true);
    expect(registry.isBindingInstallationCurrent(binding)).toBe(true);
    expect(registry.removeInstalledBinding(binding)).toBe(true);
  });
});

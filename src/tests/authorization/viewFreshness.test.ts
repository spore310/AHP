import { describe, expect, it } from "vitest";
import { createReferenceAuthorizer } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const fixture = () => {
  let time = 0;
  let onClock = () => undefined;
  const policy = { id: "view", revision: 1 };
  const actor = { kind: "user" as const, principal: { domainId: "local", subject: "reader" } };
  const context = { actor, connectionId: "reader", authRevision: "one" };
  const scope = { domainId: "local", kind: "session", id: "one", instanceId: "one" };
  const route = { origin: scope, targets: [scope] };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: {
    discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
  }, challenge: { required: false } }] });
  const registry = createReferenceAuthorizer({ policies, decisionTtlMs: 10, now: () => {
    onClock();
    return time;
  } });
  registry.installResource({ resource: scope, route, owner: actor.principal, externalAuthority: "none" });
  registry.installBinding({ id: "grant", actor, scope, policies: [policy], roles: [], revision: 1,
    authority: { kind: "host-policy", policy } });
  return { registry, context, scope, setTime: (value: number) => {
    time = value;
  },
  clock: (callback: () => undefined) => {
    onClock = callback;
  },
  evaluate: () => registry.evaluate({ actor: context, operation: "discover", scope, route, bindingId: "grant", policyRef: policy }) };
};

describe("aggregate view freshness", () => {
  it("checks every issued proof at one final clock sample including earlier expiry", async () => {
    const f = fixture();
    const first = await f.evaluate();
    f.setTime(9);
    const second = await f.evaluate();
    expect(first.stamp.validUntil).toBe(10);
    expect(second.stamp.validUntil).toBe(19);
    expect(f.registry.matches(first.stamp, f.context)).toBe(true);
    f.clock(() => {
      f.setTime(11);
    });
    expect(f.registry.matches(second.stamp, f.context)).toBe(true);
    expect(f.registry.matchesAll([first.stamp, second.stamp], f.context)).toBe(false);
    expect(f.registry.matchesAll([second.stamp], f.context)).toBe(true);
  });
  it("denies registry mutation inside the aggregate clock and rejects copied stamps", async () => {
    const f = fixture();
    const proof = await f.evaluate();
    const fence = f.registry.captureFence();
    expect(f.registry.matchesAll([proof.stamp], f.context)).toBe(true);
    expect(f.registry.matchesAll([structuredClone(proof.stamp)], f.context)).toBe(false);
    f.clock(() => {
      f.registry.teardown(f.scope);
    });
    expect(f.registry.matchesAll([proof.stamp], f.context)).toBe(false);
    expect(fence()).toBe(false);
  });
});

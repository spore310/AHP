import { describe, expect, it } from "vitest";

import { policyLimitsSchema } from "@authorization";
import {
  createToolPolicyFactory,
  defineToolPolicyNamespace,
  TOOL_OPERATIONS,
  ToolPolicyFactoryError,
  type CompiledToolPolicy,
  type PolicyResolutionContext,
} from "@toolPolicy";

const sessionType = { key: "chat", version: 1 };
const context: PolicyResolutionContext = {
  actor: {
    actor: { kind: "user", principal: { domainId: "domain", subject: "caller" } },
    connectionId: "connection",
    authRevision: "auth",
  },
  resource: { domainId: "domain", kind: "session", id: "session", instanceId: "instance" },
  input: {},
};
const policy = (id: string) => ({ id, revision: 1, operations: {}, challenge: { required: false } });

describe("P02 factory review regressions", () => {
  it("preserves explicitly admitted direct policies alongside namespace selections", async () => {
    const namespace = defineToolPolicyNamespace({
      name: "optional", revision: 1, policies: [policy("namespaced")], resolve: () => [],
    });
    const factory = createToolPolicyFactory({
      policies: [policy("direct")],
      namespaces: [namespace],
      bindings: [{
        sessionType, providerId: "provider",
        admitted: { policies: [{ id: "direct", revision: 1 }], namespaces: [{ name: "optional", revision: 1 }] },
        mandatory: [],
      }],
    });
    expect(await factory.select({ sessionType, providerId: "provider", context })).toEqual({
      effect: "selected", alternatives: [{ id: "direct", revision: 1 }], mandatory: [],
    });
  });

  it("sanitizes malformed resolver output without executing its property getters", async () => {
    let reads = 0;
    const namespace = defineToolPolicyNamespace({
      name: "malformed", revision: 1, policies: [policy("allowed")],
      resolve: () => [{
        get id(): string {
          reads += 1;
          throw new Error("private-resolver-secret");
        },
        revision: 1,
      }],
    });
    const factory = createToolPolicyFactory({
      namespaces: [namespace],
      bindings: [{
        sessionType, providerId: "provider",
        admitted: { policies: [], namespaces: [{ name: "malformed", revision: 1 }] }, mandatory: [],
      }],
    });
    expect(await factory.select({ sessionType, providerId: "provider", context })).toEqual({ effect: "deny", code: "resolver-output" });
    expect(reads).toBe(0);
  });

  it("freezes captured namespace includes and declaration arrays", () => {
    const namespace = defineToolPolicyNamespace({
      name: "captured", revision: 1, policies: [policy("allowed")],
      includes: [{ name: "child", revision: 1 }], resolve: () => [],
    });
    expect(Object.isFrozen(namespace)).toBe(true);
    expect(Object.isFrozen(namespace.policies)).toBe(true);
    expect(Object.isFrozen(namespace.includes)).toBe(true);
    expect(Object.isFrozen(namespace.includes?.[0])).toBe(true);
  });

  it("keeps a declared extension type and a detached compiled extension", () => {
    const seed = {
      ...policy("typed"),
      extension: { lane: "chat" as const },
    };
    const namespace = defineToolPolicyNamespace({
      name: "typed", revision: 1, policies: [seed], resolve: () => [],
    });
    const declared = namespace.policies[0];
    if (declared === undefined) {
      throw new Error("declared policy was not captured");
    }
    const declaredLane: "chat" = declared.extension.lane;
    const mutable: { extension: { lane: string } } = seed;
    mutable.extension = { lane: "forged" };
    expect(declaredLane).toBe("chat");
    expect(declared.extension.lane).toBe("chat");
    const factory = createToolPolicyFactory({ namespaces: [namespace] });
    const compiled = factory.getPolicy({ id: "typed", revision: 1 });
    expect(laneOf(compiled)).toBe("chat");
    expect(compiled?.extension).toEqual({ lane: "chat" });
    expect(factory.inspect().policies.find((item) => item.id === "typed")?.extension).toEqual({ lane: "chat" });
  });

  it("expands a shared repeated-edge graph without duplicating policies", () => {
    const count = 8;
    const repeats = 6;
    const nodes = Array.from({ length: count }, (_, index) => {
      const next = index + 1;
      const includeNext = { name: `node-${String(next)}`, revision: 1 };
      const includes = next === count
        ? []
        : Array.from({ length: repeats }, () => includeNext);
      return defineToolPolicyNamespace({
        name: `node-${String(index)}`,
        revision: 1,
        policies: [policy(`policy-${String(index)}`)],
        includes,
        resolve: () => [],
      });
    });
    const left = defineToolPolicyNamespace({
      name: "left", revision: 1, policies: [policy("left")],
      includes: [{ name: "shared", revision: 1 }], resolve: () => [],
    });
    const right = defineToolPolicyNamespace({
      name: "right", revision: 1, policies: [policy("right")],
      includes: [{ name: "shared", revision: 1 }], resolve: () => [],
    });
    const shared = defineToolPolicyNamespace({
      name: "shared", revision: 1, policies: [policy("shared")], resolve: () => [],
    });
    const factory = createToolPolicyFactory({ namespaces: [...nodes, left, right, shared] });
    const root = factory.inspect().namespaces.find((item) => item.name === "node-0");
    expect(root?.expanded).toHaveLength(count);
    const diamond = factory.inspect().namespaces.find((item) => item.name === "left");
    expect(diamond?.expanded.map((item) => item.id).sort()).toEqual(["left", "shared"]);
  });

  it("applies a one-reference resolver budget to references rather than their object fields", async () => {
    const namespace = defineToolPolicyNamespace({
      name: "single", revision: 1, policies: [policy("single")],
      resolve: () => [{ id: "single", revision: 1 }],
    });
    const factory = createToolPolicyFactory({
      limits: policyLimitsSchema.parse({ maxPolicyRefs: 1 }),
      namespaces: [namespace],
      bindings: [{
        sessionType, providerId: "provider",
        admitted: { policies: [], namespaces: [{ name: "single", revision: 1 }] }, mandatory: [],
      }],
    });
    expect(await factory.select({ sessionType, providerId: "provider", context })).toEqual({
      effect: "selected", alternatives: [{ id: "single", revision: 1 }], mandatory: [],
    });
  });

  it("rejects one resolver reference above the reference budget", async () => {
    const namespace = defineToolPolicyNamespace({
      name: "over-refs", revision: 1, policies: [policy("one"), policy("two")],
      resolve: () => [{ id: "one", revision: 1 }, { id: "two", revision: 1 }],
    });
    const factory = createToolPolicyFactory({
      limits: policyLimitsSchema.parse({ maxPolicyRefs: 1, expandedPoliciesPerNamespace: 2 }),
      namespaces: [namespace],
      bindings: [{
        sessionType, providerId: "provider",
        admitted: { policies: [], namespaces: [{ name: "over-refs", revision: 1 }] }, mandatory: [],
      }],
    });
    expect(await factory.select({ sessionType, providerId: "provider", context })).toEqual({
      effect: "deny", code: "resolver-output",
    });
  });

  it("bounds extension keys without counting operation fields", () => {
    const limits = policyLimitsSchema.parse({ extensionDepth: 2, extensionKeys: 1, extensionBytes: 64 });
    const operations = {
      invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: ["review"] } } } },
    };
    const atLimit = createToolPolicyFactory({
      limits,
      policies: [{ ...policy("at-limit"), operations, extension: { lane: "chat" } }],
    });
    expect(atLimit.getPolicy({ id: "at-limit", revision: 1 })?.extension).toEqual({ lane: "chat" });
    expect(() => createToolPolicyFactory({
      limits,
      policies: [{ ...policy("over-extension"), operations, extension: { lane: "chat", extra: true } }],
    })).toThrow(ToolPolicyFactoryError);
  });

  it("does not use extension-only limits to reject ordinary operation rules", () => {
    const configured = {
      ...policy("roles"),
      operations: {
        invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: ["review"] } } } },
      },
    };
    const factory = createToolPolicyFactory({
      policies: [configured],
      limits: policyLimitsSchema.parse({ extensionDepth: 1, extensionKeys: 1, extensionBytes: 1 }),
    });
    expect(factory.getPolicy({ id: "roles", revision: 1 })?.operations).toEqual(configured.operations);
  });

  it("accepts the configured role count across both actor branches", () => {
    const roles = Array.from({ length: 32 }, (_, index) => `role-${String(index)}`);
    const configured = {
      ...policy("many-roles"),
      operations: {
        invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: roles }, agent: { anyOf: roles } } } },
      },
    };
    expect(createToolPolicyFactory({ policies: [configured] }).getPolicy({ id: "many-roles", revision: 1 }))
      .toEqual(configured);
  });

  it("accepts every operation with its full configured role and permission arrays", () => {
    const roles = Array.from({ length: 32 }, (_, index) => `r${String(index)}`);
    const operations = Object.fromEntries(TOOL_OPERATIONS.map((operation) => [operation, {
      actor: { mode: "roles" as const, actors: { user: { anyOf: roles }, agent: { anyOf: roles } } },
      requiredPermissions: roles,
      reveal: true,
    }]));
    const configured = { ...policy("all-operations"), operations };
    expect(createToolPolicyFactory({ policies: [configured] }).getPolicy({ id: configured.id, revision: 1 }))
      .toEqual(configured);
  });

  it("does not reuse a shallower include closure for a deeper allowed path", () => {
    const child = defineToolPolicyNamespace({
      name: "child", revision: 1, policies: [policy("child")], resolve: () => [],
    });
    const mid = defineToolPolicyNamespace({
      name: "mid", revision: 1, policies: [policy("mid")],
      includes: [{ name: "child", revision: 1 }], resolve: () => [],
    });
    const root = defineToolPolicyNamespace({
      name: "root", revision: 1, policies: [policy("root")],
      includes: [{ name: "mid", revision: 1 }], resolve: () => [],
    });
    const namespaces = [child, mid, root];
    expect(() => createToolPolicyFactory({
      limits: policyLimitsSchema.parse({ namespaceIncludeDepth: 1 }),
      namespaces,
    })).toThrow(/limit/i);
    const factory = createToolPolicyFactory({
      limits: policyLimitsSchema.parse({ namespaceIncludeDepth: 2 }),
      namespaces,
    });
    expect(factory.inspect().namespaces.find((item) => item.name === "root")?.expanded.map((item) => item.id))
      .toEqual(["root", "mid", "child"]);
  });
});

const laneOf = (policy: CompiledToolPolicy | undefined): string | undefined => {
  const extension = policy?.extension;
  if (typeof extension !== "object" || extension === null || !("lane" in extension)) {
    return undefined;
  }
  return typeof extension.lane === "string" ? extension.lane : undefined;
};

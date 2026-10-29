import { describe, expect, it } from "vitest";

import {
  POLICY_LIMIT_DEFAULTS,
  policyLimitsSchema,
  type PolicyAdmission,
  type PolicyRef,
  type PolicyScopeRules,
} from "@authorization";
import {
  createToolPolicyFactory,
  defineToolPolicyNamespace,
  ToolPolicyFactoryError,
  type PolicyResolutionContext,
} from "@toolPolicy";

const context: PolicyResolutionContext = {
  actor: {
    actor: { kind: "user", principal: { domainId: "domain", subject: "user" } },
    connectionId: "connection",
    authRevision: "auth",
  },
  resource: { domainId: "domain", kind: "session", id: "session", instanceId: "instance" },
  input: { requested: true },
};

const policy = (id: string, revision = 1, challengeRequired = false) => ({
  id,
  revision,
  operations: {},
  challenge: { required: challengeRequired },
});

const ref = (id: string, revision = 1): PolicyRef => ({ id, revision });

const sessionType = { key: "chat", version: 1 };

const binding = (
  admitted: PolicyAdmission,
  mandatory: readonly PolicyRef[] = [],
  providerId = "host",
) => ({
  sessionType,
  providerId,
  admitted,
  mandatory,
});

describe("tool policy factory", () => {
  it("compiles and resolves a direct policy with an empty namespace list", async () => {
    const direct = policy("review");
    const factory = createToolPolicyFactory({
      policies: [direct],
      namespaces: [],
      bindings: [binding({ policies: [ref("review")], namespaces: [] })],
    });

    expect(factory.getPolicy(ref("review"))).toEqual(direct);
    expect(factory.forSessionType(sessionType, "host")).toEqual({
      admitted: { policies: [ref("review")], namespaces: [] },
      mandatory: [],
    } satisfies PolicyScopeRules);
    await expect(factory.select({ sessionType, providerId: "host", context })).resolves.toEqual({
      effect: "selected",
      alternatives: [ref("review")],
      mandatory: [],
    });
    expect(factory.getPolicy(ref("missing"))).toBeUndefined();
    expect(JSON.stringify(factory.inspect())).not.toContain("resolve");
  });

  it("rejects cyclic, conflicting, oversized, prototype-key and unknown namespace expansion", () => {
    const left = defineToolPolicyNamespace({
      name: "left",
      revision: 1,
      policies: [policy("left.policy")],
      includes: [{ name: "right", revision: 1 }],
      resolve: () => [],
    });
    const right = defineToolPolicyNamespace({
      name: "right",
      revision: 1,
      policies: [policy("right.policy")],
      includes: [{ name: "left", revision: 1 }],
      resolve: () => [],
    });
    expect(() => createToolPolicyFactory({ namespaces: [left, right] }))
      .toThrow(ToolPolicyFactoryError);
    expect(() => createToolPolicyFactory({ namespaces: [left, right] })).toThrow(/cycle/i);

    expect(() => createToolPolicyFactory({
      policies: [policy("review", 1, false), policy("review", 1, true)],
    })).toThrow(/conflict/i);

    expect(() => createToolPolicyFactory({
      policies: [policy("review"), policy("review")],
    })).not.toThrow();

    const lowCount = policyLimitsSchema.parse({ expandedPoliciesPerNamespace: 1 });
    expect(() => createToolPolicyFactory({
      limits: lowCount,
      namespaces: [defineToolPolicyNamespace({
        name: "packed",
        revision: 1,
        policies: [policy("one"), policy("two")],
        resolve: () => [],
      })],
    })).toThrow(/limit/i);

    const lowDepth = policyLimitsSchema.parse({ namespaceIncludeDepth: 1 });
    const grandchild = defineToolPolicyNamespace({
      name: "grandchild",
      revision: 1,
      policies: [policy("grandchild.policy")],
      resolve: () => [],
    });
    const child = defineToolPolicyNamespace({
      name: "child",
      revision: 1,
      policies: [policy("child.policy")],
      includes: [{ name: "grandchild", revision: 1 }],
      resolve: () => [],
    });
    const root = defineToolPolicyNamespace({
      name: "root",
      revision: 1,
      policies: [policy("root.policy")],
      includes: [{ name: "child", revision: 1 }],
      resolve: () => [],
    });
    expect(() => createToolPolicyFactory({
      limits: lowDepth,
      namespaces: [root, child, grandchild],
    })).toThrow(/limit/i);
    const higherDepth = policyLimitsSchema.parse({ namespaceIncludeDepth: 2 });
    expect(() => createToolPolicyFactory({
      limits: higherDepth,
      namespaces: [root, child, grandchild],
    })).not.toThrow();

    expect(() => defineToolPolicyNamespace({
      name: "__proto__",
      revision: 1,
      policies: [policy("review")],
      resolve: () => [],
    })).toThrow(ToolPolicyFactoryError);
    expect(() => createToolPolicyFactory({
      namespaces: [defineToolPolicyNamespace({
        name: "open",
        revision: 1,
        policies: [policy("open.policy")],
        includes: [{ name: "missing", revision: 1 }],
        resolve: () => [],
      })],
    })).toThrow(/unknown/i);
  });

  it("does not treat opaque ids, suffixes or prefixes as roles, filesystems or providers", () => {
    const opaque = policy("workspace.review@pm");
    const factory = createToolPolicyFactory({
      policies: [opaque],
      namespaces: [],
      bindings: [binding({ policies: [ref("workspace.review@pm")], namespaces: [] }, [], "host")],
    });

    expect(factory.getPolicy(ref("workspace.review@pm"))?.id).toBe("workspace.review@pm");
    expect(() => factory.forSessionType({ key: "workspace", version: 1 }, "pm")).toThrow(/binding/i);
    expect(() => factory.forSessionType({ key: "workspace.review", version: 1 }, "pm")).toThrow(/binding/i);
    expect(() => factory.forSessionType(sessionType, "workspace")).toThrow(/binding/i);
    const view = JSON.stringify(factory.inspect());
    expect(view).toContain("workspace.review@pm");
    expect(view).not.toContain("\"role\"");
    expect(view).not.toContain("filesystem");
    expect(view).not.toContain("resolve");
  });

  it("keeps registered mandatory provider and session rules when a permissive resolver narrows selection", async () => {
    const permissive = policy("permissive");
    const sessionRule = policy("session.rule");
    const providerRule = policy("provider.rule");
    let calls = 0;
    const namespace = defineToolPolicyNamespace({
      name: "review",
      revision: 1,
      policies: [permissive],
      resolve: () => {
        calls += 1;
        return [ref("permissive")];
      },
    });
    const factory = createToolPolicyFactory({
      policies: [sessionRule, providerRule],
      namespaces: [namespace],
      bindings: [binding(
        { policies: [], namespaces: [{ name: "review", revision: 1 }] },
        [ref("session.rule"), ref("provider.rule")],
        "provider",
      )],
    });

    await expect(factory.select({
      sessionType,
      providerId: "provider",
      context,
    })).resolves.toEqual({
      effect: "selected",
      alternatives: [ref("permissive")],
      mandatory: [ref("session.rule"), ref("provider.rule")],
    });
    expect(calls).toBe(1);

    const thrown = defineToolPolicyNamespace({
      name: "thrown",
      revision: 1,
      policies: [permissive],
      resolve: () => {
        throw new Error("boom-secret");
      },
    });
    const failing = createToolPolicyFactory({
      namespaces: [thrown],
      bindings: [binding({ policies: [], namespaces: [{ name: "thrown", revision: 1 }] })],
    });
    const denied = await failing.select({ sessionType, providerId: "host", context });
    expect(denied).toEqual({ effect: "deny", code: "resolver-failed" });
    expect(JSON.stringify(denied)).not.toContain("boom-secret");

    const unknown = defineToolPolicyNamespace({
      name: "unknown-out",
      revision: 1,
      policies: [permissive],
      resolve: () => [ref("not-admitted")],
    });
    const closed = createToolPolicyFactory({
      namespaces: [unknown],
      bindings: [binding({ policies: [], namespaces: [{ name: "unknown-out", revision: 1 }] })],
    });
    await expect(closed.select({ sessionType, providerId: "host", context })).resolves.toEqual({
      effect: "deny",
      code: "out-of-admission",
    });

    const hanging = defineToolPolicyNamespace({
      name: "hanging",
      revision: 1,
      policies: [permissive],
      resolve: () => new Promise(() => undefined),
    });
    const timed = createToolPolicyFactory({
      limits: policyLimitsSchema.parse({ asyncHookDeadlineMs: 1 }),
      namespaces: [hanging],
      bindings: [binding({ policies: [], namespaces: [{ name: "hanging", revision: 1 }] })],
    });
    await expect(timed.select({ sessionType, providerId: "host", context })).resolves.toEqual({
      effect: "deny",
      code: "resolver-timeout",
    });
  });

  it("keeps a compiled assignment unchanged after caller mutation and a later namespace revision", async () => {
    const seed = policy("review");
    const policies = [seed];
    const namespace = defineToolPolicyNamespace({
      name: "review",
      revision: 1,
      policies,
      resolve: () => [ref("review")],
    });
    const factory = createToolPolicyFactory({
      namespaces: [namespace],
      bindings: [binding({ policies: [], namespaces: [{ name: "review", revision: 1 }] })],
    });
    policies.push(policy("added-later"));
    seed.operations = { invoke: { actor: { mode: "direct-grant", actors: ["user"] } } };
    const before = factory.inspect();

    const later = defineToolPolicyNamespace({
      name: "review",
      revision: 2,
      policies: [policy("review"), policy("added")],
      resolve: () => [ref("added")],
    });
    createToolPolicyFactory({ namespaces: [later] });

    expect(factory.inspect()).toEqual(before);
    expect(factory.getPolicy(ref("review"))?.operations).toEqual({});
    await expect(factory.select({ sessionType, providerId: "host", context })).resolves.toEqual({
      effect: "selected",
      alternatives: [ref("review")],
      mandatory: [],
    });
    expect(factory.inspect()).toEqual(before);
    expect(JSON.stringify(factory.inspect())).not.toContain("resolve");
    expect(Object.isFrozen(factory.inspect())).toBe(true);
  });

  it("uses a higher validated budget without treating include depth as a count", () => {
    const includes = [1, 2, 3].map((revision) => ({ name: `ns-${String(revision)}`, revision }));
    const extras = includes.map((item) => defineToolPolicyNamespace({
      name: item.name,
      revision: item.revision,
      policies: [policy(item.name)],
      resolve: () => [],
    }));
    const packed = defineToolPolicyNamespace({
      name: "packed",
      revision: 1,
      policies: [],
      includes,
      resolve: () => [],
    });
    const low = policyLimitsSchema.parse({
      ...POLICY_LIMIT_DEFAULTS,
      maxNamespaceIncludes: 1,
      namespaceIncludeDepth: 16,
    });
    const high = policyLimitsSchema.parse({
      ...POLICY_LIMIT_DEFAULTS,
      maxNamespaceIncludes: 4,
      namespaceIncludeDepth: 1,
    });
    expect(() => createToolPolicyFactory({ limits: low, namespaces: [packed, ...extras] })).toThrow(/limit/i);
    expect(() => createToolPolicyFactory({ limits: high, namespaces: [packed, ...extras] })).not.toThrow();
  });
});

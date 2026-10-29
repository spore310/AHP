import { describe, expect, it } from "vitest";

import { POLICY_LIMIT_DEFAULTS, createReferenceAuthorizer, type ResourceRef, type ScopedPolicyBinding } from "@authorization";
import { createToolPolicyFactory, projectAssignedDescriptors } from "@toolPolicy";
import type { ReferenceAuthorizerOptions } from "@authorization/helpers/evaluate/types";

const policy = { id: "creator", revision: 1 };
const scope: ResourceRef = { domainId: "local", kind: "session", id: "ahp-session:/created", instanceId: "one" };
const actor = { kind: "user" as const, principal: { domainId: "local", subject: "alice" } };
const caller = { actor, connectionId: "connection", authRevision: "auth" };
const route = { origin: scope, targets: [scope] };
const compiler = () => createToolPolicyFactory({ policies: [{ ...policy, operations: {
  invoke: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
  execute: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
  discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
}, challenge: { required: false } }] });
const grant = (id: string): ScopedPolicyBinding => ({ id, actor, scope, roles: [], policies: [policy], revision: 1, authority: { kind: "host-policy", policy } });
const input = { actor: caller, operation: "invoke" as const, bindingId: "bootstrap", policyRef: policy, scope, route };
const fixture = () => {
  const policies = compiler();
  const registry = createReferenceAuthorizer({ policies, now: () => 1000, caps: { maxBindings: 1, maxToolAssignments: 1, maxExecutors: 1 } });
  registry.installResource({ resource: scope, owner: actor.principal, route, externalAuthority: "none" });
  registry.installBinding(grant("bootstrap"));
  return { policies, registry };
};

describe("P05 exact binding removal and compiler coherence", () => {
  it("captures strict compiler identity without invalidating an existing decision", async () => {
    const { policies, registry } = fixture();
    const decision = await registry.evaluate(input);
    expect(decision.decision.effect).toBe("allow");
    expect(registry.usesPolicyFactory(policies)).toBe(true);
    expect(registry.usesPolicyFactory(compiler())).toBe(false);
    expect(registry.matches(decision.stamp, caller)).toBe(true);
  });

  it("identity is captured, not reread from mutable authorizer options", () => {
    const first = compiler();
    const second = compiler();
    const options = { policies: first, now: () => 1000 };
    const registry = createReferenceAuthorizer(options);
    options.policies = second;
    expect(registry.usesPolicyFactory(first)).toBe(true);
    expect(registry.usesPolicyFactory(second)).toBe(false);
  });

  it("exact removal invalidates bootstrap stamps and frees capacity while retaining the owner", async () => {
    const { registry } = fixture();
    const allowed = await registry.evaluate(input);
    expect(allowed.decision.effect).toBe("allow");
    expect(registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 })).toBe(true);
    expect(registry.matches(allowed.stamp, caller)).toBe(false);
    expect((await registry.evaluate(input)).decision.effect).toBe("deny");
    expect(registry.owner(scope)).toEqual(actor.principal);
    registry.installBinding(grant("replacement"));
    expect((await registry.evaluate({ ...input, bindingId: "replacement" })).decision.effect).toBe("allow");
    const replacement = await registry.evaluate({ ...input, bindingId: "replacement" });
    expect(registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 })).toBe(false);
    expect(registry.matches(replacement.stamp, caller)).toBe(true);
  });

  for (const mismatch of [{ revision: 2 }, { scope: { ...scope, domainId: "other" } }, { scope: { ...scope, kind: "chat" } },
    { scope: { ...scope, id: "ahp-session:/other" } }, { scope: { ...scope, instanceId: "successor" } }, { bindingId: "missing" }]) {
    it(`stale ${JSON.stringify(mismatch)} leaves existing currentness and binding intact`, async () => {
      const { registry } = fixture();
      const before = await registry.evaluate(input);
      expect(registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1, ...mismatch })).toBe(false);
      expect(registry.matches(before.stamp, caller)).toBe(true);
      expect((await registry.evaluate(input)).decision.effect).toBe("allow");
      expect(registry.owner(scope)).toEqual(actor.principal);
    });
  }

  it("removes actual caller and executor assignments, including their capacity, without deleting resource ownership", async () => {
    const { registry } = fixture();
    const contract = { id: "11111111-1111-4111-8111-111111111111", key: "creation.read", version: 1, name: "read", schemaDialect: "draft-07" as const,
      inputSchema: { type: "object", properties: {} },
    };
    registry.installTool(contract);
    const executor = { actor, connectionId: "executor", generation: 2, registrationRevision: 4 };
    const implementation = { location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "reader" };
    const tuple = { resource: scope, route, recipient: actor, contract: { id: contract.id, key: contract.key, version: 1 }, bindingId: "bootstrap", policyRef: policy };
    registry.installToolAssignment({ ...tuple, operation: "discover" });
    registry.installExecutorAssignment({ ...tuple, operation: "execute", executor, implementation });
    const base = { actor: caller, scope, route, tools: [{ contractId: contract.id, policyRef: policy, bindingId: "bootstrap" }] };
    const projected = await registry.projectAssignments({ ...base, purpose: "discover", recipient: "caller" });
    expect(projectAssignedDescriptors(registry, projected, caller, "discover").descriptors).toHaveLength(1);
    const execution = await registry.projectAssignments({ ...base, purpose: "execute", recipient: "executor", executor });
    expect(registry.validateAssignments(execution, caller)).toBe(true);
    expect(registry.removeBinding({ bindingId: "bootstrap", scope: { ...scope, instanceId: "stale" }, revision: 1 })).toBe(false);
    expect(registry.validateAssignments(projected, caller)).toBe(true);
    expect(registry.validateAssignments(execution, caller)).toBe(true);
    expect(registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 })).toBe(true);
    expect(registry.validateAssignments(projected, caller)).toBe(false);
    expect(registry.validateAssignments(execution, caller)).toBe(false);
    registry.installBinding(grant("replacement"));
    registry.installToolAssignment({ ...tuple, bindingId: "replacement", operation: "discover" });
    registry.installExecutorAssignment({ ...tuple, bindingId: "replacement", operation: "execute", executor, implementation });
    expect(registry.owner(scope)).toEqual(actor.principal);
  });

  it("a removed mandatory contribution invalidates its real positive without erasing admission or owner", async () => {
    const mandatory = { id: "required", revision: 1 };
    const policies = createToolPolicyFactory({ policies: [policy, mandatory].map((ref) => ({ ...ref, operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] } } }, challenge: { required: false } })),
      bindings: [{ sessionType: { key: "required", version: 1 }, providerId: "test", admitted: { policies: [policy], namespaces: [] }, mandatory: [mandatory] }],
    });
    const registry = createReferenceAuthorizer({ policies, now: () => 1000 });
    const admission = { sessionType: { key: "required", version: 1 }, providerId: "test" };
    registry.installAdmission(admission);
    registry.installResource({ resource: scope, owner: actor.principal, route, externalAuthority: "none", admission });
    registry.installBinding(grant("bootstrap"));
    registry.installBinding({ ...grant("required"), policies: [mandatory], authority: { kind: "host-policy", policy: mandatory } });
    const request = { ...input, mandatoryBindings: [{ resource: scope, policyRef: mandatory, bindingId: "required" }] };
    const before = await registry.evaluate(request);
    expect(before.decision.effect).toBe("allow");
    expect(registry.removeBinding({ bindingId: "required", scope, revision: 1 })).toBe(true);
    expect(registry.matches(before.stamp, caller)).toBe(false);
    expect((await registry.evaluate(request)).decision.effect).toBe("deny");
    registry.installBinding({ ...grant("new-required"), policies: [mandatory], authority: { kind: "host-policy", policy: mandatory } });
    expect((await registry.evaluate({ ...input, mandatoryBindings: [{ resource: scope, policyRef: mandatory, bindingId: "new-required" }] })).decision.effect).toBe("allow");
    expect(registry.owner(scope)).toEqual(actor.principal);
  });

  it("stale old scope cannot remove a same-URI successor or invalidate its stamps", async () => {
    const { registry } = fixture();
    registry.teardown(scope);
    const next = { ...scope, instanceId: "next" };
    const nextActor = { kind: "user" as const, principal: { domainId: "local", subject: "bob" } };
    registry.installResource({ resource: next, owner: nextActor.principal, route: { origin: next, targets: [next] }, externalAuthority: "none" });
    registry.installBinding({ ...grant("fresh"), actor: nextActor, scope: next });
    const context = { ...caller, actor: nextActor };
    const before = await registry.evaluate({ ...input, actor: context, scope: next, route: { origin: next, targets: [next] }, bindingId: "fresh" });
    expect(before.decision.effect).toBe("allow");
    expect(registry.removeBinding({ bindingId: "fresh", scope, revision: 1 })).toBe(false);
    expect(registry.removeBinding({ bindingId: "bootstrap", scope, revision: 1 })).toBe(false);
    expect(registry.owner(next)).toEqual(nextActor.principal);
    expect(registry.matches(before.stamp, context)).toBe(true);
  });

  it("rejects malformed removal before mutation", async () => {
    const { registry } = fixture();
    const before = await registry.evaluate(input);
    expect(() => registry.removeBinding({ bindingId: "", scope, revision: 1 })).toThrow();
    expect(() => registry.removeBinding({ bindingId: "bootstrap", scope, revision: 0 })).toThrow();
    expect(registry.matches(before.stamp, caller)).toBe(true);
  });
});

const admission = (key: string) => ({ sessionType: { key, version: 1 }, providerId: "test" });
const batchFixture = (capacity = 2, inputLimit = 128) => {
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: { invoke: { actor: { mode: "direct-grant", actors: ["user"] } } }, challenge: { required: false } }],
    bindings: ["a", "b", "c"].map((key) => ({ ...admission(key), admitted: { policies: [policy], namespaces: [] }, mandatory: [] })),
  });
  const inputLimits = { maxAdmissionInstalls: inputLimit };
  const options: ReferenceAuthorizerOptions = { policies, now: () => 1000, caps: { maxAdmissions: capacity }, inputLimits };
  const registry = createReferenceAuthorizer(options);
  registry.installResource({ resource: scope, owner: actor.principal, route, externalAuthority: "none" });
  registry.installBinding(grant("bootstrap"));
  return { policies, registry, inputLimits };
};

describe("P05 correction atomic admission cohorts", () => {
  it("P2 fitting cohort including duplicates bumps epoch/revision exactly once and identical/empty batches are no-ops", async () => {
    const { registry } = batchFixture(2);
    const before = await registry.evaluate(input);
    expect(before.decision.effect).toBe("allow");
    registry.installAdmissions([admission("a"), admission("b"), admission("a")]);
    const after = await registry.evaluate(input);
    expect(after.stamp.epoch).toBe(before.stamp.epoch + 1);
    expect(after.stamp.grantRevision).toBe(before.stamp.grantRevision + 1);
    registry.installAdmissions([admission("b"), admission("a"), admission("b")]);
    registry.installAdmissions([]);
    registry.installAdmission(admission("a"));
    expect(registry.matches(after.stamp, caller)).toBe(true);
    expect(() => {
      registry.installAdmission(admission("c"));
    }).toThrow(/admission limit/);
    expect(registry.matches(after.stamp, caller)).toBe(true);
  });

  it("P2 empty-store over-cap cohort preserves a genuine allow and leaves either slot available", async () => {
    for (const survivor of ["a", "b"]) {
      const { registry } = batchFixture(1);
      const before = await registry.evaluate(input);
      expect(before.decision.effect).toBe("allow");
      expect(() => {
        registry.installAdmissions([admission("a"), admission("b")]);
      }).toThrow(/admission limit/);
      expect(registry.matches(before.stamp, caller)).toBe(true);
      registry.installAdmission(admission(survivor));
      const after = await registry.evaluate(input);
      expect(after.stamp.epoch).toBe(before.stamp.epoch + 1);
    }
  });

  it("P2 mixed existing/new over-cap cohort preserves existing entries and leaves free capacity unused", async () => {
    const { registry } = batchFixture(2);
    registry.installAdmission(admission("a"));
    const before = await registry.evaluate(input);
    expect(() => {
      registry.installAdmissions([admission("a"), admission("b"), admission("c")]);
    }).toThrow(/admission limit/);
    expect(registry.matches(before.stamp, caller)).toBe(true);
    registry.installAdmission(admission("a"));
    expect(registry.matches(before.stamp, caller)).toBe(true);
    registry.installAdmission(admission("c"));
    expect((await registry.evaluate(input)).stamp.epoch).toBe(before.stamp.epoch + 1);
  });

  it("P2 invalid later selector cannot install an earlier valid entry", async () => {
    const { registry } = batchFixture(1);
    const before = await registry.evaluate(input);
    expect(before.decision.effect).toBe("allow");
    expect(() => {
      registry.installAdmissions([admission("a"), admission("missing")]);
    }).toThrow();
    expect(registry.matches(before.stamp, caller)).toBe(true);
    registry.installAdmission(admission("b"));
    expect((await registry.evaluate(input)).stamp.epoch).toBe(before.stamp.epoch + 1);
  });

  it("P2 captured per-call input limit counts duplicates independently of storage capacity", async () => {
    const { registry, inputLimits } = batchFixture(1, 2);
    registry.installAdmissions([admission("a"), admission("a")]);
    const before = await registry.evaluate(input);
    inputLimits.maxAdmissionInstalls = 1024;
    expect(() => {
      registry.installAdmissions([admission("a"), admission("a"), admission("a")]);
    }).toThrow(/input limit/);
    expect(registry.matches(before.stamp, caller)).toBe(true);
    registry.installAdmissions([admission("a"), admission("a")]);
    expect(registry.matches(before.stamp, caller)).toBe(true);
  });

  for (const conflict of ["existing", "cohort"] as const) {
    it(`P2 ${conflict} conflict rejects the entire staged cohort without mutation`, async () => {
      const genuine = batchFixture().policies;
      let changed = false;
      let calls = 0;
      // Deliberately faulty trusted compiler adapter, exercising defensive conflict checks;
      // actual policy bodies and the initial positive remain genuine and unchanged.
      const policies = { ...genuine, forSessionType: (sessionType: { key: string; version: number }, providerId: string) => {
        const original = genuine.forSessionType(sessionType, providerId);
        if (sessionType.key === "a") calls += 1;
        return changed && sessionType.key === "a" && (conflict === "existing" || calls > 1)
          ? { ...original, admitted: { policies: [], namespaces: [] } }
          : original;
      } };
      const registry = createReferenceAuthorizer({ policies, now: () => 1000, caps: { maxAdmissions: 2 } });
      registry.installResource({ resource: scope, owner: actor.principal, route, externalAuthority: "none" });
      registry.installBinding(grant("bootstrap"));
      if (conflict === "existing") registry.installAdmission(admission("a"));
      const before = await registry.evaluate(input);
      expect(before.decision.effect).toBe("allow");
      changed = true;
      calls = 0;
      expect(() => {
        registry.installAdmissions(conflict === "existing" ? [admission("b"), admission("a")] : [admission("a"), admission("a")]);
      }).toThrow(/Conflicting admission/);
      expect(registry.matches(before.stamp, caller)).toBe(true);
      changed = false;
      if (conflict === "existing") {
        registry.installAdmission(admission("a"));
        expect(registry.matches(before.stamp, caller)).toBe(true);
      }
      registry.installAdmissions([admission("b"), ...(conflict === "cohort" ? [admission("c")] : [])]);
      expect((await registry.evaluate(input)).stamp.epoch).toBe(before.stamp.epoch + 1);
    });
  }

  it("P2 captures the bounded selector cohort before any compiler call can mutate caller input", async () => {
    const genuine = batchFixture().policies;
    const inputs = [admission("a"), admission("b")];
    const policies = { ...genuine, forSessionType: (sessionType: { key: string; version: number }, providerId: string) => {
      if (sessionType.key === "a") inputs.push(admission("c"));
      return genuine.forSessionType(sessionType, providerId);
    } };
    const registry = createReferenceAuthorizer({ policies, now: () => 1000, caps: { maxAdmissions: 2 }, inputLimits: { maxAdmissionInstalls: 2 } });
    registry.installResource({ resource: scope, owner: actor.principal, route, externalAuthority: "none" });
    registry.installBinding(grant("bootstrap"));
    registry.installAdmissions(inputs);
    const before = await registry.evaluate(input);
    expect(before.decision.effect).toBe("allow");
    registry.installAdmissions([admission("a"), admission("b")]);
    expect(registry.matches(before.stamp, caller)).toBe(true);
    expect(() => {
      registry.installAdmission(admission("c"));
    }).toThrow(/admission limit/);
  });

  it("P2 single and batch preserve canonical selectors validated by a higher captured compiler budget", () => {
    const key = "k".repeat(200);
    const providerId = "p".repeat(200);
    const policies = createToolPolicyFactory({ limits: { ...POLICY_LIMIT_DEFAULTS, maxIdentifierLength: 256 },
      policies: [{ ...policy, operations: {}, challenge: { required: false } }],
      bindings: [key, `${key}b`].map((typeKey) => ({ sessionType: { key: typeKey, version: 1 }, providerId, admitted: { policies: [policy], namespaces: [] }, mandatory: [] })),
    });
    const registry = createReferenceAuthorizer({ policies, now: () => 1000 });
    registry.installAdmission({ sessionType: { key, version: 1 }, providerId });
    registry.installAdmissions([{ sessionType: { key: `${key}b`, version: 1 }, providerId }]);
  });

  it("P2 default128 and absolute1024 input boundaries are independent and failures do not consume slots", async () => {
    const defaults = batchFixture(2);
    defaults.registry.installAdmissions(Array.from({ length: 128 }, () => admission("a")));
    const before = await defaults.registry.evaluate(input);
    expect(() => {
      defaults.registry.installAdmissions(Array.from({ length: 129 }, () => admission("b")));
    }).toThrow(/input limit/);
    expect(defaults.registry.matches(before.stamp, caller)).toBe(true);
    defaults.registry.installAdmission(admission("b"));
    const absolute = batchFixture(1, 1024);
    absolute.registry.installAdmissions(Array.from({ length: 1024 }, () => admission("a")));
    const at = await absolute.registry.evaluate(input);
    expect(() => {
      absolute.registry.installAdmissions(Array.from({ length: 1025 }, () => admission("a")));
    }).toThrow(/input limit/);
    expect(absolute.registry.matches(at.stamp, caller)).toBe(true);
    expect(() => batchFixture(1, 0)).toThrow(/input limit/);
    expect(() => batchFixture(1, 1025)).toThrow(/input limit/);
  });
});

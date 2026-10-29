import { describe, expect, it } from "vitest";

import {
  createReferenceAuthorizer, DEFAULT_REFERENCE_INPUT_LIMITS, policyLimitsSchema,
  type ReferenceAuthorizer, type ResourceRef,
} from "@authorization";
import type {
  EvaluateSelector, ProjectAssignmentsInput, ReferenceInputLimits, ToolAssignmentRecord,
} from "@authorization/helpers/evaluate";
import { createToolPolicyFactory, defineToolPolicyNamespace, projectAssignedDescriptors, type CompiledToolPolicy } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope: ResourceRef = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const left: ResourceRef = { ...scope, id: "left", instanceId: "left" };
const right: ResourceRef = { ...scope, id: "right", instanceId: "right" };
const actor = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "connection", authRevision: "auth",
};
const owner = { domainId: "domain", subject: "owner" };
const contractId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const ref = (id: string) => ({ id, revision: 1 });
const direct = (id: string): CompiledToolPolicy => ({
  id, revision: 1,
  operations: {
    invoke: { actor: { mode: "direct-grant", actors: ["user"] }, requiredPermissions: ["blocked"] },
    discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true, requiredPermissions: ["blocked"] },
    execute: { actor: { mode: "direct-grant", actors: ["agent"] } },
  },
  challenge: { required: false },
});
const route = { origin: scope, targets: [scope] };
const contract = {
  id: contractId, key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07" as const,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};
const secondContract = { ...contract, id: secondId, key: "workspace.search", name: "search" };
const bind = (host: ReferenceAuthorizer, id: string, policyId: string, resource: ResourceRef = scope): void => {
  host.installBinding({
    id, actor: actor.actor, scope: resource, roles: [], policies: [ref(policyId)],
    authority: { kind: "host-policy", policy: ref(policyId) }, revision: 1,
  });
};
const base: EvaluateSelector = { actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route };
const projection = (input: EvaluateSelector): ProjectAssignmentsInput => ({
  ...input, purpose: "discover", recipient: "caller",
  tools: [{ contractId, policyRef: input.policyRef, bindingId: input.bindingId, operation: "discover" }],
});

// Every rig has real registered permission callbacks, canonical contracts and exact assignments.
const rig = (inputLimits: Partial<ReferenceInputLimits> = {}, wide = false, proofs = false, mandatory = false) => {
  let calls = 0;
  const options = {
    policies: createToolPolicyFactory({
      policies: [direct("allow"), direct("restriction-a"), direct("restriction-b")],
      limits: policyLimitsSchema.parse({ maxPolicyRefs: 1 }),
    }),
    now: () => start, inputLimits,
    permissionEvaluators: { blocked: () => {
      calls += 1;
      return "allow" as const;
    } },
  };
  const host = createReferenceAuthorizer(options);
  const permittedRoute = wide ? { origin: scope, targets: [left, right] } : route;
  for (const resource of [scope, left, right]) {
    host.installResource({
      resource, owner, route: permittedRoute,
      mandatory: mandatory && resource === scope
        ? [{ ref: ref("restriction-a"), applicable: true }, { ref: ref("restriction-b"), applicable: true }]
        : [],
      externalAuthority: proofs && resource !== right ? "required" : "none",
    });
  }
  bind(host, "grant", "allow");
  bind(host, "restriction-a", "restriction-a");
  bind(host, "restriction-b", "restriction-b");
  for (const tool of [contract, secondContract]) {
    host.installTool(tool);
    host.installToolAssignment({
      resource: scope, route: permittedRoute, recipient: actor.actor,
      contract: { id: tool.id, key: tool.key, version: tool.version },
      operation: "discover", bindingId: "grant", policyRef: ref("allow"),
    });
  }
  const request: EvaluateSelector = {
    ...base, route: permittedRoute,
    ...(proofs
      ? {
          external: { revision: "scope-proof", validUntil: start + 1_000 },
          externalProofs: [{ resource: left, revision: "left-proof", validUntil: start + 1_000 }],
        }
      : {}),
    ...(mandatory ? { mandatoryBindings: [{ resource: scope, policyRef: ref("restriction-a"), bindingId: "restriction-a" }] } : {}),
  };
  return { host, request, options, calls: () => calls };
};

const expectRejected = (decision: { readonly effect: string; readonly code?: string }): void => {
  expect(decision).toEqual({ effect: "deny", code: "invalid-input" });
};

describe("P03 admission and input limits", () => {
  it("allows namespace closure only with an exact binding and never calls the resolver", async () => {
    let calls = 0;
    const factory = createToolPolicyFactory({
      policies: [direct("outside")],
      namespaces: [defineToolPolicyNamespace({
        name: "workspace", revision: 1, policies: [direct("inside")], resolve: () => {
          calls += 1;
          return [];
        },
      })],
      bindings: [{
        sessionType: { key: "chat", version: 1 }, providerId: "host",
        admitted: { policies: [], namespaces: [{ name: "workspace", revision: 1 }] }, mandatory: [],
      }],
    });
    const host = createReferenceAuthorizer({ policies: factory, now: () => start, permissionEvaluators: { blocked: () => "allow" } });
    host.installAdmission({ sessionType: { key: "chat", version: 1 }, providerId: "host" });
    host.installResource({ resource: scope, owner, route, externalAuthority: "none", admission: { sessionType: { key: "chat", version: 1 }, providerId: "host" } });
    bind(host, "inside", "inside");
    bind(host, "outside", "outside");
    expect((await host.evaluate({ ...base, bindingId: "inside", policyRef: ref("inside") })).decision.effect).toBe("allow");
    expect((await host.evaluate({ ...base, bindingId: "missing", policyRef: ref("inside") })).decision).toEqual({ effect: "deny", code: "missing-authority" });
    expect((await host.evaluate({ ...base, bindingId: "outside", policyRef: ref("outside") })).decision).toEqual({ effect: "deny", code: "missing-authority" });
    expect(calls).toBe(0);
  });

  it("fails unknown admission atomically with matching scope authority and preserves a direct control", async () => {
    const { host } = rig();
    expect((await host.evaluate(base)).decision.effect).toBe("allow");
    expect(() => {
      host.installAdmission({ sessionType: { key: "missing", version: 1 }, providerId: "host" });
    }).toThrow();
    host.installResource({ resource: scope, owner, route, externalAuthority: "none", admission: { sessionType: { key: "missing", version: 1 }, providerId: "host" } });
    expect((await host.evaluate(base)).decision).toEqual({ effect: "deny", code: "missing-authority" });
  });

  for (const fault of ["unknown-namespace", "unknown-policy"] as const) {
    it(`${fault} admission installation fails atomically without consuming the cap`, async () => {
      const compiled = createToolPolicyFactory({ namespaces: [defineToolPolicyNamespace({
        name: "workspace", revision: 1, policies: [direct("allow")], resolve: () => [],
      })], bindings: [{ sessionType: { key: "chat", version: 1 }, providerId: "host",
        admitted: { policies: [], namespaces: [{ name: "workspace", revision: 1 }] }, mandatory: [],
      }] });
      let broken = true;
      const host = createReferenceAuthorizer({
        policies: {
          ...compiled,
          inspect: () => ({ ...compiled.inspect(), namespaces: broken && fault === "unknown-namespace" ? [] : compiled.inspect().namespaces }),
          getPolicy: (policyRef) => broken && fault === "unknown-policy" ? undefined : compiled.getPolicy(policyRef),
        },
        now: () => start, caps: { maxAdmissions: 1 }, permissionEvaluators: { blocked: () => "allow" },
      });
      const admission = { sessionType: { key: "chat", version: 1 }, providerId: "host" };
      host.installResource({ resource: scope, owner, route, externalAuthority: "none", admission });
      bind(host, "grant", "allow");
      expect(() => {
        host.installAdmission(admission);
      }).toThrow(/unknown/i);
      expect((await host.evaluate(base)).decision).toEqual({ effect: "deny", code: "missing-authority" });
      broken = false;
      expect(() => {
        host.installAdmission(admission);
      }).not.toThrow();
      expect((await host.evaluate(base)).decision.effect).toBe("allow");
    });
  }

  it("preserves missing-evaluator denial rather than silently dropping a permission", async () => {
    const host = createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies: [direct("allow")] }), now: () => start });
    host.installResource({ resource: scope, owner, route, externalAuthority: "none" });
    bind(host, "grant", "allow");
    expect((await host.evaluate(base)).decision).toEqual({ effect: "deny", code: "missing-evaluator" });
  });

  for (const entry of ["evaluate", "project"] as const) {
    it(`${entry}: route at custom limit allows and one-over rejects before callbacks`, async () => {
      const r = rig({ maxRouteTargets: 1 });
      r.options.inputLimits = { maxRouteTargets: 8 };
      const control = entry === "evaluate" ? await r.host.evaluate(r.request) : (await r.host.projectAssignments(projection(r.request))).decisions[0];
      expect(control?.decision.effect).toBe("allow");
      if (entry === "project") {
        expect(projectAssignedDescriptors(r.host, await r.host.projectAssignments(projection(r.request)), actor, "discover").descriptors).toHaveLength(1);
      }
      expect(r.calls()).toBeGreaterThan(0);
      const before = r.calls();
      const over = { ...r.request, route: { origin: scope, targets: [left, right] } };
      const denied = entry === "evaluate" ? await r.host.evaluate(over) : (await r.host.projectAssignments(projection(over))).decisions[0];
      if (denied === undefined) {
        throw new Error("Missing oversized-route decision.");
      }
      expectRejected(denied.decision);
      expect(denied.stamp.authority.route.targets).toEqual([]);
      expect(r.calls()).toBe(before);
      const wider = rig({ maxRouteTargets: 2 }, true);
      expect((await wider.host.evaluate(wider.request)).decision.effect).toBe("allow");
    });

    it(`${entry}: combined shorthand and distinct proof list enforce the captured proof limit`, async () => {
      const r = rig({ maxProofs: 2 }, true, true);
      r.options.inputLimits = { maxProofs: 8 };
      const valid = entry === "evaluate" ? await r.host.evaluate(r.request) : (await r.host.projectAssignments(projection(r.request))).decisions[0];
      expect(valid?.decision.effect).toBe("allow");
      if (entry === "project") {
        expect(projectAssignedDescriptors(r.host, await r.host.projectAssignments(projection(r.request)), actor, "discover").descriptors).toHaveLength(1);
      }
      const before = r.calls();
      const over = { ...r.request, externalProofs: [
        { resource: left, revision: "left-proof", validUntil: start + 1_000 },
        { resource: right, revision: "right-proof", validUntil: start + 1_000 },
      ] };
      const denied = entry === "evaluate" ? await r.host.evaluate(over) : (await r.host.projectAssignments(projection(over))).decisions[0];
      if (denied === undefined) {
        throw new Error("Missing oversized-proof decision.");
      }
      expectRejected(denied.decision);
      expect(r.calls()).toBe(before);
      const wider = rig({ maxProofs: 3 }, true, true);
      expect((await wider.host.evaluate(over)).decision.effect).toBe("allow");
    });

    it(`${entry}: unique mandatory selectors allow at limit and one-over cannot skip rules`, async () => {
      const r = rig({ maxMandatorySelectors: 2 }, false, false, true);
      // Install-time mandatory lists are bounded too: capture the lower evaluation budget only after a valid two-rule rig exists.
      const selectorLimits = { maxMandatorySelectors: 1 };
      const limited = createReferenceAuthorizer({
        policies: r.options.policies, now: () => start, inputLimits: selectorLimits,
        permissionEvaluators: r.options.permissionEvaluators,
      });
      selectorLimits.maxMandatorySelectors = 8;
      limited.installResource({ resource: scope, owner, route, mandatory: [{ ref: ref("restriction-a"), applicable: true }], externalAuthority: "none" });
      bind(limited, "grant", "allow");
      bind(limited, "restriction-a", "restriction-a");
      bind(limited, "restriction-b", "restriction-b");
      limited.installTool(contract);
      limited.installToolAssignment({ resource: scope, route, recipient: actor.actor, contract: { id: contractId, key: contract.key, version: 1 }, operation: "discover", bindingId: "grant", policyRef: ref("allow") });
      const valid = entry === "evaluate" ? await limited.evaluate(r.request) : (await limited.projectAssignments(projection(r.request))).decisions[0];
      expect(valid?.decision.effect).toBe("allow");
      if (entry === "project") {
        expect(projectAssignedDescriptors(limited, await limited.projectAssignments(projection(r.request)), actor, "discover").descriptors).toHaveLength(1);
      }
      const before = r.calls();
      const over = { ...r.request, mandatoryBindings: [
        { resource: scope, policyRef: ref("restriction-a"), bindingId: "restriction-a" },
        { resource: scope, policyRef: ref("restriction-b"), bindingId: "restriction-b" },
      ] };
      const denied = entry === "evaluate" ? await limited.evaluate(over) : (await limited.projectAssignments(projection(over))).decisions[0];
      if (denied === undefined) {
        throw new Error("Missing oversized-selector decision.");
      }
      expectRejected(denied.decision);
      expect(r.calls()).toBe(before);
      expect((await r.host.evaluate(over)).decision.effect).toBe("allow");
    });
  }

  it("projection tools deliver canonical descriptors at limit and reject one extra valid tuple", async () => {
    const r = rig({ maxProjectionTools: 1 });
    r.options.inputLimits = { maxProjectionTools: 8 };
    const input = projection(r.request);
    const allowed = await r.host.projectAssignments(input);
    expect(projectAssignedDescriptors(r.host, allowed, actor, "discover").descriptors).toHaveLength(1);
    const before = r.calls();
    const over = { ...input, tools: [...input.tools, { contractId: secondId, policyRef: ref("allow"), bindingId: "grant", operation: "discover" as const }] };
    const denied = await r.host.projectAssignments(over);
    const deniedDecision = denied.decisions[0];
    if (deniedDecision === undefined) {
      throw new Error("Missing oversized-projection decision.");
    }
    expectRejected(deniedDecision.decision);
    expect(denied.admitted).toEqual([]);
    expect(r.calls()).toBe(before);
    const wider = rig({ maxProjectionTools: 2 });
    expect(projectAssignedDescriptors(wider.host, await wider.host.projectAssignments(over), actor, "discover").descriptors).toHaveLength(2);
  });

  it("resource, tool and executor route installers reject one-over atomically and preserve existing authority", async () => {
    const r = rig({ maxRouteTargets: 1, maxMandatorySelectors: 1 });
    const current = await r.host.projectAssignments(projection(r.request));
    const record: ToolAssignmentRecord = {
      resource: scope, route, recipient: actor.actor, contract: { id: contractId, key: contract.key, version: 1 },
      operation: "discover", bindingId: "grant", policyRef: ref("allow"),
    };
    const executor = {
      actor: { kind: "agent" as const, principal: { domainId: "domain", subject: "ada" }, agentId: "agent" },
      connectionId: "executor", generation: 1, registrationRevision: 1,
    };
    r.host.installBinding({ id: "executor-grant", actor: executor.actor, scope, roles: [], policies: [ref("allow")], authority: { kind: "host-policy", policy: ref("allow") }, revision: 1 });
    const executorRecord: ToolAssignmentRecord = {
      ...record, operation: "execute", recipient: executor.actor, executor, bindingId: "executor-grant",
      implementation: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "impl" },
    };
    r.host.installExecutorAssignment(executorRecord);
    const beforeRejectedInstalls = await r.host.projectAssignments(projection(r.request));
    const executed = await r.host.projectAssignments({
      actor, purpose: "execute", recipient: "executor", executor, scope, route,
      tools: [{ contractId, policyRef: ref("allow"), bindingId: "executor-grant", operation: "execute" }],
    });
    expect(projectAssignedDescriptors(r.host, executed, actor, "execute").descriptors).toHaveLength(1);
    const overRoute = { origin: scope, targets: [left, right] };
    expect(() => {
      r.host.installResource({ resource: scope, owner, route: overRoute, externalAuthority: "none" });
    }).toThrow(/route limit/i);
    expect(() => {
      r.host.installResource({ resource: left, owner, route, mandatory: [
        { ref: ref("restriction-a"), applicable: true }, { ref: ref("restriction-b"), applicable: true },
      ], externalAuthority: "none" });
    }).toThrow(/limit/i);
    expect(() => {
      r.host.installToolAssignment({ ...record, route: overRoute });
    }).toThrow(/route limit/i);
    expect(() => {
      r.host.installExecutorAssignment({ ...executorRecord, route: overRoute });
    }).toThrow(/route limit/i);
    expect(r.host.validateAssignments(beforeRejectedInstalls, actor)).toBe(true);
    expect(projectAssignedDescriptors(r.host, executed, actor, "execute").descriptors).toHaveLength(1);
    expect(projectAssignedDescriptors(r.host, beforeRejectedInstalls, actor, "discover").descriptors).toHaveLength(1);
    expect((await r.host.evaluate(r.request)).decision.effect).toBe("allow");
    expect(current.admitted).toHaveLength(1);
  });

  it("validates each limit independently, captures options, and exposes default128/absolute1024 boundaries", () => {
    expect(DEFAULT_REFERENCE_INPUT_LIMITS).toEqual({ maxAdmissionInstalls: 128, maxRouteTargets: 128, maxProofs: 128, maxMandatorySelectors: 128, maxProjectionTools: 128 });
    for (const key of ["maxAdmissionInstalls", "maxRouteTargets", "maxProofs", "maxMandatorySelectors", "maxProjectionTools"] as const) {
      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1025]) {
        expect(() => rig({ [key]: invalid })).toThrow(/input limit/i);
      }
      expect(() => rig({ [key]: 1024 })).not.toThrow();
    }
  });

  it("allows 128 route targets by default and rejects target129 before callbacks or copying", async () => {
    let calls = 0;
    const targets = [scope, ...Array.from({ length: 127 }, (_, index) => ({ ...scope, id: `target-${String(index)}`, instanceId: `target-${String(index)}` }))];
    const permittedRoute = { origin: scope, targets };
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [direct("allow")] }), now: () => start,
      permissionEvaluators: { blocked: () => {
        calls += 1;
        return "allow";
      } },
    });
    for (const resource of targets) {
      host.installResource({ resource, owner, route: permittedRoute, externalAuthority: "none" });
    }
    bind(host, "grant", "allow");
    expect((await host.evaluate({ ...base, route: permittedRoute })).decision.effect).toBe("allow");
    expect(calls).toBe(1);
    const denied = await host.evaluate({ ...base, route: { origin: scope, targets: [...targets, { ...scope, instanceId: "target129" }] } });
    expectRejected(denied.decision);
    expect(denied.stamp.authority.route.targets).toEqual([]);
    expect(calls).toBe(1);
  });

  it("uses default binding schema budgets independently of a lower factory ref budget", () => {
    const r = rig();
    expect(() => {
      r.host.installBinding({
        id: "two-refs", actor: actor.actor, scope, roles: ["reviewer"], policies: [ref("allow"), ref("restriction-a")],
        authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
      });
    }).not.toThrow();
    expect(() => {
      r.host.installBinding({
        id: "bad-role", actor: actor.actor, scope, roles: [""], policies: [ref("allow")],
        authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
      });
    }).toThrow(/invalid binding/i);
  });
});

import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, type ReferenceAuthorizer, type ResourceRef } from "@authorization";
import { createToolPolicyFactory, projectAssignedDescriptors, type CompiledToolPolicy } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope: ResourceRef = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const left: ResourceRef = { domainId: "domain", kind: "terminal", id: "left", instanceId: "left" };
const right: ResourceRef = { domainId: "domain", kind: "terminal", id: "right", instanceId: "right" };
const route = { origin: scope, targets: [scope, left, right] };
const actor = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "connection",
  authRevision: "auth",
};
const ref = (id: string) => ({ id, revision: 1 });
const invoke = (id: string): CompiledToolPolicy => ({
  id, revision: 1,
  operations: {
    invoke: { actor: { mode: "direct-grant", actors: ["user"] } },
    discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
  },
  challenge: { required: false },
});

const hostWith = (policies: readonly CompiledToolPolicy[], now: () => number = () => start): ReferenceAuthorizer => (
  createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies }), now })
);

describe("P03 completion review", () => {
  for (const revokedRevision of ["left-proof", "right-proof"]) {
    it(`uses the earliest required target proof and invalidates ${revokedRevision} without borrowing mutable proofs`, async () => {
      let now = start;
      const host = hostWith([invoke("allow")], () => now);
      host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route, mandatory: [], externalAuthority: "none" });
      host.installResource({ resource: left, owner: { domainId: "domain", subject: "owner" }, route, mandatory: [], externalAuthority: "required" });
      host.installResource({ resource: right, owner: { domainId: "domain", subject: "owner" }, route, mandatory: [], externalAuthority: "required" });
      host.installBinding({
        id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
        authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
      });
      const proofs = [
        { resource: left, revision: "left-proof", validUntil: start + 500 },
        { resource: right, revision: "right-proof", validUntil: start + 1_000 },
      ];
      const allowed = await host.evaluate({
        actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route, externalProofs: proofs,
      });
      expect(allowed.decision.effect).toBe("allow");
      expect(allowed.stamp.validUntil).toBe(start + 500);
      expect(host.matches(allowed.stamp, actor)).toBe(true);
      proofs[0] = { resource: left, revision: "left-proof", validUntil: start + 10_000 };
      now = start + 501;
      expect(host.matches(allowed.stamp, actor)).toBe(false);
      now = start;
      const longer = await host.evaluate({
        actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
        externalProofs: [
          { resource: left, revision: "left-proof", validUntil: start + 1_000 },
          { resource: right, revision: "right-proof", validUntil: start + 1_000 },
        ],
      });
      expect(longer.decision.effect).toBe("allow");
      host.invalidateExternal(revokedRevision);
      expect(host.matches(longer.stamp, actor)).toBe(false);
    });
  }

  it("denies when a required proof expires during a deferred callback", async () => {
    let now = start;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let expire = false;
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [{
        id: "allow", revision: 1,
        operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, requiredPermissions: ["check"] } },
        challenge: { required: false },
      }] }),
      now: () => now,
      permissionEvaluators: {
        check: () => {
          if (!expire) {
            return "allow";
          }
          return gate.then(() => {
            now = start + 1_001;
            return "allow" as const;
          });
        },
      },
    });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] },
      mandatory: [], externalAuthority: "required",
    });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    const request = {
      actor, operation: "invoke" as const, bindingId: "grant", policyRef: ref("allow"), scope,
      route: { origin: scope, targets: [scope] },
      externalProofs: [{ resource: scope, revision: "proof", validUntil: start + 1_000 }],
    };
    expect((await host.evaluate(request)).decision.effect).toBe("allow");
    expire = true;
    const pending = host.evaluate(request);
    release?.();
    expect((await pending).decision).toEqual({ effect: "deny", code: "external-expired" });
  });

  it("sends a mandatory extension evaluator the target scope and ignores an unrelated allow", async () => {
    const seen: string[] = [];
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [
        invoke("allow"),
        { ...invoke("target.ext"), extension: { lane: "chat" } },
      ] }),
      now: () => start,
    });
    const full = { origin: scope, targets: [scope, left] };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: full, mandatory: [], externalAuthority: "none" });
    host.installResource({
      resource: left, owner: { domainId: "domain", subject: "owner" }, route: full,
      mandatory: [{ ref: ref("target.ext"), applicable: true }], externalAuthority: "none",
    });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    host.installBinding({
      id: "target-ext", actor: actor.actor, scope: left, roles: [], policies: [ref("target.ext")],
      authority: { kind: "host-policy", policy: ref("target.ext") }, revision: 1,
    });
    host.installPolicyExtensionEvaluator(ref("allow"), () => {
      seen.push("unrelated");
      return "allow";
    });
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: full,
    })).decision).toEqual({ effect: "deny", code: "missing-evaluator" });
    host.installPolicyExtensionEvaluator(ref("target.ext"), (input) => {
      expect(input.policyRef).toEqual(ref("target.ext"));
      expect(input.scope).toEqual(left);
      expect(input.actor).toEqual(actor.actor);
      seen.push(input.scope.id);
      return input.scope.id === "left" ? "allow" : "deny";
    });
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: full,
    })).decision.effect).toBe("allow");
    expect(seen).toEqual(["left"]);
  });

  it("allows one explicit mandatory alternative and denies the other without fallback", async () => {
    const host = mandatoryHost();
    const base = { actor, operation: "invoke" as const, bindingId: "grant", policyRef: ref("allow"), scope, route: { origin: scope, targets: [scope] } };
    expect((await host.evaluate(base)).decision).toEqual({ effect: "deny", code: "ambiguous-authority" });
    expect((await host.evaluate({
      ...base, mandatoryBindings: [{ resource: scope, policyRef: ref("restricted"), bindingId: "allow-path" }],
    })).decision.effect).toBe("allow");
    expect((await host.evaluate({
      ...base, mandatoryBindings: [{ resource: scope, policyRef: ref("restricted"), bindingId: "deny-path" }],
    })).decision).toEqual({ effect: "deny", code: "mandatory-deny" });
  });

  it("rejects duplicate and conflicting mandatory selectors separately from ambiguous omission", async () => {
    const host = mandatoryHost();
    const base = { actor, operation: "invoke" as const, bindingId: "grant", policyRef: ref("allow"), scope, route: { origin: scope, targets: [scope] } };
    expect((await host.evaluate({ ...base, mandatoryBindings: [
      { resource: scope, policyRef: ref("restricted"), bindingId: "allow-path" },
    ] })).decision.effect).toBe("allow");
    for (const bindingId of ["allow-path", "deny-path"]) {
      expect((await host.evaluate({ ...base, mandatoryBindings: [
        { resource: scope, policyRef: ref("restricted"), bindingId: "allow-path" },
        { resource: scope, policyRef: ref("restricted"), bindingId },
      ] })).decision).toEqual({ effect: "deny", code: "ambiguous-authority" });
    }
    expect((await host.evaluate({ ...base, mandatoryBindings: [
      { resource: scope, policyRef: ref("restricted"), bindingId: "missing" },
    ] })).decision).toEqual({ effect: "deny", code: "mandatory-deny" });
  });

  it("rejects a copied authorization object while the issued object remains valid", async () => {
    const host = hostWithPlain();
    const tool = {
      id: "11111111-1111-4111-8111-111111111111", key: "workspace.read", version: 1, name: "read", schemaDialect: "draft-07" as const,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    };
    host.installTool(tool);
    host.installToolAssignment({ resource: scope, route: { origin: scope, targets: [scope] }, recipient: actor.actor,
      contract: { id: tool.id, key: tool.key, version: tool.version }, operation: "discover", bindingId: "grant", policyRef: ref("allow"),
    });
    const authorization = await host.projectAssignments({
      actor, purpose: "discover", recipient: "caller", scope, route: { origin: scope, targets: [scope] },
      tools: [{ contractId: "11111111-1111-4111-8111-111111111111", policyRef: ref("allow"), bindingId: "grant" }],
    });
    expect(host.validateAssignments(authorization, actor)).toBe(true);
    expect(projectAssignedDescriptors(host, authorization, actor, "discover").descriptors).toHaveLength(1);
    const copied = { ...authorization, admitted: [...authorization.admitted] };
    expect(host.validateAssignments(copied, actor)).toBe(false);
    expect(projectAssignedDescriptors(host, copied, actor, "discover").descriptors).toEqual([]);
  });

  it("keeps a revoked proof unusable after invalidation overflow", async () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [invoke("allow")] }),
      now: () => start,
      caps: { maxExternalInvalidations: 1 },
    });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] },
      mandatory: [], externalAuthority: "required",
    });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    const request = {
      actor, operation: "invoke" as const, bindingId: "grant", policyRef: ref("allow"), scope,
      route: { origin: scope, targets: [scope] },
      externalProofs: [{ resource: scope, revision: "kept", validUntil: start + 1_000 }],
    };
    const issued = await host.evaluate(request);
    expect(issued.decision.effect).toBe("allow");
    host.invalidateExternal("kept");
    expect(host.matches(issued.stamp, actor)).toBe(false);
    expect((await host.evaluate(request)).decision).toEqual({ effect: "deny", code: "external-expired" });
    expect(() => {
      host.invalidateExternal("overflow");
    }).toThrow(/invalidation limit/i);
    expect(host.matches(issued.stamp, actor)).toBe(false);
    expect((await host.evaluate(request)).decision).toEqual({ effect: "deny", code: "external-expired" });
    expect((await host.evaluate({
      ...request, externalProofs: [{ resource: scope, revision: "fresh", validUntil: start + 1_000 }],
    })).decision.effect).toBe("deny");
  });
  it("captures the whole selector before a callback instead of retargeting or denying all work", async () => {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<"allow">((resolve) => {
      release = () => {
        resolve("allow");
      };
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [{ ...invoke("allow"), operations: {
        invoke: { actor: { mode: "direct-grant", actors: ["user"] }, requiredPermissions: ["check"] },
      } }] }), now: () => start,
      permissionEvaluators: { check: () => {
        entered();
        return gate;
      } },
    });
    const originalRoute = { origin: scope, targets: [scope] };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: originalRoute, externalAuthority: "none" });
    host.installBinding({ id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")], authority: { kind: "host-policy", policy: ref("allow") }, revision: 1 });
    const input = structuredClone({ actor, operation: "invoke" as const, bindingId: "grant", policyRef: ref("allow"),
      scope: { ...scope }, route: { origin: { ...scope }, targets: [{ ...scope }] },
    });
    const pending = host.evaluate(input);
    await started;
    input.actor.actor.principal.subject = "mallory";
    input.actor.authRevision = "forged";
    input.scope.instanceId = "forged";
    input.route.origin.id = "forged";
    input.route.targets = [left];
    input.bindingId = "missing";
    input.policyRef.id = "missing";
    release();
    const captured = await pending;
    expect(captured.decision.effect).toBe("allow");
    expect(captured.stamp.authority.actor).toEqual(actor.actor);
    expect(captured.stamp.authority.route).toEqual(originalRoute);
    expect(captured.stamp.authority.policyRevisions).toEqual([ref("allow")]);
    expect(captured.stamp.bindingExpiries.map((binding) => binding.bindingId)).toEqual(["grant"]);
    expect(host.matches(captured.stamp, actor)).toBe(true);
    expect(host.matches(captured.stamp, input.actor)).toBe(false);
  });

  it("keeps identical binding/tool/extension installs current at cap and rejects conflicts and one-over", async () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [invoke("allow")] }), now: () => start,
      caps: { maxBindings: 1, maxTools: 1, maxExtensionEvaluators: 1, maxPermissionEvaluators: 1 },
      permissionEvaluators: { check: () => "allow" },
    });
    const singleRoute = { origin: scope, targets: [scope] };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: singleRoute, externalAuthority: "none" });
    const binding = { id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")], authority: { kind: "host-policy" as const, policy: ref("allow") }, revision: 1 };
    const tool = { id: "11111111-1111-4111-8111-111111111111", key: "workspace.read", version: 1, name: "read", schemaDialect: "draft-07" as const, inputSchema: { type: "object", properties: {} } };
    const callback = () => "allow" as const;
    host.installBinding(binding);
    host.installTool(tool);
    host.installPolicyExtensionEvaluator(ref("allow"), callback);
    const decision = await host.evaluate({ actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: singleRoute });
    expect(decision.decision.effect).toBe("allow");
    host.installBinding(binding);
    host.installTool(tool);
    host.installPolicyExtensionEvaluator(ref("allow"), callback);
    expect(() => {
      host.installBinding({ ...binding, roles: ["forged"] });
    }).toThrow(/conflict/i);
    expect(() => {
      host.installTool({ ...tool, version: 2 });
    }).toThrow(/conflict/i);
    expect(() => {
      host.installTool({ ...tool, name: "silently_changed" });
    }).toThrow(/conflict/i);
    expect(() => {
      host.installPolicyExtensionEvaluator(ref("allow"), () => "deny");
    }).toThrow(/conflict/i);
    expect(() => {
      host.installBinding({ ...binding, id: "second" });
    }).toThrow(/limit/i);
    expect(() => {
      host.installTool({ ...tool, id: "22222222-2222-4222-8222-222222222222", key: "workspace.other" });
    }).toThrow(/limit/i);
    expect(() => {
      host.installPolicyExtensionEvaluator(ref("second"), callback);
    }).toThrow(/limit/i);
    expect(host.matches(decision.stamp, actor)).toBe(true);
    expect(host.getContract(tool.id)?.version).toBe(1);
    expect(() => createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies: [invoke("allow")] }), now: () => start,
      caps: { maxPermissionEvaluators: 1 }, permissionEvaluators: { a: callback, b: callback },
    })).toThrow(/limit/i);
  });

  it("keeps an identical resource registration current at capacity and rejects a conflicting owner atomically", async () => {
    const host = createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies: [invoke("allow")] }), now: () => start, caps: { maxResources: 1 } });
    const input = { resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] }, externalAuthority: "none" as const };
    host.installResource(input);
    host.installBinding({ id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")], authority: { kind: "host-policy", policy: ref("allow") }, revision: 1 });
    const decision = await host.evaluate({ actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: input.route });
    expect(decision.decision.effect).toBe("allow");
    host.installResource(input);
    expect(() => {
      host.installResource({ ...input, owner: { domainId: "domain", subject: "intruder" } });
    }).toThrow(/immutable|conflict/i);
    expect(() => {
      host.installResource({ ...input, resource: left });
    }).toThrow(/limit/i);
    expect(host.owner(scope)).toEqual(input.owner);
    expect(host.matches(decision.stamp, actor)).toBe(true);
  });

  it("keeps identical admission installation current at capacity and rejects a second admission atomically", async () => {
    const admission = { sessionType: { key: "chat", version: 1 }, providerId: "host" };
    const factory = createToolPolicyFactory({ policies: [invoke("allow")], bindings: [
      { ...admission, admitted: { policies: [ref("allow")], namespaces: [] }, mandatory: [] },
      { sessionType: { key: "other", version: 1 }, providerId: "host", admitted: { policies: [ref("allow")], namespaces: [] }, mandatory: [] },
    ] });
    const host = createReferenceAuthorizer({ policies: factory, now: () => start, caps: { maxAdmissions: 1 } });
    host.installAdmission(admission);
    const singleRoute = { origin: scope, targets: [scope] };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: singleRoute, admission, externalAuthority: "none" });
    host.installBinding({ id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")], authority: { kind: "host-policy", policy: ref("allow") }, revision: 1 });
    const decision = await host.evaluate({ actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: singleRoute });
    expect(decision.decision.effect).toBe("allow");
    expect(() => {
      host.installAdmission(admission);
    }).not.toThrow();
    expect(() => {
      host.installAdmission({ sessionType: { key: "other", version: 1 }, providerId: "host" });
    }).toThrow(/limit/i);
    expect(host.matches(decision.stamp, actor)).toBe(true);
  });
});

const mandatoryHost = (): ReferenceAuthorizer => {
  const host = createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies: [
    invoke("allow"), { id: "restricted", revision: 1,
      operations: { invoke: { actor: { mode: "roles", actors: { user: { anyOf: ["reviewer"] } } } } },
      challenge: { required: false },
    },
  ] }), now: () => start });
  host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] },
    mandatory: [{ ref: ref("restricted"), applicable: true }], externalAuthority: "none",
  });
  host.installBinding({ id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")], authority: { kind: "host-policy", policy: ref("allow") }, revision: 1 });
  for (const [id, roles] of [["allow-path", ["reviewer"]], ["deny-path", []]] as const) {
    host.installBinding({ id, actor: actor.actor, scope, roles, policies: [ref("restricted")], authority: { kind: "host-policy", policy: ref("restricted") }, revision: 1 });
  }
  return host;
};

const hostWithPlain = (): ReferenceAuthorizer => {
  const host = hostWith([invoke("allow")]);
  host.installResource({
    resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] },
    mandatory: [], externalAuthority: "none",
  });
  host.installBinding({
    id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
    authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
  });
  return host;
};

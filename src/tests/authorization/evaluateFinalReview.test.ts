import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, type ReferenceAuthorizer, type ResourceRef } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope: ResourceRef = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const target: ResourceRef = { domainId: "domain", kind: "terminal", id: "terminal", instanceId: "terminal-1" };
const other: ResourceRef = { domainId: "domain", kind: "session", id: "other", instanceId: "other" };
const route = { origin: scope, targets: [scope] };
const caller = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "caller-connection",
  authRevision: "auth",
};
const executor = {
  actor: { kind: "agent" as const, principal: { domainId: "domain", subject: "ada" }, agentId: "agent-1" },
  connectionId: "executor-connection",
  generation: 2,
  registrationRevision: 4,
};
const ref = (id: string) => ({ id, revision: 1 });
const direct = (id: string, operation: "invoke" | "execute" | "discover" = "invoke") => ({
  id,
  revision: 1,
  operations: {
    [operation]: { actor: { mode: "direct-grant" as const, actors: [operation === "execute" ? "agent" as const : "user" as const] } },
  },
  challenge: { required: false },
});

const hostWith = (
  policies: readonly Record<string, unknown>[],
  options: Partial<Parameters<typeof createReferenceAuthorizer>[0]> = {},
): ReferenceAuthorizer => createReferenceAuthorizer({
  policies: createToolPolicyFactory({ policies: policies as never }),
  now: () => start,
  ...options,
});

const installScope = (host: ReferenceAuthorizer, resource = scope, installedRoute = route): void => {
  host.installResource({
    resource,
    owner: { domainId: resource.domainId, subject: "owner" },
    route: installedRoute,
    mandatory: [],
    externalAuthority: "none",
  });
};

describe("P03 final review regressions", () => {
  it("rejects an authorization issued by another identically configured host", async () => {
    const configure = (): ReferenceAuthorizer => {
      const host = hostWith([direct("allow")]);
      installScope(host);
      host.installBinding({
        id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
        authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
      });
      host.installTool({
        id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07",
        inputSchema: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
      });
      host.installToolAssignment({
        resource: scope, route, recipient: caller.actor,
        contract: { id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 1 },
        operation: "invoke", bindingId: "grant", policyRef: ref("allow"),
      });
      return host;
    };
    const issuedBy = configure();
    const otherHost = configure();
    const authorization = await issuedBy.projectAssignments({
      actor: caller, purpose: "invoke", recipient: "caller", scope, route,
      tools: [{ contractId: "11111111-1111-4111-8111-111111111111", policyRef: ref("allow"), bindingId: "grant" }],
    });
    expect(authorization.decisions[0]?.decision.effect).toBe("allow");
    expect(issuedBy.validateAssignments(authorization, caller)).toBe(true);
    expect(otherHost.validateAssignments(authorization, caller)).toBe(false);
  });

  it("keeps executor assignment capacity independent of tool assignments", () => {
    const host = hostWith([direct("allow")], { caps: { maxExecutors: 1, maxToolAssignments: 2 } });
    installScope(host);
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    host.installTool({
      id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07",
      inputSchema: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
    });
    const record = {
      resource: scope, route, recipient: caller.actor,
      contract: { id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 1 },
      operation: "execute" as const, bindingId: "grant", policyRef: ref("allow"),
    };
    host.installToolAssignment(record);
    expect(() => {
      host.installExecutorAssignment({
        ...record,
        recipient: executor.actor,
        executor,
        implementation: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "impl-1" },
      });
    }).not.toThrow();
  });

  it("denies a mandatory policy whose own extension evaluator is missing", async () => {
    const host = hostWith([
      direct("allow"),
      { ...direct("restricted"), extension: { lane: "chat" } },
    ]);
    installScope(host);
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    host.installBinding({
      id: "restriction", actor: caller.actor, scope, roles: [], policies: [ref("restricted")],
      authority: { kind: "host-policy", policy: ref("restricted") }, revision: 1,
    });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [{ ref: ref("restricted"), applicable: true }], externalAuthority: "none",
    });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    })).decision).toEqual({ effect: "deny", code: "missing-evaluator" });
  });

  it("retains the caller on a genuinely authorized execute stamp", async () => {
    const host = hostWith([{
      id: "run", revision: 1,
      operations: { execute: { actor: { mode: "direct-grant" as const, actors: ["agent" as const] } } },
      challenge: { required: false },
    }]);
    installScope(host);
    host.installBinding({
      id: "exec-grant", actor: executor.actor, scope, roles: [], policies: [ref("run")],
      authority: { kind: "host-policy", policy: ref("run") }, revision: 1,
    });
    const allowed = await host.evaluate({
      actor: caller, operation: "execute", bindingId: "exec-grant", policyRef: ref("run"), scope, route, executor,
    });
    expect(allowed.decision.effect).toBe("allow");
    expect(allowed.stamp.authority.actor).toEqual(caller.actor);
    expect(allowed.stamp.authority.connectionId).toBe(caller.connectionId);
    expect(allowed.stamp.authority.executor).toEqual(executor);
    expect(host.matches(allowed.stamp, caller)).toBe(true);
    expect(host.matches(allowed.stamp, { ...caller, authRevision: "changed" })).toBe(false);
  });

  it("denies a positive policy outside the linked admission ceiling", async () => {
    const policies = createToolPolicyFactory({
      policies: [direct("allowed"), direct("other")],
      bindings: [{
        sessionType: { key: "chat", version: 1 }, providerId: "host",
        admitted: { policies: [ref("allowed")], namespaces: [] }, mandatory: [],
      }],
    });
    const host = createReferenceAuthorizer({ policies, now: () => start });
    host.installAdmission({ sessionType: { key: "chat", version: 1 }, providerId: "host" });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
      admission: { sessionType: { key: "chat", version: 1 }, providerId: "host" },
    });
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("other")],
      authority: { kind: "host-policy", policy: ref("other") }, revision: 1,
    });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("other"), scope, route,
    })).decision.effect).toBe("deny");
  });

  it("denies an uninstalled admission link", async () => {
    const host = hostWith([direct("allow")]);
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
      admission: { sessionType: { key: "missing", version: 1 }, providerId: "host" },
    });
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    })).decision.effect).toBe("deny");
  });

  it("denies a binding scope that is not on the registered route", async () => {
    const host = hostWith([direct("allow")]);
    installScope(host);
    host.installBinding({
      id: "off-route", actor: caller.actor, scope: other, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "off-route", policyRef: ref("allow"),
      scope: other, route,
    })).decision.effect).toBe("deny");
  });

  it("gives a target permission callback the target resource", async () => {
    const seen: ResourceRef[] = [];
    const host = hostWith([
      direct("allow"),
      {
        id: "target.rule", revision: 1,
        operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, requiredPermissions: ["scope.check"] } },
        challenge: { required: false },
      },
    ], {
      permissionEvaluators: {
        "scope.check": (input) => {
          seen.push(input.scope);
          return input.scope.id === "terminal" ? "deny" : "allow";
        },
      },
    });
    const fullRoute = { origin: scope, targets: [scope, target] };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: fullRoute, mandatory: [], externalAuthority: "none" });
    host.installResource({
      resource: target, owner: { domainId: "domain", subject: "owner" }, route: fullRoute,
      mandatory: [{ ref: ref("target.rule"), applicable: true }], externalAuthority: "none",
    });
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    host.installBinding({
      id: "target-rule", actor: caller.actor, scope: target, roles: [], policies: [ref("target.rule")],
      authority: { kind: "host-policy", policy: ref("target.rule") }, revision: 1,
    });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: fullRoute,
    })).decision.effect).toBe("deny");
    expect(seen).toEqual([target]);
  });

  it("does not let an origin proof satisfy a required target", async () => {
    const host = hostWith([direct("allow")]);
    const fullRoute = { origin: scope, targets: [scope, target] };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: fullRoute, mandatory: [], externalAuthority: "none" });
    host.installResource({ resource: target, owner: { domainId: "domain", subject: "owner" }, route: fullRoute, mandatory: [], externalAuthority: "required" });
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    const denied = await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: fullRoute,
      external: { revision: "origin-proof", validUntil: start + 1_000 },
    });
    expect(denied.decision.effect).toBe("deny");
    const allowed = await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: fullRoute,
      externalProofs: [{ resource: target, revision: "target-proof", validUntil: start + 1_000 }],
    });
    expect(allowed.decision.effect).toBe("allow");
  });

  it("denies ambiguous mandatory bindings and does not fall back after the chosen path denies", async () => {
    const host = hostWith([{
      id: "restricted", revision: 1,
      operations: { invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: ["reviewer"] } } } } },
      challenge: { required: false },
    }, direct("allow")]);
    installScope(host);
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [{ ref: ref("restricted"), applicable: true }], externalAuthority: "none",
    });
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    host.installBinding({
      id: "deny-path", actor: caller.actor, scope, roles: [], policies: [ref("restricted")],
      authority: { kind: "host-policy", policy: ref("restricted") }, revision: 1,
    });
    host.installBinding({
      id: "allow-path", actor: caller.actor, scope, roles: ["reviewer"], policies: [ref("restricted")],
      authority: { kind: "host-policy", policy: ref("restricted") }, revision: 1,
    });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
    })).decision).toEqual({ effect: "deny", code: "ambiguous-authority" });
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
      mandatoryBindings: [
        { resource: scope, policyRef: ref("restricted"), bindingId: "deny-path" },
        { resource: scope, policyRef: ref("restricted"), bindingId: "allow-path" },
      ],
    })).decision.effect).toBe("deny");
  });

  it("does not let a deferred callback mutation retarget the captured selector", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = hostWith([{
      id: "needs", revision: 1,
      operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, requiredPermissions: ["check"] } },
      challenge: { required: false },
    }], {
      permissionEvaluators: { check: () => gate.then(() => "allow" as const) },
    });
    installScope(host);
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("needs")],
      authority: { kind: "host-policy", policy: ref("needs") }, revision: 1,
    });
    const request = {
      actor: caller, operation: "invoke" as const, bindingId: "grant", policyRef: ref("needs"), scope, route,
    };
    const pending = host.evaluate(request);
    request.actor = { ...caller, authRevision: "forged" };
    request.policyRef = ref("forged");
    release?.();
    const decision = await pending;
    expect(decision.decision.effect).toBe("allow");
    expect(decision.stamp.authority.authRevision).toBe("auth");
    expect(decision.stamp.authority.policyRevisions[0]).toEqual(ref("needs"));
  });

  it("latches required external authority when invalidation storage is exhausted", async () => {
    const host = hostWith([direct("allow")], { caps: { maxExternalInvalidations: 1 } });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "required",
    });
    host.installBinding({
      id: "grant", actor: caller.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    host.invalidateExternal("kept");
    expect(() => {
      host.invalidateExternal("overflow");
    }).toThrow(/invalidation limit/i);
    expect((await host.evaluate({
      actor: caller, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route,
      externalProofs: [{ resource: scope, revision: "fresh", validUntil: start + 1_000 }],
    })).decision.effect).toBe("deny");
  });
});

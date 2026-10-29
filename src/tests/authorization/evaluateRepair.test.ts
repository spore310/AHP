import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, DEFAULT_REFERENCE_CAPS } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const target = { domainId: "domain", kind: "terminal", id: "terminal", instanceId: "terminal-1" };
const route = { origin: scope, targets: [scope, target] };
const actor = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "connection",
  authRevision: "auth",
};
const ref = (id: string) => ({ id, revision: 1 });
const policy = (id: string, operation: "invoke" | "discover" = "invoke") => ({
  id, revision: 1,
  operations: { [operation]: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, reveal: true } },
  challenge: { required: false },
});

describe("P03 repair boundaries", () => {
  it("does not let a second policy in the same binding become a grant", async () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [policy("allow"), policy("other")] }),
      now: () => start,
    });
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] }, mandatory: [], externalAuthority: "none" });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow"), ref("other")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("missing"), scope, route: { origin: scope, targets: [scope] },
    })).decision.effect).toBe("deny");
  });

  it("denies a missing target and keeps the target mandatory rule", async () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [policy("allow"), {
        id: "target.deny", revision: 1,
        operations: { invoke: { actor: { mode: "roles", actors: { user: { anyOf: [] } } } } },
        challenge: { required: false },
      }] }),
      now: () => start,
    });
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route, mandatory: [], externalAuthority: "none" });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    expect((await host.evaluate({ actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route })).decision.effect).toBe("deny");
    host.installResource({
      resource: target, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [{ ref: ref("target.deny"), applicable: true }], externalAuthority: "none",
    });
    host.installBinding({
      id: "target-grant", actor: actor.actor, scope: target, roles: [], policies: [ref("target.deny")],
      authority: { kind: "host-policy", policy: ref("target.deny") }, revision: 1,
    });
    const denied = await host.evaluate({ actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route });
    expect(denied.decision.effect).toBe("deny");
  });

  it("expires a short decision TTL before the binding and ignores proof mutation", async () => {
    let now = start;
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [policy("allow")] }),
      now: () => now,
      decisionTtlMs: 10,
    });
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] }, mandatory: [], externalAuthority: "required" });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
      expiresAt: new Date(start + 10_000).toISOString(),
    });
    const external = { revision: "proof", validUntil: start + 10_000 };
    const allowed = await host.evaluate({ actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: { origin: scope, targets: [scope] }, external });
    expect(allowed.decision.effect).toBe("allow");
    external.validUntil = Number.POSITIVE_INFINITY;
    now = start + 11;
    expect(host.matches(allowed.stamp, actor)).toBe(false);
  });

  it("uses a tool cap independent of maxPolicyRefs", () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [policy("allow")], limits: { maxPolicyRefs: 1 } as never }),
      now: () => start,
      caps: { maxTools: 1 },
    });
    host.installTool({
      id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07",
      inputSchema: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
    });
    expect(() => {
      host.installTool({
        id: "22222222-2222-4222-8222-222222222222", key: "workspace.search", version: 1, name: "search", schemaDialect: "draft-07",
        inputSchema: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
      });
    }).toThrow(/tool limit/i);
    expect(DEFAULT_REFERENCE_CAPS.maxTools).toBe(128);
  });

  it("does not clear another domain when tearing down the same instance id", () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [policy("allow")] }),
      now: () => start,
    });
    const other = { ...scope, domainId: "other" };
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] }, mandatory: [], externalAuthority: "none" });
    host.installResource({ resource: other, owner: { domainId: "other", subject: "owner" }, route: { origin: other, targets: [other] }, mandatory: [], externalAuthority: "none" });
    host.teardown(scope);
    expect(host.owner(other)).toEqual({ domainId: "other", subject: "owner" });
    expect(host.owner(scope)).toBeUndefined();
  });

  it("denies an extension when its own evaluator is missing", async () => {
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [{
        id: "allow", revision: 1, extension: { lane: "chat" },
        operations: { invoke: { actor: { mode: "direct-grant", actors: ["user"] } } },
        challenge: { required: false },
      }] }),
      now: () => start,
      permissionEvaluators: { blocked: () => "allow" },
    });
    host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] }, mandatory: [], externalAuthority: "none" });
    host.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("allow")],
      authority: { kind: "host-policy", policy: ref("allow") }, revision: 1,
    });
    expect((await host.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("allow"), scope, route: { origin: scope, targets: [scope] },
    })).decision).toEqual({ effect: "deny", code: "missing-evaluator" });
  });

  it("denies when a permission callback times out", async () => {
    const compiled = {
      id: "needs", revision: 1,
      operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, requiredPermissions: ["blocked"] } },
      challenge: { required: false },
    };
    const timed = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [compiled] }),
      now: () => start,
      hookDeadlineMs: 5,
      permissionEvaluators: { blocked: () => new Promise(() => undefined) },
    });
    timed.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route: { origin: scope, targets: [scope] }, mandatory: [], externalAuthority: "none" });
    timed.installBinding({
      id: "grant", actor: actor.actor, scope, roles: [], policies: [ref("needs")],
      authority: { kind: "host-policy", policy: ref("needs") }, revision: 1,
    });
    expect((await timed.evaluate({
      actor, operation: "invoke", bindingId: "grant", policyRef: ref("needs"), scope, route: { origin: scope, targets: [scope] },
    })).decision.effect).toBe("deny");
  });
});

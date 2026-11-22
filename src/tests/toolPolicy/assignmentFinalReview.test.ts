import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, type ResourceRef } from "@authorization";
import { createToolPolicyFactory, projectAssignedDescriptors } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope: ResourceRef = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const route = { origin: scope, targets: [scope] };
const contractId = "11111111-1111-4111-8111-111111111111";
const actor = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "caller-connection",
  authRevision: "auth",
};
const contract = {
  id: contractId, key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07" as const,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};
const ref = { id: "allow", revision: 1 };

const host = () => {
  const authorizer = createReferenceAuthorizer({
    policies: createToolPolicyFactory({
      policies: [{
        id: "allow", revision: 1,
        operations: {
          invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, reveal: true },
          discover: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, reveal: true },
        },
        challenge: { required: false },
      }],
    }),
    now: () => start,
  });
  authorizer.installResource({
    resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
    mandatory: [], externalAuthority: "none",
  });
  authorizer.installTool(contract);
  authorizer.installBinding({
    id: "grant", actor: actor.actor, scope, roles: [], policies: [ref],
    authority: { kind: "host-policy", policy: ref }, revision: 1,
  });
  return authorizer;
};

const assignment = {
  resource: scope, route, recipient: actor.actor,
  contract: { id: contractId, key: contract.key, version: 1 },
  operation: "invoke" as const, bindingId: "grant", policyRef: ref,
};

describe("P03 assignment final review regressions", () => {
  it("does not disclose an invoke authorization when delivery purpose is execute", async () => {
    const authorizer = host();
    authorizer.installToolAssignment(assignment);
    authorizer.installToolAssignment({ ...assignment, operation: "discover" });
    const authorized = await authorizer.projectAssignments({
      actor, purpose: "invoke", recipient: "caller", scope, route,
      tools: [{ contractId, policyRef: ref, bindingId: "grant", operation: "invoke" }],
    });
    const discovered = await authorizer.projectAssignments({
      actor, purpose: "discover", recipient: "caller", scope, route,
      tools: [{ contractId, policyRef: ref, bindingId: "grant", operation: "discover" }],
    });
    expect(authorized.decisions[0]?.decision.effect).toBe("allow");
    expect(projectAssignedDescriptors(authorizer, discovered, actor, "discover").descriptors).toHaveLength(1);
    expect(projectAssignedDescriptors(authorizer, authorized, actor, "execute").descriptors).toEqual([]);
  });

  it("rejects a conflicting assignment instead of overwriting the installed tuple", () => {
    const authorizer = host();
    authorizer.installToolAssignment(assignment);
    expect(() => {
      authorizer.installToolAssignment({
        ...assignment,
        recipient: { kind: "user", principal: { domainId: "domain", subject: "bob" } },
        route: { origin: scope, targets: [scope, scope] },
      });
    }).toThrow(/conflict/i);
  });

  it("does not disclose an assignment whose recipient does not match the caller", async () => {
    const matching = host();
    matching.installToolAssignment({ ...assignment, operation: "discover" });
    const disclosed = await matching.projectAssignments({
      actor, purpose: "discover", recipient: "caller", scope, route,
      tools: [{ contractId, policyRef: ref, bindingId: "grant", operation: "discover" }],
    });
    expect(projectAssignedDescriptors(matching, disclosed, actor, "discover").descriptors).toHaveLength(1);
    const authorizer = host();
    authorizer.installToolAssignment({
      ...assignment,
      operation: "discover",
      recipient: { kind: "user", principal: { domainId: "domain", subject: "bob" } },
    });
    const authorized = await authorizer.projectAssignments({
      actor, purpose: "discover", recipient: "caller", scope, route,
      tools: [{ contractId, policyRef: ref, bindingId: "grant", operation: "discover" }],
    });
    expect(projectAssignedDescriptors(authorizer, authorized, actor, "discover").descriptors).toEqual([]);
  });
});

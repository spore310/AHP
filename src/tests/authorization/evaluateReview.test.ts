import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, type ScopedPolicyBinding, type TrustedRequestContext } from "@authorization";
import { createToolPolicyFactory, projectAssignedDescriptors } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const route = { origin: scope, targets: [scope] };
const actor: TrustedRequestContext = {
  actor: { kind: "user", principal: { domainId: "domain", subject: "ada" } },
  connectionId: "connection", authRevision: "auth",
};
const contractId = "11111111-1111-4111-8111-111111111111";
const directRule = { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, reveal: true };
const ref = (id: string) => ({ id, revision: 1 });
const binding = (id: string, policyId: string, expiresAt?: string): ScopedPolicyBinding => ({
  id, actor: actor.actor, scope, roles: [], policies: [ref(policyId)],
  authority: { kind: "host-policy", policy: ref(policyId) }, revision: 1,
  ...(expiresAt === undefined ? {} : { expiresAt }),
});
const request = {
  actor, operation: "invoke" as const, policyRef: ref("allow"), bindingId: "grant", scope, route, mandatory: [],
};
const fixture = (options: {
  mandatory?: boolean;
  primaryPermission?: boolean;
  mandatoryPermission?: boolean;
  now?: () => number;
  external?: boolean;
} = {}) => {
  const host = createReferenceAuthorizer({
    policies: createToolPolicyFactory({ policies: [
      { id: "allow", revision: 1, operations: {
        invoke: { ...directRule, ...(options.primaryPermission === true ? { requiredPermissions: ["blocked"] } : {}) },
      }, challenge: { required: false } },
      { id: "mandatory", revision: 1, operations: {
        invoke: options.mandatoryPermission === true
          ? { ...directRule, requiredPermissions: ["blocked"] }
          : { actor: { mode: "roles", actors: { user: { anyOf: [] } } } },
      }, challenge: { required: false } },
    ] }),
    now: options.now ?? (() => start),
    permissionEvaluators: { blocked: () => "deny" },
  });
  host.installResource({
    resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
    mandatory: options.mandatory === true ? [{ ref: ref("mandatory"), applicable: true }] : [],
    externalAuthority: options.external === true ? "required" : "none",
  });
  host.installBinding(binding("grant", "allow"));
  host.installBinding(binding("restriction", "mandatory"));
  return host;
};

describe("P03 authority review regressions", () => {
  it("enforces registered mandatory restrictions even when the request omits them", async () => {
    const host = fixture({ mandatory: true });
    expect((await host.evaluate(request)).decision.effect).toBe("deny");
  });

  it("evaluates permission checks on mandatory policies, not only the positive grant", async () => {
    const host = fixture({ mandatory: true, mandatoryPermission: true });
    expect((await host.evaluate({ ...request, mandatory: [ref("mandatory")] })).decision.effect).toBe("deny");
  });

  it("does not disclose descriptors through a synchronous permission-check bypass", async () => {
    let calls = 0;
    const host = createReferenceAuthorizer({
      policies: createToolPolicyFactory({ policies: [{
        id: "allow", revision: 1,
        operations: { discover: { ...directRule, requiredPermissions: ["blocked"] } },
        challenge: { required: false },
      }] }),
      now: () => start,
      permissionEvaluators: {
        blocked: () => {
          calls += 1;
          return "deny";
        },
      },
    });
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    host.installBinding(binding("grant", "allow"));
    host.installTool({
      id: contractId, key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07",
      inputSchema: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
    });
    host.installToolAssignment({
      resource: scope, route, recipient: actor.actor,
      contract: { id: contractId, key: "workspace.read-file", version: 1 },
      operation: "discover", bindingId: "grant", policyRef: ref("allow"),
    });
    const authorized = await host.projectAssignments({
      actor, purpose: "discover", recipient: "caller", scope, route,
      tools: [{ contractId, policyRef: ref("allow"), bindingId: "grant", operation: "discover" }],
    });
    expect(calls).toBeGreaterThan(0);
    expect(projectAssignedDescriptors(host, authorized, actor, "discover").descriptors).toEqual([]);
  });

  it("never retains an allowed decision past its binding expiry", async () => {
    let now = start;
    const host = fixture({ now: () => now });
    host.teardown(scope);
    host.installResource({
      resource: scope, owner: { domainId: "domain", subject: "owner" }, route,
      mandatory: [], externalAuthority: "none",
    });
    host.installBinding(binding("grant", "allow", new Date(start + 1000).toISOString()));
    const allowed = await host.evaluate(request);
    expect(allowed.decision.effect).toBe("allow");
    now = start + 1001;
    expect(host.matches(allowed.stamp, actor)).toBe(false);
  });

  it("never retains an allowed decision past its external proof expiry", async () => {
    let now = start;
    const host = fixture({ now: () => now, external: true });
    const allowed = await host.evaluate({ ...request, external: { revision: "external", validUntil: start + 1000 } });
    expect(allowed.decision.effect).toBe("allow");
    now = start + 1001;
    expect(host.matches(allowed.stamp, actor)).toBe(false);
  });

  it("rejects nonfinite external validity instead of treating it as current forever", async () => {
    const host = fixture({ external: true });
    for (const validUntil of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await host.evaluate({ ...request, external: { revision: "external", validUntil } })).decision.effect)
        .toBe("deny");
    }
  });

  it("captures host-installed bindings rather than borrowing mutable grant arrays", async () => {
    const host = fixture();
    const policies: { id: string; revision: number }[] = [];
    host.installBinding({ ...binding("empty", "allow"), policies });
    const emptyRequest = { ...request, bindingId: "empty" };
    expect((await host.evaluate(emptyRequest)).decision.effect).toBe("deny");
    policies.push(ref("allow"));
    expect((await host.evaluate(emptyRequest)).decision.effect).toBe("deny");
  });
});

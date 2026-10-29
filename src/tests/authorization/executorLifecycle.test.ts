import { describe, expect, it } from "vitest";
import { createReferenceAuthorizer } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";

const fixture = () => {
  const policy = { id: "executor", revision: 1 };
  const actor = { kind: "user" as const, principal: { domainId: "local", subject: "executor" } };
  const context = { actor, connectionId: "caller", authRevision: "auth" };
  const scope = { domainId: "local", kind: "session", id: "ahp-session:/executors", instanceId: "one" };
  const route = { origin: scope, targets: [scope] };
  const contract = { id: "11111111-1111-4111-8111-111111111111", key: "test.echo", version: 1,
    name: "echo", schemaDialect: "draft-07" as const, inputSchema: { type: "object" } };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: {
    execute: { actor: { mode: "direct-grant", actors: ["user"] } },
  }, challenge: { required: false } }] });
  const registry = createReferenceAuthorizer({ policies, now: Date.now });
  registry.installResource({ resource: scope, route, owner: actor.principal, externalAuthority: "none" });
  registry.installBinding({ id: "grant", actor, scope, policies: [policy], roles: [], revision: 1,
    authority: { kind: "host-policy", policy } });
  registry.installTool(contract);
  const tuple = { resource: scope, route, recipient: actor, contract: { id: contract.id, key: contract.key, version: 1 },
    operation: "execute" as const, bindingId: "grant", policyRef: policy,
    executor: { actor, connectionId: "executor-a", generation: 1, registrationRevision: 1 },
    implementation: { location: "client" as const, suppliedBy: "client" as const,
      implementation: "client-owned" as const, implementationId: "echo-a" } };
  const project = (executor = tuple.executor) => registry.projectAssignments({ actor: context, purpose: "execute", recipient: "executor",
    executor, scope, route, tools: [{ contractId: contract.id, policyRef: policy, bindingId: "grant" }] });
  return { registry, tuple, project, context };
};

describe("canonical executor assignment lifecycle", () => {
  it("admits distinct connections and generations under one unchanged grant", async () => {
    const f = fixture();
    const second = { ...f.tuple, executor: { ...f.tuple.executor, connectionId: "executor-b" } };
    const successor = { ...f.tuple, executor: { ...f.tuple.executor, generation: 2, registrationRevision: 2 } };
    f.registry.installExecutorAssignment(f.tuple);
    f.registry.installExecutorAssignment(second);
    f.registry.installExecutorAssignment(successor);
    for (const tuple of [f.tuple, second, successor]) {
      expect((await f.project(tuple.executor)).admitted).toMatchObject([{ allowed: true, tuple }]);
    }
    expect(f.registry.readBindings({ actor: f.context.actor, scope: f.tuple.resource }).bindings).toHaveLength(1);
  });

  it("removes only the exact expected tuple and invalidates old proofs", async () => {
    const f = fixture();
    const next = { ...f.tuple, executor: { ...f.tuple.executor, generation: 2 } };
    f.registry.installExecutorAssignment(f.tuple);
    f.registry.installExecutorAssignment(next);
    const before = await f.project();
    expect(f.registry.validateAssignments(before, f.context)).toBe(true);
    expect(f.registry.removeExecutorAssignment({ ...f.tuple, implementation: { ...f.tuple.implementation, implementationId: "wrong" } })).toBe(false);
    expect(f.registry.validateAssignments(before, f.context)).toBe(true);
    expect(f.registry.removeExecutorAssignment(f.tuple)).toBe(true);
    expect(f.registry.removeExecutorAssignment(f.tuple)).toBe(false);
    expect(f.registry.validateAssignments(before, f.context)).toBe(false);
    expect((await f.project()).admitted).toEqual([]);
    expect((await f.project(next.executor)).admitted).toMatchObject([{ allowed: true, tuple: next }]);
    expect(f.registry.readBindings({ actor: f.context.actor, scope: f.tuple.resource }).bindings).toHaveLength(1);
  });

  it("rejects a changed implementation on the same executor registration", () => {
    const f = fixture();
    f.registry.installExecutorAssignment(f.tuple);
    expect(() => {
      f.registry.installExecutorAssignment({ ...f.tuple, implementation: { ...f.tuple.implementation, implementationId: "replacement" } });
    }).toThrow();
  });
});

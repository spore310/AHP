import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, type ResourceRef } from "@authorization";
import type { ProjectAssignmentsInput, ReferenceAuthorizerOptions, ToolAssignmentRecord } from "@authorization/helpers/evaluate";
import { createToolPolicyFactory, projectAssignedDescriptors } from "@toolPolicy";

const start = 1_700_000_000_000;
const scope: ResourceRef = { domainId: "domain", kind: "session", id: "session", instanceId: "instance" };
const route = { origin: scope, targets: [scope] };
const contractId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const caller = {
  actor: { kind: "user" as const, principal: { domainId: "domain", subject: "ada" } },
  connectionId: "caller-connection", authRevision: "auth",
};
const executor = {
  actor: { kind: "agent" as const, principal: { domainId: "domain", subject: "ada" }, agentId: "agent-1" },
  connectionId: "executor-connection", generation: 2, registrationRevision: 4,
};
const implementation = {
  location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "impl-1",
};
const contract = {
  id: contractId, key: "workspace.read-file", version: 1, name: "read_file", schemaDialect: "draft-07" as const,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};
const secondContract = { ...contract, id: secondId, key: "workspace.search", name: "search" };
const ref = { id: "allow", revision: 1 };
const record = (execute = false): ToolAssignmentRecord => ({
  resource: scope, route, recipient: execute ? executor.actor : caller.actor,
  contract: { id: contractId, key: contract.key, version: 1 },
  operation: execute ? "execute" : "discover", bindingId: execute ? "exec-grant" : "grant", policyRef: ref,
  ...(execute ? { executor, implementation } : {}),
});
const request = (execute = false): ProjectAssignmentsInput => ({
  actor: caller, purpose: execute ? "execute" : "discover", recipient: execute ? "executor" : "caller", scope, route,
  ...(execute ? { executor } : {}),
  tools: [{ contractId, policyRef: ref, bindingId: execute ? "exec-grant" : "grant", operation: execute ? "execute" : "discover" }],
});
const authorizer = (
  check: NonNullable<ReferenceAuthorizerOptions["permissionEvaluators"]>[string] = () => "allow",
  caps: ReferenceAuthorizerOptions["caps"] = {},
) => {
  const host = createReferenceAuthorizer({
    policies: createToolPolicyFactory({ policies: [{
      id: "allow", revision: 1,
      operations: {
        discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true, requiredPermissions: ["check"] },
        execute: { actor: { mode: "direct-grant", actors: ["agent"] } },
      }, challenge: { required: false },
    }] }),
    now: () => start, permissionEvaluators: { check }, caps,
  });
  host.installResource({ resource: scope, owner: { domainId: "domain", subject: "owner" }, route, mandatory: [], externalAuthority: "none" });
  host.installTool(contract);
  host.installTool(secondContract);
  for (const [id, actor] of [["grant", caller.actor], ["exec-grant", executor.actor]] as const) {
    host.installBinding({ id, actor, scope, roles: [], policies: [ref], authority: { kind: "host-policy", policy: ref }, revision: 1 });
  }
  return host;
};
const installDiscovery = (host: ReturnType<typeof authorizer>): void => {
  host.installToolAssignment(record());
  host.installToolAssignment({ ...record(), contract: { id: secondId, key: secondContract.key, version: 1 } });
};
const twoItems = (): ProjectAssignmentsInput => ({ ...request(), tools: [
  { contractId, policyRef: ref, bindingId: "grant", operation: "discover" },
  { contractId: secondId, policyRef: ref, bindingId: "grant", operation: "discover" },
] });

describe("P03 assignment completion review", () => {
  it("captures the whole projection and later tuple during a controlled first await", async () => {
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
    let calls = 0;
    const host = authorizer(() => {
      calls += 1;
      if (calls === 1) {
        entered();
        return gate;
      }
      return "allow";
    });
    installDiscovery(host);
    const input = structuredClone({
      actor: caller, purpose: "discover" as const, recipient: "caller" as const,
      scope: { ...scope }, route: { origin: { ...scope }, targets: [{ ...scope }] },
      tools: [
        { contractId, policyRef: { ...ref }, bindingId: "grant", operation: "discover" as const },
        { contractId: secondId, policyRef: { ...ref }, bindingId: "grant", operation: "discover" as const },
      ],
    });
    const pending = host.projectAssignments(input);
    await started;
    input.actor.actor.principal.subject = "forged";
    input.actor.authRevision = "forged";
    input.scope.instanceId = "forged";
    input.route.origin.id = "forged";
    input.route.targets = [];
    input.tools[0] = { contractId: secondId, policyRef: { id: "missing", revision: 1 }, bindingId: "missing", operation: "discover" };
    input.tools[1] = { contractId: "33333333-3333-4333-8333-333333333333", policyRef: { id: "missing", revision: 1 }, bindingId: "missing", operation: "discover" };
    release();
    const captured = await pending;
    expect(calls).toBe(2);
    expect(captured.decisions.map((decision) => decision.decision.effect)).toEqual(["allow", "allow"]);
    expect(captured.admitted.map((item) => item.tuple.contract.id)).toEqual([contractId, secondId]);
    expect(captured.stamps.every((stamp) => host.matches(stamp, caller))).toBe(true);
    expect(projectAssignedDescriptors(host, captured, caller, "discover").descriptors.map((tool) => tool.name)).toEqual(["read_file", "search"]);
    expect(projectAssignedDescriptors(host, captured, input.actor, "discover").descriptors).toEqual([]);
  });

  it("emits no descriptors when the first resource is torn down while the second callback is pending", async () => {
    let release: () => void = () => undefined;
    let enteredSecond: () => void = () => undefined;
    const gate = new Promise<"allow">((resolve) => {
      release = () => {
        resolve("allow");
      };
    });
    const startedSecond = new Promise<void>((resolve) => {
      enteredSecond = resolve;
    });
    let calls = 0;
    const host = authorizer(() => {
      calls += 1;
      if (calls === 2) {
        enteredSecond();
        return gate;
      }
      return "allow";
    });
    installDiscovery(host);
    const pending = host.projectAssignments(twoItems());
    await startedSecond;
    expect(calls).toBe(2);
    host.teardown(scope);
    release();
    const revoked = await pending;
    expect(revoked.decisions[0]?.decision.effect).toBe("allow");
    expect(revoked.decisions[1]?.decision).toEqual({ effect: "deny", code: "stale" });
    const revokedStamp = revoked.stamps[0];
    if (revokedStamp === undefined) {
      throw new Error("Missing first projection stamp.");
    }
    expect(host.matches(revokedStamp, caller)).toBe(false);
    expect(projectAssignedDescriptors(host, revoked, caller, "discover").descriptors).toEqual([]);
    const control = authorizer();
    installDiscovery(control);
    const intact = await control.projectAssignments(twoItems());
    expect(projectAssignedDescriptors(control, intact, caller, "discover").descriptors).toHaveLength(2);
  });

  it("delivers execute for the exact registered tuple while retaining the original caller currentness", async () => {
    const host = authorizer();
    host.installExecutorAssignment(record(true));
    const executed = await host.projectAssignments(request(true));
    expect(executed.decisions[0]?.decision.effect).toBe("allow");
    expect(executed.admitted).toHaveLength(1);
    expect(executed.admitted[0]?.tuple).toEqual(record(true));
    expect(executed.stamps[0]?.authority.actor).toEqual(caller.actor);
    expect(executed.stamps[0]?.authority.executor).toEqual(executor);
    expect(projectAssignedDescriptors(host, executed, caller, "execute").descriptors).toHaveLength(1);
    const executedStamp = executed.stamps[0];
    if (executedStamp === undefined) {
      throw new Error("Missing execution stamp.");
    }
    expect(host.matches(executedStamp, caller)).toBe(true);
    expect(host.matches(executedStamp, { ...caller, authRevision: "changed" })).toBe(false);
    expect(projectAssignedDescriptors(host, executed, caller, "discover").descriptors).toEqual([]);
  });

  for (const changed of ["generation", "registration", "connection", "identity", "missing-executor", "recipient", "contract", "resource", "route", "relabeled-item"] as const) {
    it(`execute refuses a ${changed} mismatch instead of borrowing the registered tuple`, async () => {
      const host = authorizer();
      host.installExecutorAssignment(record(true));
      expect(projectAssignedDescriptors(host, await host.projectAssignments(request(true)), caller, "execute").descriptors).toHaveLength(1);
      const base = request(true);
      let input: ProjectAssignmentsInput;
      switch (changed) {
        case "generation":
          input = { ...base, executor: { ...executor, generation: 9 } };
          break;
        case "registration":
          input = { ...base, executor: { ...executor, registrationRevision: 9 } };
          break;
        case "connection":
          input = { ...base, executor: { ...executor, connectionId: "other" } };
          break;
        case "identity":
          input = { ...base, executor: { ...executor, actor: { ...executor.actor, agentId: "other" } } };
          break;
        case "missing-executor":
          input = { actor: caller, purpose: "execute", recipient: "executor", scope, route, tools: base.tools };
          break;
        case "recipient":
          input = { ...base, recipient: "caller" };
          break;
        case "contract":
          input = { ...base, tools: [{ contractId: secondId, bindingId: "exec-grant", policyRef: ref, operation: "execute" }] };
          break;
        case "resource":
          input = { ...base, scope: { ...scope, instanceId: "other" } };
          break;
        case "route":
          input = { ...base, route: { origin: scope, targets: [] } };
          break;
        case "relabeled-item":
          input = { ...base, purpose: "discover" };
          break;
      }
      const denied = await host.projectAssignments(input);
      expect(projectAssignedDescriptors(host, denied, caller, input.purpose).descriptors).toEqual([]);
      const code = changed === "resource" || changed === "route" || changed === "identity" || changed === "missing-executor"
        ? "missing-authority"
        : "missing-assignment";
      expect(denied.decisions[0]?.decision).toEqual({ effect: "deny", code });
    });
  }

  it("never borrows execute delivery from the ordinary map or discovery delivery from the executor map", async () => {
    const control = authorizer();
    control.installExecutorAssignment(record(true));
    control.installToolAssignment(record());
    expect(projectAssignedDescriptors(control, await control.projectAssignments(request(true)), caller, "execute").descriptors).toHaveLength(1);
    expect(projectAssignedDescriptors(control, await control.projectAssignments(request()), caller, "discover").descriptors).toHaveLength(1);
    const wrongMap = authorizer();
    wrongMap.installToolAssignment(record(true));
    wrongMap.installExecutorAssignment({ ...record(), implementation });
    const wrongExecute = await wrongMap.projectAssignments(request(true));
    const wrongDiscovery = await wrongMap.projectAssignments(request());
    expect(wrongExecute.decisions[0]?.decision).toEqual({ effect: "deny", code: "missing-assignment" });
    expect(wrongDiscovery.decisions[0]?.decision).toEqual({ effect: "deny", code: "missing-assignment" });
    expect(projectAssignedDescriptors(wrongMap, wrongExecute, caller, "execute").descriptors).toEqual([]);
    expect(projectAssignedDescriptors(wrongMap, wrongDiscovery, caller, "discover").descriptors).toEqual([]);
  });

  it("does not deliver an executor assignment without an approved implementation", async () => {
    const host = authorizer();
    const complete = record(true);
    const { implementation: omitted, ...incomplete } = complete;
    expect(omitted).toEqual(implementation);
    expect(() => {
      host.installExecutorAssignment(incomplete);
    }).toThrow("Invalid executor implementation.");
    const result = await host.projectAssignments(request(true));
    expect(result.decisions[0]?.decision).toEqual({ effect: "deny", code: "missing-assignment" });
    expect(projectAssignedDescriptors(host, result, caller, "execute").descriptors).toEqual([]);
  });

  for (const fault of ["missing-fence", "invalid-implementation"] as const) {
    it(`does not deliver an executor tuple with ${fault}`, async () => {
      const host = authorizer();
      const { executor: storedFence, ...withoutFence } = record(true);
      expect(storedFence).toEqual(executor);
      if (fault === "missing-fence") {
        host.installExecutorAssignment(withoutFence);
      } else {
        expect(() => {
          host.installExecutorAssignment({
            ...record(true), implementation: { ...implementation, implementationId: "" },
          });
        }).toThrow("Invalid executor implementation.");
      }
      const denied = await host.projectAssignments(request(true));
      expect(denied.decisions[0]?.decision).toEqual({ effect: "deny", code: "missing-assignment" });
      expect(projectAssignedDescriptors(host, denied, caller, "execute").descriptors).toEqual([]);
    });
  }

  it("rejects a stored noncanonical contract identity and proves permission denial invokes its callback", async () => {
    const executeHost = authorizer();
    executeHost.installExecutorAssignment({ ...record(true), contract: { id: contractId, key: "forged.key", version: 9 } });
    expect(projectAssignedDescriptors(executeHost, await executeHost.projectAssignments(request(true)), caller, "execute").descriptors).toEqual([]);
    let calls = 0;
    const deniedHost = authorizer(() => {
      calls += 1;
      return "deny";
    });
    deniedHost.installToolAssignment(record());
    const denied = await deniedHost.projectAssignments(request());
    expect(calls).toBe(1);
    expect(denied.decisions[0]?.decision).toEqual({ effect: "deny", code: "mandatory-deny" });
    expect(projectAssignedDescriptors(deniedHost, denied, caller, "discover").descriptors).toEqual([]);
  });

  for (const execute of [false, true]) {
    it(`${execute ? "executor" : "tool"} identical assignment stays current at cap; conflicting tuple and one-over reject atomically`, async () => {
      const host = authorizer(() => "allow", { maxToolAssignments: 1, maxExecutors: 1 });
      const installed = record(execute);
      const install = (value: ToolAssignmentRecord): void => {
        if (execute) {
          host.installExecutorAssignment(value);
        } else {
          host.installToolAssignment(value);
        }
      };
      install(installed);
      const before = await host.projectAssignments(request(execute));
      expect(projectAssignedDescriptors(host, before, caller, execute ? "execute" : "discover").descriptors).toHaveLength(1);
      install(installed);
      expect(() => {
        install({ ...installed, recipient: { kind: "user", principal: { domainId: "domain", subject: "bob" } } });
      }).toThrow(/conflict/i);
      if (execute) {
        expect(() => {
          install({ ...installed, implementation: { ...implementation, implementationId: "unapproved" } });
        }).toThrow(/conflict/i);
        expect(() => {
          install({ ...installed, executor: { ...executor, generation: 9 } });
        }).toThrow(/conflict/i);
      }
      expect(() => {
        install({ ...installed, contract: { id: secondId, key: secondContract.key, version: 1 } });
      }).toThrow(/limit/i);
      const beforeStamp = before.stamps[0];
      if (beforeStamp === undefined) {
        throw new Error("Missing assignment stamp.");
      }
      expect(host.matches(beforeStamp, caller)).toBe(true);
      expect(projectAssignedDescriptors(host, before, caller, execute ? "execute" : "discover").descriptors).toHaveLength(1);
    });
  }
});

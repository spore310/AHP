import { describe, expect, it } from "vitest";

import { createReferenceAuthorizer, type ResourceRef, type ScopedPolicyBinding } from "@authorization";
import { createToolPolicyFactory, projectAssignedDescriptors } from "@toolPolicy";
import { TOOL_CONTRACT_META_KEY } from "@tools";

const NOW = 1_700_000_000_000;
const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";

const scope: ResourceRef = {
  domainId: "local",
  kind: "session",
  id: "ahp-session:/assign",
  instanceId: "assign",
};

const contract = {
  id: CONTRACT_ID,
  key: "workspace.read-file",
  version: 1,
  name: "read_file",
  schemaDialect: "draft-07" as const,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

const binding = (id: string, policies: readonly { readonly id: string; readonly revision: number }[]): ScopedPolicyBinding => ({
  id,
  actor: { kind: "user", principal: { domainId: "local", subject: "ada" } },
  scope,
  roles: [],
  policies,
  authority: { kind: "host-policy", policy: policies[0] ?? { id: "none", revision: 1 } },
  revision: 1,
});

const hostFor = (operations: Record<string, unknown>) => {
  const host = createReferenceAuthorizer({
    policies: createToolPolicyFactory({
      policies: [{
        id: "tool.policy",
        revision: 1,
        operations,
        challenge: { required: false },
      }],
    }),
    now: () => NOW,
  });
  host.installResource({
    resource: scope,
    owner: { domainId: "local", subject: "senior" },
    route: { origin: scope, targets: [scope] },
    mandatory: [],
    externalAuthority: "none",
  });
  host.installTool(contract);
  return host;
};

const request = (purpose: "invoke" | "execute" | "advertise" | "publish" | "discover", bindingId: string) => ({
  actor: {
    actor: { kind: "user" as const, principal: { domainId: "local", subject: "ada" } },
    connectionId: "connection-ada",
    authRevision: "auth-1",
  },
  purpose,
  recipient: "caller" as const,
  scope,
  route: { origin: scope, targets: [scope] },
  mandatory: [],
  tools: [{ contractId: CONTRACT_ID, policyRef: { id: "tool.policy", revision: 1 }, bindingId }],
});

describe("tool assignments", () => {
  it("A04 reveal never grants authority", async () => {
    const hidden = hostFor({
      discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: false },
    });
    hidden.installBinding(binding("grant", [{ id: "tool.policy", revision: 1 }]));
    hidden.installTool(contract);
    hidden.installToolAssignment({
      resource: scope, route: { origin: scope, targets: [scope] },
      recipient: { kind: "user", principal: { domainId: "local", subject: "ada" } },
      contract: { id: CONTRACT_ID, key: contract.key, version: 1 },
      operation: "discover", bindingId: "grant", policyRef: { id: "tool.policy", revision: 1 },
    });
    const concealed = await hidden.projectAssignments({ ...request("discover", "grant"), purpose: "discover" });
    expect(concealed.decisions[0]?.decision.effect).toBe("allow");
    expect(projectAssignedDescriptors(hidden, concealed, request("discover", "grant").actor, "discover").descriptors).toEqual([]);

    const revealed = hostFor({
      discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
    });
    const disclosed = await revealed.projectAssignments(request("discover", "missing"));
    expect(disclosed.decisions[0]?.decision).toEqual({ effect: "deny", code: "missing-authority" });
    expect(projectAssignedDescriptors(revealed, disclosed, request("discover", "missing").actor, "discover").descriptors).toEqual([]);
  });

  it("A05 caller and executor purposes are separate", async () => {
    const host = hostFor({
      discover: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
      invoke: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
    });
    host.installBinding(binding("grant", [{ id: "tool.policy", revision: 1 }]));
    host.installTool(contract);
    host.installToolAssignment({
      resource: scope, route: { origin: scope, targets: [scope] },
      recipient: { kind: "user", principal: { domainId: "local", subject: "ada" } },
      contract: { id: CONTRACT_ID, key: contract.key, version: 1 },
      operation: "discover", bindingId: "grant", policyRef: { id: "tool.policy", revision: 1 },
    });
    const publish = await host.projectAssignments(request("publish", "grant"));
    expect(projectAssignedDescriptors(host, publish, request("publish", "grant").actor, "publish").descriptors).toEqual([]);
    const discovered = await host.projectAssignments({ ...request("discover", "grant"), purpose: "discover" });
    const descriptors = projectAssignedDescriptors(host, discovered, request("discover", "grant").actor, "discover").descriptors;
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.name).toBe("read_file");
    expect(descriptors[0]?._meta?.[TOOL_CONTRACT_META_KEY]).toMatchObject({ id: CONTRACT_ID, version: 1 });

    const executorHost = createReferenceAuthorizer({
      policies: createToolPolicyFactory({
        policies: [{
          id: "tool.policy",
          revision: 1,
          operations: {
            invoke: { actor: { mode: "direct-grant", actors: ["user"] }, reveal: true },
            execute: { actor: { mode: "direct-grant", actors: ["agent"] } },
          },
          challenge: { required: false },
        }],
      }),
      now: () => NOW,
    });
    executorHost.installResource({
      resource: scope,
      owner: { domainId: "local", subject: "senior" },
      route: { origin: scope, targets: [scope] },
      mandatory: [],
      externalAuthority: "none",
    });
    executorHost.installTool(contract);
    executorHost.installBinding({
      id: "exec-grant",
      actor: { kind: "agent", principal: { domainId: "local", subject: "ada" }, agentId: "agent-1" },
      scope,
      roles: [],
      policies: [{ id: "tool.policy", revision: 1 }],
      authority: { kind: "host-policy", policy: { id: "tool.policy", revision: 1 } },
      revision: 1,
    });
    const executor = {
      actor: { kind: "agent" as const, principal: { domainId: "local", subject: "ada" }, agentId: "agent-1" },
      connectionId: "executor-connection",
      generation: 2,
      registrationRevision: 4,
    };
    executorHost.installExecutorAssignment({
      resource: scope, route: { origin: scope, targets: [scope] },
      recipient: executor.actor,
      contract: { id: CONTRACT_ID, key: contract.key, version: 1 },
      operation: "execute", bindingId: "exec-grant", policyRef: { id: "tool.policy", revision: 1 },
      executor,
      implementation: {
        location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "impl-1",
      },
    });
    const executed = await executorHost.projectAssignments({
      actor: {
        actor: { kind: "user", principal: { domainId: "local", subject: "ada" } },
        connectionId: "connection-ada",
        authRevision: "auth-1",
      },
      purpose: "execute",
      recipient: "executor",
      executor: {
        actor: { kind: "agent", principal: { domainId: "local", subject: "ada" }, agentId: "agent-1" },
        connectionId: "executor-connection",
        generation: 2,
        registrationRevision: 4,
      },
      scope,
      route: { origin: scope, targets: [scope] },
      mandatory: [],
      tools: [{ contractId: CONTRACT_ID, policyRef: { id: "tool.policy", revision: 1 }, bindingId: "exec-grant" }],
    });
    expect(projectAssignedDescriptors(executorHost, executed, {
      actor: { kind: "user", principal: { domainId: "local", subject: "ada" } },
      connectionId: "connection-ada", authRevision: "auth-1",
    }, "execute").descriptors).toHaveLength(1);
    expect(executed.stamps[0]?.authority.executor?.actor.kind).toBe("agent");
    const substituted = await executorHost.projectAssignments({
      ...request("execute", "exec-grant"),
      recipient: "executor",
      executor: {
        actor: { kind: "user", principal: { domainId: "local", subject: "ada" } },
        connectionId: "connection-ada",
        generation: 2,
        registrationRevision: 4,
      },
    });
    expect(projectAssignedDescriptors(executorHost, substituted, request("execute", "exec-grant").actor, "execute").descriptors).toEqual([]);
  });
});

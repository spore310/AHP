import { createReferenceAuthorizer } from "@authorization";
import type { ExecutorRevision, TrustedRequestContext } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import type { ToolOperation } from "@toolPolicy";
import type { ToolAssignmentRecord } from "@authorization/helpers/evaluate";
import { createClientToolPolicy } from "@toolExecution/helpers/client/helpers/broker";
import type { ClientToolBrokerOptions } from "@toolExecution/helpers/client/helpers/broker";
import { contract } from "./fixtures";

export const clientPolicyFixture = (options: { operations?: readonly ToolOperation[]; challenge?: boolean;
  permission?: () => Promise<"allow" | "deny">; resolve?: ClientToolBrokerOptions["resolve"];
  now?: () => number; decisionTtlMs?: number; } = {}) => {
  const policy = { id: "client-tool", revision: 1 };
  const sessionType = { key: "client-tools", version: 1 };
  const origin = { domainId: "local", kind: "session", id: "ahp-session:/tools", instanceId: "one" };
  const route = { origin, targets: [origin] };
  const caller: TrustedRequestContext = { actor: { kind: "user", principal: { domainId: "local", subject: "caller" } },
    connectionId: "caller-connection", authRevision: "caller-auth" };
  const executorContext: TrustedRequestContext = { actor: { kind: "user", principal: { domainId: "local", subject: "executor" } },
    connectionId: "executor-connection", authRevision: "executor-auth" };
  const executor: ExecutorRevision = { actor: executorContext.actor, connectionId: executorContext.connectionId, generation: 1, registrationRevision: 1 };
  const operationRules = Object.fromEntries((options.operations ?? ["invoke", "advertise", "execute"]).map((operation) => [operation,
    { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, ...(options.permission === undefined ? {} : { requiredPermissions: ["check"] }) }]));
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: operationRules, challenge: { required: options.challenge ?? false } }],
    bindings: [{ sessionType, providerId: "test", admitted: { policies: [policy], namespaces: [] }, mandatory: [] }] });
  const registry = createReferenceAuthorizer({ policies, now: options.now ?? Date.now,
    ...(options.decisionTtlMs === undefined ? {} : { decisionTtlMs: options.decisionTtlMs }),
    ...(options.permission === undefined ? {} : { permissionEvaluators: { check: options.permission } }) });
  registry.installAdmission({ sessionType, providerId: "test" });
  registry.installResource({ resource: origin, route, owner: caller.actor.principal, externalAuthority: "none", admission: { sessionType, providerId: "test" } });
  registry.installTool(contract);
  const implementation = { location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "approved-echo" };
  const tuples: ToolAssignmentRecord[] = [];
  for (const context of [caller, executorContext]) {
    const binding = { id: `grant-${context.connectionId}`, actor: context.actor, scope: origin, roles: [], policies: [policy],
      authority: { kind: "host-policy" as const, policy }, revision: 1 };
    registry.installBinding(binding);
    for (const operation of options.operations ?? ["invoke", "advertise", "execute"]) {
      const tuple: ToolAssignmentRecord = { resource: origin, route, recipient: context.actor,
        contract: { id: contract.id, key: contract.key, version: 1 }, operation, bindingId: binding.id, policyRef: policy,
        ...(operation !== "execute" || context !== executorContext ? {} : { executor, implementation }) };
      if (operation === "execute") {
        if (context !== executorContext) continue;
        registry.installExecutorAssignment(tuple);
      } else registry.installToolAssignment(tuple);
      tuples.push(tuple);
    }
  }
  const brokerOptions: ClientToolBrokerOptions = { registry, policies,
    registrations: [{ definition: contract, implementation, revision: 1, source: { id: "test-source", revision: 1 } }],
    resolve: options.resolve ?? (() => ({ route })) };
  const policyService = createClientToolPolicy(brokerOptions);
  const registration = policyService.registrations[0];
  if (registration === undefined) throw new Error("Missing fixture registration");
  const request = { caller, origin, sessionType, providerId: "test", registration,
    input: { path: "private-canary" }, signal: new AbortController().signal, resolution: { route } };
  return { registry, policies, policy, policyService, brokerOptions, registration, request, caller, executorContext, executor, origin, route, tuples };
};

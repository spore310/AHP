import { vi } from "vitest";
import { ToolAction } from "@toolExecution";
import type { ToolActionContext } from "@toolExecution";
import { createToolActionRegistration } from "@toolExecution/helpers/action";
import type { ToolDispatchFacts, ToolDispatchPorts } from "@toolExecution/helpers/dispatcher";
import type { ToolContractDefinition } from "@tools/types";

export interface Input { readonly path: string }
export interface Output { readonly value: string }

export const contract: ToolContractDefinition = {
  id: "11111111-1111-4111-8111-111111111111", key: "test.read", version: 1,
  name: "read", schemaDialect: "draft-07",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
};

export function facts(callId = "call-1", subject = "caller", target = "file-1"): ToolDispatchFacts {
  const actor = { kind: "user" as const, principal: { domainId: "local", subject } };
  const caller = { actor, connectionId: `connection-${subject}`, authRevision: "auth-1" };
  const executor = { actor: { kind: "user" as const, principal: { domainId: "local", subject: "executor" } },
    connectionId: "executor-connection", generation: 1, registrationRevision: 1 };
  const resources = { origin: { domainId: "local", kind: "session", id: "session-1", instanceId: "origin-1" },
    targets: [{ domainId: "local", kind: "file", id: target, instanceId: `instance-${target}` }] };
  return {
    caller, executor, resources, callId, contract: { id: contract.id, revision: 1 },
    implementation: { location: "server", suppliedBy: "server", implementation: "host", implementationId: "impl-1" },
    authority: { domainId: "local", actor, authRevision: caller.authRevision, connectionId: caller.connectionId,
      executor, route: resources, relationshipRevision: 1, policyRevisions: [{ id: "policy-1", revision: 1 }], grantRevision: 1 },
  };
}

export function ports(callId = "call-1", subject = "caller"): ToolDispatchPorts {
  return {
    resolve: vi.fn(() => facts(callId, subject)),
    coarse: vi.fn(() => true),
    authorize: vi.fn((context: ToolActionContext) => ({ decision: { effect: "allow" as const, reveal: true, challengeRequired: false }, authority: context.authority })),
    current: vi.fn(() => true),
  };
}

export function registration<TPrepared = void>(create: () => ToolAction<Input, Output, TPrepared>, definition = contract) {
  return createToolActionRegistration({ definition, implementation: facts().implementation, create });
}

export class EchoAction extends ToolAction<Input, Output> {
  override execute(input: Input): Output {
    return { value: input.path };
  }
}

import { toAhpToolDefinition } from "@tools/helpers/protocol";
import type { ToolContractDefinition } from "@tools/types";
import { parseToolWire, toolAssignedReplySchema, toolAdvertiseReplySchema, toolInvokeSchema } from "@toolExecution/helpers/client/helpers/protocol";

/** Synthetic DTOs for transport boundary tests only; no host authorization claim. */
export function privateWireFixture(definition: ToolContractDefinition, channel: string) {
  const assigned = parseToolWire(toolAssignedReplySchema, { version: 2, channel,
    resource: { domainId: "local", kind: "session", id: channel, instanceId: "test-incarnation" },
    connection: { id: "test-connection", generation: 1 }, viewRevision: "22222222-2222-4222-8222-222222222222",
    tools: [{ contract: { id: definition.id, key: definition.key, version: definition.version }, descriptor: toAhpToolDefinition(definition),
      purposes: ["discover", "invoke", "advertise", "execute"], conditions: [], execution: {
        binding: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "test-implementation" },
        registrationRevision: 1, source: { id: "test-source", revision: 1 },
      } }],
  });
  const acknowledgement = parseToolWire(toolAdvertiseReplySchema, { ...assigned, advertisementId: "33333333-3333-4333-8333-333333333333" });
  const invoke = (callId: string = globalThis.crypto.randomUUID(), input: unknown = {}) => parseToolWire(toolInvokeSchema, {
    version: 2, callId, channel, contract: assigned.tools[0]?.contract, execution: assigned.tools[0]?.execution,
    route: { origin: assigned.resource, targets: [assigned.resource] }, connection: assigned.connection,
    advertisementId: acknowledgement.advertisementId, input,
  });
  return { assigned, acknowledgement, invoke };
}

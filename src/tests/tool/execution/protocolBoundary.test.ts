import { expect, it, vi } from "vitest";
import { parseToolWire, toolCapabilitiesReplySchema, toolInvokeSchema } from "@tool/protocol";
import { toolExecutionBindingSchema } from "@tool/policy/binding";

vi.mock("ajv", () => {
  throw new Error("Trusted schema compiler evaluated");
});
vi.mock("node:crypto", () => {
  throw new Error("Node crypto evaluated");
});
vi.mock("@sessions", () => {
  throw new Error("Session factory evaluated");
});
vi.mock("@tool", () => {
  throw new Error("Trusted catalogue evaluated");
});
vi.mock("@tool/policy", () => {
  throw new Error("Tool policy services evaluated");
});
vi.mock("@tool/execution", () => {
  throw new Error("Tool execution services evaluated");
});
vi.mock("@tool/server", () => {
  throw new Error("Server tool broker evaluated");
});
vi.mock("@tool/helpers/execution/helpers/remote", () => {
  throw new Error("Remote dispatch evaluated");
});
vi.mock("@tool/helpers/validation", () => {
  throw new Error("Trusted tool validation evaluated");
});
vi.mock("@authorization", () => {
  throw new Error("Authorization service evaluated");
});
vi.mock("@work", () => {
  throw new Error("Work service evaluated");
});
vi.mock("@websocket", () => {
  throw new Error("Server evaluated");
});
vi.mock("@application", () => {
  throw new Error("Application evaluated");
});
vi.mock("@persistence", () => {
  throw new Error("Persistence evaluated");
});
vi.mock("ws", () => {
  throw new Error("Node socket evaluated");
});
vi.mock("pg", () => {
  throw new Error("Database evaluated");
});

it("private client DTO imports do not evaluate server, schema compiler or Node capabilities", () => {
  const reply = parseToolWire(toolCapabilitiesReplySchema, { version: 1, assignments: true, dispatch: true, continuation: false });
  expect(reply.version).toBe(1);
  expect(Object.isFrozen(reply)).toBe(true);
  const id = "12345678-1234-4234-8234-123456789012";
  const origin = { kind: "session", id: "ahp-session:/portable", domainId: "domain", instanceId: id };
  const binding = toolExecutionBindingSchema.parse({ location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "local" });
  const invocation = parseToolWire(toolInvokeSchema, { version: 1, callId: id, channel: origin.id, contract: { id, key: "probe", version: 2 },
    route: { origin, targets: [origin] }, execution: { binding, registrationRevision: 1, source: { id: "catalogue", revision: 1 } },
    connection: { id: "portable", generation: 1 }, advertisementId: id, input: {} });
  expect(invocation.execution.binding).toEqual(binding);
  expect(invocation.contract.version).toBe(2);
});

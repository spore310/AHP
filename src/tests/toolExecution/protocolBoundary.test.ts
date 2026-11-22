import { expect, it, vi } from "vitest";
import { parseToolWire, toolCapabilitiesReplySchema } from "@toolExecution/helpers/client/helpers/protocol";

vi.mock("ajv", () => {
  throw new Error("Trusted schema compiler evaluated");
});
vi.mock("node:crypto", () => {
  throw new Error("Node crypto evaluated");
});
vi.mock("@sessions", () => {
  throw new Error("Session factory evaluated");
});
vi.mock("@tools", () => {
  throw new Error("Trusted catalogue evaluated");
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
  const reply = parseToolWire(toolCapabilitiesReplySchema, { version: 2, assignments: true, dispatch: true, continuation: false });
  expect(reply.version).toBe(2);
  expect(Object.isFrozen(reply)).toBe(true);
});

import { expect, it, vi } from "vitest";

vi.mock("node:util", () => {
  throw new Error("Neutral tool policy entrypoint eagerly imported a Node runtime module");
});

it("imports the neutral tool policy entrypoint without Node runtime helpers", async () => {
  const policy = await import("@authorization/policies");
  expect(policy.createPolicyFactory).toBeTypeOf("function");
});

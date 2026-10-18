import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/index";

describe("Agent Hosting Protocol", () => {
  it("exposes the product name", () => {
    expect(APP_NAME).toBe("Agent Hosting Protocol");
  });
});

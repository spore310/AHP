import { describe, expect, it } from "vitest";

import { loadEnv } from "@env";

describe("environment configuration", () => {
  it("applies defaults when variables are absent", () => {
    const config = loadEnv({});

    expect(config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST).toBe("127.0.0.1");
    expect(config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT).toBe(12345);
  });

  it("reads explicit values", () => {
    const config = loadEnv({
      AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST: "0.0.0.0",
      AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT: "8080",
    });

    expect(config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST).toBe("0.0.0.0");
    expect(config.AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT).toBe(8080);
  });

  it("accepts an optional provider name without embedding a database enum", () => {
    expect(loadEnv({ AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER: "custom-provider" })
      .AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER).toBe("custom-provider");
    expect(loadEnv({}).AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER).toBeUndefined();
  });

  it("rejects a port above the valid range without echoing the value", () => {
    let message = "";
    try {
      loadEnv({ AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT: "70000" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT");
    expect(message).not.toContain("70000");
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadEnv({ AGENT_HOSTING_PROTOCOL_WEBSOCKET_PORT: "not-a-port" })).toThrow();
  });

  it("rejects an empty host", () => {
    expect(() => loadEnv({ AGENT_HOSTING_PROTOCOL_WEBSOCKET_HOST: "" })).toThrow();
  });
});

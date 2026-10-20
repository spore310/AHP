import { describe, expect, it } from "vitest";

import { loadEnv, parseAllowedKinds, parseAuthTokens } from "@env";
import { createAgentWorkOptions } from "../../index";

describe("compound environment values", () => {
  it("parses a token map and trims subjects", () => {
    expect([...parseAuthTokens("{\"token-a\":\" alice \",\"token-b\":\"bob\"}")])
      .toEqual([["token-a", "alice"], ["token-b", "bob"]]);
  });

  it("treats an absent token map as empty", () => {
    expect(parseAuthTokens(undefined).size).toBe(0);
  });

  it("rejects malformed, empty, or non-string token maps without echoing values", () => {
    for (const value of [
      "not-json",
      "[]",
      "null",
      "{}",
      "{\"\":\"alice\"}",
      "{\"token\":\"\"}",
      "{\"token\":42}",
    ]) {
      let message = "";
      try {
        parseAuthTokens(value);
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).toContain("AGENT_HOSTING_PROTOCOL_AUTH_TOKENS");
      expect(message).not.toContain("not-json");
      expect(message).not.toContain("alice");
    }
  });

  it("parses, trims and deduplicates allowed work kinds", () => {
    expect([...parseAllowedKinds(" code.patch, code.review ")])
      .toEqual(["code.patch", "code.review"]);
    expect(() => parseAllowedKinds(" , ")).toThrow();
    expect(() => parseAllowedKinds("code.patch,code.patch")).toThrow();
  });
});

describe("agent/work composition", () => {
  it("is disabled when neither database nor tokens are configured", () => {
    expect(createAgentWorkOptions(loadEnv({}))).toBeUndefined();
  });

  it("fails closed on a partial configuration", () => {
    expect(() => createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_DATABASE_URL: "postgresql://example.invalid/ahp",
    }))).toThrow(/AGENT_HOSTING_PROTOCOL_DATABASE_URL/);

    expect(() => createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: "{\"token\":\"alice\"}",
    }))).toThrow(/AGENT_HOSTING_PROTOCOL_AUTH_TOKENS/);
  });

  it("wires the optional extension and releases its pool", async () => {
    const options = createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_DATABASE_URL: "postgresql://ahp:ahp@127.0.0.1:1/ahp",
      AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: "{\"token\":\"alice\"}",
      AGENT_HOSTING_PROTOCOL_PRESENCE_TTL_SECONDS: "30",
      AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS: "code.patch",
    }));

    expect(options).toBeDefined();
    expect(options?.presenceTtlMs).toBe(30_000);
    expect([...(options?.allowedKinds ?? [])]).toEqual(["code.patch"]);
    await options?.dispose?.();
  });
});

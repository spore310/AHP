import { describe, expect, it, vi } from "vitest";

import { loadEnv, parseAllowedKinds, parseAuthTokens } from "@env";
import { createAgentWorkOptions } from "../../index";

// The stub provider is intentionally synchronous while honoring Promise ports.
/* eslint-disable @typescript-eslint/require-await */
const { selectProvider, providerDispose, provider } = vi.hoisted(() => {
  const providerDispose = vi.fn(async () => undefined);
  const provider = {
    registrations: { register: async () => { throw new Error("unused"); }, getById: async () => undefined },
    sessions: { ensure: async () => { throw new Error("unused"); }, get: async () => undefined, delete: async () => false },
    work: {
      submit: async () => { throw new Error("unused"); }, claim: async () => null, renew: async () => null,
      complete: async () => false, fail: async () => null, cancel: async () => null, get: async () => null,
      reconcileExpired: async () => 0, hasDependentWork: async () => false,
    },
    dispose: providerDispose,
  };
  return { selectProvider: vi.fn(async () => provider), providerDispose, provider };
});

vi.mock("@persistence/helpers/adapters", () => ({
  createConfiguredPersistenceProvider: selectProvider,
}));

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
  it("is disabled when neither database nor tokens are configured", async () => {
    await expect(createAgentWorkOptions(loadEnv({}))).resolves.toBeUndefined();
    expect(selectProvider).not.toHaveBeenCalled();
  });

  it("rejects a selector without durable feature configuration", async () => {
    await expect(createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER: "postgres",
    }))).rejects.toThrow(/PERSISTENCE_PROVIDER/);
    expect(selectProvider).not.toHaveBeenCalled();
  });

  it("fails closed on a partial configuration", async () => {
    await expect(createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_DATABASE_URL: "postgresql://example.invalid/ahp",
    }))).rejects.toThrow(/AGENT_HOSTING_PROTOCOL_DATABASE_URL/);

    await expect(createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: "{\"token\":\"alice\"}",
    }))).rejects.toThrow(/AGENT_HOSTING_PROTOCOL_AUTH_TOKENS/);
    expect(selectProvider).not.toHaveBeenCalled();
  });

  it("wires the optional extension through the selected provider and disposes it", async () => {
    selectProvider.mockClear();
    providerDispose.mockClear();
    const options = await createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_DATABASE_URL: "postgresql://ahp:ahp@127.0.0.1:1/ahp",
      AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: "{\"token\":\"alice\"}",
      AGENT_HOSTING_PROTOCOL_PRESENCE_TTL_SECONDS: "30",
      AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS: "code.patch",
    }));

    expect(options).toBeDefined();
    expect(options?.presenceTtlMs).toBe(30_000);
    expect([...(options?.allowedKinds ?? [])]).toEqual(["code.patch"]);
    expect(selectProvider).toHaveBeenCalledWith({
      provider: undefined,
      options: {
        url: "postgresql://ahp:ahp@127.0.0.1:1/ahp",
        workLeaseSeconds: 60,
      },
    });
    await options?.dispose?.();
    expect(providerDispose).toHaveBeenCalledOnce();
  });

  it("passes an explicit provider selector to the allowlisted loader", async () => {
    selectProvider.mockClear();
    const options = await createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_DATABASE_URL: "postgresql://example/ahp",
      AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: "{\"token\":\"alice\"}",
      AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER: "postgres",
    }));
    expect(selectProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: "postgres" }));
    await options?.dispose?.();
  });

  it("disposes an acquired provider when facade composition fails", async () => {
    providerDispose.mockClear();
    selectProvider.mockResolvedValueOnce({
      ...provider,
      get registrations(): typeof provider.registrations {
        throw new Error("composition failed");
      },
    });
    await expect(createAgentWorkOptions(loadEnv({
      AGENT_HOSTING_PROTOCOL_DATABASE_URL: "postgresql://example/ahp",
      AGENT_HOSTING_PROTOCOL_AUTH_TOKENS: "{\"token\":\"alice\"}",
    }))).rejects.toThrow("composition failed");
    expect(providerDispose).toHaveBeenCalledOnce();
  });
});

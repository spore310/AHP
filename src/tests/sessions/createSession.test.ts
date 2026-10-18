import type {
  ActionEnvelope,
  AgentInfo,
  ErrorInfo,
} from "@microsoft/agent-host-protocol";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createSessionsFactory,
  SESSION_URI_PREFIX,
  SessionConfigError,
  type CatalogueNotification,
  type SessionBackend,
  type SessionConfigContract,
  type SessionProvider,
  type SessionsFactory,
} from "@sessions";
import { createMockProvider } from "@sessions/mock";

const TEST_NOW = (): Date => new Date("2026-01-02T03:04:05.000Z");

const TEST_AGENT: AgentInfo = {
  provider: "test",
  displayName: "Test Agent",
  description: "Agent used by the session tests.",
  models: [],
};

const sessionUri = (id: string): string => `${SESSION_URI_PREFIX}${id}`;

/** Records everything the factory broadcasts, in emission order. */
function recordFactoryEvents(factory: SessionsFactory): {
  catalogue: CatalogueNotification[];
  envelopes: ActionEnvelope[];
} {
  const catalogue: CatalogueNotification[] = [];
  const envelopes: ActionEnvelope[] = [];
  factory.onCatalogueNotification((notification) => catalogue.push(notification));
  factory.onSessionEnvelope((envelope) => envelopes.push(envelope));

  return { catalogue, envelopes };
}

/**
 * A provider whose `startSession` stays pending until `complete()` is called,
 * so a session can be observed (and re-created) while still `creating`.
 */
function deferredProvider(): { provider: SessionProvider; complete: () => void } {
  let resolveStart: (() => void) | undefined;

  const provider: SessionProvider = {
    providerId: "deferred",
    agentInfo: { ...TEST_AGENT, provider: "deferred" },
    startSession: (): Promise<SessionBackend> =>
      new Promise<SessionBackend>((resolve) => {
        resolveStart = (): void => {
          resolve({ dispose: (): void => undefined });
        };
      }),
  };

  return {
    provider,
    complete: (): void => {
      resolveStart?.();
    },
  };
}

/**
 * A provider with a session configuration contract: `model` is required, `mode`
 * is an optional enum with a default, and unknown keys are rejected. Records the
 * normalized config every backend receives.
 */
function configurableProvider(): {
  provider: SessionProvider;
  received: Record<string, unknown>[];
} {
  const received: Record<string, unknown>[] = [];
  const config: SessionConfigContract = {
    schema: {
      type: "object",
      properties: {
        model: { type: "string", title: "Model" },
        mode: { type: "string", title: "Mode", enum: ["fast", "slow"] },
      },
      required: ["model"],
    },
    parse: (value) => {
      const result = z
        .object({ model: z.string(), mode: z.enum(["fast", "slow"]).default("fast") })
        .strict()
        .safeParse(value);
      if (!result.success) {
        throw new SessionConfigError("Invalid session configuration for provider configurable.");
      }
      return result.data;
    },
  };

  const provider: SessionProvider = {
    providerId: "configurable",
    agentInfo: { ...TEST_AGENT, provider: "configurable" },
    config,
    startSession: (input): Promise<SessionBackend> => {
      received.push(input.config);
      return Promise.resolve({ dispose: (): void => undefined });
    },
  };

  return { provider, received };
}

describe("createSession: lifecycle", () => {
  it("creates a ready session and emits the creation sequence", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const { catalogue, envelopes } = recordFactoryEvents(factory);
    const uri = sessionUri("lifecycle");

    await factory.createSession({ channel: uri, provider: "mock" });

    const snapshot = factory.getSessionSnapshot(uri);
    expect(snapshot?.resource).toBe(uri);
    expect(snapshot?.fromSeq).toBe(1);
    expect(snapshot?.state.lifecycle).toBe("ready");
    expect(snapshot?.state.provider).toBe("mock");
    expect(snapshot?.state.title).toBe("New Session");
    expect(snapshot?.state.status).toBe(1);

    expect(envelopes).toEqual([
      { channel: uri, action: { type: "session/ready" }, serverSeq: 1, origin: undefined },
    ]);

    const timestamp = TEST_NOW().toISOString();
    expect(catalogue).toEqual([
      {
        method: "root/sessionAdded",
        params: {
          channel: "ahp-root://",
          summary: {
            resource: uri,
            provider: "mock",
            title: "New Session",
            status: 1,
            createdAt: timestamp,
            modifiedAt: timestamp,
          },
        },
      },
      {
        method: "root/sessionSummaryChanged",
        params: { channel: "ahp-root://", session: uri, changes: { modifiedAt: timestamp } },
      },
    ]);
  });

  it("reports creation failure as a failed session with the carried error info", async () => {
    const info: ErrorInfo = { errorType: "initFailed", message: "Could not start." };
    const factory = createSessionsFactory({
      providers: [createMockProvider({ failCreation: info })],
      now: TEST_NOW,
    });
    const { catalogue, envelopes } = recordFactoryEvents(factory);
    const uri = sessionUri("failure");

    await factory.createSession({ channel: uri, provider: "mock" });

    const snapshot = factory.getSessionSnapshot(uri);
    expect(snapshot?.state.lifecycle).toBe("failed");
    expect(snapshot?.state.creationError).toEqual(info);
    expect(envelopes).toEqual([
      {
        channel: uri,
        action: { type: "session/creationFailed", error: info },
        serverSeq: 1,
        origin: undefined,
      },
    ]);
    expect(catalogue.map((notification) => notification.method)).toEqual([
      "root/sessionAdded",
      "root/sessionSummaryChanged",
    ]);
  });

  it("maps an unexpected provider rejection to a generic failure", async () => {
    const provider: SessionProvider = {
      providerId: "boom",
      agentInfo: { ...TEST_AGENT, provider: "boom" },
      startSession: (): Promise<SessionBackend> => Promise.reject(new Error("kaboom")),
    };
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const { envelopes } = recordFactoryEvents(factory);
    const uri = sessionUri("boom");

    await factory.createSession({ channel: uri });

    expect(envelopes[0]?.action).toEqual({
      type: "session/creationFailed",
      error: { errorType: "sessionStartFailed", message: "Session backend failed to start." },
    });
    expect(JSON.stringify(envelopes)).not.toContain("kaboom");
    expect(factory.getSessionSnapshot(uri)?.state.creationError).toEqual({
      errorType: "sessionStartFailed",
      message: "Session backend failed to start.",
    });
  });
});

describe("createSession: provider resolution", () => {
  it("uses the default provider when none is requested", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("default-provider");

    await factory.createSession({ channel: uri });

    expect(factory.getSessionSnapshot(uri)?.state.provider).toBe("mock");
  });

  it("rejects an unknown provider with ProviderNotFound", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });

    await expect(
      factory.createSession({ channel: sessionUri("unknown-provider"), provider: "nope" }),
    ).rejects.toMatchObject({
      code: AhpErrorCodes.ProviderNotFound,
      message: "No agent for provider: nope",
    });
  });

  it("honours an explicit defaultProviderId", async () => {
    const other = createMockProvider();
    const factory = createSessionsFactory({
      providers: [other],
      defaultProviderId: other.providerId,
      now: TEST_NOW,
    });
    const uri = sessionUri("explicit-default");

    await factory.createSession({ channel: uri });

    expect(factory.getSessionSnapshot(uri)?.state.provider).toBe("mock");
  });
});

describe("createSession: uniqueness", () => {
  it("rejects a duplicate session URI with SessionAlreadyExists", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("duplicate");
    await factory.createSession({ channel: uri });

    await expect(factory.createSession({ channel: uri })).rejects.toMatchObject({
      code: AhpErrorCodes.SessionAlreadyExists,
      message: `Session already exists: ${uri}`,
    });
  });

  it("rejects a duplicate URI while the first session is still creating", async () => {
    const { provider, complete } = deferredProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const uri = sessionUri("creating");

    const first = factory.createSession({ channel: uri });
    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("creating");

    await expect(factory.createSession({ channel: uri })).rejects.toMatchObject({
      code: AhpErrorCodes.SessionAlreadyExists,
    });

    complete();
    await first;
    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
  });
});

describe("createSession: parameter validation", () => {
  it("rejects params that are not an object", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });

    await expect(factory.createSession(undefined)).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
    });
  });

  it("rejects a channel that is not a session URI", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });

    await expect(factory.createSession({ channel: "ahp-root://" })).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
    });
    await expect(factory.createSession({ channel: SESSION_URI_PREFIX })).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
    });
  });

  it("discards an unknown additive member and still creates the session", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("unknown-member");

    await factory.createSession({ channel: uri, surprise: true });

    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
  });

  it("accepts activeClient, progressToken and _meta for protocol completeness", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("optional-params");

    await factory.createSession({
      channel: uri,
      provider: "mock",
      activeClient: { clientId: "client-1", tools: [] },
      progressToken: "token-1",
      _meta: { trace: "abc" },
    });

    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
  });
});

describe("createSession: session configuration", () => {
  it("rejects non-empty config when the provider exposes no config contract", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });

    await expect(
      factory.createSession({ channel: sessionUri("config-rejected"), config: { model: "x" } }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });
  });

  it("accepts an empty config when the provider exposes no config contract", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("config-empty");

    await factory.createSession({ channel: uri, config: {} });

    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
  });

  it("passes normalized configuration to the provider", async () => {
    const { provider, received } = configurableProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const uri = sessionUri("config-normalized");

    await factory.createSession({ channel: uri, config: { model: "gpt", mode: "slow" } });

    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
    expect(received).toEqual([{ model: "gpt", mode: "slow" }]);
  });

  it("applies contract defaults before the provider starts", async () => {
    const { provider, received } = configurableProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });

    await factory.createSession({ channel: sessionUri("config-defaults"), config: { model: "gpt" } });

    expect(received).toEqual([{ model: "gpt", mode: "fast" }]);
  });

  it("rejects a wrongly typed value without starting the provider", async () => {
    const { provider, received } = configurableProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const uri = sessionUri("config-type");

    await expect(
      factory.createSession({ channel: uri, config: { model: 5 } }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });

    expect(factory.getSessionSnapshot(uri)).toBeUndefined();
    expect(received).toEqual([]);
  });

  it("rejects an unsupported enum value", async () => {
    const { provider } = configurableProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });

    await expect(
      factory.createSession({
        channel: sessionUri("config-enum"),
        config: { model: "gpt", mode: "turbo" },
      }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });
  });

  it("rejects a missing required value even for an empty config", async () => {
    const { provider, received } = configurableProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });

    await expect(
      factory.createSession({ channel: sessionUri("config-required"), config: {} }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });
    expect(received).toEqual([]);
  });

  it("rejects extra keys the contract prohibits", async () => {
    const { provider } = configurableProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });

    await expect(
      factory.createSession({
        channel: sessionUri("config-extra"),
        config: { model: "gpt", surprise: true },
      }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });
  });
});

describe("createSession: working directories", () => {
  it("keeps only the first working directory", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("working-directories");

    await factory.createSession({
      channel: uri,
      workingDirectories: ["file:///first", "file:///second"],
    });

    expect(factory.getSessionSnapshot(uri)?.state.workingDirectories).toEqual(["file:///first"]);
  });

  it("omits workingDirectories when none are supplied", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("no-working-directories");

    await factory.createSession({ channel: uri });

    expect(factory.getSessionSnapshot(uri)?.state.workingDirectories).toBeUndefined();
  });
});

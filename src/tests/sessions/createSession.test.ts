import type {
  ActionEnvelope,
  AgentInfo,
  ErrorInfo,
  SessionConfigSchema,
} from "@microsoft/agent-host-protocol";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import {
  createSessionsFactory,
  SESSION_URI_PREFIX,
  type CatalogueNotification,
  type SessionBackend,
  type SessionProvider,
  type SessionsFactory,
} from "@/sessions";
import { createMockProvider } from "@/sessions/mock";

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

  it("maps an unexpected provider rejection to a creation failure", async () => {
    const provider: SessionProvider = {
      providerId: "boom",
      agentInfo: { ...TEST_AGENT, provider: "boom" },
      startSession: (): Promise<SessionBackend> => Promise.reject(new Error("kaboom")),
    };
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const { envelopes } = recordFactoryEvents(factory);

    await factory.createSession({ channel: sessionUri("boom") });

    expect(envelopes[0]?.action).toEqual({
      type: "session/creationFailed",
      error: { errorType: "Error", message: "kaboom" },
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

  it("rejects unknown members", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });

    await expect(
      factory.createSession({ channel: sessionUri("unknown-member"), surprise: true }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });
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
  it("rejects non-empty config when the provider exposes no schema", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });

    await expect(
      factory.createSession({ channel: sessionUri("config-rejected"), config: { model: "x" } }),
    ).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });
  });

  it("accepts an empty config even when the provider exposes no schema", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()], now: TEST_NOW });
    const uri = sessionUri("config-empty");

    await factory.createSession({ channel: uri, config: {} });

    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
  });

  it("accepts config when the provider exposes a schema", async () => {
    const configSchema: SessionConfigSchema = { type: "object", properties: {} };
    const provider: SessionProvider = {
      providerId: "configurable",
      agentInfo: { ...TEST_AGENT, provider: "configurable" },
      configSchema,
      startSession: (): Promise<SessionBackend> =>
        Promise.resolve({ dispose: (): void => undefined }),
    };
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const uri = sessionUri("config-accepted");

    await factory.createSession({ channel: uri, config: { model: "x" } });

    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
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

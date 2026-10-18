import type { AgentInfo } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import {
  createSessionsFactory,
  SESSION_URI_PREFIX,
  type SessionBackend,
  type SessionProvider,
} from "@/sessions";
import { createMockProvider, mockProvider } from "@/sessions/mock";

const TEST_NOW = (): Date => new Date("2026-01-02T03:04:05.000Z");

const TEST_AGENT: AgentInfo = {
  provider: "test",
  displayName: "Test Agent",
  description: "Agent used by the session tests.",
  models: [],
};

const sessionUri = (id: string): string => `${SESSION_URI_PREFIX}${id}`;

/** A provider that records the sessions it is asked to dispose. */
function trackingProvider(): { provider: SessionProvider; disposed: string[] } {
  const disposed: string[] = [];

  const provider: SessionProvider = {
    providerId: "tracker",
    agentInfo: { ...TEST_AGENT, provider: "tracker" },
    startSession: (input): Promise<SessionBackend> =>
      Promise.resolve({
        dispose: (): void => {
          disposed.push(input.sessionUri);
        },
      }),
  };

  return { provider, disposed };
}

describe("sessions factory: construction", () => {
  it("requires at least one provider", () => {
    expect(() => createSessionsFactory({ providers: [] })).toThrow(
      /at least one session provider/,
    );
  });

  it("rejects duplicate provider ids", () => {
    expect(() =>
      createSessionsFactory({ providers: [mockProvider, createMockProvider()] }),
    ).toThrow(/Duplicate session provider id: mock/);
  });

  it("rejects a provider with an empty id", () => {
    const emptyId: SessionProvider = {
      providerId: "",
      agentInfo: { ...TEST_AGENT, provider: "" },
      startSession: (): Promise<SessionBackend> =>
        Promise.resolve({ dispose: (): void => undefined }),
    };

    expect(() => createSessionsFactory({ providers: [emptyId] })).toThrow(
      /non-empty providerId/,
    );
  });

  it("rejects a default provider id that is not registered", () => {
    expect(() =>
      createSessionsFactory({ providers: [mockProvider], defaultProviderId: "missing" }),
    ).toThrow(/Default provider is not registered: missing/);
  });
});

describe("sessions factory: queries", () => {
  it("lists the agents of every registered provider", () => {
    const factory = createSessionsFactory({ providers: [mockProvider] });

    expect(factory.listAgents().map((agent) => agent.provider)).toEqual(["mock"]);
    expect(factory.listAgents()[0]?.displayName).toBe("Mock Agent");
  });

  it("returns undefined for an unknown session snapshot", () => {
    const factory = createSessionsFactory({ providers: [mockProvider] });

    expect(factory.getSessionSnapshot(sessionUri("missing"))).toBeUndefined();
  });
});

describe("sessions factory: listeners", () => {
  it("stops notifying after unsubscribe", async () => {
    const factory = createSessionsFactory({ providers: [mockProvider], now: TEST_NOW });
    let received = 0;
    const unsubscribe = factory.onSessionEnvelope(() => {
      received += 1;
    });

    unsubscribe();
    await factory.createSession({ channel: sessionUri("unsubscribed") });

    expect(received).toBe(0);
  });

  it("drops listeners and sessions on dispose", async () => {
    const { provider, disposed } = trackingProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    let received = 0;
    factory.onSessionEnvelope(() => {
      received += 1;
    });

    const firstUri = sessionUri("dispose-first");
    const secondUri = sessionUri("dispose-second");
    await factory.createSession({ channel: firstUri });
    await factory.createSession({ channel: secondUri });

    await factory.dispose();

    expect([...disposed].sort()).toEqual([firstUri, secondUri].sort());
    expect(factory.getSessionSnapshot(firstUri)).toBeUndefined();
    expect(factory.getSessionSnapshot(secondUri)).toBeUndefined();

    // Listeners registered before dispose are gone, so a later session emits nothing.
    const receivedBeforeLateSession = received;
    await factory.createSession({ channel: sessionUri("after-dispose") });
    expect(received).toBe(receivedBeforeLateSession);
  });
});

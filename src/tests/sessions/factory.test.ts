import type { ActionEnvelope, AgentInfo, ErrorInfo } from "@microsoft/agent-host-protocol";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import {
  createSessionsFactory,
  SESSION_URI_PREFIX,
  SessionsDisposingError,
  type SessionBackend,
  type SessionProvider,
  type SessionsDiagnostic,
} from "@sessions";
import { createMockProvider, mockProvider } from "@sessions/mock";

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

/** A provider that records which sessions it was asked to start. */
function countingProvider(): { provider: SessionProvider; starts: string[] } {
  const starts: string[] = [];

  const provider: SessionProvider = {
    providerId: "counter",
    agentInfo: { ...TEST_AGENT, provider: "counter" },
    startSession: (input): Promise<SessionBackend> => {
      starts.push(input.sessionUri);
      return Promise.resolve({ dispose: (): void => undefined });
    },
  };

  return { provider, starts };
}

/** A provider whose `startSession` stays pending until `complete()` is called. */
function deferredTrackingProvider(): {
  provider: SessionProvider;
  complete: () => void;
  disposed: string[];
} {
  const disposed: string[] = [];
  let resolveStart: (() => void) | undefined;

  const provider: SessionProvider = {
    providerId: "deferred-tracker",
    agentInfo: { ...TEST_AGENT, provider: "deferred-tracker" },
    startSession: (input): Promise<SessionBackend> =>
      new Promise<SessionBackend>((resolve) => {
        resolveStart = (): void => {
          resolve({
            dispose: (): void => {
              disposed.push(input.sessionUri);
            },
          });
        };
      }),
  };

  return {
    provider,
    disposed,
    complete: (): void => {
      resolveStart?.();
    },
  };
}

/** A provider whose disposal of a `*-fail` session rejects. */
function partiallyFailingProvider(): { provider: SessionProvider; disposed: string[] } {
  const disposed: string[] = [];

  const provider: SessionProvider = {
    providerId: "partial",
    agentInfo: { ...TEST_AGENT, provider: "partial" },
    startSession: (input): Promise<SessionBackend> =>
      Promise.resolve({
        dispose: (): Promise<void> | void => {
          disposed.push(input.sessionUri);
          if (input.sessionUri.endsWith("fail")) {
            return Promise.reject(new Error("dispose failed"));
          }
          return undefined;
        },
      }),
  };

  return { provider, disposed };
}

/** A provider whose disposal waits until the returned gate is released. */
function gatedDisposeProvider(): {
  provider: SessionProvider;
  disposed: string[];
  gate: { release: () => void };
} {
  const disposed: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const provider: SessionProvider = {
    providerId: "gated",
    agentInfo: { ...TEST_AGENT, provider: "gated" },
    startSession: (input): Promise<SessionBackend> =>
      Promise.resolve({
        dispose: async (): Promise<void> => {
          await gate;
          disposed.push(input.sessionUri);
        },
      }),
  };

  return { provider, disposed, gate: { release } };
}

/**
 * A provider whose starts settle in call order via `completeNext()`, recording
 * every dispose attempt and optionally rejecting some.
 */
function queuedDeferredProvider(
  options: { failDisposeWhen?: (sessionUri: string) => boolean } = {},
): {
  provider: SessionProvider;
  completeNext: () => void;
  disposeAttempts: string[];
} {
  const disposeAttempts: string[] = [];
  const pending: (() => void)[] = [];

  const provider: SessionProvider = {
    providerId: "queued-deferred",
    agentInfo: { ...TEST_AGENT, provider: "queued-deferred" },
    startSession: (input): Promise<SessionBackend> =>
      new Promise<SessionBackend>((resolve) => {
        pending.push(() => {
          resolve({
            dispose: (): Promise<void> | void => {
              disposeAttempts.push(input.sessionUri);
              if (options.failDisposeWhen?.(input.sessionUri) === true) {
                return Promise.reject(new Error("sensitive provider detail"));
              }
              return undefined;
            },
          });
        });
      }),
  };

  return {
    provider,
    disposeAttempts,
    completeNext: (): void => {
      pending.shift()?.();
    },
  };
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

describe("sessions factory: snapshot ownership", () => {
  it("does not let a returned snapshot mutate authoritative state", async () => {
    const factory = createSessionsFactory({ providers: [mockProvider], now: TEST_NOW });
    const uri = sessionUri("snapshot-ownership");
    await factory.createSession({ channel: uri, workingDirectories: ["file:///first"] });

    const first = factory.getSessionSnapshot(uri);
    if (first === undefined) {
      throw new Error("expected a snapshot");
    }
    first.state.title = "Tampered";
    first.state.workingDirectories?.push("file:///second");

    const second = factory.getSessionSnapshot(uri);
    expect(second?.state.title).toBe("New Session");
    expect(second?.state.workingDirectories).toEqual(["file:///first"]);
  });

  it("does not let a copied creation error mutate authoritative state", async () => {
    const info: ErrorInfo = { errorType: "initFailed", message: "Could not start." };
    const factory = createSessionsFactory({
      providers: [createMockProvider({ failCreation: info })],
      now: TEST_NOW,
    });
    const uri = sessionUri("snapshot-error");
    await factory.createSession({ channel: uri });

    const first = factory.getSessionSnapshot(uri);
    if (first?.state.creationError === undefined) {
      throw new Error("expected a creation error");
    }
    first.state.creationError.message = "Tampered";

    expect(factory.getSessionSnapshot(uri)?.state.creationError).toEqual(info);
  });

  it("returns agent descriptors that callers cannot mutate", () => {
    const factory = createSessionsFactory({ providers: [mockProvider] });
    const agents = factory.listAgents();
    const firstAgent = agents[0];
    if (firstAgent === undefined) {
      throw new Error("expected an agent");
    }
    firstAgent.displayName = "Tampered";

    expect(factory.listAgents()[0]?.displayName).toBe("Mock Agent");
  });
});

describe("sessions factory: observer isolation", () => {
  it("isolates throwing observers and still delivers to healthy observers", async () => {
    const { provider, starts } = countingProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const envelopes: ActionEnvelope[] = [];
    factory.onCatalogueNotification((notification) => {
      if (notification.method === "root/sessionAdded") {
        throw new Error("catalogue observer failed");
      }
    });
    factory.onSessionEnvelope(() => {
      throw new Error("envelope observer failed");
    });
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
    const uri = sessionUri("observer-isolation");

    await factory.createSession({ channel: uri });

    expect(starts).toEqual([uri]);
    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.action).toEqual({ type: "session/ready" });
  });

  it("prevents a mutating observer from changing what later observers receive", async () => {
    const factory = createSessionsFactory({ providers: [mockProvider], now: TEST_NOW });
    const seen: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => {
      const mutable = envelope as { channel: string; action: { type: string } };
      mutable.channel = "mutated";
      mutable.action.type = "mutated";
    });
    factory.onSessionEnvelope((envelope) => seen.push(envelope));
    const uri = sessionUri("observer-mutation");

    await factory.createSession({ channel: uri });

    expect(seen[0]?.channel).toBe(uri);
    expect(seen[0]?.action).toEqual({ type: "session/ready" });
  });
});

describe("sessions factory: disposal lifecycle", () => {
  it("disposes a backend that finishes starting after disposal, publishing nothing", async () => {
    const { provider, complete, disposed } = deferredTrackingProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
    const uri = sessionUri("late-start");

    const creation = factory.createSession({ channel: uri });
    await factory.dispose();
    complete();
    await creation;

    expect(disposed).toEqual([uri]);
    expect(factory.getSessionSnapshot(uri)).toBeUndefined();
    expect(envelopes).toEqual([]);
  });

  it("continues cleanup when one disposer rejects and reports the failure", async () => {
    const { provider, disposed } = partiallyFailingProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const okUri = sessionUri("dispose-ok");
    const failUri = sessionUri("dispose-fail");
    await factory.createSession({ channel: okUri });
    await factory.createSession({ channel: failUri });

    await expect(factory.dispose()).rejects.toThrow(AggregateError);
    expect([...disposed].sort()).toEqual([okUri, failUri].sort());
  });

  it("coordinates concurrent disposal and allows reuse afterwards", async () => {
    const { provider, disposed, gate } = gatedDisposeProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const uri = sessionUri("concurrent-dispose");
    await factory.createSession({ channel: uri });

    const first = factory.dispose();
    const second = factory.dispose();
    expect(second).toBe(first);

    gate.release();
    await Promise.all([first, second]);
    expect(disposed).toEqual([uri]);

    // Reuse remains supported after disposal.
    const reused = sessionUri("after-concurrent-dispose");
    await factory.createSession({ channel: reused });
    expect(factory.getSessionSnapshot(reused)?.state.lifecycle).toBe("ready");
  });

  it("rejects new sessions while disposal is in progress", async () => {
    const { provider, disposed, gate } = gatedDisposeProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const existingUri = sessionUri("before-dispose");
    await factory.createSession({ channel: existingUri });

    const disposal = factory.dispose();

    await expect(
      factory.createSession({ channel: sessionUri("during-dispose") }),
    ).rejects.toBeInstanceOf(SessionsDisposingError);
    await expect(
      factory.createSession({ channel: sessionUri("during-dispose-code") }),
    ).rejects.toMatchObject({
      name: "SessionsDisposingError",
      code: JsonRpcErrorCodes.InternalError,
    });

    gate.release();
    await disposal;

    expect(disposed).toEqual([existingUri]);
    expect(factory.getSessionSnapshot(sessionUri("during-dispose"))).toBeUndefined();
  });

  it("reports sanitized diagnostics when a detached late backend fails to dispose", async () => {
    const { provider, completeNext, disposeAttempts } = queuedDeferredProvider({
      failDisposeWhen: (uri) => uri.endsWith("late-failing"),
    });
    const diagnostics: SessionsDiagnostic[] = [];
    const factory = createSessionsFactory({
      providers: [provider],
      now: TEST_NOW,
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    const failingUri = sessionUri("late-failing");
    const okUri = sessionUri("late-ok");
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));

    const failing = factory.createSession({ channel: failingUri });
    const ok = factory.createSession({ channel: okUri });
    await factory.dispose();

    completeNext();
    completeNext();
    await Promise.all([failing, ok]);

    // Both detached backends are attempted even though the first one fails.
    expect([...disposeAttempts].sort()).toEqual([failingUri, okUri].sort());
    expect(diagnostics).toEqual([
      { event: "lateBackendDisposeFailed", sessionUri: failingUri, errorType: "Error" },
    ]);
    // The sink receives stable identifiers only, never exception detail.
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive");
    expect(envelopes).toEqual([]);
  });

  it("keeps a late backend from an older record away from a reused URI", async () => {
    const { provider, completeNext, disposeAttempts } = queuedDeferredProvider();
    const factory = createSessionsFactory({ providers: [provider], now: TEST_NOW });
    const uri = sessionUri("reused-late");

    const staleCreation = factory.createSession({ channel: uri });
    await factory.dispose();

    // Disposal drops the earlier listeners, so observe the reused generation
    // through a fresh listener.
    const envelopes: ActionEnvelope[] = [];
    factory.onSessionEnvelope((envelope) => envelopes.push(envelope));

    const reusedCreation = factory.createSession({ channel: uri });
    completeNext(); // the stale backend resolves into a registry that no longer holds it
    completeNext(); // the reused backend resolves against the new record
    await Promise.all([staleCreation, reusedCreation]);

    expect(disposeAttempts).toEqual([uri]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.channel).toBe(uri);
    expect(envelopes[0]?.action).toEqual({ type: "session/ready" });
    expect(factory.getSessionSnapshot(uri)?.state.lifecycle).toBe("ready");
  });
});

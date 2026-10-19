import { describe, expect, it, vi } from "vitest";

import { createBaselineSessionApplication } from "@application";
import { createApplicationSession, createSessionsFactory, SESSION_URI_PREFIX, type ProviderSessionInput } from "@sessions";
import { createMockProvider, mockProvider } from "@sessions/mock";
import { createAHPServer } from "@websocket";

describe("baseline session application", () => {
  it("separates application config from provider input for explicit and default creation", async () => {
    const provider = createMockProvider();
    const startSession = vi.fn((input: ProviderSessionInput) => provider.startSession(input));
    const factory = createSessionsFactory({
      providers: [{ ...provider, startSession }],
      application: createBaselineSessionApplication(),
    });
    try {
      await factory.createSession({ channel: `${SESSION_URI_PREFIX}default`, config: { language: "rust" } });
      await createApplicationSession(factory, {
        channel: `${SESSION_URI_PREFIX}explicit`, type: "coding", config: { language: "typescript" },
      });
      expect(startSession).toHaveBeenCalledTimes(2);
      expect(startSession.mock.calls.map(([input]) => input.config)).toEqual([{}, {}]);
      await expect(factory.createSession({
        channel: `${SESSION_URI_PREFIX}invalid-language`, config: { language: 42 },
      })).rejects.toMatchObject({ name: "SessionsError", code: -32602 });
      expect(startSession).toHaveBeenCalledTimes(2);
    } finally {
      await factory.dispose();
    }
  });

  it("uses isolated policies and records on two running public hosts with the same URI", async () => {
    const first = createAHPServer({
      host: "127.0.0.1", port: 0,
      sessions: { providers: [createMockProvider()], application: createBaselineSessionApplication() },
    });
    const second = createAHPServer({
      host: "127.0.0.1", port: 0,
      sessions: { providers: [createMockProvider()], application: {
        ...createBaselineSessionApplication(), defaultType: { key: "coding", version: 1 },
      } },
    });
    try {
      const [firstAddress, secondAddress] = await Promise.all([first.start(), second.start()]);
      expect(firstAddress.port).not.toBe(secondAddress.port);
      const channel = `${SESSION_URI_PREFIX}same-uri`;
      await first.sessions.createSession({ channel });
      await second.sessions.createSession({ channel });
      expect(first.sessions.getSessionToolManifest(channel)?.toolContracts).toHaveLength(2);
      expect(second.sessions.getSessionToolManifest(channel)?.toolContracts).toHaveLength(3);
      const before = second.sessions.getCurrentServerSeq();
      first.sessions.dispatchAction({
        channel, clientId: "owner", clientSeq: 1, action: { type: "session/titleChanged", title: "only first" },
      });
      expect(first.sessions.getSessionSnapshot(channel)?.state.title).toBe("only first");
      expect(second.sessions.getSessionSnapshot(channel)?.state.title).not.toBe("only first");
      expect(second.sessions.getCurrentServerSeq()).toBe(before);
      await first.stop();
      expect(first.sessions.getSessionToolManifest(channel)).toBeUndefined();
      await expect(createApplicationSession(first.sessions, {
        channel: `${SESSION_URI_PREFIX}after-stop`, type: "code-review",
      })).rejects.toThrow(/shutdown/);
      expect(second.sessions.getSessionToolManifest(channel)?.toolContracts).toHaveLength(3);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  it("builds a typed policy without opening a port or sharing host state", async () => {
    const left = createBaselineSessionApplication();
    const right = createBaselineSessionApplication();
    expect(left.defaultType).toEqual({ key: "code-review", version: 1 });
    expect(left.catalogue).not.toBe(right.catalogue);

    const first = createSessionsFactory({ providers: [mockProvider], application: left });
    const second = createSessionsFactory({ providers: [mockProvider], application: right });
    const channel = `${SESSION_URI_PREFIX}shared-uri`;

    await createApplicationSession(first, {
      channel,
      type: "code-review",
      config: { language: "typescript" },
    });
    await createApplicationSession(second, { channel, type: "coding" });

    expect(first.getSessionToolManifest(channel)?.toolContracts).toHaveLength(2);
    expect(second.getSessionToolManifest(channel)?.toolContracts).toHaveLength(3);
    expect(second.getSessionSnapshot(channel)?.state._meta).not.toEqual(
      first.getSessionSnapshot(channel)?.state._meta,
    );

    await first.dispose();
    await second.dispose();
  });
});

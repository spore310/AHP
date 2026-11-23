import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStaticTokenAuthenticator } from "@agents";
import { SESSION_URI_PREFIX } from "@sessions";
import { createMockProvider } from "@sessions/mock";
import { createAHPServer, type AHPServerHandle } from "@websocket";
import { createMemoryPersistenceFixture } from "../persistence/conformance/helpers";

const hosts: AHPServerHandle[] = [];
const occupiers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.stop();
  }
  await Promise.all(occupiers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  })));
});

describe("AHP host composition", () => {
  it("shares completion while an attached session backend is disposing", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const dispose = vi.fn(() => {
      entered.resolve(undefined);
      return release.promise;
    });
    const host = createAHPServer({ host: "127.0.0.1", port: 0,
      sessions: { providers: [{ ...createMockProvider(), startSession: () => Promise.resolve({ dispose }) }] } });
    hosts.push(host);
    await host.sessions.createSession({ channel: `${SESSION_URI_PREFIX}held-disposal` });
    const first = host.stop();
    try {
      await entered.promise;
      expect(host.stop()).toBe(first);
      const settled = vi.fn();
      void first.then(settled);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      release.resolve(undefined);
      await first;
    }
  });

  it("shares completion while the supplied resource disposer is pending", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const persistence = createMemoryPersistenceFixture();
    const dispose = vi.fn(async () => {
      entered.resolve(undefined);
      await release.promise;
      await persistence.provider.dispose();
    });
    const host = createAHPServer({
      host: "127.0.0.1", port: 0,
      sessions: { providers: [createMockProvider()] },
      agentWork: { authenticator: createStaticTokenAuthenticator(new Map()), registrations: persistence.provider.registrations,
        work: persistence.provider.work, allowedKinds: new Set(["test.kind"]), dispose },
    });
    hosts.push(host);
    const first = host.stop();
    try {
      await entered.promise;
      const second = host.stop();
      expect(second).toBe(first);
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      release.resolve(undefined);
      await first;
    }
  });

  it("shares reentrant shutdown and caches the aggregate cleanup error", async () => {
    const persistence = createMemoryPersistenceFixture();
    const failure = new Error("Resource cleanup failed");
    const reentrant = Promise.withResolvers<{ stop: Promise<void> }>();
    const dispose = vi.fn(async () => {
      reentrant.resolve({ stop: host.stop() });
      await persistence.provider.dispose();
      throw failure;
    });
    const host = createAHPServer({
      host: "127.0.0.1", port: 0,
      sessions: { providers: [createMockProvider()] },
      agentWork: { authenticator: createStaticTokenAuthenticator(new Map()), registrations: persistence.provider.registrations,
        work: persistence.provider.work, allowedKinds: new Set(["test.kind"]), dispose },
    });
    const first = host.stop();
    const caught = first.catch((error: unknown) => error);
    await expect(host.start()).rejects.toThrow(/shutdown/);
    expect((await reentrant.promise).stop).toBe(first);
    expect(host.stop()).toBe(first);
    await expect(caught).resolves.toMatchObject({ name: "AggregateError", errors: [failure] });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps two hosts from sharing sessions", async () => {
    const first = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: { providers: [createMockProvider()] },
    });
    const second = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: { providers: [createMockProvider()] },
    });
    hosts.push(first, second);
    await first.start();
    await second.start();

    await first.sessions.createSession({ channel: `${SESSION_URI_PREFIX}one` });
    await second.sessions.createSession({ channel: `${SESSION_URI_PREFIX}two` });

    expect(first.sessions.listSessionSnapshots().map((snapshot) => snapshot.resource)).toEqual([
      `${SESSION_URI_PREFIX}one`,
    ]);
    expect(second.sessions.listSessionSnapshots().map((snapshot) => snapshot.resource)).toEqual([
      `${SESSION_URI_PREFIX}two`,
    ]);
  });

  it("does not revive a stopped host", async () => {
    const host = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: { providers: [createMockProvider()] },
    });
    hosts.push(host);
    await host.start();
    await host.stop();
    await expect(host.start()).rejects.toThrow(/shutdown/);
    await expect(
      host.sessions.createSession({ channel: `${SESSION_URI_PREFIX}after-stop` }),
    ).rejects.toThrow(/sessions cannot be used after shutdown/);
    expect(() => host.sessions.dispatchAction({
      channel: `${SESSION_URI_PREFIX}after-stop`,
      clientSeq: 1,
      action: { type: "session/titleChanged", title: "Nope" },
      clientId: "t24",
    })).toThrow(/sessions cannot be used after shutdown/);
  });

  it("rejects sessions use and restart after stop, including failed start", async () => {
    const occupier = createServer();
    occupiers.push(occupier);
    const port = await new Promise<number>((resolve, reject) => {
      occupier.once("error", reject);
      occupier.listen(0, "127.0.0.1", () => {
        const address = occupier.address();
        if (address === null || typeof address === "string") {
          reject(new Error("expected a TCP address"));
          return;
        }
        resolve(address.port);
      });
    });

    const persistenceFixture = createMemoryPersistenceFixture();
    const disposePersistence = vi.fn(() => persistenceFixture.provider.dispose());
    const host = createAHPServer({
      host: "127.0.0.1",
      port,
      sessions: { providers: [createMockProvider()] },
      agentWork: {
        authenticator: createStaticTokenAuthenticator(new Map([["test-token", "test-principal"]])),
        registrations: persistenceFixture.provider.registrations,
        work: persistenceFixture.provider.work,
        allowedKinds: new Set(["test.kind"]),
        dispose: disposePersistence,
      },
    });
    hosts.push(host);
    await expect(host.start()).rejects.toThrow();
    expect(disposePersistence).toHaveBeenCalledOnce();
    await new Promise<void>((resolve, reject) => {
      occupier.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    occupiers.splice(occupiers.indexOf(occupier), 1);

    await expect(host.start()).rejects.toThrow(/shutdown/);
    await expect(
      host.sessions.createSession({ channel: `${SESSION_URI_PREFIX}after-failed-start` }),
    ).rejects.toThrow(/sessions cannot be used after shutdown/);
    expect(() => host.sessions.dispatchAction({
      channel: `${SESSION_URI_PREFIX}after-failed-start`,
      clientSeq: 1,
      action: { type: "session/titleChanged", title: "Nope" },
      clientId: "t24",
    })).toThrow(/sessions cannot be used after shutdown/);
  });
});

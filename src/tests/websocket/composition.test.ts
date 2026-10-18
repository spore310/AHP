import { afterEach, describe, expect, it } from "vitest";

import { SESSION_URI_PREFIX } from "@sessions";
import { createMockProvider } from "@sessions/mock";
import { createAHPServer, type AHPServerHandle } from "@websocket";

const hosts: AHPServerHandle[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.stop();
  }
});

describe("AHP host composition", () => {
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
  });
});

import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_URI_PREFIX } from "@sessions";
import { ACTION_TYPE_SESSION_TITLE_CHANGED } from "@sessions/constants";
import { createMockProvider } from "@sessions/mock";
import { createAHPServer, type AHPServerHandle } from "@websocket";

// INTERNAL canonical SDK compatibility, not authorized public-host/P12 evidence.
// File-isolated substitution preserves real host composition and all canonical assertions.
vi.mock("@websocket/helpers/ahp", async () => ({
  createAHPBinding: (await import("@websocket/helpers/ahp/helpers/kernel/helpers")).createAHPKernel,
}));

const hosts: AHPServerHandle[] = [];
const clients: AhpClient[] = [];

const nextEvent = async (
  events: AsyncIterableIterator<{ channel: string; event: { type: string; params?: unknown } }>,
  type: string,
  channel?: string,
): Promise<{ channel: string; event: { type: string; params?: unknown } }> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const next = await Promise.race([
      events.next(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`timed out waiting for ${type}`));
        }, remaining);
      }),
    ]);
    if (next.done === true) {
      throw new Error(`event stream ended before ${type}`);
    }
    if (next.value.event.type === type && (channel === undefined || next.value.channel === channel)) {
      return next.value;
    }
  }
  throw new Error(`timed out waiting for ${type}`);
};

const openClient = async (url: string, clientId: string): Promise<AhpClient> => {
  const transport = await WebSocketTransport.connect(url);
  const client = new AhpClient(transport);
  clients.push(client);
  client.connect();
  await client.initialize({
    clientId,
    protocolVersions: ["1.0.0"],
    initialSubscriptions: ["ahp-root://"],
  });
  return client;
};

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.shutdown();
  }
  for (const host of hosts.splice(0)) {
    await host.stop();
  }
});

describe("SDK host baseline", () => {
  it("lets two SDK clients observe the same created session and one rename", async () => {
    const host = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: { providers: [createMockProvider()] },
    });
    hosts.push(host);
    const address = await host.start();
    const url = `ws://127.0.0.1:${String(address.port)}/`;
    const creator = await openClient(url, "creator");
    const observer = await openClient(url, "observer");
    const creatorEvents = creator.events();
    const observerEvents = observer.events();
    const channel = `${SESSION_URI_PREFIX}sdk-shared`;

    const created = creator.request("createSession", { channel });
    await expect(nextEvent(creatorEvents, "sessionAdded")).resolves.toMatchObject({
      channel: "ahp-root://",
      event: { type: "sessionAdded" },
    });
    await expect(nextEvent(observerEvents, "sessionAdded")).resolves.toMatchObject({
      channel: "ahp-root://",
      event: { type: "sessionAdded" },
    });
    await created;

    await creator.subscribe(channel);
    await observer.subscribe(channel);
    creator.dispatch(channel, { type: ACTION_TYPE_SESSION_TITLE_CHANGED, title: "Shared title" });

    await expect(nextEvent(creatorEvents, "action", channel)).resolves.toMatchObject({
      channel,
      event: { type: "action" },
    });
    await expect(nextEvent(observerEvents, "action", channel)).resolves.toMatchObject({
      channel,
      event: { type: "action" },
    });
    expect(host.sessions.getSessionSnapshot(channel)?.state.title).toBe("Shared title");
  });
});

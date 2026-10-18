import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { APP_NAME, installShutdownHandlers } from "@/index";
import type { WebSocketServerHandle } from "@/websocket";

const fakeAddress: AddressInfo = { address: "127.0.0.1", family: "IPv4", port: 0 };

describe("Agent Hosting Protocol", () => {
  it("exposes the product name", () => {
    expect(APP_NAME).toBe("Agent Hosting Protocol");
  });

  it("registers and removes one handler per termination signal", () => {
    const server: WebSocketServerHandle = {
      start: (): Promise<AddressInfo> => Promise.resolve(fakeAddress),
      stop: (): Promise<void> => Promise.resolve(),
    };
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const remove = installShutdownHandlers(server);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    remove();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("stops the server when a termination signal handler runs", () => {
    const stop = vi.fn((): Promise<void> => Promise.resolve());
    const server: WebSocketServerHandle = {
      start: (): Promise<AddressInfo> => Promise.resolve(fakeAddress),
      stop,
    };
    const before = process.listeners("SIGTERM");

    const remove = installShutdownHandlers(server);
    const added = process.listeners("SIGTERM").filter((listener) => !before.includes(listener));
    expect(added).toHaveLength(1);

    added[0]?.("SIGTERM");
    expect(stop).toHaveBeenCalledTimes(1);

    remove();
    expect(process.listeners("SIGTERM")).toHaveLength(before.length);
  });
});

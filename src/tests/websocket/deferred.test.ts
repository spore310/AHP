import WebSocket from "ws";
import { describe, expect, it } from "vitest";

import { createWebSocketServer } from "@websocket";

import { FrameLog, responseWithId } from "./helpers";

describe("deferred request queue", () => {
  it("isolates a throwing completion matcher and preserves queued ordinary requests", async () => {
    const pending = Promise.withResolvers<null>();
    const matcherCalled = Promise.withResolvers<undefined>();
    const server = createWebSocketServer({
      host: "127.0.0.1", port: 0,
      handlers: { deferred: () => pending.promise, ping: () => null, complete: () => null },
      deferredRequestCompletionMethods: new Map([["deferred", {
        method: "complete",
        matches: () => {
          matcherCalled.resolve(undefined);
          throw new Error("Broken application callback");
        },
      }]]),
    });
    const address = await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const frames = new FrameLog(socket);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "deferred", params: {} }));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping", params: {} }));
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "complete", params: {} }));
      await matcherCalled.promise;
      pending.resolve(null);
      await expect(frames.waitFor(responseWithId(1))).resolves.toMatchObject({ id: 1, result: null });
      await expect(frames.waitFor(responseWithId(2))).resolves.toMatchObject({ id: 2, result: null });
    } finally {
      pending.resolve(null);
      socket.terminate();
      await server.stop();
    }
  });
});

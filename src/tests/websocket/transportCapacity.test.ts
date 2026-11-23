import { EventEmitter, once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createWebSocketServer } from "@websocket";
import { attachConnection } from "@websocket/helpers/connection";
import { captureTransportLimits, createCapacity } from "@websocket/helpers/capacity";
import { FrameLog, responseWithId } from "./helpers";

const socketFixture = () => {
  class Socket extends EventEmitter {
    readonly OPEN = 1;
    readyState = this.OPEN;
    bufferedAmount = 0;
    readonly send = vi.fn();
    readonly terminate = vi.fn(() => {
      this.readyState = 3;
      this.emit("close");
    });
  }
  const socket = new Socket();
  return { socket, connection: socket as unknown as WebSocket };
};

describe("WebSocket transport capacity", () => {
  it("publishes transport shutdown before cancelling pending setup", async () => {
    const entered = Promise.withResolvers<undefined>();
    const setup = Promise.withResolvers<undefined>();
    const reentry = Promise.withResolvers<{ shutdown: Promise<void> }>();
    const server = createWebSocketServer({
      host: "127.0.0.1", port: 0,
      connectionSetup: { prepare: ({ signal }) => {
        signal.addEventListener("abort", () => {
          reentry.resolve({ shutdown: server.stop() });
        }, { once: true });
        entered.resolve(undefined);
        return setup.promise;
      } },
    });
    const address = await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`);
    try {
      await once(socket, "open");
      await entered.promise;
      const shutdown = server.stop();
      expect((await reentry.promise).shutdown).toBe(shutdown);
      await shutdown;
    } finally {
      setup.resolve(undefined);
      socket.terminate();
      await server.stop();
    }
  });

  it("keeps timed-out setup work charged until settlement and bounds accepted connections", async () => {
    const held = Promise.withResolvers<{ subject: string }>();
    const authenticate = vi.fn(() => Promise.resolve({ subject: "active" }))
      .mockImplementationOnce(() => held.promise);
    const onConnection = vi.fn();
    const server = createWebSocketServer({
      host: "127.0.0.1", port: 0, setupDeadlineMs: 35,
      transportLimits: { maxConnections: 1, maxPendingSetups: 1 },
      authentication: "required",
      authenticator: { authenticate },
      onConnection,
      handlers: { ping: () => "ready" },
    });
    const address = await server.start();
    const url = `ws://127.0.0.1:${String(address.port)}/`;
    const sockets: WebSocket[] = [];
    const connect = (): WebSocket => {
      const socket = new WebSocket(url);
      sockets.push(socket);
      return socket;
    };
    const refused = async (): Promise<void> => {
      const socket = connect();
      const error = new Promise<Error>((resolve) => socket.once("error", resolve));
      await expect(error).resolves.toMatchObject({ message: "Unexpected server response: 503" });
    };
    try {
      await expect(once(connect(), "close")).resolves.toEqual([1011, Buffer.from("Connection rejected")]);
      await refused();
      expect(authenticate).toHaveBeenCalledOnce();
      expect(onConnection).not.toHaveBeenCalled();

      held.resolve({ subject: "too late" });
      const active = connect();
      await once(active, "open");
      await refused();
      const frames = new FrameLog(active);
      active.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
      await expect(frames.waitFor(responseWithId(1))).resolves.toEqual({ jsonrpc: "2.0", id: 1, result: "ready" });
      expect(authenticate).toHaveBeenCalledTimes(2);
      expect(onConnection).toHaveBeenCalledOnce();
    } finally {
      held.resolve({ subject: "too late" });
      for (const socket of sockets) socket.terminate();
      await server.stop();
    }
  });

  it("refuses output that cannot fit in the local write buffer", () => {
    const { socket, connection } = socketFixture();
    const context = attachConnection(connection, {}, undefined, undefined, undefined, undefined, {
      limits: captureTransportLimits({ maxBufferedOutputBytes: 256 }),
    });
    socket.bufferedAmount = 220;
    expect(context.send({ jsonrpc: "2.0", method: "notice" })).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledOnce();
  });

  it("charges queued frames by their UTF-8 bytes", () => {
    const { socket, connection } = socketFixture();
    const pending = Promise.withResolvers<null>();
    const received = vi.fn(() => pending.promise);
    const frame = JSON.stringify({ jsonrpc: "2.0", method: "message", params: { value: "日本語" } });
    attachConnection(connection, { message: received }, undefined, undefined, undefined, undefined, {
      limits: captureTransportLimits({ maxQueuedInputBytes: frame.length }),
    });
    try {
      socket.emit("message", Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "message" })), false);
      expect(received).toHaveBeenCalledOnce();
      socket.emit("message", Buffer.from(frame), false);
      expect(socket.terminate).toHaveBeenCalledOnce();
      expect(received).toHaveBeenCalledOnce();
    } finally {
      pending.resolve(null);
    }
  });

  it("closes required-authentication sockets before attaching them", async () => {
    const attached = Promise.withResolvers<"attached">();
    const onConnection = vi.fn(() => {
      attached.resolve("attached");
    });
    const options = {
      host: "127.0.0.1", port: 0,
      authentication: "required" as const,
      onConnection,
      authenticator: { authenticate: vi.fn(() => Promise.resolve(undefined)) },
    };
    const server = createWebSocketServer(options);
    const address = await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`);
    try {
      const closeCode = once(socket, "close").then(([code]: readonly unknown[]) => code);
      const result = await Promise.race([closeCode, attached.promise]);
      expect(result).toBe(1008);
      expect(onConnection).not.toHaveBeenCalled();
    } finally {
      socket.terminate();
      await server.stop();
    }
  });

  it("keeps deferred work charged after close until the handler settles", async () => {
    const pending = Promise.withResolvers<null>();
    const handle = vi.fn(() => pending.promise);
    const capacity = {
      limits: captureTransportLimits({ maxPendingDeferredRequests: 1 }),
      reserveDeferred: createCapacity(1),
    };
    const completionMethods = new Map([["deferred", { method: "complete", matches: () => true }]]);
    const frame = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "deferred" }));
    const sendDeferred = () => {
      const { socket, connection } = socketFixture();
      attachConnection(connection, { deferred: handle }, undefined, completionMethods, undefined, undefined, capacity);
      socket.emit("message", frame, false);
      return socket;
    };
    try {
      sendDeferred().terminate();
      const refused = sendDeferred();
      expect(refused.terminate).not.toHaveBeenCalled();
      expect(refused.send).toHaveBeenCalledWith(JSON.stringify({
        jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Request capacity unavailable" },
      }));
      expect(handle).toHaveBeenCalledOnce();
      pending.resolve(null);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(sendDeferred().terminate).not.toHaveBeenCalled();
      expect(handle).toHaveBeenCalledTimes(2);
    } finally {
      pending.resolve(null);
    }
  });
});

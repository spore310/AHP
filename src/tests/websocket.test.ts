import { request as httpRequest } from "node:http";
import { connect as netConnect, createServer as netCreateServer } from "node:net";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { RpcError } from "@jsonrpc";
import { createSessionsFactory, SESSION_URI_PREFIX } from "@sessions";
import { mockProvider } from "@sessions/mock";
import {
  createWebSocketServer,
  WEBSOCKET_HEARTBEAT_INTERVAL_MS,
  type JsonRpcHandlers,
  type WebSocketServerHandle,
} from "@websocket";

const servers: WebSocketServerHandle[] = [];
const sockets: WebSocket[] = [];

const startServer = async (
  handlers: JsonRpcHandlers,
): Promise<{ url: string; server: WebSocketServerHandle }> => {
  const server = createWebSocketServer({ host: "127.0.0.1", port: 0, handlers });
  const address = await server.start();
  servers.push(server);
  return { url: `ws://127.0.0.1:${String(address.port)}/`, server };
};

const connect = async (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => {
      sockets.push(socket);
      resolve(socket);
    });
    socket.once("error", reject);
  });

const frameToText = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};

const readJson = (socket: WebSocket): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      cleanup();
      resolve(JSON.parse(frameToText(data)));
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("socket closed before a message arrived"));
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });

const request = async (socket: WebSocket, payload: unknown): Promise<unknown> => {
  const received = readJson(socket);
  socket.send(JSON.stringify(payload));
  return received;
};

/** Sends a raw upgrade request with an arbitrary request target over TCP. */
const rawUpgrade = (port: number, target: string): Promise<void> =>
  new Promise((resolve) => {
    const socket = netConnect(port, "127.0.0.1");
    const timer = setTimeout(() => {
      socket.destroy();
    }, 500);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    socket.on("error", finish);
    socket.on("close", finish);
    socket.on("connect", () => {
      const lines = [
        `GET ${target} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
      ];
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
  });

/** Reads the HTTP status for an ordinary request. */
const httpStatus = (port: number, path: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET" },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });

/** Binds a throwaway TCP listener so a test can target a known-occupied port. */
const occupiedPort = async (): Promise<{ port: number; release: () => Promise<void> }> => {
  const probe = netCreateServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    throw new Error("probe server did not bind to a TCP address");
  }
  return {
    port: address.port,
    release: () =>
      new Promise<void>((resolve) => {
        probe.close(() => {
          resolve();
        });
      }),
  };
};

/** Reserves an ephemeral port and releases it for the server under test. */
const reservePort = async (): Promise<number> => {
  const { port, release } = await occupiedPort();
  await release();
  return port;
};

/** Resolves `true` when nothing accepts TCP connections on the port. */
const isPortClosed = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = netConnect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(true);
    });
  });

/** An error carrying a `code` that is not the owned RPC error type. */
class FakeError extends Error {
  readonly code = AhpErrorCodes.ProviderNotFound;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

describe("WebSocket JSON-RPC handling", () => {
  it("answers a request with the handler result", async () => {
    const { url } = await startServer({ echo: (params) => ({ received: params }) });
    const socket = await connect(url);

    const response = await request(socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "echo",
      params: { value: 42 },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { received: { value: 42 } },
    });
  });

  it("returns MethodNotFound for an unregistered method", async () => {
    const { url } = await startServer({});
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: "abc", method: "missing" });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "abc",
      error: { code: -32601, message: "Method not found: missing" },
    });
  });

  it("reports a parse error with a null id for malformed JSON", async () => {
    const { url } = await startServer({});
    const socket = await connect(url);

    const received = readJson(socket);
    socket.send("{ not json");

    expect(await received).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("rejects a wrongly typed known member while preserving its id", async () => {
    const { url } = await startServer({});
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: 7, method: "m", params: 5 });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("dispatches a request carrying an unknown additive member", async () => {
    const { url } = await startServer({ echo: (params) => params });
    const socket = await connect(url);

    const response = await request(socket, {
      jsonrpc: "2.0",
      id: 9,
      method: "echo",
      params: { a: 1 },
      trace: "abc",
    });

    expect(response).toEqual({ jsonrpc: "2.0", id: 9, result: { a: 1 } });
  });

  it("does not reply to notifications", async () => {
    let notifications = 0;
    const { url } = await startServer({
      notify: () => {
        notifications += 1;
      },
    });
    const socket = await connect(url);

    socket.send(JSON.stringify({ jsonrpc: "2.0", method: "notify" }));
    // The following request's reply proves the notification produced none.
    const response = await request(socket, { jsonrpc: "2.0", id: 2, method: "unknown" });

    expect(notifications).toBe(1);
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found: unknown" },
    });
  });

  it("maps a handler ZodError to InvalidParams", async () => {
    const { url } = await startServer({
      strict: (params) => z.object({ n: z.number() }).parse(params),
    });
    const socket = await connect(url);

    const response = await request(socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "strict",
      params: { n: "x" },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32602, message: "Invalid params" },
    });
  });

  it("does not leak handler error details", async () => {
    const { url } = await startServer({
      boom: () => {
        throw new Error("sensitive detail");
      },
    });
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: 4, method: "boom" });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: -32603, message: "Internal error" },
    });
  });

  it("closes the connection when a binary frame arrives", async () => {
    const { url } = await startServer({});
    const socket = await connect(url);

    const closed = new Promise<number>((resolve) => {
      socket.once("close", (code) => {
        resolve(code);
      });
    });
    socket.send(Buffer.from([1, 2, 3]));

    expect(await closed).toBe(1003);
  });

  it("rejects upgrades on an unexpected path", async () => {
    const server = createWebSocketServer({ host: "127.0.0.1", port: 0, path: "/ws", handlers: {} });
    const address = await server.start();
    servers.push(server);

    await expect(connect(`ws://127.0.0.1:${String(address.port)}/`)).rejects.toThrow();
  });

  it("survives a malformed upgrade target and still serves clients", async () => {
    const { url, server } = await startServer({ ping: () => "pong" });
    const address = new URL(url);

    await rawUpgrade(Number(address.port), "//[");

    const socket = await connect(url);
    const response = await request(socket, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: "pong" });

    await server.stop();
  });

  it("closes clients when stopped", async () => {
    const { url, server } = await startServer({});
    const socket = await connect(url);

    const closed = new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
    });
    await server.stop();
    await closed;
  });
});

describe("WebSocket method dispatch", () => {
  it("answers MethodNotFound for inherited property names", async () => {
    const { url } = await startServer({});
    const socket = await connect(url);

    for (const method of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      const response = await request(socket, { jsonrpc: "2.0", id: method, method });
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: method,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  });

  it("dispatches an own method whose name matches a prototype member", async () => {
    const { url } = await startServer({ toString: () => "own" });
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: 1, method: "toString" });

    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: "own" });
  });
});

describe("WebSocket error mapping", () => {
  it("preserves an owned RPC error's code, message, and data", async () => {
    const { url } = await startServer({
      fail: () => {
        throw new RpcError(AhpErrorCodes.UnsupportedProtocolVersion, "Unsupported", {
          supportedVersions: ["1.0.0"],
        });
      },
    });
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: 1, method: "fail" });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: AhpErrorCodes.UnsupportedProtocolVersion,
        message: "Unsupported",
        data: { supportedVersions: ["1.0.0"] },
      },
    });
  });

  it("does not trust a thrown error that merely carries a code", async () => {
    const { url } = await startServer({
      fake: () => {
        throw new FakeError("spoofed");
      },
    });
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: 2, method: "fake" });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32603, message: "Internal error" },
    });
  });

  it("maps session failures to their protocol codes through the boundary", async () => {
    const factory = createSessionsFactory({ providers: [mockProvider] });
    const { url } = await startServer({
      createSession: (params) => factory.createSession(params),
    });
    const socket = await connect(url);

    const unknownProvider = await request(socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "createSession",
      params: { channel: `${SESSION_URI_PREFIX}unknown`, provider: "missing" },
    });
    expect(unknownProvider).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: AhpErrorCodes.ProviderNotFound },
    });

    const created = await request(socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "createSession",
      params: { channel: `${SESSION_URI_PREFIX}dup` },
    });
    expect(created).toEqual({ jsonrpc: "2.0", id: 2, result: null });

    const duplicate = await request(socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "createSession",
      params: { channel: `${SESSION_URI_PREFIX}dup` },
    });
    expect(duplicate).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: { code: AhpErrorCodes.SessionAlreadyExists },
    });

    const invalid = await request(socket, {
      jsonrpc: "2.0",
      id: 4,
      method: "createSession",
      params: { channel: "not-a-session-uri" },
    });
    expect(invalid).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      error: { code: JsonRpcErrorCodes.InvalidParams },
    });
  });
});

describe("WebSocket lifecycle", () => {
  it("leaves no listener behind when stop() races the initial bind", async () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      const port = await reservePort();
      const server = createWebSocketServer({ host: "127.0.0.1", port, handlers: {} });
      servers.push(server);

      const [startResult, stopResult] = await Promise.allSettled([
        server.start(),
        server.stop(),
      ]);

      expect(startResult.status).toBe("rejected");
      expect(stopResult.status).toBe("fulfilled");
      expect(await isPortClosed(port)).toBe(true);
      // The bind never reached `listening`, so no heartbeat was ever scheduled.
      const heartbeatIntervals = intervalSpy.mock.calls.filter(
        (call) => call[1] === WEBSOCKET_HEARTBEAT_INTERVAL_MS,
      );
      expect(heartbeatIntervals).toHaveLength(0);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it("is terminal when stop() precedes start()", async () => {
    const server = createWebSocketServer({ host: "127.0.0.1", port: 0, handlers: {} });
    servers.push(server);

    await server.stop();

    await expect(server.start()).rejects.toThrow(/shutdown has begun/);
  });

  it("shares one bind across concurrent start() calls", async () => {
    const server = createWebSocketServer({ host: "127.0.0.1", port: 0, handlers: {} });
    servers.push(server);

    const first = server.start();
    const second = server.start();
    expect(second).toBe(first);

    const [firstAddress, secondAddress] = await Promise.all([first, second]);
    expect(firstAddress.port).toBe(secondAddress.port);
    expect((await server.start()).port).toBe(firstAddress.port);
  });

  it("retries a bind after the first attempt fails", async () => {
    const { port, release } = await occupiedPort();
    const server = createWebSocketServer({ host: "127.0.0.1", port, handlers: {} });
    servers.push(server);

    await expect(server.start()).rejects.toThrow();

    await release();

    const address = await server.start();
    expect(address.port).toBe(port);
  });

  it("clears the heartbeat timer when a listening server stops", async () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const server = createWebSocketServer({ host: "127.0.0.1", port: 0, handlers: {} });
      servers.push(server);
      await server.start();

      const heartbeatTimers = intervalSpy.mock.calls
        .map((call, index) => ({ delay: call[1], result: intervalSpy.mock.results[index] }))
        .filter((entry) => entry.delay === WEBSOCKET_HEARTBEAT_INTERVAL_MS)
        .map((entry) => entry.result?.value as NodeJS.Timeout | undefined);
      expect(heartbeatTimers).toHaveLength(1);

      await server.stop();

      for (const timer of heartbeatTimers) {
        expect(clearSpy.mock.calls.some(([cleared]) => cleared === timer)).toBe(true);
      }
    } finally {
      intervalSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});

describe("WebSocket shutdown", () => {
  it("shares one shutdown promise across concurrent and repeated stops", async () => {
    const { server } = await startServer({});

    const first = server.stop();
    const second = server.stop();
    expect(second).toBe(first);
    await first;
    expect(server.stop()).toBe(first);
  });

  it("answers ordinary HTTP requests instead of stalling them", async () => {
    const { url } = await startServer({});
    const status = await httpStatus(Number(new URL(url).port), "/");
    expect(status).toBe(426);
  });

  it("rejects upgrades once stopping", async () => {
    const { url, server } = await startServer({});
    const stop = server.stop();
    await expect(connect(url)).rejects.toThrow();
    await stop;
  });

  it("bounds shutdown when an open request would otherwise stall it", async () => {
    const server = createWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      handlers: {},
      shutdownTimeoutMs: 100,
    });
    const address = await server.start();
    servers.push(server);

    // An incomplete request keeps a connection active; the deadline must still
    // let shutdown finish.
    const socket = netConnect(address.port, "127.0.0.1");
    await new Promise<void>((resolve) => {
      socket.once("connect", () => {
        resolve();
      });
    });
    socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n");

    const startedAt = Date.now();
    await server.stop();
    const elapsed = Date.now() - startedAt;
    socket.destroy();

    expect(elapsed).toBeLessThan(2000);
    // Forced closure still awaits local release before stop() resolves.
    expect(await isPortClosed(address.port)).toBe(true);
  });
});

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createWebSocketServer,
  type JsonRpcHandlers,
  type WebSocketServerHandle,
} from "@/websocket";

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

  it("rejects a non-conforming message while preserving its id", async () => {
    const { url } = await startServer({});
    const socket = await connect(url);

    const response = await request(socket, { jsonrpc: "2.0", id: 7, method: "m", extra: true });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32600, message: "Invalid Request" },
    });
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

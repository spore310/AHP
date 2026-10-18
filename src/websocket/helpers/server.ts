import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";

import {
  WEBSOCKET_CLOSE_GOING_AWAY,
  WEBSOCKET_DEFAULT_PATH,
  WEBSOCKET_HEARTBEAT_INTERVAL_MS,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
} from "../constants";
import type {
  WebSocketServerHandle,
  WebSocketServerOptions,
} from "../types";
import { attachConnection } from "./connection";

/**
 * Create a WebSocket server that speaks JSON-RPC over text frames.
 *
 * Binds lazily: nothing listens until {@link WebSocketServerHandle.start}.
 * Upgrades are accepted only on the configured path, oversized frames are
 * rejected, and idle connections are dropped by a heartbeat ping.
 */
export const createWebSocketServer = (
  options: WebSocketServerOptions,
): WebSocketServerHandle => {
  const { host, port, path = WEBSOCKET_DEFAULT_PATH, handlers = {} } = options;

  const httpServer = createServer();
  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES,
  });

  // Tracks liveness between heartbeat ticks: a socket is marked alive on
  // connect and on every pong, cleared when pinged, terminated if still clear.
  const alive = new WeakSet<WebSocket>();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  httpServer.on("upgrade", (request, socket, head) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (requestPath !== path) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit("connection", client, request);
    });
  });

  wsServer.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => {
      alive.add(socket);
    });
    attachConnection(socket, handlers);
  });

  const start = (): Promise<AddressInfo> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        httpServer.off("error", onError);
        const address = httpServer.address();
        if (address === null || typeof address === "string") {
          reject(new Error("WebSocket server did not bind to a TCP address"));
          return;
        }

        heartbeatTimer = setInterval(() => {
          for (const socket of wsServer.clients) {
            if (!alive.has(socket)) {
              socket.terminate();
              continue;
            }
            alive.delete(socket);
            socket.ping();
          }
        }, WEBSOCKET_HEARTBEAT_INTERVAL_MS);

        resolve(address);
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, host);
    });

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      stopped = true;

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      for (const socket of wsServer.clients) {
        socket.close(WEBSOCKET_CLOSE_GOING_AWAY, "Server shutting down");
      }

      wsServer.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });

  return { start, stop };
};

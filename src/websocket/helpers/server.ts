import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";

import {
  WEBSOCKET_CLOSE_GOING_AWAY,
  WEBSOCKET_DEFAULT_PATH,
  WEBSOCKET_HEARTBEAT_INTERVAL_MS,
  WEBSOCKET_HTTP_UPGRADE_REQUIRED,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  WEBSOCKET_SHUTDOWN_TIMEOUT_MS,
} from "../constants";
import type {
  WebSocketServerHandle,
  WebSocketServerOptions,
} from "../types";
import { attachConnection } from "./connection";

/** Lifecycle of a server: bound lazily and stopped terminally. */
type WebSocketLifecycle = "idle" | "listening" | "stopping" | "stopped";

/**
 * Create a WebSocket server that speaks JSON-RPC over text frames.
 *
 * Binds lazily: nothing listens until {@link WebSocketServerHandle.start}.
 * Upgrades are accepted only on the configured path, oversized frames are
 * rejected, and idle connections are dropped by a heartbeat ping. Shutdown is
 * shared and bounded: concurrent stops await the same cleanup, and a slow
 * client or open HTTP request cannot stall it past the configured deadline.
 */
export const createWebSocketServer = (
  options: WebSocketServerOptions,
): WebSocketServerHandle => {
  const {
    host,
    port,
    path = WEBSOCKET_DEFAULT_PATH,
    handlers = {},
    shutdownTimeoutMs = WEBSOCKET_SHUTDOWN_TIMEOUT_MS,
  } = options;

  const httpServer = createServer((_request, response) => {
    // This listener speaks WebSocket only. Answer ordinary HTTP requests
    // explicitly so an accepted request cannot complicate HTTP shutdown.
    response.writeHead(WEBSOCKET_HTTP_UPGRADE_REQUIRED, { Connection: "close" });
    response.end();
  });
  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES,
  });

  // Tracks liveness between heartbeat ticks: a socket is marked alive on
  // connect and on every pong, cleared when pinged, terminated if still clear.
  const alive = new WeakSet<WebSocket>();
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let lifecycle: WebSocketLifecycle = "idle";
  let boundAddress: AddressInfo | null = null;
  let startPromise: Promise<AddressInfo> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const rejectUpgrade = (socket: Duplex, status: number, message: string): void => {
    if (socket.writable) {
      socket.write(`HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    socket.destroy();
  };

  httpServer.on("upgrade", (request, socket, head) => {
    // Contain every failure inside the upgrade boundary: a malformed request
    // target must not escape this handler and terminate the process.
    const onSocketError = (): void => {
      socket.destroy();
    };
    socket.once("error", onSocketError);

    if (lifecycle !== "listening") {
      socket.off("error", onSocketError);
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    let requestPath: string;
    try {
      requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.off("error", onSocketError);
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    if (requestPath !== path) {
      socket.off("error", onSocketError);
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    try {
      wsServer.handleUpgrade(request, socket, head, (client) => {
        socket.off("error", onSocketError);
        wsServer.emit("connection", client, request);
      });
    } catch {
      socket.off("error", onSocketError);
      socket.destroy();
    }
  });

  wsServer.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => {
      alive.add(socket);
    });
    attachConnection(socket, handlers);
  });

  const beginListening = (): Promise<AddressInfo> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off("listening", onListening);
        lifecycle = "idle";
        startPromise = null;
        reject(error);
      };
      const onListening = (): void => {
        httpServer.off("error", onError);
        const address = httpServer.address();
        if (address === null || typeof address === "string") {
          reject(new Error("WebSocket server did not bind to a TCP address"));
          return;
        }

        boundAddress = address;
        lifecycle = "listening";
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

  const start = (): Promise<AddressInfo> => {
    if (lifecycle === "stopping" || lifecycle === "stopped") {
      return Promise.reject(
        new Error("WebSocket server cannot be restarted after it has stopped."),
      );
    }
    if (lifecycle === "listening" && boundAddress !== null) {
      return Promise.resolve(boundAddress);
    }

    startPromise ??= beginListening();
    return startPromise;
  };

  const stop = (): Promise<void> => {
    shutdownPromise ??= performShutdown();
    return shutdownPromise;
  };

  const performShutdown = async (): Promise<void> => {
    if (lifecycle === "stopped") {
      return;
    }
    const wasListening = lifecycle === "listening";
    lifecycle = "stopping";

    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    for (const socket of wsServer.clients) {
      socket.close(WEBSOCKET_CLOSE_GOING_AWAY, "Server shutting down");
    }

    if (wasListening) {
      const closed = new Promise<void>((resolve) => {
        wsServer.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      });

      await withDeadline(closed, shutdownTimeoutMs, () => {
        for (const socket of wsServer.clients) {
          socket.terminate();
        }
        wsServer.close();
        httpServer.closeAllConnections();
        httpServer.close();
      });
    }

    lifecycle = "stopped";
  };

  return { start, stop };
};

/**
 * Awaits a shutdown promise, invoking {@link onTimeout} and resolving once the
 * deadline elapses so forced cleanup can complete.
 */
async function withDeadline(
  promise: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([promise, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

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

/**
 * Lifecycle of a server: bound lazily, single-flight while starting, and
 * terminal once stopped.
 *
 * Legal transitions:
 *
 *     idle -> starting -> listening -> stopping -> stopped
 *                \------------------> stopping -> stopped
 *     idle -------------------------> stopped
 *
 * `stop()` enters `stopping` synchronously, before any in-flight bind settles,
 * so a late `listening` callback can never restore `listening` after shutdown
 * has begun.
 */
type WebSocketLifecycle = "idle" | "starting" | "listening" | "stopping" | "stopped";

/**
 * Create a WebSocket server that speaks JSON-RPC over text frames.
 *
 * Binds lazily: nothing listens until {@link WebSocketServerHandle.start}.
 * Upgrades are accepted only on the configured path, oversized frames are
 * rejected, and idle connections are dropped by a heartbeat ping. Startup and
 * shutdown are single-flight: concurrent starts share one bind, concurrent
 * stops share one cleanup, and a stop that races a start leaves no listener
 * behind.
 */
export const createWebSocketServer = (
  options: WebSocketServerOptions,
): WebSocketServerHandle => {
  const {
    host,
    port,
    path = WEBSOCKET_DEFAULT_PATH,
    handlers = {},
    onConnection,
    beforeDispatch,
    deferredRequestCompletionMethods = new Map(),
    shutdownTimeoutMs = WEBSOCKET_SHUTDOWN_TIMEOUT_MS,
  } = options;

  const httpServer = createServer((_request, response) => {
    // This listener speaks WebSocket only. Answer ordinary HTTP requests
    // explicitly so an accepted request cannot complicate HTTP shutdown.
    response.writeHead(WEBSOCKET_HTTP_UPGRADE_REQUIRED, { Connection: "close" });
    response.end();
  });
  // Hold a permanent error listener so a late server-level error (after the
  // one-shot listen handlers are removed) cannot crash the process. Socket
  // errors are handled per connection, and startup failures by the pending
  // bind.
  httpServer.on("error", () => undefined);
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
    const context = attachConnection(socket, handlers, beforeDispatch, deferredRequestCompletionMethods);
    onConnection?.(context);
  });

  const startHeartbeat = (): void => {
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
  };

  const stopHeartbeat = (): void => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const beginListening = (): Promise<AddressInfo> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off("listening", onListening);
        if (lifecycle === "starting") {
          lifecycle = "idle";
        }
        reject(error);
      };
      const onListening = (): void => {
        httpServer.off("error", onError);
        const address = httpServer.address();
        if (address === null || typeof address === "string") {
          if (lifecycle === "starting") {
            lifecycle = "idle";
          }
          reject(new Error("WebSocket server did not bind to a TCP address"));
          return;
        }

        boundAddress = address;
        if (lifecycle !== "starting") {
          // stop() began while the bind was completing. The listener must not
          // become usable, and shutdown closes it once this promise settles.
          reject(new Error("WebSocket server began stopping before it finished starting."));
          return;
        }

        lifecycle = "listening";
        startHeartbeat();
        resolve(address);
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      try {
        httpServer.listen(port, host);
      } catch (error) {
        httpServer.off("error", onError);
        httpServer.off("listening", onListening);
        if (lifecycle === "starting") {
          lifecycle = "idle";
        }
        reject(error instanceof Error ? error : new Error("WebSocket server failed to listen."));
      }
    });

  const start = (): Promise<AddressInfo> => {
    if (lifecycle === "stopping" || lifecycle === "stopped") {
      return Promise.reject(
        new Error("WebSocket server cannot be started after shutdown has begun."),
      );
    }
    if (lifecycle === "listening" && boundAddress !== null) {
      return Promise.resolve(boundAddress);
    }
    if (lifecycle === "starting" && startPromise !== null) {
      return startPromise;
    }

    lifecycle = "starting";
    const attempt = beginListening();
    startPromise = attempt;
    void attempt.then(undefined, () => {
      // A bind failure returns to `idle` so a later start can retry; shutdown
      // keeps the settled attempt for its own bookkeeping.
      if (lifecycle === "idle") {
        startPromise = null;
      }
    });
    return attempt;
  };

  const forceClose = (): void => {
    for (const socket of wsServer.clients) {
      socket.terminate();
    }
    wsServer.close();
    httpServer.closeAllConnections();
    httpServer.close();
  };

  const closeResources = async (): Promise<void> => {
    const closed = new Promise<void>((resolve) => {
      wsServer.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });

    interface DeadlineOutcome {
      readonly timedOut: true;
      readonly error?: Error;
    }

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<DeadlineOutcome>((resolve) => {
      timer = setTimeout(() => {
        try {
          forceClose();
          resolve({ timedOut: true });
        } catch (error) {
          resolve({
            timedOut: true,
            error: error instanceof Error ? error : new Error("Forced close failed."),
          });
        }
      }, shutdownTimeoutMs);
    });

    let outcome: DeadlineOutcome | { readonly timedOut: false };
    try {
      outcome = await Promise.race([
        closed.then((): { readonly timedOut: false } => ({ timedOut: false })),
        deadline,
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }

    if (outcome.timedOut) {
      if (outcome.error !== undefined) {
        throw outcome.error;
      }
      // Forced closure was initiated for clients or requests that outlasted
      // the deadline. Await local release confirmation so a resolved stop()
      // means the listener and its connections are actually gone; a remote
      // peer observing the close handshake is not guaranteed.
      await closed;
    }
  };

  const performShutdown = async (): Promise<void> => {
    const wasStarting = lifecycle === "starting";
    lifecycle = "stopping";
    stopHeartbeat();

    // A bind still in flight must settle before shutdown can close it, so a
    // listener cannot appear after stop() reports completion. beginListening
    // rejects its promise when it observes `stopping`.
    if (wasStarting && startPromise !== null) {
      await startPromise.catch(() => undefined);
    }

    for (const socket of wsServer.clients) {
      socket.close(WEBSOCKET_CLOSE_GOING_AWAY, "Server shutting down");
    }

    if (boundAddress !== null) {
      await closeResources();
    }

    lifecycle = "stopped";
  };

  const stop = (): Promise<void> => {
    shutdownPromise ??= performShutdown();
    return shutdownPromise;
  };

  return { start, stop };
};

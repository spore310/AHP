import type { AddressInfo } from "node:net";

import type { JsonRpcMessage, JsonRpcParams } from "@jsonrpc";

/** Per-connection surface handed to JSON-RPC method handlers. */
export interface WebSocketConnectionContext {
  /** Identifier for the connection, unique within the server. */
  readonly connectionId: string;
  /**
   * Send a JSON-RPC message to this connection. A no-op once the connection
   * is no longer open.
   */
  send(message: JsonRpcMessage): void;
}

/**
 * Handles a single JSON-RPC method on a connection.
 *
 * Return value becomes the JSON-RPC `result` for a request. Throwing surfaces a
 * JSON-RPC error to the caller instead of a result.
 */
export type JsonRpcHandler = (
  params: JsonRpcParams,
  context: WebSocketConnectionContext,
) => unknown;

/** JSON-RPC methods the server can dispatch, keyed by method name. */
export type JsonRpcHandlers = Readonly<Record<string, JsonRpcHandler>>;

/** Options for {@link createWebSocketServer}. */
export interface WebSocketServerOptions {
  /** Network interface to bind. */
  readonly host: string;
  /** TCP port to bind. Use `0` to request an ephemeral port. */
  readonly port: number;
  /** HTTP path the upgrade request must target. Defaults to `/`. */
  readonly path?: string;
  /** JSON-RPC methods to dispatch. Unknown methods answer `MethodNotFound`. */
  readonly handlers?: JsonRpcHandlers;
  /**
   * Upper bound on graceful shutdown before remaining clients and connections
   * are force-closed. Shutdown still waits for local release after a forced
   * close. Defaults to `WEBSOCKET_SHUTDOWN_TIMEOUT_MS`.
   */
  readonly shutdownTimeoutMs?: number;
}

/** Handle returned by {@link createWebSocketServer}. */
export interface WebSocketServerHandle {
  /**
   * Begin listening and resolve with the bound address. Concurrent calls share
   * a single bind. A start still in flight when {@link stop} runs rejects, and
   * a stopped server is terminal, so later calls reject.
   */
  start(): Promise<AddressInfo>;
  /**
   * Stop accepting new upgrades, close every client, and release HTTP
   * resources. Concurrent and repeated calls share one completion.
   *
   * The promise resolves only after local resources are released: no listener,
   * client, or heartbeat remains afterwards. Clients and open HTTP requests get
   * up to the configured deadline to close; once it elapses, remaining
   * resources are force-closed and shutdown still awaits local release. A slow
   * remote peer is not guaranteed to observe the close handshake. Rejects only
   * if a forced close throws.
   */
  stop(): Promise<void>;
}

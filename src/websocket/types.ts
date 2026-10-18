import type { AddressInfo } from "node:net";

import type { JsonRpcMessage, JsonRpcParams } from "@/jsonrpc";

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
}

/** Handle returned by {@link createWebSocketServer}. */
export interface WebSocketServerHandle {
  /** Begin listening and resolve with the bound address. */
  start(): Promise<AddressInfo>;
  /** Stop listening and close every client, resolving once fully shut down. */
  stop(): Promise<void>;
}

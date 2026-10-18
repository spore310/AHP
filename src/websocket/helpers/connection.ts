import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type WebSocket from "ws";

import {
  isRpcError,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  JSONRPC_PUBLIC_ERROR_CODES,
  JSONRPC_VERSION,
  jsonRpcMessageSchema,
  type JsonRpcErrorResponse,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcRequestId,
  type JsonRpcResponseId,
  type JsonRpcResultResponse,
} from "@/jsonrpc";

import { WEBSOCKET_CLOSE_UNSUPPORTED_DATA } from "../constants";
import type {
  JsonRpcHandler,
  JsonRpcHandlers,
  WebSocketConnectionContext,
} from "../types";

const resultResponse = (id: JsonRpcRequestId, result: unknown): JsonRpcResultResponse => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  result: result === undefined ? null : result,
});

const errorResponse = (
  id: JsonRpcResponseId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

// Only own, callable handler properties are dispatchable. A plain object also
// exposes inherited members (`toString`, `constructor`, ...), which must not be
// reachable as methods.
const lookupHandler = (
  handlers: JsonRpcHandlers,
  method: string,
): JsonRpcHandler | undefined => {
  if (!Object.hasOwn(handlers, method)) {
    return undefined;
  }
  const handler = handlers[method];
  return typeof handler === "function" ? handler : undefined;
};

const frameToText = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};

// Recover a request id from an otherwise invalid message so the error response
// can be correlated, per JSON-RPC 2.0. Falls back to null when unusable.
const extractRequestId = (value: unknown): JsonRpcRequestId | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (!("id" in value)) {
    return null;
  }
  const { id } = value;
  if (typeof id === "string") {
    return id;
  }
  if (typeof id === "number" && Number.isInteger(id)) {
    return id;
  }
  return null;
};

const handleRequest = async (
  request: JsonRpcRequest,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
): Promise<void> => {
  const handler = lookupHandler(handlers, request.method);
  if (handler === undefined) {
    context.send(errorResponse(request.id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${request.method}`));
    return;
  }

  try {
    const result = await handler(request.params, context);
    context.send(resultResponse(request.id, result));
  } catch (cause) {
    // Handler validation failures are the caller's fault; an owned RPC error
    // preserves its allowlisted code and message. Anything else is reported
    // generically so internal details do not leak to the client.
    if (cause instanceof ZodError) {
      context.send(errorResponse(request.id, JSONRPC_INVALID_PARAMS, "Invalid params"));
      return;
    }
    if (isRpcError(cause) && JSONRPC_PUBLIC_ERROR_CODES.has(cause.code)) {
      context.send(errorResponse(request.id, cause.code, cause.message, cause.data));
      return;
    }
    context.send(errorResponse(request.id, JSONRPC_INTERNAL_ERROR, "Internal error"));
  }
};

const handleNotification = async (
  notification: JsonRpcNotification,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
): Promise<void> => {
  const handler = lookupHandler(handlers, notification.method);
  if (handler === undefined) {
    return;
  }
  try {
    await handler(notification.params, context);
  } catch {
    // Notifications have no reply channel; failures are intentionally dropped.
  }
};

const handleFrame = async (
  text: string,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
): Promise<void> => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    context.send(errorResponse(null, JSONRPC_PARSE_ERROR, "Parse error"));
    return;
  }

  const { data: message } = jsonRpcMessageSchema.safeParse(decoded);
  if (!message) {
    context.send(errorResponse(extractRequestId(decoded), JSONRPC_INVALID_REQUEST, "Invalid Request"));
    return;
  }

  if ("method" in message) {
    if ("id" in message) {
      await handleRequest(message, context, handlers);
    } else {
      await handleNotification(message, context, handlers);
    }
    return;
  }

  // Responses are not expected from a client on this transport; drop them.
};

/**
 * Wire JSON-RPC handling onto an accepted socket.
 *
 * Text frames are parsed and dispatched; binary frames close the connection.
 * Attaches an `error` listener so socket failures surface as a close rather
 * than an unhandled event.
 */
export const attachConnection = (socket: WebSocket, handlers: JsonRpcHandlers): void => {
  const context: WebSocketConnectionContext = {
    connectionId: randomUUID(),
    send: (message: JsonRpcMessage) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
  };

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      socket.close(WEBSOCKET_CLOSE_UNSUPPORTED_DATA, "Binary frames are not supported");
      return;
    }
    void handleFrame(frameToText(data), context, handlers);
  });

  socket.on("error", () => {
    // Socket errors are followed by a close event; no additional handling.
  });
};

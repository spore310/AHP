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
  parseUnknownJson,
  type JsonRpcErrorResponse,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcRequestId,
  type JsonRpcResponseId,
  type JsonRpcResultResponse,
} from "@jsonrpc";

import { WEBSOCKET_CLOSE_UNSUPPORTED_DATA } from "../constants";
import type {
  JsonRpcHandler,
  JsonRpcHandlers,
  JsonRpcInvocation,
  ReplySettlement,
  WebSocketConnectionContext,
  WebSocketDispatchContext,
} from "../types";

interface Invocation extends JsonRpcInvocation {
  settle(settlement: ReplySettlement): void;
}

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
// reachable as methods. Lifecycle names are never wire methods.
const lookupHandler = (
  handlers: JsonRpcHandlers,
  method: string,
): JsonRpcHandler | undefined => {
  if (method.startsWith("__") || method === "dispose" || !Object.hasOwn(handlers, method)) {
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

const createInvocation = (kind: JsonRpcInvocation["kind"]): Invocation => {
  const listeners = new Set<(settlement: ReplySettlement) => void>();
  let settled = false;

  return {
    kind,
    onReplySettled: (listener: (settlement: ReplySettlement) => void): void => {
      listeners.add(listener);
    },
    settle: (settlement: ReplySettlement): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const listener of [...listeners]) {
        try {
          listener(settlement);
        } catch {
          // One listener cannot block the others or the socket loop.
        }
      }
    },
  };
};

const sendMappedError = (
  context: WebSocketConnectionContext,
  id: JsonRpcResponseId,
  cause: unknown,
): boolean => {
  if (cause instanceof ZodError) {
    return context.send(errorResponse(id, JSONRPC_INVALID_PARAMS, "Invalid params"));
  }
  if (isRpcError(cause) && JSONRPC_PUBLIC_ERROR_CODES.has(cause.code)) {
    return context.send(errorResponse(id, cause.code, cause.message, cause.data));
  }
  return context.send(errorResponse(id, JSONRPC_INTERNAL_ERROR, "Internal error"));
};

const handleRequest = async (
  request: JsonRpcRequest,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
  beforeDispatch: ((dispatch: WebSocketDispatchContext) => void) | undefined,
): Promise<void> => {
  const invocation = createInvocation("request");
  try {
    beforeDispatch?.({
      kind: "request",
      method: request.method,
      params: request.params,
      context,
      invocation,
    });
  } catch (cause) {
    const responseSent = sendMappedError(context, request.id, cause);
    invocation.settle({ outcome: "failure", responseSent });
    return;
  }

  const handler = lookupHandler(handlers, request.method);
  if (handler === undefined) {
    const responseSent = context.send(errorResponse(
      request.id,
      JSONRPC_METHOD_NOT_FOUND,
      `Method not found: ${request.method}`,
    ));
    invocation.settle({ outcome: "failure", responseSent });
    return;
  }

  try {
    const result = await handler(request.params, context, invocation);
    const responseSent = context.send(resultResponse(request.id, result));
    invocation.settle({ outcome: "success", responseSent });
  } catch (cause) {
    const responseSent = sendMappedError(context, request.id, cause);
    invocation.settle({ outcome: "failure", responseSent });
  }
};

const handleNotification = async (
  notification: JsonRpcNotification,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
  beforeDispatch: ((dispatch: WebSocketDispatchContext) => void) | undefined,
): Promise<void> => {
  const invocation = createInvocation("notification");
  try {
    beforeDispatch?.({
      kind: "notification",
      method: notification.method,
      params: notification.params,
      context,
      invocation,
    });
  } catch {
    invocation.settle({ outcome: "failure", responseSent: false });
    return;
  }

  const handler = lookupHandler(handlers, notification.method);
  if (handler === undefined) {
    invocation.settle({ outcome: "success", responseSent: false });
    return;
  }

  try {
    await handler(notification.params, context, invocation);
    invocation.settle({ outcome: "success", responseSent: false });
  } catch {
    // Notifications have no reply channel; failures are intentionally dropped.
    invocation.settle({ outcome: "failure", responseSent: false });
  }
};

const handleFrame = async (
  text: string,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
  beforeDispatch: ((dispatch: WebSocketDispatchContext) => void) | undefined,
): Promise<void> => {
  let decoded: unknown;
  try {
    decoded = parseUnknownJson(text);
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
      await handleRequest(message, context, handlers, beforeDispatch);
    } else {
      await handleNotification(message, context, handlers, beforeDispatch);
    }
  }

  // Responses are not expected from a client on this transport; drop them.
};

/**
 * Wire JSON-RPC handling onto an accepted socket.
 *
 * Text frames are parsed and dispatched one at a time so a fatal reply can
 * settle before the next frame on this socket runs. Binary frames close the
 * connection. Attaches an `error` listener so socket failures surface as a
 * close rather than an unhandled event.
 */
export const attachConnection = (
  socket: WebSocket,
  handlers: JsonRpcHandlers,
  beforeDispatch?: (dispatch: WebSocketDispatchContext) => void,
): WebSocketConnectionContext => {
  const closeHandlers = new Set<() => void>();
  let closed = false;
  let tail: Promise<void> = Promise.resolve();

  const context: WebSocketConnectionContext = {
    connectionId: randomUUID(),
    send: (message: JsonRpcMessage): boolean => {
      if (closed || socket.readyState !== socket.OPEN) {
        return false;
      }
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    onClose: (handler: () => void): void => {
      if (closed) {
        try {
          handler();
        } catch {
          // Intentionally isolated; close cleanup must never throw.
        }
        return;
      }
      closeHandlers.add(handler);
    },
    close: (): void => {
      try {
        socket.close();
      } catch {
        // Best effort only. The close event still runs local cleanup.
      }
    },
  };

  const runCloseHandlers = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    for (const handler of [...closeHandlers]) {
      try {
        handler();
      } catch {
        // Intentionally isolated; close cleanup must never throw.
      }
    }
    closeHandlers.clear();
  };

  socket.on("message", (data, isBinary) => {
    tail = tail.then(async () => {
      if (closed) {
        return;
      }
      if (isBinary) {
        socket.close(WEBSOCKET_CLOSE_UNSUPPORTED_DATA, "Binary frames are not supported");
        return;
      }
      await handleFrame(frameToText(data), context, handlers, beforeDispatch);
    }).catch(() => undefined);
  });

  socket.on("close", () => {
    runCloseHandlers();
  });

  socket.on("error", () => {
    // Socket errors are followed by a close event; no additional handling.
  });

  return context;
};

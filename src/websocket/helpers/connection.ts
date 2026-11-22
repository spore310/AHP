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
  jsonRpcParamsSchema,
  parseUnknownJson,
  type JsonRpcErrorResponse,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcParams,
  type JsonRpcRequest,
  type JsonRpcRequestId,
  type JsonRpcResponseId,
  type JsonRpcResultResponse,
} from "@jsonrpc";

import { WEBSOCKET_CLOSE_UNSUPPORTED_DATA } from "../constants";
import type { AuthenticatedPrincipal } from "@agents";
import type { ConnectionAttachment } from "./security/types";
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
  admitReply(): boolean;
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
  let replyGuard: (() => boolean) | undefined;

  return {
    kind,
    guardReply: (admission) => {
      if (kind !== "request" || settled || replyGuard !== undefined || typeof admission !== "function") throw new Error("Reply guard unavailable");
      replyGuard = admission;
    },
    admitReply: () => {
      try {
        const allowed: unknown = replyGuard?.() ?? (replyGuard === undefined);
        if (allowed !== true) void Promise.resolve(allowed).catch(() => undefined);
        return !settled && allowed === true;
      } catch {
        return false;
      }
    },
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
    let admitted = true;
    const denied = () => !admitted;
    const responseSent = context.send(resultResponse(request.id, result), () => {
      admitted = invocation.admitReply();
      return admitted;
    });
    if (denied()) {
      const errorSent = context.send(errorResponse(request.id, JSONRPC_INVALID_PARAMS, "Protected reply unavailable"));
      invocation.settle({ outcome: "failure", responseSent: errorSent });
    } else invocation.settle({ outcome: "success", responseSent });
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

const frameMethod = (text: string): {
  readonly method: string;
  readonly kind: "request" | "notification";
  readonly params: JsonRpcParams;
} | undefined => {
  try {
    const value = parseUnknownJson(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const frame = value as Record<string, unknown>;
    if (typeof frame.method !== "string") return undefined;
    const parsedParams = jsonRpcParamsSchema.safeParse(frame.params);
    if (!parsedParams.success) return undefined;
    return {
      method: frame.method,
      kind: Object.hasOwn(frame, "id") ? "request" : "notification",
      params: parsedParams.data,
    };
  } catch {
    return undefined;
  }
};

const handleFrame = async (
  text: string,
  context: WebSocketConnectionContext,
  handlers: JsonRpcHandlers,
  beforeDispatch: ((dispatch: WebSocketDispatchContext) => void) | undefined,
  deferredRequests: ReadonlySet<string>,
  onDeferredRequest: (method: string, promise: Promise<void>) => void,
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
      const request = handleRequest(message, context, handlers, beforeDispatch);
      if (deferredRequests.has(message.method)) {
        onDeferredRequest(message.method, request);
        return;
      }
      await request;
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
  deferredRequestCompletionMethods: ReadonlyMap<string, import("../types").DeferredRequestCompletionRule> = new Map(),
  principal?: AuthenticatedPrincipal,
  attachment?: ConnectionAttachment,
): WebSocketConnectionContext => {
  const closeHandlers = new Set<() => void>();
  let closed = false;
  let processingFrame = false;
  const deferredRequests = new Set(deferredRequestCompletionMethods.keys());
  const pendingDeferredRequests = new Map<Promise<void>, string>();
  const queuedFrames: string[] = [];

  const setup = attachment?.setup;
  const isCurrent = setup?.isCurrent.bind(setup);
  const socketOpen = () => !closed && socket.readyState === socket.OPEN;
  const context: WebSocketConnectionContext = {
    connectionId: attachment?.fence.connectionId ?? randomUUID(),
    connectionGeneration: attachment?.fence.connectionGeneration ?? 1,
    ...(setup === undefined ? {} : { security: setup.snapshot }),
    isOpen: socketOpen,
    isSecurityCurrent: (): boolean => {
      try {
        const live: unknown = isCurrent?.();
        return live === true && !closed && socket.readyState === socket.OPEN;
      } catch {
        return false;
      }
    },
    ...(principal !== undefined ? { principal } : {}),
    send: (message: JsonRpcMessage, admission?: () => boolean): boolean => {
      if (!socketOpen()) {
        return false;
      }
      let encoded: string;
      try {
        encoded = JSON.stringify(message);
      } catch {
        return false;
      }
      if (setup !== undefined) {
        let current = false;
        try {
          current = isCurrent?.() === true;
        } catch {
          // A failed synchronous guard cannot authorize output.
        }
        if (!current) {
          try {
            socket.close();
          } catch {
            // The close/error path still owns local cleanup.
          }
          return false;
        }
      }
      if (admission !== undefined) {
        try {
          const allowed: unknown = admission();
          if (allowed !== true) {
            void Promise.resolve(allowed).catch(() => undefined);
            return false;
          }
        } catch {
          return false;
        }
      }
      if (!socketOpen()) return false;
      // No await between the final currentness check and local enqueue.
      try {
        socket.send(encoded);
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
    queuedFrames.length = 0;
    for (const handler of [...closeHandlers]) {
      try {
        handler();
      } catch {
        // Intentionally isolated; close cleanup must never throw.
      }
    }
    closeHandlers.clear();
  };

  const dispatchDeferred = (method: string, request: Promise<void>): void => {
    pendingDeferredRequests.set(request, method);
    void request.then(() => {
      pendingDeferredRequests.delete(request);
      pumpFrames();
    }, () => {
      pendingDeferredRequests.delete(request);
      pumpFrames();
    });
  };

  const pumpFrames = (): void => {
    if (closed || processingFrame || queuedFrames.length === 0) return;
    let nextIndex = 0;
    if (pendingDeferredRequests.size > 0) {
      const head = frameMethod(queuedFrames[0] ?? "");
      const headIsDeferredRequest = head?.kind === "request" && deferredRequests.has(head.method);
      if (!headIsDeferredRequest) {
        nextIndex = queuedFrames.findIndex((text) => {
          const frame = frameMethod(text);
          return frame?.kind === "notification" && [...pendingDeferredRequests.values()].some((requestMethod) => {
            const rule = deferredRequestCompletionMethods.get(requestMethod);
            if (rule === undefined || rule.method !== frame.method) return false;
            try {
              return rule.matches(frame.params, context);
            } catch {
              // A broken application matcher must not escape the socket loop
              // or grant permission to bypass ordered frames.
              return false;
            }
          });
        });
        if (nextIndex < 0) return;
      }
    }
    const [text] = queuedFrames.splice(nextIndex, 1);
    if (text === undefined) return;
    processingFrame = true;
    void handleFrame(text, context, handlers, beforeDispatch, deferredRequests, dispatchDeferred).then(() => {
      processingFrame = false;
      pumpFrames();
    }, () => {
      processingFrame = false;
      pumpFrames();
    });
  };

  socket.on("message", (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      socket.close(WEBSOCKET_CLOSE_UNSUPPORTED_DATA, "Binary frames are not supported");
      return;
    }
    if (queuedFrames.length >= 256) {
      socket.close(1013, "Too many queued frames");
      return;
    }
    queuedFrames.push(frameToText(data));
    pumpFrames();
  });

  socket.on("close", () => {
    runCloseHandlers();
  });

  socket.on("error", () => {
    // Socket errors are followed by a close event; no additional handling.
  });

  return context;
};

import WebSocket from "ws";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { RpcError, parseUnknownJson, type JsonRpcMessage } from "@jsonrpc";
import { WEBSOCKET_MAX_PAYLOAD_BYTES } from "@websocket/constants";
import type { HostLink, HostLinkOptions } from "./types";

/** Every transport failure collapses to this. It never names an endpoint, a credential or a peer error. */
export const routeUnavailable = (): RpcError => new RpcError(JsonRpcErrorCodes.InternalError, "Routed request unavailable");
/** The owner may have applied the request. Reconcile with an authorized read or an idempotent retry. */
export const routeOutcomeUnknown = (): RpcError => new RpcError(JsonRpcErrorCodes.InternalError, "Routed request outcome unknown");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const frameToText = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};

/**
 * Opens one authenticated JSON-RPC link to another host over WebSocket.
 *
 * A link belongs to exactly one public connection and one destination. It has
 * a bounded pending-request table and one deadline per request. A request that
 * times out closes the link, so a late reply can never be mistaken for a
 * current one.
 */
export const openHostLink = (options: HostLinkOptions): Promise<HostLink> => new Promise((resolve, reject) => {
  const socket = new WebSocket(options.endpoint, {
    headers: options.headers, maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES, handshakeTimeout: options.connectTimeoutMs,
    followRedirects: false, perMessageDeflate: false, ...(options.tls === undefined ? {} : options.tls),
  });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; sent: boolean; after?: Promise<void>; ordered: boolean }>();
  // Frames are handled strictly in arrival order, one at a time.
  const inbox: Record<string, unknown>[] = [];
  let draining = false;
  const closeHandlers = new Set<() => void>();
  let nextId = 1;
  let opened = false;
  let closed = false;
  const isClosed = (): boolean => closed;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      // Once the frame left this process the owner may already have committed.
      entry.reject(entry.sent ? routeOutcomeUnknown() : routeUnavailable());
    }
    pending.clear();
    try {
      socket.terminate();
    } catch { /* Already released. */ }
    for (const handler of [...closeHandlers]) {
      try {
        handler();
      } catch { /* One listener cannot keep the link open. */ }
    }
    closeHandlers.clear();
    if (!opened) reject(routeUnavailable());
  };
  const link: HostLink = {
    hostId: options.hostId,
    isOpen: () => !closed && socket.readyState === WebSocket.OPEN,
    pending: () => pending.size,
    request(method, params, after, ordered = false) {
      if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(routeUnavailable());
      if (pending.size >= options.maxPending) return Promise.reject(new RpcError(JsonRpcErrorCodes.InternalError, "Routed request capacity unavailable"));
      const id = nextId++;
      return new Promise((done, fail) => {
        const entry = { resolve: done, reject: fail, sent: false, ordered, ...(after === undefined ? {} : { after }), timer: setTimeout(() => {
          // The deadline ends the whole link: nothing later on it can be trusted to be current.
          close();
        }, options.requestTimeoutMs) };
        pending.set(id, entry);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), (error) => {
          if (error) close();
          else entry.sent = true;
        });
      });
    },
    notify(method, params) {
      if (closed || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }), (error) => {
        if (error) close();
      });
      return true;
    },
    onClose(handler) {
      if (closed) handler();
      else closeHandlers.add(handler);
    },
    close,
  };
  socket.on("open", () => {
    opened = true;
    resolve(link);
  });
  socket.on("message", (data, binary) => {
    if (binary) {
      close();
      return;
    }
    let message: unknown;
    try {
      message = parseUnknownJson(frameToText(data));
    } catch {
      close();
      return;
    }
    if (!isRecord(message) || message.jsonrpc !== "2.0") {
      close();
      return;
    }
    if (inbox.length + held.length >= 4_096) {
      close();
      return;
    }
    inbox.push(message);
    drain();
  });
  let holds = 0;
  const held: Record<string, unknown>[] = [];
  const hold = (after: Promise<void>): void => {
    holds += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      holds -= 1;
      if (holds === 0) {
        inbox.unshift(...held.splice(0));
        drain();
      }
    };
    const timer = setTimeout(release, options.requestTimeoutMs);
    void after.then(release, release);
  };
  const drain = (): void => {
    if (draining) return;
    draining = true;
    try {
      for (let message = inbox.shift(); message !== undefined && !isClosed(); message = inbox.shift()) {
        const notification = typeof message.method === "string";
        const entry = !notification && typeof message.id === "number" ? pending.get(message.id) : undefined;
        // While a forwarded reply is on its way to the caller, everything this peer sent after it
        // waits: notifications and ordering confirmations. Replies to other requests do not wait,
        // so one caller request can make several requests on this link.
        if (holds > 0 && (notification || entry?.ordered === true)) {
          held.push(message);
          continue;
        }
        if (notification) {
          // Hosts never send requests to each other on this link, only notifications.
          if (message.id === undefined) options.onNotification(message as unknown as JsonRpcMessage);
          continue;
        }
        if (entry === undefined || typeof message.id !== "number") continue;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        const error = message.error;
        if (isRecord(error) && typeof error.code === "number" && typeof error.message === "string") entry.reject(new RpcError(error.code, error.message, error.data));
        else if ("result" in message) entry.resolve(message.result);
        else entry.reject(routeUnavailable());
        if (entry.after !== undefined) hold(entry.after);
      }
    } finally {
      draining = false;
    }
  };
  socket.on("error", close);
  socket.on("close", close);
  socket.on("unexpected-response", close);
});

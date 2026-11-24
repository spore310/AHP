import { WorkError, type WorkRequestContext } from "@work";
import type { WebSocketConnectionContext } from "../../types";

const lifetimes = new WeakMap<WebSocketConnectionContext, AbortController>();

export function workConnection(connection: WebSocketConnectionContext): WorkRequestContext {
  const setup = connection.security;
  if (!setup || connection.isSecurityCurrent?.() !== true) throw new WorkError("unauthorized", "Work is unavailable.");
  let lifetime = lifetimes.get(connection);
  if (!lifetime) {
    lifetime = new AbortController();
    lifetimes.set(connection, lifetime);
    const owned = lifetime;
    connection.onClose(() => {
      owned.abort();
    });
  }
  return { context: setup.context, signal: lifetime.signal,
    isCurrent: () => connection.security === setup && connection.isSecurityCurrent?.() === true && !lifetime.signal.aborted };
}

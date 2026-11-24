import type { Client } from "@client";
import type { WorkExtensionPort } from "./types";

const ports = new WeakMap<Client, WorkExtensionPort>();

/** One owner per private work notification on this SDK connection. */
export function createWorkPort(connection: Client): WorkExtensionPort {
  const cached = ports.get(connection);
  if (cached) return cached;
  const groups = new Map<string, { listeners: Set<(params: unknown) => unknown>; release(): void }>();
  let count = 0;
  const port: WorkExtensionPort = {
    request: (method, params, timeoutMs, signal, releaseLate) => connection.rpc.request(method, params, { timeoutMs, signal, releaseLate }),
    onClose: (receive) => connection.lifetime.addCleanup(receive),
    onNotification(method, receive) {
      if (connection.lifetime.signal.aborted || count >= 64 || !["x-ahp/work/changed", "x-ahp/work/reset"].includes(method)) throw new Error("Work observer unavailable.");
      let group = groups.get(method);
      if (!group) {
        const listeners = new Set<(params: unknown) => unknown>();
        const release = connection.rpc.onNotification(method, (params) => {
          for (const listener of [...listeners]) {
            if (!listeners.has(listener)) continue;
            try {
              void Promise.resolve(listener(params)).catch(() => undefined);
            } catch { /* Isolate work projections on this connection. */ }
          }
        });
        group = { listeners, release };
        groups.set(method, group);
      }
      if (group.listeners.has(receive)) throw new Error("Duplicate work observer.");
      group.listeners.add(receive);
      count++;
      return () => {
        if (!group.listeners.delete(receive)) return;
        count--;
        if (!group.listeners.size) {
          group.release();
          groups.delete(method);
        }
      };
    },
  };
  connection.lifetime.addCleanup(() => {
    for (const group of groups.values()) {
      group.listeners.clear();
      group.release();
    }
    groups.clear();
    ports.delete(connection);
  });
  ports.set(connection, port);
  return port;
}

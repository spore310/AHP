import type { WorkEvent, WorkEventPublisher } from "./types";

export function createWorkEventPublisher(onFailure?: () => void): WorkEventPublisher {
  const listeners = new Map<(event: WorkEvent) => unknown, { busy: boolean }>();
  let disposed = false;
  const failed = () => {
    try {
      void Promise.resolve(onFailure?.()).catch(() => undefined);
    } catch { /* Diagnostic sinks are optional. */ }
  };
  return {
    publish(event) {
      if (disposed || listeners.size === 0) return;
      const { type, workId, revision, occurredAt } = event;
      const { domainId, kind, id, instanceId } = event.session;
      const value = Object.freeze({
        version: 1 as const, type, workId, revision, occurredAt,
        session: Object.freeze({ domainId, kind, id, instanceId }),
      });
      for (const [listener, entry] of [...listeners]) {
        if (entry.busy || listeners.get(listener) !== entry) continue;
        entry.busy = true;
        try {
          const result = listener(value);
          if (((typeof result === "object" && result !== null) || typeof result === "function") && "then" in result) {
            void Promise.resolve(result).catch(failed).finally(() => {
              entry.busy = false;
            });
          } else entry.busy = false;
        } catch {
          entry.busy = false;
          failed();
        }
      }
    },
    subscribe(listener) {
      if (disposed || listeners.has(listener) || listeners.size >= 128) throw new Error("Work event listener unavailable.");
      const entry = { busy: false };
      listeners.set(listener, entry);
      return () => {
        if (listeners.get(listener) === entry) listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

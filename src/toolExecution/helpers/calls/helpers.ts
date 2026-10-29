import { randomUUID } from "node:crypto";
import { captureToolValue } from "@toolExecution/helpers/value";
import type { ToolDispatchOutcome } from "@toolExecution/helpers/dispatcher";
import type { PrivateToolCallEntry as Entry, PrivateToolCallLimits, PrivateToolCallOptions, PrivateToolCalls } from "./types";

const defaults: PrivateToolCallLimits = { maxRecords: 256, maxOutputBytes: 1024 * 1024, maxRetainedBytes: 16 * 1024 * 1024, ttlMs: 60_000 };
const maximum: PrivateToolCallLimits = { maxRecords: 1024, maxOutputBytes: 16 * 1024 * 1024, maxRetainedBytes: 256 * 1024 * 1024, ttlMs: 120_000 };

/** Disclosure retention only. The dispatcher separately owns execution/draining capacity. */
export function createPrivateToolCalls(options: PrivateToolCallOptions = {}): PrivateToolCalls {
  const limits = { ...defaults, ...options.limits };
  if (Object.keys(limits).some((key) => !Object.hasOwn(defaults, key))) throw new TypeError("Unknown private call limit.");
  for (const key of Object.keys(defaults) as Array<keyof PrivateToolCallLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum[key]) throw new TypeError("Invalid private call limit.");
  }
  const now = options.now === undefined ? Date.now.bind(Date) : options.now.bind(options);
  const entries = new Map<string, Entry>();
  let closed = false;
  let retainedBytes = 0;
  let lastTime = Number.NEGATIVE_INFINITY;
  const owned = (entry: Entry): boolean => !closed && entries.get(entry.callId) === entry;
  const cancelWork = (entry: Entry): void => {
    try {
      entry.handle?.cancel();
    } catch {
      /* Cleanup of other records still runs. */

    }
  };
  const remove = (entry: Entry): void => {
    if (entries.get(entry.callId) !== entry) return;
    entries.delete(entry.callId);
    retainedBytes -= entry.bytes;
    entry.bytes = 0;
    clearTimeout(entry.timer);
    entry.admission.resolve(false);
    if (!entry.finished) cancelWork(entry);
  };
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    for (const entry of [...entries.values()]) remove(entry);
  };
  const clock = (): number => {
    let time: number;
    try {
      time = now();
    } catch {
      dispose();
      throw new TypeError("Invalid private call clock.");
    }
    if (!Number.isFinite(time) || time < lastTime) {
      dispose();
      throw new TypeError("Invalid private call clock.");
    }
    lastTime = time;
    for (const entry of [...entries.values()]) if (time >= entry.expiresAt) remove(entry);
    return time;
  };
  const state = (entry: Entry, status: "waiting" | "running" | "draining" | "failed" | "cancelled"): void => {
    entry.status = Object.freeze({ version: 2, callId: entry.callId, status });
  };
  const live = (entry: Entry): boolean => {
    if (!owned(entry)) return false;
    try {
      clock();
      return owned(entry);
    } catch {
      return false;
    }
  };
  const acceptResult = (entry: Entry, outcome: ToolDispatchOutcome<unknown>): void => {
    if (!live(entry) || entry.resultSeen) return;
    entry.resultSeen = true;
    entry.admission.resolve(false);
    if (entry.cancelled) {
      state(entry, entry.finished ? "cancelled" : "draining");
      return;
    }
    if (outcome.status !== "succeeded") {
      entry.cancelled = outcome.code === "cancelled";
      state(entry, entry.finished ? (entry.cancelled ? "cancelled" : "failed") : "draining");
      return;
    }
    try {
      const captured = captureToolValue(outcome.output, { maxBytes: limits.maxOutputBytes, maxDepth: 64, maxKeys: 131072 });
      if (!owned(entry) || retainedBytes + captured.bytes > limits.maxRetainedBytes) {
        state(entry, "failed");
        return;
      }
      entry.bytes = captured.bytes;
      retainedBytes += captured.bytes;
      entry.status = Object.freeze({ version: 2, callId: entry.callId, status: "completed", output: captured.value });
    } catch {
      state(entry, "failed");
    }
  };
  return Object.freeze<PrivateToolCalls>({
    start(owner, start) {
      const time = clock();
      if (closed || entries.size >= limits.maxRecords) return undefined;
      const callId = randomUUID();
      const admission = Promise.withResolvers<boolean>();
      const entry: Entry = { callId, owner, expiresAt: time + limits.ttlMs, admission,
        status: Object.freeze({ version: 2, callId, status: "waiting" }), bytes: 0, cancelled: false, finished: false, resultSeen: false };
      entries.set(callId, entry);
      entry.timer = setTimeout(() => {
        remove(entry);
      }, limits.ttlMs);
      entry.timer.unref();
      try {
        const handle = start(callId);
        entry.handle = handle;
        if (!owned(entry)) cancelWork(entry);
        void handle.admitted.then((allowed) => {
          if (!live(entry) || entry.cancelled || entry.resultSeen) {
            admission.resolve(false);
            return;
          }
          const verdict: unknown = allowed;
          if (verdict !== true) {
            admission.resolve(false);
            return;
          }
          state(entry, "running");
          admission.resolve(true);
        }, () => {
          admission.resolve(false);
        });
        void handle.result.then((outcome) => {
          acceptResult(entry, outcome);
        }, () => {
          if (owned(entry)) {
            entry.resultSeen = true;
            state(entry, "failed");
          }
          admission.resolve(false);
        });
        void handle.settled.then((outcome) => {
          entry.finished = true;
          if (!owned(entry)) return;
          acceptResult(entry, outcome);
          if (entry.status.status === "draining") state(entry, entry.cancelled ? "cancelled" : "failed");
        }, () => {
          entry.finished = true;
          if (owned(entry)) state(entry, entry.cancelled ? "cancelled" : "failed");
          admission.resolve(false);
        });
      } catch {
        remove(entry);
      }
      return Object.freeze({ callId, admitted: admission.promise });
    },
    read(callId, owner) {
      clock();
      const entry = entries.get(callId);
      if (entry === undefined || entry.owner !== owner || !owned(entry)) return undefined;
      const status = entry.status;
      const fence = (): boolean => owned(entry) && entry.status === status;
      return Object.freeze({ status, fence, current: () => {
        clock();
        return fence();
      } });
    },
    cancel(callId, owner) {
      clock();
      const entry = entries.get(callId);
      if (entry === undefined || entry.owner !== owner || !owned(entry)) return false;
      if (entry.finished || entry.cancelled) return true;
      entry.cancelled = true;
      retainedBytes -= entry.bytes;
      entry.bytes = 0;
      entry.admission.resolve(false);
      state(entry, "draining");
      cancelWork(entry);
      return true;
    },
    forget(owner) {
      for (const entry of [...entries.values()]) if (entry.owner === owner) remove(entry);
    },
    dispose,
    stats() {
      clock();
      return { records: entries.size, retainedBytes };
    },
  });
}

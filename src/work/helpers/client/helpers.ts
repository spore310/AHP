import type { Client } from "@client";
import { createWorkPort } from "./port";
import type { WorkListSummary } from "../commands/types";
import { workSubscribeSchema } from "../views/schemas";
import { capturePage, hintSchema, pageSchema, resetSchema, subscribedSchema } from "./schemas";
import type { WorkClient, WorkClientOptions, WorkClientSnapshot, WorkExtensionPort, WorkViewSubscription } from "./types";

const method = (name: string) => "x-ahp/work/" + name;
interface ScanBudget {
  readonly deadline: number;
  pages: number;
  replaced: boolean;
  defer: boolean;
}
function bound(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError("Invalid work client limit.");
  return value;
}
function notify(callback: () => unknown): void {
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch { /* Independent observers cannot change transport ownership. */ }
}

export function createWorkClient(initial: WorkExtensionPort | Client, options: WorkClientOptions = {}): WorkClient {
  const maxItems = bound(options.maxTrackedItems ?? 500, 1, 5000);
  const maxPages = bound(options.maxPages ?? 20, 1, 20);
  const timeout = bound(options.refreshTimeoutMs ?? 10000, 1, 10000);
  const interval = bound(options.reconcileIntervalMs ?? 30000, 5000, 2147483647);
  let items = new Map<string, WorkListSummary>();
  const observers = new Set<(value: WorkClientSnapshot) => unknown>();
  let port: WorkExtensionPort | undefined, target: WorkViewSubscription | undefined;
  let status: WorkClientSnapshot["status"] = "idle";
  let subscriptionId: string | undefined, streamEpoch: string | undefined, nextCursor: string | undefined;
  let remainingItems: WorkListSummary[] | undefined;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  const detach: (() => void)[] = [];
  let lifetime = new AbortController();
  let dirty = false;
  // Notifications can arrive in the same transport read as the subscribe reply.
  let earlyReset: string | undefined;
  const snapshot = (): WorkClientSnapshot => ({ status, items: structuredClone([...items.values()]),
    ...(subscriptionId && { subscriptionId }), ...(streamEpoch && { streamEpoch }), ...(nextCursor && { nextCursor }),
    ...(remainingItems && { remainingItems: structuredClone(remainingItems) }) });
  const emit = () => {
    for (const observer of [...observers]) if (observers.has(observer)) notify(() => observer(snapshot()));
  };
  function stopTimer() {
    clearInterval(timer);
    timer = undefined;
  }
  function invalidate() {
    lifetime.abort();
    lifetime = new AbortController();
    stopTimer();
    dirty = false;
    earlyReset = undefined;
    running = undefined;
    subscriptionId = streamEpoch = nextCursor = undefined;
    remainingItems = undefined;
    items.clear();
  }
  async function unsubscribe(source: WorkExtensionPort | undefined, id: string | undefined) {
    if (source && id) {
      try {
        await source.request(method("unsubscribe"), { version: 1, subscriptionId: id }, 5000);
      } catch { /* A closed connection also releases its server subscriptions. */ }
    }
  }
  function armTimer() {
    if (!timer && port && target && status !== "limit") timer = setInterval(() => {
      void refresh();
    }, interval);
  }
  function replaceSubscription(source: WorkExtensionPort, scan: ScanBudget) {
    const prior = subscriptionId;
    subscriptionId = streamEpoch = nextCursor = earlyReset = undefined;
    remainingItems = undefined;
    // A lost reset and a rejected page may look identical on a private transport.
    // Try the exact target once. Further failures wait for the periodic read.
    scan.defer = scan.replaced || scan.pages >= maxPages || performance.now() >= scan.deadline;
    scan.replaced = true;
    dirty = !scan.defer;
    status = "incomplete";
    void unsubscribe(source, prior);
  }
  async function sweep(source: WorkExtensionPort, filter: WorkViewSubscription, generation: AbortSignal, scan: ScanBudget) {
    const { deadline } = scan;
    const budget = new AbortController();
    const timerId = setTimeout(() => {
      budget.abort();
    }, Math.max(0, Math.ceil(deadline - performance.now())));
    const signal = AbortSignal.any([generation, budget.signal]);
    const cancelled = Promise.withResolvers<never>();
    const cancel = () => {
      cancelled.reject(new Error("Work scan ended."));
    };
    signal.addEventListener("abort", cancel, { once: true });
    const scanned = new Map<string, WorkListSummary>();
    let cursor: string | undefined;
    const reachedLimit = (unread: readonly WorkListSummary[] = []) => {
      if (scan.replaced && !subscriptionId) {
        // Recovery ran out of this refresh's budget before receiving a view.
        // The next interval may spend a fresh budget on the exact subscription.
        status = "incomplete";
        scan.defer = true;
        return;
      }
      const extra = [...scanned.values()].filter((item) => !items.has(item.id)).concat(unread);
      remainingItems = extra.length ? extra : undefined;
      status = "limit";
      nextCursor = cursor;
      stopTimer();
    };
    try {
      do {
        const remaining = Math.ceil(deadline - performance.now());
        if (remaining < 1 || scan.pages >= maxPages) {
          reachedLimit();
          return;
        }
        scan.pages++;
        let page;
        if (!subscriptionId) {
          // Only release resources if a previously cancelled subscription is later acknowledged.
          const releaseLate = (result: unknown) => {
            const reply = subscribedSchema.safeParse(capturePage(result));
            if (reply.success) void unsubscribe(source, reply.data.subscriptionId);
          };
          const pending = source.request(method("subscribe"), { version: 1, ...filter }, remaining, signal, releaseLate);
          const response = await Promise.race([pending, cancelled.promise]);
          if (signal.aborted) {
            releaseLate(response);
            return;
          }
          const reply = subscribedSchema.parse(capturePage(response));
          subscriptionId = reply.subscriptionId;
          streamEpoch = reply.streamEpoch;
          if (earlyReset === subscriptionId || earlyReset === "*") {
            items.clear();
            replaceSubscription(source, scan);
            return;
          }
          earlyReset = undefined;
          page = reply;
        } else {
          const { resource, ...rest } = filter;
          let response: unknown;
          try {
            const pending = source.request(method("list"), { version: 1, subscriptionId, announceTo: resource, ...rest, ...(cursor && { cursor }) }, remaining, signal);
            response = await Promise.race([pending, cancelled.promise]);
          } catch (error) {
            if (signal.aborted) throw error;
            replaceSubscription(source, scan);
            return;
          }
          if (signal.aborted) return;
          page = pageSchema.parse(capturePage(response));
        }
        for (const row of page.items) {
          if ((filter.resource.kind === "session" && (row.session.id !== filter.resource.id || row.session.instanceId !== filter.resource.instanceId))
            || filter.filter?.kinds?.includes(row.kind) === false || filter.filter?.statuses?.includes(row.status) === false) throw new Error("Unexpected work snapshot.");
        }
        for (const [index, row] of page.items.entries()) {
          if (!scanned.has(row.id) && scanned.size >= maxItems) {
            // Keep the unread suffix in wire order before its successor.
            cursor = page.nextCursor;
            reachedLimit(page.items.slice(index));
            return;
          }
          const previous = scanned.get(row.id) ?? items.get(row.id);
          const current = previous && BigInt(previous.revision) >= BigInt(row.revision) ? previous : row;
          scanned.set(row.id, current);
          if (items.has(row.id) || items.size < maxItems) items.set(row.id, current);
        }
        cursor = page.nextCursor;
        if (performance.now() >= deadline) {
          reachedLimit();
          return;
        }
        if (!cursor) {
          if (dirty && scan.pages >= maxPages) {
            reachedLimit();
            return;
          }
          if (!dirty) items = scanned;
          status = "ready";
          nextCursor = undefined;
          remainingItems = undefined;
        }
      } while (cursor);
    } catch {
      if (generation.aborted) return;
      if (budget.signal.aborted || performance.now() >= deadline) reachedLimit();
      else {
        status = "incomplete";
        nextCursor = cursor;
        if (!subscriptionId) scan.defer = true;
      }
    } finally {
      clearTimeout(timerId);
      signal.removeEventListener("abort", cancel);
      if (!generation.aborted) {
        armTimer();
        emit();
      }
    }
  }
  const needsRescan = () => dirty && status !== "limit";
  function refresh(): Promise<WorkClientSnapshot> {
    if (!port || !target || status === "limit" || status === "disposed") return Promise.resolve(snapshot());
    if (!running) {
      const generation = lifetime.signal, source = port, filter = target;
      const scan: ScanBudget = { deadline: performance.now() + timeout, pages: 0, replaced: false, defer: false };
      running = Promise.resolve().then(async () => {
        do {
          dirty = false;
          if (!generation.aborted) await sweep(source, filter, generation, scan);
        } while (!generation.aborted && !scan.defer && needsRescan());
      }).finally(() => {
        if (!generation.aborted) running = undefined;
      });
    }
    return running.then(snapshot);
  }
  function restart(): Promise<WorkClientSnapshot> {
    const source = port, prior = subscriptionId;
    invalidate();
    status = "loading";
    void unsubscribe(source, prior);
    emit();
    return refresh();
  }
  function attach(next: WorkExtensionPort) {
    port = next;
    const listen = (name: string, receive: (params: unknown) => unknown) => next.onNotification(method(name), (params) => {
      if (port === next && target) return receive(params);
      return undefined;
    });
    try {
      detach.push(listen("changed", (params) => {
        const result = hintSchema.safeParse(params);
        if (!result.success) return;
        if (!subscriptionId) {
          dirty = true;
          return;
        }
        if (result.data.subscriptionId !== subscriptionId) return;
        if (result.data.streamEpoch !== streamEpoch) {
          if (status === "limit") {
            invalidate();
            emit();
          } else void restart();
          return;
        }
        const prior = items.get(result.data.workId);
        if (status === "limit" || (prior && BigInt(result.data.revision) <= BigInt(prior.revision))) return;
        dirty = true;
        void refresh();
      }));
      detach.push(listen("reset", (params) => {
        const result = resetSchema.safeParse(params);
        if (!result.success) return;
        if (!subscriptionId) {
          earlyReset = earlyReset && earlyReset !== result.data.subscriptionId ? "*" : result.data.subscriptionId;
          return;
        }
        if (result.data.subscriptionId !== subscriptionId) return;
        if (status === "limit") {
          invalidate();
          emit();
        } else void restart();
      }));
      detach.push(next.onClose(() => {
        if (port !== next) return;
        disconnect();
        status = "disconnected";
        emit();
      }));
    } catch (error) {
      disconnect();
      throw error;
    }
  }
  function disconnect() {
    port = undefined;
    for (const release of detach.splice(0)) notify(release);
    invalidate();
  }
  attach("rpc" in initial ? createWorkPort(initial) : initial);
  return {
    snapshot, refresh,
    subscribe(input) {
      if (!port || status === "disposed") throw new Error("Work client disconnected.");
      const { resource, filter, limit } = workSubscribeSchema.parse({ ...input, version: 1 });
      if (!resource.instanceId) throw new Error("Work views require an exact resource instance.");
      target = { resource: { ...resource, instanceId: resource.instanceId }, ...(filter && { filter }), limit: Math.min(limit ?? 50, maxItems) };
      return restart();
    },
    reconnect(next) {
      if (status === "disposed") throw new Error("Work client disposed.");
      void unsubscribe(port, subscriptionId);
      disconnect();
      attach("rpc" in next ? createWorkPort(next) : next);
      status = target ? "loading" : "idle";
      emit();
      return refresh();
    },
    onChange(receive) {
      if (status === "disposed" || observers.size >= 64) throw new Error("Work observer unavailable.");
      observers.add(receive);
      return () => {
        observers.delete(receive);
      };
    },
    async dispose() {
      const done = unsubscribe(port, subscriptionId);
      disconnect();
      target = undefined;
      status = "disposed";
      observers.clear();
      await done;
    },
  };
}

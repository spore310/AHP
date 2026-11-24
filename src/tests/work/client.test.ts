import { afterEach, expect, it, vi } from "vitest";
import { createWorkClient, type WorkExtensionPort } from "@work/helpers/client";

const resource = { kind: "session", id: "ahp-session:/review", instanceId: crypto.randomUUID() };
const session = { ...resource, kind: "session" as const, domainId: "demo" };
const sub = crypto.randomUUID(), cursor = crypto.randomUUID();
const row = { id: crypto.randomUUID(), session, kind: "review", priority: 0, status: "queued", revision: "9",
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
function fixture() {
  let items = [row];
  const subscriptions = new Map<string, (params: unknown) => void>();
  let lost: (() => void) | undefined;
  const request = vi.fn<WorkExtensionPort["request"]>((method: string): Promise<unknown> => Promise.resolve(method.endsWith("/subscribe")
    ? { version: 1, subscriptionId: sub, streamEpoch: "epoch", items }
    : method.endsWith("/list") ? { version: 1, items } : null));
  const port: WorkExtensionPort = { request, onNotification(method, callback) {
    subscriptions.set(method, callback);
    return () => {
      subscriptions.delete(method);
    };
  }, onClose(callback) {
    lost = callback;
    return () => {
      lost = undefined;
    };
  } };
  return { port, request, subscriptions, close: () => lost?.(), replace(next: typeof items) {
    items = next;
  } };
}
afterEach(() => {
  vi.useRealTimers();
});

it("recovers a missed final revision periodically and stops while disconnected or disposed", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port, { reconcileIntervalMs: 5000 });
  await client.subscribe({ resource });
  expect(client.snapshot().items[0]?.revision).toBe("9");
  f.replace([{ ...row, revision: "10", status: "completed" }]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.snapshot().items[0]?.revision).toBe("10");
  f.close();
  const calls = f.request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.request.mock.calls).toHaveLength(calls);
  expect(client.snapshot().items).toEqual([]);
  const next = fixture();
  await client.reconnect(next.port);
  expect(client.snapshot().status).toBe("ready");
  await client.dispose();
  const stop = next.request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15000);
  expect(next.request.mock.calls).toHaveLength(stop);
});

it("preserves items during incomplete pages, compares bigint revisions, and pauses at the cap", async () => {
  const f = fixture();
  const client = createWorkClient(f.port, { maxTrackedItems: 1, maxPages: 2 });
  await client.subscribe({ resource });
  f.request.mockResolvedValueOnce({ version: 1, items: [], nextCursor: cursor })
    .mockResolvedValueOnce({ version: 1, items: [{ ...row, revision: "10" }] });
  await client.refresh();
  expect(client.snapshot().items[0]?.revision).toBe("10");
  f.replace([{ ...row, revision: "8" }]);
  await client.refresh();
  expect(client.snapshot().items[0]?.revision).toBe("10");
  f.replace([row, { ...row, id: crypto.randomUUID() }]);
  await client.refresh();
  expect(client.snapshot()).toMatchObject({ status: "limit" });
  expect(client.snapshot().items.length).toBeLessThanOrEqual(1);
  await client.dispose();
});

it("ignores foreign and old hints and coalesces concurrent hints without losing a newer revision", async () => {
  const f = fixture();
  const client = createWorkClient(f.port);
  await client.subscribe({ resource });
  const send = (revision: string, subscriptionId = sub) => f.subscriptions.get("x-ahp/work/changed")?.({
    version: 1, subscriptionId, streamEpoch: "epoch", workId: row.id, change: "claimed", revision });
  send("8");
  send("9");
  send("10", crypto.randomUUID());
  expect(f.request).toHaveBeenCalledTimes(1);
  const first = Promise.withResolvers<unknown>();
  f.request.mockReturnValueOnce(first.promise);
  send("10");
  await Promise.resolve();
  for (let i = 0; i < 100; i++) send("9007199254740999");
  f.replace([{ ...row, revision: "9007199254740999" }]);
  first.resolve({ version: 1, items: [{ ...row, revision: "10" }] });
  await client.refresh();
  expect(f.request).toHaveBeenCalledTimes(3);
  expect(client.snapshot().items[0]?.revision).toBe("9007199254740999");
  send("9007199254740998");
  expect(f.request).toHaveBeenCalledTimes(3);
  await client.dispose();
});

it("cancels an outstanding page on reset, abandons its cursor, and rejects late data", async () => {
  const f = fixture();
  const client = createWorkClient(f.port);
  await client.subscribe({ resource });
  const oldPage = Promise.withResolvers<unknown>();
  f.request.mockReturnValueOnce(oldPage.promise);
  const previous = client.refresh();
  await Promise.resolve();
  const signal = f.request.mock.calls.at(-1)?.[3];
  f.replace([]);
  f.subscriptions.get("x-ahp/work/reset")?.({ version: 1, subscriptionId: sub, streamEpoch: "epoch" });
  expect(signal?.aborted).toBe(true);
  await previous;
  await client.refresh();
  oldPage.resolve({ version: 1, items: [row], nextCursor: cursor });
  expect(client.snapshot()).toMatchObject({ status: "ready", items: [] });
  await client.dispose();
});

it("preserves existing entries through a timed-out partial page, pauses, and resumes for a new filter", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port, { maxPages: 2, refreshTimeoutMs: 40, reconcileIntervalMs: 5000 });
  await client.subscribe({ resource });
  f.request.mockResolvedValueOnce({ version: 1, items: [], nextCursor: cursor })
    .mockReturnValueOnce(new Promise(() => undefined));
  const refresh = client.refresh();
  await vi.advanceTimersByTimeAsync(41);
  expect(await refresh).toMatchObject({ status: "limit", nextCursor: cursor, items: [row] });
  const last = f.request.mock.calls.at(-1);
  expect(last?.[3]?.aborted).toBe(true);
  const count = f.request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.request).toHaveBeenCalledTimes(count);
  f.replace([]);
  expect(await client.subscribe({ resource, filter: { statuses: ["queued"] }, limit: 1 })).toMatchObject({ status: "ready", items: [] });
  expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({ filter: { statuses: ["queued"] }, limit: 1 });
  await client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds multi-page terminal histories and replaces vanished rows only after a successful finite sweep", async () => {
  const f = fixture();
  const client = createWorkClient(f.port, { maxPages: 2, maxTrackedItems: 100 });
  await client.subscribe({ resource });
  const page = Array.from({ length: 50 }, () => ({ ...row, status: "completed", id: crypto.randomUUID() }));
  const next = crypto.randomUUID();
  f.request.mockResolvedValueOnce({ version: 1, items: page, nextCursor: cursor })
    .mockResolvedValueOnce({ version: 1, items: [], nextCursor: next });
  expect(await client.refresh()).toMatchObject({ status: "limit", nextCursor: next });
  expect(client.snapshot().items).toHaveLength(51);
  f.replace(page);
  await client.subscribe({ resource, filter: { statuses: ["completed"] } });
  expect(client.snapshot().items).toEqual(page);
  const replaced = page.map((r) => ({ ...r, id: crypto.randomUUID() }));
  f.replace(replaced);
  expect((await client.refresh()).items).toEqual(replaced);
  await client.dispose();
});

it("clears callbacks, aborts an unacknowledged subscription, and ignores its late reply after disposal", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port);
  const observe = vi.fn();
  client.onChange(observe);
  const late = Promise.withResolvers<unknown>();
  f.request.mockReturnValueOnce(late.promise);
  const first = client.subscribe({ resource });
  await Promise.resolve();
  const call = f.request.mock.calls[0];
  await client.dispose();
  expect(call?.[3]?.aborted).toBe(true);
  expect(await first).toMatchObject({ status: "disposed", items: [] });
  late.resolve({ version: 1, subscriptionId: sub, streamEpoch: "late", items: [row] });
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.subscriptions.size).toBe(0);
  expect(client.snapshot()).toEqual({ status: "disposed", items: [] });
  expect(observe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("reads a short final page that fits the remaining cache and continues periodic reconciliation", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port, { maxTrackedItems: 3, reconcileIntervalMs: 5000 });
  const second = { ...row, id: crypto.randomUUID() };
  const last = { ...row, id: crypto.randomUUID() };
  f.request.mockResolvedValueOnce({ version: 1, subscriptionId: sub, streamEpoch: "epoch", items: [row, second], nextCursor: cursor })
    .mockResolvedValueOnce({ version: 1, items: [last] });
  expect(await client.subscribe({ resource, limit: 2 })).toMatchObject({ status: "ready", items: [row, second, last] });
  f.request.mockResolvedValueOnce({ version: 1, items: [row, second], nextCursor: cursor })
    .mockResolvedValueOnce({ version: 1, items: [{ ...last, revision: "10" }] });
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.snapshot().items.at(-1)?.revision).toBe("10");
  await client.dispose();
});

it("hands off the unread suffix and its actual live successor after a retention overflow", async () => {
  const f = fixture();
  const client = createWorkClient(f.port, { maxTrackedItems: 3 });
  const rows = Array.from({ length: 5 }, () => ({ ...row, id: crypto.randomUUID() }));
  const next = crypto.randomUUID();
  f.request.mockResolvedValueOnce({ version: 1, subscriptionId: sub, streamEpoch: "epoch", items: rows.slice(0, 2), nextCursor: cursor })
    .mockResolvedValueOnce({ version: 1, items: rows.slice(2, 4), nextCursor: next })
    .mockImplementationOnce((method, params) => {
      expect(method).toBe("x-ahp/work/list");
      expect(params).toMatchObject({ cursor: next, limit: 2, subscriptionId: sub });
      return Promise.resolve({ version: 1, items: rows.slice(4) });
    });
  const result = await client.subscribe({ resource, limit: 2 });
  expect(result).toMatchObject({ status: "limit", items: rows.slice(0, 3), remainingItems: rows.slice(3, 4), nextCursor: next });
  expect(await f.port.request("x-ahp/work/list", { version: 1, announceTo: resource, limit: 2, cursor: result.nextCursor, subscriptionId: sub }))
    .toMatchObject({ items: rows.slice(4) });
  f.subscriptions.get("x-ahp/work/reset")?.({ version: 1, subscriptionId: sub, streamEpoch: "epoch" });
  expect(client.snapshot()).toEqual({ status: "limit", items: [] });
  await client.dispose();
});

it("isolates rejected asynchronous change observers and continues delivering to other observers", async () => {
  const f = fixture();
  const client = createWorkClient(f.port);
  client.onChange(() => Promise.reject(new Error("observer failed")));
  const receive = vi.fn();
  client.onChange(receive);
  await client.subscribe({ resource });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(receive).toHaveBeenCalledTimes(2);
  await client.dispose();
});

it("charges all coalesced dirty sweeps to the refresh's original page budget", async () => {
  const f = fixture();
  const client = createWorkClient(f.port, { maxPages: 1 });
  await client.subscribe({ resource });
  const parked = Promise.withResolvers<unknown>();
  f.request.mockReturnValueOnce(parked.promise);
  const refresh = client.refresh();
  await Promise.resolve();
  f.subscriptions.get("x-ahp/work/changed")?.({ version: 1, subscriptionId: sub, streamEpoch: "epoch",
    workId: row.id, revision: "10", change: "claimed" });
  parked.resolve({ version: 1, items: [row] });
  expect((await refresh).status).toBe("limit");
  expect(f.request).toHaveBeenCalledTimes(2);
  await client.dispose();
});

it.each(["retention", "pages", "time"] as const)("preserves old display and every new row on a %s limit", async (reason) => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port, { maxTrackedItems: 3, maxPages: reason === "pages" ? 1 : 5, refreshTimeoutMs: 100 });
  const make = () => ({ ...row, id: crypto.randomUUID() });
  const [a, b, c, d, e, g] = [make(), make(), make(), make(), make(), make()] as const;
  f.replace([a, b]);
  await client.subscribe({ resource, limit: 2 });
  const next = crypto.randomUUID();
  f.request.mockResolvedValueOnce({ version: 1, items: [c, d], nextCursor: cursor });
  if (reason === "retention") f.request.mockResolvedValueOnce({ version: 1, items: [e, g], nextCursor: next });
  if (reason === "time") f.request.mockReturnValueOnce(new Promise(() => undefined));
  const refresh = client.refresh();
  await vi.advanceTimersByTimeAsync(101);
  expect(await refresh).toMatchObject({ status: "limit", items: [a, b, c], remainingItems: reason === "retention" ? [d, e, g] : [d],
    nextCursor: reason === "retention" ? next : cursor });
  await client.dispose();
});

it("limits a failed subscription recovery and retains the incomplete view until a full sweep", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port, { reconcileIntervalMs: 5000, maxPages: 2 });
  await client.subscribe({ resource });
  f.request.mockRejectedValueOnce(new Error("stale list")).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("subscription unavailable"));
  expect(await client.refresh()).toMatchObject({ status: "incomplete", items: [row] });
  expect(f.request).toHaveBeenCalledTimes(4);
  f.replace([]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.snapshot()).toMatchObject({ status: "ready", items: [] });
  expect(f.request).toHaveBeenCalledTimes(5);
  await client.dispose();
});

it.each([1, 2])("defers stale subscription recovery after its original %i-page or time budget expires", async (maxPages) => {
  vi.useFakeTimers();
  const f = fixture();
  const client = createWorkClient(f.port, { reconcileIntervalMs: 5000, maxPages, refreshTimeoutMs: 100 });
  await client.subscribe({ resource });
  const late = Promise.withResolvers<unknown>();
  f.request.mockReturnValueOnce(late.promise).mockResolvedValueOnce(null);
  if (maxPages === 2) f.request.mockReturnValueOnce(new Promise(() => undefined));
  const result = client.refresh();
  await vi.advanceTimersByTimeAsync(90);
  late.reject(new Error("old subscription"));
  await vi.advanceTimersByTimeAsync(11);
  expect(await result).toMatchObject({ status: "incomplete", items: [row] });
  expect(f.request).toHaveBeenCalledTimes(maxPages + 2);
  f.replace([]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.snapshot()).toMatchObject({ status: "ready", items: [] });
  await client.dispose();
});

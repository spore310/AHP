import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { createMemoryDurableStorage } from "@persistence";
import { assertFiniteWorkPages, assertWorkPageProjection } from "../persistence/conformance/workPages";
import { createWorkViews, workListSchema, workSubscribeSchema } from "@work/helpers/views";
import type { WorkApproval, WorkCommandOptions } from "@work";
import { workFixture } from "./commandsFixture";

it("pages a finite session sweep across later submissions", async () => {
  const host = await createMemoryDurableStorage().acquire("pages", () => undefined);
  try {
    await assertFiniteWorkPages(host);
    await assertWorkPageProjection(host);
  } finally {
    await host.release();
  }
});

async function fixture(prepare: WorkCommandOptions["prepare"] = () => Promise.resolve({ isCurrent: () => true, fence: () => true, release() {} })) {
  const f = await workFixture();
  const views = createWorkViews({ repository: () => f.host.work, resolveType: () => f.type,
    allowedKinds: ["review"], captureAuthority: () => () => true, prepare });
  const receipts: WorkApproval[] = [];
  const caller = { ...f.caller, retainReply(p: WorkApproval) {
    receipts.push(p);
  } };
  const request = { version: 1 as const, announceTo: { kind: "session", id: f.ref.id } };
  const target = await views.resolve(caller, request);
  return { ...f, views, receipts, recipient: caller, visibility: { isCurrent: () => true, fence: () => true, release() {} },
    list: request, target, async finish() {
      for (const receipt of receipts) receipt.release();
      views.close();
      f.service.close();
      await f.host.release();
    } };
}

it("retains exact announced rows and recipient visibility through final response and hint guards", async () => {
  const f = await fixture();
  try {
    const hidden = await f.service.submit(f.caller, f.request);
    const shown = await f.service.submit(f.caller, { ...f.request, requestKey: "announced", announce: f.request.scope });
    const event = (workId: string) => ({ workId, revision: "1", session: f.ref });
    expect(await f.views.hint(f.recipient, f.target, event(hidden.id), f.visibility)).toBeUndefined();
    expect(await f.views.hint(f.recipient, f.target, { ...event(shown.id), session: { ...f.ref, instanceId: crypto.randomUUID() } }, f.visibility)).toBeUndefined();
    let visible = true;
    const visibility = { ...f.visibility, isCurrent: () => visible, fence: () => visible };
    const hint = await f.views.hint(f.recipient, f.target, event(shown.id), visibility);
    expect(hint?.isCurrent()).toBe(true);
    const page = await f.views.list(f.recipient, f.list, f.target, visibility);
    expect(page.items.map((item) => item.id)).toEqual([shown.id]);
    expect(f.receipts[0]?.isCurrent()).toBe(true);
    visible = false;
    expect(hint?.fence?.()).toBe(false);
    expect(f.receipts[0]?.isCurrent()).toBe(false);
    visible = true;
    await f.service.cancel(f.caller, shown.id);
    expect(hint?.fence?.()).toBe(false);
    expect(f.receipts[0]?.isCurrent()).toBe(false);
    hint?.release();
  } finally { await f.finish(); }
});

it.each(["isCurrent", "fence"] as const)("rechecks observed work after a later %s callback changes an earlier row", async (phase) => {
  let mutate: (() => void) | undefined;
  const f = await fixture((_caller, _op, _intent, row) => Promise.resolve({ isCurrent: () => true, [phase]() {
    if (row?.requestKey === "two") mutate?.();
    return true;
  }, release() {} }));
  try {
    const one = await f.service.submit(f.caller, { ...f.request, requestKey: "one", announce: f.request.scope });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await f.service.submit(f.caller, { ...f.request, requestKey: "two", announce: f.request.scope });
    await f.views.list(f.recipient, f.list, f.target, f.visibility);
    let pending: Promise<unknown> | undefined;
    mutate = () => {
      mutate = undefined;
      pending = f.host.work.disposition({ session: f.ref, id: one.id, revision: "1" }, "cancel", () => true);
    };
    const receipt = f.receipts[0];
    expect(phase === "fence" ? receipt?.fence?.() : receipt?.isCurrent()).toBe(false);
    await pending;
  } finally { await f.finish(); }
});

it("times out a parked row policy and releases its late receipt without returning a partial page", async () => {
  const entered = Promise.withResolvers<undefined>();
  const pending = Promise.withResolvers<WorkApproval>();
  const release = vi.fn();
  const f = await fixture(() => {
    entered.resolve(undefined);
    return pending.promise;
  });
  try {
    await f.service.submit(f.caller, { ...f.request, announce: f.request.scope });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const listing = f.views.list(f.recipient, f.list, f.target, f.visibility);
    const rejected = expect(listing).rejects.toMatchObject({ code: "exhausted" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    pending.resolve({ isCurrent: () => true, release });
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledOnce();
    expect(f.receipts).toHaveLength(0);
  } finally {
    vi.useRealTimers();
    await f.finish();
  }
});

it("rejects unknown filters and bounds overlapping wire schemas before SQL", async () => {
  const f = await fixture();
  try {
    const graph = vi.spyOn(f.host.work, "graph");
    await expect(f.views.resolve(f.recipient, { ...f.list, filter: { kinds: ["unknown"] } })).rejects.toMatchObject({ code: "invalid" });
    expect(graph).not.toHaveBeenCalled();
    expect(workListSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(workListSchema.safeParse({ ...f.list, filter: { statuses: ["hidden"] } }).success).toBe(false);
    expect(workListSchema.safeParse({ ...f.list, subscriptionId: "callerId" }).success).toBe(false);
    expect(workSubscribeSchema.safeParse({ version: 1, resource: f.list.announceTo, subscriptionId: crypto.randomUUID() }).success).toBe(false);
  } finally { await f.finish(); }
});

it("masks an absent fresh target and keeps unresolved continuations stale", async () => {
  const f = await fixture();
  try {
    const missing = { kind: "session", id: "ahp://absent" };
    for (const request of [{ version: 1 as const, session: missing }, { version: 1 as const, announceTo: missing },
      { ...f.list, session: missing },
      { ...f.list, announceTo: { ...f.list.announceTo, instanceId: crypto.randomUUID() } }]) {
      await expect(f.views.resolve(f.recipient, request)).rejects.toMatchObject({ code: "unauthorized" });
      await expect(f.views.resolve(f.recipient, { ...request, cursor: crypto.randomUUID() })).rejects.toMatchObject({ code: "stale" });
    }
  } finally { await f.finish(); }
});

it("releases every refresh cursor owned by a removed subscription and preserves independent sweeps", async () => {
  const f = await fixture();
  try {
    for (const key of ["one", "two", "three"]) {
      await f.service.submit(f.caller, { ...f.request, requestKey: key, announce: f.request.scope });
    }
    const id = crypto.randomUUID(), other = crypto.randomUUID();
    const base = { ...f.list, limit: 1 };
    const target = await f.views.resolve(f.recipient, base);
    const page = (wireId?: string, trustedId?: string, cursor?: string) => f.views.list(f.recipient,
      { ...base, ...(wireId && { subscriptionId: wireId }), ...(cursor && { cursor }) }, target, f.visibility, trustedId);
    await expect(page(id)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(page(id, other)).rejects.toMatchObject({ code: "unauthorized" });
    const independent = await page(), sibling = await page(other, other);
    const refresh = await page(id, id), restarted = await page(id, id);
    expect(refresh.nextCursor).toBeDefined();
    const continued = await page(id, id, refresh.nextCursor);
    expect(continued.nextCursor).toBeDefined();
    expect(restarted.nextCursor).toBeDefined();
    f.views.releaseSubscription(f.recipient.context.connectionId, id);
    for (const cursor of [refresh.nextCursor, continued.nextCursor, restarted.nextCursor]) {
      await expect(f.views.resolve(f.recipient, { ...base, cursor })).rejects.toMatchObject({ code: "stale" });
    }
    expect((await page(undefined, undefined, independent.nextCursor)).items).toHaveLength(1);
    expect((await page(other, other, sibling.nextCursor)).items).toHaveLength(1);
  } finally { await f.finish(); }
});

it("aborts a parked subscription refresh during graph lookup when its owner unsubscribes", async () => {
  const f = await fixture();
  const parked = Promise.withResolvers<undefined>();
  try {
    const id = crypto.randomUUID();
    const graph = vi.spyOn(f.host.work, "graph").mockImplementationOnce(() => parked.promise);
    const rejected = expect(f.views.resolve(f.recipient, { ...f.list, subscriptionId: id })).rejects.toMatchObject({ code: "exhausted" });
    expect(graph).toHaveBeenCalledOnce();
    f.views.releaseSubscription(f.recipient.context.connectionId, id);
    await rejected;
    parked.resolve(undefined);
    expect(f.receipts).toHaveLength(0);
  } finally {
    parked.resolve(undefined);
    await f.finish();
  }
});

it("reauthorizes the previous cursor after a lost reply, including a final page, within a two-position window", async () => {
  const f = await fixture();
  try {
    for (const key of ["one", "two", "three", "four"]) {
      await f.service.submit(f.caller, { ...f.request, requestKey: key, announce: f.request.scope });
    }
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const base = { ...f.list, limit: 1, subscriptionId: crypto.randomUUID() };
    const page = async (cursor?: string) => {
      const request = { ...base, ...(cursor && { cursor }) };
      const target = await f.views.resolve(f.recipient, request);
      return f.views.list(f.recipient, request, target, f.visibility, base.subscriptionId);
    };
    const start = await page();
    assert.ok(start.nextCursor);
    const lost = await page(start.nextCursor);
    const item = lost.items[0];
    assert.ok(item && lost.nextCursor);
    await f.service.cancel(f.caller, item.id);
    expect(f.receipts.at(-1)?.fence?.()).toBe(false);
    f.views.discardCursor(f.recipient, lost.nextCursor);
    const retried = await page(start.nextCursor);
    expect(retried.items).toMatchObject([{ id: item.id, status: "cancelled", revision: "2" }]);
    const duplicates = await Promise.all([page(start.nextCursor), page(start.nextCursor)]);
    expect(duplicates).toEqual([retried, retried]);
    assert.ok(duplicates[0].nextCursor);
    f.views.discardCursor(f.recipient, duplicates[0].nextCursor);

    const middle = await page(retried.nextCursor);
    expect(middle.nextCursor).toBeDefined();
    await expect(page(start.nextCursor)).rejects.toMatchObject({ code: "stale" });
    const final = await page(middle.nextCursor);
    expect(final.items).toHaveLength(1);
    expect(final.nextCursor).toBeUndefined();
    expect(await page(middle.nextCursor)).toEqual(final);
    await expect(page(retried.nextCursor)).rejects.toMatchObject({ code: "stale" });
    await vi.advanceTimersByTimeAsync(60001);
    await expect(page(middle.nextCursor)).rejects.toMatchObject({ code: "stale" });
  } finally {
    vi.useRealTimers();
    await f.finish();
  }
});

it("renews the 60-second idle window for authorized terminal reads and reoffered successors", async () => {
  const f = await fixture();
  try {
    for (const key of ["one", "two", "three"]) {
      await f.service.submit(f.caller, { ...f.request, requestKey: key, announce: f.request.scope });
    }
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const request = (cursor?: string) => ({ ...f.list, limit: 1, ...(cursor && { cursor }) });
    const page = async (cursor?: string, visible = true) => {
      const req = request(cursor);
      const target = await f.views.resolve(f.recipient, req);
      try {
        return await f.views.list(f.recipient, req, target, { ...f.visibility, isCurrent: () => visible });
      } finally { target.release(); }
    };
    const a = await page(), b = await page();
    assert.ok(a.nextCursor && b.nextCursor);
    const terminal = (await page(a.nextCursor)).nextCursor, offered = (await page(b.nextCursor)).nextCursor;
    assert.ok(terminal && offered);
    await vi.advanceTimersByTimeAsync(59000);
    const last = await page(terminal);
    expect(last.nextCursor).toBeUndefined();
    expect((await page(b.nextCursor)).nextCursor).toBe(offered);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await page(terminal)).toEqual(last);
    expect(await page(offered)).toEqual(last);
    await vi.advanceTimersByTimeAsync(59000);
    await expect(page(terminal, false)).rejects.toMatchObject({ code: "stale" });
    const foreign = { ...f.recipient, context: { ...f.recipient.context, connectionId: "other" } };
    await expect(f.views.resolve(foreign, request(offered))).rejects.toMatchObject({ code: "stale" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(page(terminal)).rejects.toMatchObject({ code: "stale" });
    await expect(page(offered)).rejects.toMatchObject({ code: "stale" });
  } finally {
    vi.useRealTimers();
    await f.finish();
  }
});

it("shares the examined-row budget across a stale initial snapshot and its retry", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 127; i++) await f.service.submit(f.caller, { ...f.request, requestKey: String(i) });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const last = await f.service.submit(f.caller, { ...f.request, requestKey: "last", announce: f.request.scope });
    const inspect = f.host.work.inspect.bind(f.host.work);
    vi.spyOn(f.host.work, "inspect").mockImplementationOnce(async (domain, id) => {
      await f.host.work.disposition({ session: f.ref, id: last.id, revision: "1" }, "cancel", () => true);
      return inspect(domain, id);
    });
    await expect(f.views.list(f.recipient, f.list, f.target, f.visibility)).rejects.toMatchObject({ code: "stale" });
    const before = vi.spyOn(f.host.work, "pageKeys");
    await expect(f.views.list(f.recipient, f.list, f.target, f.visibility)).rejects.toMatchObject({ code: "exhausted" });
    expect(before).not.toHaveBeenCalled();
    expect(f.receipts).toHaveLength(0);
  } finally { await f.finish(); }
});

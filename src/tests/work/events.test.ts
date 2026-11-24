import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { createMemoryDurableStorage, type AgentRegistrationRecord } from "@persistence";
import type { WorkEvent } from "@work/helpers/events/types";
import type { StoredWork } from "@persistence/helpers/durability/workTypes";
import { schedulingFixture } from "../persistence/conformance/scheduling";

it("publishes expiry, policy requeue and failure from the confirmed row", async () => {
  const agents = new Map<string, AgentRegistrationRecord>();
  const rows = new Map<string, StoredWork>();
  const host = await createMemoryDurableStorage(rows, agents).acquire("work-events", () => undefined);
  try {
    const f = await schedulingFixture(host, (r) => {
      agents.set(r.id, r);
      return Promise.resolve();
    });
    const events: string[] = [];
    assert.ok(host.workEvents);
    host.workEvents.subscribe((e) => events.push(e.type + "-" + e.revision));
    const claim = async (id: string) => {
      const row = rows.get(id);
      assert.ok(row);
      const result = await host.work.claimPrepared(f.prepare([row]), () => undefined);
      assert.ok(result.status === "claimed" && result.row.lease);
      return { id, revision: result.row.revision, execution: result.row.lease, session: f.ref };
    };
    const expired = await f.submit(1, "review", 1);
    await claim(expired);
    const row = rows.get(expired);
    assert.ok(row?.lease);
    rows.set(expired, { ...row, lease: { ...row.lease, expiresAt: new Date(0).toISOString() } });
    await host.work.expireExhausted(f.ref, 32);
    await host.work.expireExhausted(f.ref, 32);
    const id = await f.submit(1);
    await host.work.disposition(await claim(id), "requeue", () => true);
    await host.work.settle(await claim(id), { status: "failed", retryable: false, code: "failed", summary: "Failed" }, () => true);
    expect(events).toEqual(["submitted-1", "claimed-2", "failed-3", "submitted-1", "claimed-2", "requeued-3", "claimed-4", "failed-5"]);
  } finally { await host.release(); }
});

it("publishes each confirmed revision once across acquisition, retries, CAS and retirement", async () => {
  const registrations = new Map<string, AgentRegistrationRecord>();
  const host = await createMemoryDurableStorage(new Map(), registrations).acquire("events", () => undefined);
  try {
    assert.ok(host.workEvents);
    const events: WorkEvent[] = [];
    host.workEvents.subscribe(() => {
      throw new Error("listener");
    });
    host.workEvents.subscribe(() => Promise.reject(new Error("async listener")));
    host.workEvents.subscribe((event) => {
      events.push(event);
    });
    const f = await schedulingFixture(host, (r) => {
      registrations.set(r.id, r);
      return Promise.resolve();
    });
    const id = await f.submit(1);
    const row = await host.work.get(f.ref.domainId, id);
    assert.ok(row);
    expect((await host.work.submit(row, f.graph.session.graphRevision, { session: 100, host: 100 }, () => true)).created).toBe(false);
    const claim = async (revision: string) => {
      const r = await host.work.claimPrepared(f.prepare([{ id, revision }]), () => undefined);
      assert.ok(r.status === "claimed" && r.row.lease);
      return { session: f.ref, id, revision: r.row.revision, execution: r.row.lease, graphRevision: f.graph.session.graphRevision };
    };
    const first = await claim("1");
    await host.work.renewPrepared({ actor: f.actor, fence: first, leaseMs: 60000 }, () => undefined);
    await expect(host.work.settle(first, { status: "completed", result: {} }, () => true)).rejects.toThrow();
    await host.work.settle({ ...first, revision: "3" }, { status: "failed", retryable: true, code: "retry", summary: "Retry" }, () => true);
    await host.work.replaceData({ id, session: f.ref, revision: "4" }, { expectedDataRevision: "1", data: { private: true } }, () => true);
    const second = await claim("5");
    await host.work.settle(second, { status: "completed", result: { private: true } }, () => true);
    const other = await f.submit(0);
    await host.sessions.beginRetirement(f.ref, () => true);
    expect(events.map((e) => [e.workId, e.type, e.revision])).toEqual([
      [id, "submitted", "1"], [id, "claimed", "2"], [id, "renewed", "3"], [id, "requeued", "4"],
      [id, "dataUpdated", "5"], [id, "claimed", "6"], [id, "completed", "7"], [other, "submitted", "1"], [other, "cancelled", "2"],
    ]);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(["occurredAt", "revision", "session", "type", "version", "workId"]);
  } finally {
    await host.release();
  }
});

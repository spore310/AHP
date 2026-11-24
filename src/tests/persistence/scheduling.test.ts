import { expect, it } from "vitest";
import { createMemoryDurableStorage, type AgentRegistrationRecord } from "@persistence";
import { assertScheduling, schedulingFixture } from "./conformance/scheduling";
import type { StoredWork } from "@persistence/helpers/durability/workTypes";

it("uses bounded priority scans, identity-wide capacity and exact renewals in memory", async () => {
  const registrations = new Map<string, AgentRegistrationRecord>();
  const jobs = new Map<string, StoredWork>();
  const host = await createMemoryDurableStorage(jobs, registrations).acquire("scheduling", () => undefined);
  try {
    await assertScheduling(host, (row) => {
      registrations.set(row.id, row);
      return Promise.resolve();
    }, (id) => {
      const r = jobs.get(id);
      if (!r?.lease) throw new Error("Missing lease.");
      jobs.set(id, { ...r, lease: { ...r.lease, expiresAt: new Date(0).toISOString() } });
      return Promise.resolve();
    });
  } finally {
    await host.release();
  }
});

it("rejects admission if a synchronous callback changes the canonical resource snapshot", async () => {
  const registrations = new Map<string, AgentRegistrationRecord>();
  const host = await createMemoryDurableStorage(new Map(), registrations).acquire("scheduling", () => undefined);
  try {
    const f = await schedulingFixture(host, (row) => {
      registrations.set(row.id, row);
      return Promise.resolve();
    });
    const id = await f.submit(1);
    const { rows } = await host.work.scanCandidates(f.scan);
    let updated: Promise<unknown> | undefined;
    await expect(host.work.claimPrepared(f.prepare(rows), (locked) => {
      expect(locked.resources[0]?.dataRevision).toBe("1");
      updated = host.resources.replaceData(f.ref, f.ref, { expectedDataRevision: "1", data: { changed: true } }, () => true);
      return undefined;
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(updated).resolves.toMatchObject({ status: "updated" });
    expect(await host.work.get(f.ref.domainId, id)).toMatchObject({ status: "queued", revision: "1" });
  } finally { await host.release(); }
});

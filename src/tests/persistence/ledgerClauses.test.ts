import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResourceRef } from "@authorization";
import { createMemoryDurableStorage, type ResourceRecord } from "@persistence";
import type { StoredWork, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { createWorkSessionFixture } from "./conformance/work";

const yes = (): boolean => true;

it("P0-21 retirement cancels positive anchors reached only through the parent edge and only through the grant-parent edge", async () => {
  const work = new Map<string, StoredWork>();
  const host = await createMemoryDurableStorage(work).acquire("ledger-p0-21", () => undefined);
  try {
    const { ref, root } = await createWorkSessionFixture(host);
    async function resource(name: string, parent: ResourceRef, grantParent?: ResourceRef): Promise<ResourceRef> {
      const row: ResourceRecord = { ...root, ref: { ...ref, kind: "chat", id: `chat:/${name}`, instanceId: randomUUID() }, operationId: randomUUID(),
        parent, ...(grantParent && { grantParent }) };
      await host.resources.reserve(row, yes);
      await host.resources.activate({ ref: row.ref, session: ref, operationId: row.operationId, expected: "creating", next: "active" }, yes);
      return row.ref;
    }
    const retiring = await resource("retiring", ref);
    const contained = await resource("contained", retiring);
    const granted = await resource("granted", ref, retiring);
    const outside = await resource("outside", ref);
    // Each dependent hangs off the retiring resource by exactly one of the two edges.
    expect(await host.resources.get(contained)).toMatchObject({ parent: retiring });
    expect((await host.resources.get(contained))?.grantParent).toBeUndefined();
    expect(await host.resources.get(granted)).toMatchObject({ parent: ref, grantParent: retiring });

    const graphRevision = (await host.work.graph(ref.domainId, ref))?.session.graphRevision;
    assert.ok(graphRevision);
    const anchor = (target: ResourceRef, include = true) => ({ resource: target, include, includeDescendants: false });
    const submit = async (requestKey: string, scope: WorkIntent["scope"], leased = false): Promise<string> => {
      const intent: WorkIntent = { session: ref, requestKey, kind: "review", submitter: { kind: "user", principal: { domainId: ref.domainId, subject: "owner" } },
        input: {}, submittedData: {}, priority: 0, targetAgentId: null, maxAttempts: 3, scope, announce: [] };
      const { id } = await host.work.submit(intent, graphRevision, { host: 1000, session: 100 }, yes);
      const row = work.get(id);
      assert.ok(row);
      if (leased) work.set(id, { ...row, status: "leased", revision: "2", attemptCount: 1, lease: { registrationId: randomUUID(), executionEpoch: "1",
        attempt: 1, leaseToken: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() } });
      return id;
    };
    const jobs = {
      containedQueued: await submit("contained-queued", [anchor(contained)]),
      containedLeased: await submit("contained-leased", [anchor(contained)], true),
      grantedQueued: await submit("granted-queued", [anchor(granted)]),
      grantedLeased: await submit("granted-leased", [anchor(granted)], true),
      outsideQueued: await submit("outside-queued", [anchor(outside)]),
      outsideLeased: await submit("outside-leased", [anchor(outside)], true),
      negativeOnly: await submit("negative-only", [anchor(outside), anchor(contained, false), anchor(granted, false)]),
    };

    const reported: { readonly id: string; readonly revision: string }[] = [];
    const closure = await host.resources.beginRetirement(ref, retiring, yes, (cancelled) => {
      reported.push(...cancelled);
    });

    expect(closure.map((row) => row.ref.id).sort()).toEqual([contained.id, granted.id, retiring.id]);
    expect(closure.at(-1)?.ref).toEqual(retiring);
    const stored = new Map<string, StoredWork | undefined>();
    for (const [name, id] of Object.entries(jobs)) stored.set(name, await host.work.get(ref.domainId, id));
    expect(Object.fromEntries([...stored].map(([name, row]) => [name, row?.status]))).toEqual({
      containedQueued: "cancelled", containedLeased: "cancelled", grantedQueued: "cancelled", grantedLeased: "cancelled",
      outsideQueued: "queued", outsideLeased: "leased", negativeOnly: "queued",
    });
    expect(stored.get("containedLeased")?.lease).toBeUndefined();
    expect(stored.get("grantedLeased")?.lease).toBeUndefined();
    expect(stored.get("outsideLeased")?.lease?.attempt).toBe(1);
    const cancelled = [jobs.containedQueued, jobs.containedLeased, jobs.grantedQueued, jobs.grantedLeased];
    expect(reported.map((row) => row.id).sort()).toEqual([...cancelled].sort());
    for (const row of reported) expect((await host.work.get(ref.domainId, row.id))?.revision).toBe(row.revision);
    expect((await host.resources.get(outside))?.lifecycle).toBe("active");
  } finally { await host.release(); }
});

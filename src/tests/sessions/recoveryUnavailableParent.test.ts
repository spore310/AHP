import assert from "node:assert/strict";
import { expect, it } from "vitest";
import type { ResourceRef } from "@authorization";
import { resourceOrder } from "@persistence/helpers/durability/helpers";
import type { ResourceRecord } from "@persistence/helpers/durability/types";
import type { ProviderSessionInput, RuntimeResourceDriver } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { channel } from "../../../examples/advanced/host";
import { observableStorage, sessionHost } from "./durableFixture";

/** The rows in the dependency order recovery walks them: identity, lifecycle and the parent each one depends on. */
function describeRows(rows: readonly ResourceRecord[]): string[] {
  const name = (ref: ResourceRef): string => ref.kind === "session" ? "session" : ref.id;
  return resourceOrder(rows).map((row) => [name(row.ref), row.lifecycle, ...(row.parent ? ["under " + name(row.parent)] : [])].join(" "));
}

it("recovers later siblings when a child's parent is unavailable (review finding 3)", async () => {
  // What the host itself read and did: every durable scan, and every driver callback and child commit in order.
  const scans: string[][] = [];
  const steps: string[] = [];
  const store = observableStorage((h) => ({ ...h, resources: { ...h.resources,
    async listSession(session) {
      const rows = await h.resources.listSession(session);
      scans.push(describeRows(rows));
      return rows;
    },
    async activate(change, admit) {
      await h.resources.activate(change, admit);
      steps.push("commit " + change.ref.id + " " + change.next);
    },
  } }));
  let context: ProviderSessionInput | undefined;
  const nested: ResourceRef[] = [];
  const handle = () => Promise.resolve({ metadata: {}, release() {} });
  const driver: RuntimeResourceDriver = { kind: "chat", key: "chat", version: 1, captureRecoveryInput: () => ({}),
    async ensure({ resource }) {
      steps.push("ensure " + resource.id);
      if (resource.id !== "a") return handle();
      // The store only reserves B while A is still "creating", so B is reserved from inside A's own ensure.
      assert.ok(context?.resources);
      if (!nested.length) nested.push(await context.resources.create({ kind: "chat", id: "b", parent: resource, driver }));
      throw new Error("A cannot be provisioned");
    },
    restore({ resource }) {
      steps.push("restore " + resource.id);
      return handle();
    },
    destroy: () => Promise.resolve() };
  const remember = (input: ProviderSessionInput) => {
    context = input;
    return Promise.resolve({ dispose() {} });
  };
  const provider = { ...mockProvider, drivers: [driver], startSession: remember, restoreSession: remember };
  const first = sessionHost(store.storage, provider);
  const second = sessionHost(store.storage, provider);
  try {
    await first.host.start();
    await first.provision();
    const session = first.origin();
    assert.ok(context?.resources);
    const created = context.resources;
    await expect(created.create({ kind: "chat", id: "a", parent: session, driver })).rejects.toThrow();
    const c = await created.create({ kind: "chat", id: "c", parent: session, driver });
    const [b] = nested;
    assert.ok(b);
    const durable = () => store.current().resources.listSession(session);
    const before = await durable();
    const a = before.find((row) => row.ref.id === "a");
    assert.ok(a);
    // A failed its initial ensure without a receipt, B is still reserved under it, and C was created last.
    const graph = ["session active", "a failed under session", "b creating under a", "c active under session"];
    expect(describeRows(before)).toEqual(graph);
    expect(a.runtimeMetadata).toEqual({});
    expect(steps).toEqual(["ensure a", "commit a failed", "ensure c", "commit c active"]);
    await first.stop();
    scans.length = 0;
    steps.length = 0;

    await second.host.start();

    // Recovery walked the rows with B, the child of the unavailable A, before the later sibling C.
    expect(scans).not.toHaveLength(0);
    for (const scan of scans) expect(scan).toEqual(graph);
    // A is retried and stays failed. B gets no driver call and no commit. The walk still reaches C and restores it.
    expect(steps).toEqual(["ensure a", "commit a failed", "restore c", "commit c active"]);
    expect(describeRows(await durable())).toEqual(graph);

    const authorization = second.host.sessions.authorization;
    expect(authorization?.getResource(channel)).toEqual(session);
    expect(authorization?.isReady(session)).toBe(true);
    expect(second.host.sessions.getSessionSnapshot(channel)?.state.lifecycle).toBe("ready");

    const recovered = context.resources;
    expect(recovered).not.toBe(created);
    expect(second.registry.owner(c)).toBeDefined();
    expect(await recovered.readData(c)).toMatchObject({ dataRevision: "1" });
    expect(await recovered.replaceData(c, { expectedDataRevision: "1", data: { recovered: true } })).toMatchObject({ status: "updated" });
    expect(await recovered.readData(c)).toEqual({ dataRevision: "2", data: { recovered: true } });

    for (const unavailable of [a.ref, b]) {
      expect(second.registry.owner(unavailable)).toBeUndefined();
      await expect(recovered.readData(unavailable)).rejects.toThrow();
      await expect(recovered.replaceData(unavailable, { expectedDataRevision: "1", data: {} })).rejects.toThrow();
    }
  } finally {
    await first.stop();
    await second.stop();
  }
});

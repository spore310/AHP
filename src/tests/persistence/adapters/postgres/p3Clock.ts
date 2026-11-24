import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";
import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";
import { mockProvider } from "@sessions/mock";
import { createReviewHost, reviewWorkerKey } from "../../../../../examples/advanced/host";
import { claimedLease, execution, openWorkClient } from "../../../../../examples/advanced/work";

/** Application clocks and PostgreSQL clocks are independent. Exercise the complete protected wire path on both sides of skew. */
export async function verifyWorkClock(connectionString: string, db: Pool) {
  const wall = Date.now;
  for (const offset of [-8000, 8000]) {
    let adjustment = 0;
    Date.now = () => wall() + adjustment;
    let demo: ReturnType<typeof createReviewHost> | undefined;
    const peers: Awaited<ReturnType<typeof openWorkClient>>[] = [];
    try {
      const persistence = await createPostgresPersistenceProvider({ connectionString });
      assert.ok(persistence.durability);
      demo = createReviewHost("direct", { persistence, durability: { storage: persistence.durability, hostId: "p0-conformance" }, provider: mockProvider,
        capacityDemo: { configuration: {}, leaseMs: 3000 },
        restoration: { prepare: () => Promise.resolve({ bindings: [], isCurrent: () => true }) } });
      const { port } = await demo.host.start();
      const uri = offset < 0 ? "ahp-session:/clock-behind" : "ahp-session:/clock-ahead";
      await demo.provision(undefined, uri);
      const url = `ws://127.0.0.1:${String(port)}`;
      const pm = await openWorkClient(url, "pm", "clock-pm");
      peers.push(pm);
      const worker = await openWorkClient(url, "junior", "clock-worker");
      peers.push(worker);
      await worker.request("x-ahp/agents/register", { agentKey: reviewWorkerKey });
      const session = { kind: "session", id: uri };
      await pm.request("x-ahp/work/submit", { requestKey: "skew", kind: "code.review", input: {}, scope: [{ resource: session, include: true }] });
      adjustment = offset;
      const first = claimedLease.parse(await worker.request("x-ahp/work/claim", { session })).lease;
      const renewed = await worker.request("x-ahp/work/renew", execution(first));
      assert.ok(renewed);
      await db.query("UPDATE work_items SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [first.workId]);
      await pm.request("x-ahp/work/submit", { requestKey: "lower", kind: "code.review", priority: -1, input: {}, scope: [{ resource: session, include: true }] });
      const writer = await db.connect();
      let claim: Promise<unknown> | undefined;
      let finished = false;
      try {
        await writer.query("BEGIN");
        const { rows: [held] } = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid FROM work_items WHERE id=$1 FOR UPDATE", [first.workId]);
        assert.ok(held);
        claim = worker.request("x-ahp/work/claim", { session }).finally(() => {
          finished = true;
        });
        const blocking = async (): Promise<unknown> => {
          while (!finished) {
            const { rowCount }: { rowCount: number | null } = await db.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))", [held.pid]);
            assert.equal(rowCount, 0, "Hosted claim blocked on the expired high-priority work row.");
            await setTimeout(10);
          }
          return claim;
        };
        const lower = claimedLease.parse(await Promise.race([claim, blocking()])).lease;
        assert.equal(lower.priority, -1);
        assert.notEqual(lower.workId, first.workId);
        assert.equal(await worker.request("x-ahp/work/complete", { ...execution(lower), result: {} }), null);
      } finally {
        finished = true;
        await writer.query("ROLLBACK");
        writer.release();
        await claim?.catch(() => undefined);
      }
      const replacement = claimedLease.parse(await worker.request("x-ahp/work/claim", { session })).lease;
      assert.equal(replacement.attempt, first.attempt + 1);
      assert.equal(await worker.request("x-ahp/work/complete", { ...execution(replacement), result: {} }), null);
    } finally {
      try {
        await Promise.allSettled(peers.map((peer) => peer.connection.shutdown()));
        await demo?.stop();
      } finally { Date.now = wall; }
    }
  }
}

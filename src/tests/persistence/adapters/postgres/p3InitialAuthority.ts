import assert from "node:assert/strict";
import type { Pool } from "pg";
import { z } from "zod";
import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";
import { mockProvider } from "@sessions/mock";
import { createReviewHost, reviewWorkerKey } from "../../../../../examples/advanced/host";
import { openWorkClient } from "../../../../../examples/advanced/work";

/** Withdraw only the worker's initial connection receipt while its public claim waits in PostgreSQL. */
export async function verifyInitialClaimAuthority(connectionString: string, db: Pool, wait: (pool: Pool, blocker: number) => Promise<void>) {
  const persistence = await createPostgresPersistenceProvider({ connectionString });
  assert.ok(persistence.durability);
  const revoked = new AbortController();
  const demo = createReviewHost("direct", { persistence, provider: mockProvider, durability: { storage: persistence.durability, hostId: "p0-conformance" },
    restoration: { prepare: () => Promise.resolve({ bindings: [], isCurrent: () => true }) },
    initialAuthority: { prepare: ({ context, signal }) => {
      const active = context.actor.principal.subject === "junior" ? revoked.signal : signal;
      return Promise.resolve({ scopes: [], allowGlobalSequence: true, validUntil: Date.now() + 60000, signal: active,
        isCurrent: () => !active.aborted, release() {} });
    } } });
  const peers: Awaited<ReturnType<typeof openWorkClient>>[] = [];
  try {
    const { port } = await demo.host.start();
    const session = { kind: "session", id: "ahp-session:/parked-initial-authority" };
    await demo.provision(undefined, session.id);
    const url = `ws://127.0.0.1:${String(port)}`;
    const pm = await openWorkClient(url, "pm", "pm");
    peers.push(pm);
    const worker = await openWorkClient(url, "junior", "worker");
    peers.push(worker);
    const { agentId } = z.object({ agentId: z.uuid() }).parse(await worker.request("x-ahp/agents/register", { agentKey: reviewWorkerKey }));
    const { workId } = z.object({ workId: z.uuid() }).parse(await pm.request("x-ahp/work/submit", { session, kind: "code.review", requestKey: "parked",
      scope: [{ resource: session, include: true }], targetAgentId: agentId, input: {} }));
    const state = async () => (await db.query<Record<string, unknown>>(`SELECT revision::text, status, attempt_count, lease_agent_id, lease_execution_epoch, lease_token, lease_expires_at
      FROM work_items WHERE id = $1`, [workId])).rows;
    const before = await state();
    assert.deepEqual(before, [{ revision: "1", status: "queued", attempt_count: 0, lease_agent_id: null,
      lease_execution_epoch: null, lease_token: null, lease_expires_at: null }]);
    const writer = await db.connect();
    let outcome: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await writer.query("BEGIN");
      const { rows: [held] } = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid FROM agent_registrations WHERE id=$1 FOR UPDATE", [agentId]);
      assert.ok(held);
      outcome = Promise.allSettled([worker.request("x-ahp/work/claim", { session })]);
      await wait(db, held.pid);
      const waiting = await db.query("SELECT query FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND query ILIKE '%FROM agent_registrations%FOR UPDATE%'", [held.pid]);
      assert.equal(waiting.rowCount, 1, "The hosted claim must be waiting on its durable capacity lock.");
      revoked.abort();
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
    assert.equal((await outcome)[0]?.status, "rejected");
    assert.deepEqual(await state(), before);
  } finally {
    await Promise.allSettled(peers.map(({ connection }) => connection.shutdown()));
    await demo.stop();
  }
}

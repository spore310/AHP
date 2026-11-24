import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { DurableHost } from "@persistence";
import { createWorkViews } from "@work/helpers/views";
import type { WorkApproval } from "@work";
import { workFixture } from "../../../work/commandsFixture";

export async function assertSqlViewFences(host: DurableHost, sql: Pool, wait: (pool: Pool, pid: number) => Promise<void>) {
  const f = await workFixture({}, host);
  const receipts: WorkApproval[] = [];
  const caller = { ...f.caller, retainReply(p: WorkApproval) {
    receipts.push(p);
  } };
  const visibility = { isCurrent: () => true, fence: () => true, release() {} };
  const views = createWorkViews({ repository: () => host.work, resolveType: () => f.type, prepare: () => Promise.resolve(visibility),
    allowedKinds: ["review"], captureAuthority: () => () => true });
  const writer = await sql.connect();
  try {
    const ids = [];
    for (const key of ["one", "two", "three"]) ids.push((await f.service.submit(f.caller, { ...f.request, requestKey: key })).id);
    ids.sort();
    await sql.query("UPDATE work_items SET created_at='2026-11-01T00:00:00.000001Z' WHERE id=ANY($1::uuid[])", [ids]);
    await sql.query("UPDATE work_items SET created_at='2026-11-01T00:00:00.000002Z' WHERE id=$1", [ids[0]]);
    const first = await host.work.pageKeys(f.ref, 1);
    const second = await host.work.pageKeys(f.ref, 1, first.rows[0], first.upper);
    const third = await host.work.pageKeys(f.ref, 1, second.rows[0], second.upper);
    assert.deepEqual([first.rows[0]?.id, second.rows[0]?.id, third.rows[0]?.id], [ids[1], ids[2], ids[0]]);
    assert.ok(first.rows[0]?.createdAt.endsWith("000001Z") && third.rows[0]?.createdAt.endsWith("000002Z"));

    const request = { version: 1 as const, session: { id: f.ref.id, kind: "session" }, limit: 1 };
    const target = await views.resolve(caller, request);
    try {
      await writer.query("BEGIN");
      const { rows: [held] } = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      assert.ok(held);
      assert.equal((await writer.query("UPDATE work_items SET data='{\"private\":true}',data_revision=data_revision+1,revision=revision+1 WHERE id=$1", [ids[1]])).rowCount, 1);
      const outcome = Promise.allSettled([views.list(caller, request, target, visibility)]);
      try {
        await wait(sql, held.pid);
      } finally {
        await writer.query("COMMIT");
      }
      const [page] = await outcome;
      assert.ok(page.status === "rejected" && page.reason instanceof Error && "code" in page.reason && page.reason.code === "stale");
      assert.equal(receipts.length, 0);
    } finally { target.release(); }
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
    views.close();
    f.service.close();
  }
}

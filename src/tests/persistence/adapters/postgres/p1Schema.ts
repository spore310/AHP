import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";
import { withTransaction } from "@persistence/helpers/adapters/postgres/helpers/connection";

/** Run against the forward migrations, on an isolated schema with two P0 sessions and a child. */
export async function testP1Schema(pool: Pool): Promise<void> {
  const smoke = await readFile(new URL("../../../../../docs/plans/work/AHP_V1_Schema_Smoke.sql", import.meta.url), "utf8");
  const fixture = await pool.connect();
  try {
    await fixture.query(smoke);
  } finally {
    await fixture.query("ROLLBACK");
    fixture.release();
  }
  const roots = await pool.query<{ resource_pk: string; session_instance_id: string; domain_id: string }>(
    "SELECT resource_pk,session_instance_id,domain_id FROM canonical_resources WHERE kind='session' ORDER BY session_instance_id");
  const anchors = await pool.query<{ resource_pk: string; session_instance_id: string; domain_id: string }>(
    "SELECT resource_pk,session_instance_id,domain_id FROM canonical_resources WHERE resource_id IN ('left','right') ORDER BY resource_id");
  const [a, b] = anchors.rows;
  const foreign = roots.rows.find((root) => root.session_instance_id !== a?.session_instance_id);
  assert.ok(a && b && foreign);
  const insert = `INSERT INTO work_items(id,session_instance_id,domain_id,kind,request_key,input,submitted_by_kind,submitted_by_subject)
    VALUES ($1,$2,$3,'p1','key','{}','user','owner')`;
  const select = `INSERT INTO work_resource_selections(work_id,session_instance_id,domain_id,purpose,include,resource_pk)
    VALUES ($1,$2,$3,'scope',true,$4)`;
  const work = randomUUID();
  const args = [work, a.session_instance_id, a.domain_id];
  await assert.rejects(pool.query(insert, args), { code: "23514" });
  await withTransaction(pool, async (client) => {
    await client.query(insert, args);
    await client.query(select, [...args, a.resource_pk]);
    await client.query(select, [...args, b.resource_pk]);
  });
  await assert.rejects(pool.query(select, [...args, foreign.resource_pk]), { code: "23503" });
  for (const assignment of ["data=NULL", "submitted_data=NULL"]) {
    await assert.rejects(pool.query(`UPDATE work_items SET ${assignment} WHERE id=$1`, [work]), { code: "23502" });
  }
  for (const assignment of ["data='null'", "submitted_data='[]'", "submitted_by_kind='agent'", "submitted_by_agent_id='user-is-not-agent'",
    "lease_execution_epoch=1", "last_failure_message='orphan'", "data_revision=0", "max_attempts=101"]) {
    await assert.rejects(pool.query(`UPDATE work_items SET ${assignment} WHERE id=$1`, [work]), { code: "23514" });
  }
  const registration = await pool.query<{ id: string; epoch: string }>(`INSERT INTO agent_registrations(domain_id,principal_subject,agent_key)
    VALUES ('foreign-domain','same','key') RETURNING id,execution_epoch::text AS epoch`);
  const agent = registration.rows[0];
  assert.ok(agent);
  assert.equal(agent.epoch, "0");
  await assert.rejects(pool.query("UPDATE agent_registrations SET execution_epoch=-1 WHERE id=$1", [agent.id]), { code: "23514" });
  await assert.rejects(pool.query("UPDATE work_items SET target_agent_id=$1 WHERE id=$2", [agent.id, work]), { code: "23503" });
  const manifest = await pool.query<{ work_manifest: unknown }>("SELECT work_manifest FROM session_types WHERE type_key='sample'");
  assert.deepEqual(manifest.rows, [{ work_manifest: { kinds: [] } }]);
  await assert.rejects(pool.query("UPDATE session_types SET work_manifest='[]' WHERE type_key='sample'"), { code: "23514" });
  const indexes = await pool.query<{ indexname: string; indexdef: string }>(
    "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='work_items'");
  for (const [name, definition] of [
    ["work_items_queued_priority_idx", "(session_instance_id, priority DESC, created_at, id) WHERE (status = 'queued'::text)"],
    ["work_items_expired_claim_idx", "(session_instance_id, lease_expires_at, priority DESC, created_at, id) WHERE (status = 'leased'::text)"],
    ["work_items_active_agent_idx", "(lease_agent_id, lease_expires_at) WHERE (status = 'leased'::text)"],
    ["work_items_session_list_idx", "(session_instance_id, created_at, id)"],
  ] as const) {
    assert.ok(indexes.rows.some((r) => r.indexname === name && r.indexdef.includes(definition)), name);
  }
  const left = await pool.connect();
  const right = await pool.connect();
  try {
    await Promise.all([left, right].map((c) => c.query("BEGIN ISOLATION LEVEL READ COMMITTED")));
    const remove = "DELETE FROM work_resource_selections WHERE work_id=$1 AND resource_pk=$2";
    await Promise.all([left.query(remove, [work, a.resource_pk]), right.query(remove, [work, b.resource_pk])]);
    await left.query("SET CONSTRAINTS selections_preserve_scope IMMEDIATE");
    const { rows: [pid] } = await left.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    assert.ok(pid);
    const second = assert.rejects(right.query("COMMIT"), { code: "23514" });
    try {
      const deadline = Date.now() + 5000;
      while (!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid.pid])).rowCount) {
        assert.ok(Date.now() < deadline, "Second selector deletion did not wait on its common work row.");
        await setTimeout(10);
      }
    } finally {
      await left.query("COMMIT");
      await second;
    }
    assert.deepEqual((await pool.query("SELECT resource_pk FROM work_resource_selections WHERE work_id=$1", [work])).rows,
      [{ resource_pk: b.resource_pk }]);
  } finally {
    await Promise.all([left, right].map(async (c) => {
      try {
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    }));
    await pool.query("DELETE FROM work_items WHERE id=$1", [work]);
    await pool.query("DELETE FROM agent_registrations WHERE id=$1", [agent.id]);
  }
}

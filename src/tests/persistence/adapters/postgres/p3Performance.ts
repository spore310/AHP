import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { AgentRegistrationRecord, DurableHost } from "@persistence";
import { countActiveSql, exhaustedSql, scanParams, scanWhere } from "@persistence/helpers/adapters/postgres/helpers/durableWork/scheduling";
import { workRowsQuery } from "@persistence/helpers/adapters/postgres/helpers/durableWork/rows";
import { schedulingFixture } from "../../conformance/scheduling";

interface PlanNode { "Node Type": string; "Index Name"?: string; "Plans"?: PlanNode[]; "Shared Hit Blocks": number; "Shared Read Blocks": number }
interface Explain { "Plan": PlanNode; "Execution Time": number }
const ms = (n: number) => Number(n.toFixed(3));
export async function schedulingPerformance(host: DurableHost, sql: Pool, register: (r: AgentRegistrationRecord) => Promise<void>) {
  const a = await schedulingFixture(host, register), b = await schedulingFixture(host, register);
  const inserted = await sql.query(`WITH seed AS (
    SELECT g,CASE WHEN g%10=0 THEN 'queued' WHEN g%10 IN (1,2) THEN 'leased' ELSE 'cancelled' END AS status,
    CASE WHEN g%3=0 THEN $1::uuid ELSE $2::uuid END AS session,CASE WHEN g%7=0 THEN $3::uuid ELSE $4::uuid END AS agent
    FROM generate_series(1,12000) g), added AS (
    INSERT INTO work_items(session_instance_id,domain_id,kind,request_key,priority,input,submitted_by_kind,submitted_by_subject,status,
      target_agent_id,lease_agent_id,lease_execution_epoch,lease_token,lease_expires_at,attempt_count,max_attempts)
    SELECT session,$5,CASE WHEN g%4=0 THEN 'review' ELSE 'other' END,'measured-'||g,CASE WHEN g%97=0 THEN 2147483647 ELSE g%9 END,
      '{}','user','fixture',status,CASE WHEN g%5=0 THEN agent END,CASE WHEN status='leased' THEN agent END,CASE WHEN status='leased' THEN 1 END,
      CASE WHEN status='leased' THEN gen_random_uuid() END,CASE WHEN status='leased' THEN clock_timestamp()+
      CASE WHEN g%2=0 THEN interval '10 minutes' ELSE interval '-10 minutes' END END,CASE WHEN status='leased' THEN 1 ELSE 0 END,
      CASE WHEN g%11=0 THEN 1 ELSE 3 END FROM seed RETURNING id,session_instance_id,domain_id)
    INSERT INTO work_resource_selections(work_id,session_instance_id,domain_id,purpose,resource_pk,include)
    SELECT a.id,a.session_instance_id,a.domain_id,'scope',r.resource_pk,true FROM added a JOIN canonical_resources r
      ON r.session_instance_id=a.session_instance_id AND r.kind='session'`, [a.ref.instanceId, b.ref.instanceId, a.actor.registrationId, b.actor.registrationId, a.ref.domainId]);
  assert.equal(inserted.rowCount, 12000);
  await sql.query("ANALYZE work_items");
  await sql.query("ANALYZE work_resource_selections");
  const statements = { scan: { text: workRowsQuery(scanWhere), args: scanParams(a.scan) },
    capacity: { text: countActiveSql, args: [a.actor.registrationId] }, expiry: { text: exhaustedSql, args: [a.ref.instanceId, a.ref.domainId, 32] } };
  const record: Record<string, unknown> = {};
  let peak = 0;
  for (const [name, statement] of Object.entries(statements)) {
    const { rows: [result] } = await sql.query<{ "QUERY PLAN": Explain[] }>("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement.text, statement.args);
    const plan = result?.["QUERY PLAN"][0];
    assert.ok(plan);
    const nodes = new Set<string>();
    const visit = (node: PlanNode) => {
      nodes.add(node["Index Name"] ?? node["Node Type"]);
      for (const child of node.Plans ?? []) visit(child);
    };
    visit(plan.Plan);
    const times: number[] = [];
    for (let batch = 0; batch < 8; batch++) {
      await Promise.all(Array.from({ length: 4 }, async () => {
        const start = performance.now();
        await sql.query(statement.text, statement.args);
        times.push(performance.now() - start);
        peak = Math.max(peak, sql.totalCount);
      }));
    }
    times.sort((x, y) => x - y);
    const percentile = (p: number) => ms(times[Math.ceil(times.length * p) - 1] ?? 0);
    record[name] = { nodes: [...nodes], executionMs: plan["Execution Time"], sharedHits: plan.Plan["Shared Hit Blocks"],
      sharedReads: plan.Plan["Shared Read Blocks"], samples: times.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
  }
  console.log("P3 PostgreSQL performance", JSON.stringify({ rows: inserted.rowCount, ...record,
    pool: { peak, total: sql.totalCount, idle: sql.idleCount, waiting: sql.waitingCount } }));
}

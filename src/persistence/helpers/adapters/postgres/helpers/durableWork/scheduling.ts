import { randomUUID } from "node:crypto";
import type { CandidateScan, ClaimActor, LockedClaim, StoredWork, WorkScheduling } from "@persistence/helpers/durability/workTypes";
import { admitSchedule, bounded, synchronousAdmission, validateScan, validateSchedule } from "@persistence/helpers/durability/scheduling";
import type { Admission, StoredSession } from "@persistence/helpers/durability/types";
import type { QueryableClient } from "../../types";
import { reject, resourceRows, sessionRow } from "../resources/rows/helpers";
import type { DurableTransaction } from "../resources/types";
import { workRow, workRows } from "./rows";

const order = "priority DESC, created_at ASC, id ASC";
const filter = `session_instance_id=$1 AND domain_id=$2 AND kind=ANY($3::text[]) AND (target_agent_id IS NULL OR target_agent_id=$4)
  AND attempt_count<max_attempts AND ($5::int IS NULL OR priority<$5 OR (priority=$5 AND (created_at,id)>($6::timestamptz,$7::uuid)))`;
export const scanKeysSql = `SELECT id FROM (
  (SELECT id,priority,created_at FROM work_items WHERE ${filter} AND status='queued' ORDER BY ${order} LIMIT $8)
  UNION ALL
  (SELECT id,priority,created_at FROM work_items WHERE ${filter} AND status='leased' AND lease_expires_at<=statement_timestamp() ORDER BY ${order} LIMIT $8)
  ) AS eligible ORDER BY ${order} LIMIT $8`;
export const countActiveSql = `SELECT count(*)::int AS count FROM work_items WHERE lease_agent_id=$1 AND status='leased' AND lease_expires_at>statement_timestamp()`;
export const scanWhere = `WHERE w.id IN (${scanKeysSql}) ORDER BY w.priority DESC,w.created_at,w.id`;
export const exhaustedSql = `SELECT id FROM work_items WHERE session_instance_id=$1 AND domain_id=$2 AND status='leased'
  AND lease_expires_at<=statement_timestamp() AND attempt_count>=max_attempts ORDER BY lease_expires_at,priority DESC,created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED`;
export function scanParams(input: CandidateScan) {
  return [input.session.instanceId, input.session.domainId, input.allowedKinds, input.registrationId, input.after?.priority, input.after?.createdAt, input.after?.id, input.limit + 1];
}
async function lockSession(client: QueryableClient, ref: StoredSession["ref"], revision?: string) {
  const s = await sessionRow(client, ref, "share");
  if (!s || s.lifecycle !== "active" || (revision !== undefined && s.graphRevision !== revision)) return reject();
  return s;
}
async function lockAgent(client: QueryableClient, actor: ClaimActor, domain: string) {
  if (actor.principal.domainId !== domain) return reject();
  const { rows: [agent] } = await client.query<LockedClaim["registration"]>(`SELECT id,principal_subject AS subject,agent_key AS key,execution_epoch::text AS epoch,enabled
    FROM agent_registrations WHERE id=$1 AND domain_id=$2 AND principal_subject=$3 AND agent_key=$4 AND execution_epoch=$5 AND enabled FOR UPDATE`,
  [actor.registrationId, domain, actor.principal.subject, actor.agentKey, actor.executionEpoch]);
  return agent ?? reject();
}
async function facts(client: QueryableClient, session: StoredSession, resources: LockedClaim["resources"], id: string,
  registration: LockedClaim["registration"], hostEpoch: string): Promise<LockedClaim> {
  const row = await workRow(client, session.ref.domainId, id) ?? reject();
  const { rows: [clock] } = await client.query<{ now: number }>("SELECT ceil(extract(epoch FROM clock_timestamp())*1000)::double precision AS now");
  return { row, session, resources, registration, hostEpoch, databaseTime: clock?.now ?? reject() };
}
export function createPostgresScheduling(tx: DurableTransaction, authorize: (check: Admission) => void, hostEpoch: string): WorkScheduling {
  return {
    async scanCandidates(raw) {
      const input = structuredClone(raw);
      validateScan(input);
      return tx(async (client) => {
        await lockSession(client, input.session);
        const rows = await workRows(client, scanWhere, scanParams(input));
        return { rows: rows.slice(0, input.limit), hasMore: rows.length > input.limit };
      });
    },
    async claimPrepared(raw, admit) {
      const input = structuredClone(raw);
      validateSchedule(input);
      return tx(async (client) => {
        const s = await lockSession(client, input.session, input.graphRevision);
        const resources = (await resourceRows(client, s.ref, "share")).map((item) => item.record);
        const agent = await lockAgent(client, input.actor, s.ref.domainId);
        // This statement must start after the registration lock wait for a fresh READ COMMITTED snapshot.
        const { rows: [count] } = await client.query<{ count: number }>(countActiveSql, [agent.id]);
        const activeClaims = count?.count ?? reject();
        if (activeClaims >= input.maxActiveClaims) return { status: "capacity" };
        if (!input.candidates.length) return { status: "changed" };
        const { rows: [selected] } = await client.query<{ id: string }>(`SELECT w.id FROM work_items w
          JOIN unnest($1::uuid[],$2::bigint[]) AS p(id,revision) ON w.id=p.id AND w.revision=p.revision
          WHERE w.session_instance_id=$3 AND w.domain_id=$4 AND w.kind=ANY($5::text[]) AND (w.target_agent_id IS NULL OR w.target_agent_id=$6)
          AND w.attempt_count<w.max_attempts AND (w.status='queued' OR (w.status='leased' AND w.lease_expires_at<=clock_timestamp()))
          ORDER BY w.priority DESC,w.created_at,w.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`,
        [input.candidates.map((r) => r.id), input.candidates.map((r) => r.revision), s.ref.instanceId, s.ref.domainId, input.allowedKinds, agent.id]);
        if (!selected) return { status: "changed" };
        const locked = await facts(client, s, resources, selected.id, agent, hostEpoch);
        const token = randomUUID();
        authorize(() => {
          admitSchedule({ ...locked, activeClaims }, admit);
          return true;
        });
        const updated = await client.query(`UPDATE work_items SET status='leased',lease_agent_id=$2,lease_execution_epoch=$3,lease_token=$4,
          lease_expires_at=clock_timestamp()+$5::integer*interval '1 millisecond',attempt_count=attempt_count+1,revision=revision+1,updated_at=clock_timestamp()
          WHERE id=$1 AND revision=$6 AND attempt_count<max_attempts AND (status='queued' OR (status='leased' AND lease_expires_at<=clock_timestamp()))`,
        [selected.id, agent.id, agent.epoch, token, input.leaseMs, locked.row.revision]);
        if (updated.rowCount !== 1) return reject();
        return { status: "claimed", row: await workRow(client, s.ref.domainId, selected.id) ?? reject() };
      });
    },
    async renewPrepared(raw, admit) {
      const input = structuredClone(raw);
      validateSchedule(input);
      return tx(async (client) => {
        const { fence, actor } = input;
        const s = await lockSession(client, fence.session, fence.graphRevision);
        const resources = (await resourceRows(client, s.ref, "share")).map((item) => item.record);
        const agent = await lockAgent(client, actor, s.ref.domainId);
        const proof = fence.execution;
        if (proof.registrationId !== agent.id || proof.executionEpoch !== agent.epoch) return reject();
        const predicates = `id=$1 AND session_instance_id=$2 AND revision=$3 AND status='leased' AND lease_agent_id=$4
          AND lease_execution_epoch=$5 AND attempt_count=$6 AND lease_token=$7`;
        const params = [fence.id, s.ref.instanceId, fence.revision, agent.id, agent.epoch, proof.attempt, proof.leaseToken];
        if ((await client.query(`SELECT id FROM work_items WHERE ${predicates} FOR UPDATE`, params)).rowCount !== 1) return reject();
        const locked = await facts(client, s, resources, fence.id, agent, hostEpoch);
        if (!locked.row.lease || Date.parse(locked.row.lease.expiresAt) <= locked.databaseTime) return reject();
        authorize(() => {
          admitSchedule(locked, admit);
          return true;
        });
        if ((await client.query(`UPDATE work_items SET lease_expires_at=clock_timestamp()+$8::integer*interval '1 millisecond',revision=revision+1,updated_at=clock_timestamp()
          WHERE ${predicates} AND lease_expires_at>clock_timestamp()`, [...params, input.leaseMs])).rowCount !== 1) return reject();
        return await workRow(client, s.ref.domainId, fence.id) ?? reject();
      });
    },
    async expireExhausted(raw, limit, beforeWrite) {
      const ref = structuredClone(raw);
      if (!bounded(limit, 1, 32)) return reject();
      return tx(async (client) => {
        await lockSession(client, ref);
        const { rows } = await client.query<{ id: string }>(exhaustedSql, [ref.instanceId, ref.domainId, limit]);
        const ids = rows.map((r) => r.id);
        if (!ids.length) return [];
        authorize(() => {
          if (beforeWrite) synchronousAdmission(beforeWrite, [...ids]);
          return true;
        });
        const result = await client.query<Pick<StoredWork, "id" | "revision">>(`UPDATE work_items SET status='failed',lease_agent_id=NULL,lease_execution_epoch=NULL,
          lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp(),last_failure_code='lease_expired',
          last_failure_message='Work lease expired.',last_failed_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND status='leased'
          AND lease_expires_at<=clock_timestamp() AND attempt_count>=max_attempts RETURNING id,revision::text`, [ids]);
        return result.rows;
      });
    },
  };
}

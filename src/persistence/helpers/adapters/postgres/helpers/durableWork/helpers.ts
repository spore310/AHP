import type { ResourceRef } from "@authorization";
import { resourceKey } from "@authorization/helpers/resources";
import { captureData } from "@persistence/helpers/durability/helpers";
import { captureWorkIntent, sameWorkIntent } from "@persistence/helpers/durability/workIntent";
import type { Admission } from "@persistence/helpers/durability/types";
import type { DurableWorkRepository, WorkFence } from "@persistence/helpers/durability/workTypes";
import type { WorkResourceSelection } from "@work/helpers/selections/types";
import type { PoolClientLike } from "../connection";
import { reject, resourceRows, sessionRow } from "../resources/rows/helpers";
import type { DurableTransaction, ResourceRow } from "../resources/types";
import { workRow } from "./rows";

function anchors(rules: readonly WorkResourceSelection[], rows: readonly ResourceRow[], domainId: string) {
  const available = new Map(rows.map((row) => [resourceKey(row.record.ref), row]));
  const checked = new Set<string>();
  function active(ref: ResourceRef, depth = 0): ResourceRow {
    const key = resourceKey(ref);
    const row = available.get(key);
    if (!row || row.record.lifecycle !== "active" || ref.domainId !== domainId || depth > 32) return reject();
    if (!checked.has(key)) {
      for (const parent of [row.record.parent, row.record.grantParent]) if (parent) active(parent, depth + 1);
      checked.add(key);
    }
    return row;
  }
  return rules.map((rule) => ({ pk: active(rule.resource).pk, include: rule.include, descendants: rule.includeDescendants }));
}

// Session lifecycle/graph writers take the session row exclusively. Agent rebinding takes the registration row.
async function lockWork(client: PoolClientLike, fence: WorkFence): Promise<void> {
  const session = await sessionRow(client, fence.session, "share");
  if (session?.lifecycle !== "active") reject();
  const execution = fence.execution;
  if (execution) {
    const registration = await client.query(`SELECT id FROM agent_registrations WHERE domain_id=$1 AND id=$2
      AND enabled AND execution_epoch=$3 FOR SHARE`, [fence.session.domainId, execution.registrationId, execution.executionEpoch]);
    if (registration.rowCount !== 1) reject();
  }
  const guard = execution ? "AND status='leased' AND lease_agent_id=$5 AND lease_execution_epoch=$6 AND lease_token=$7 AND attempt_count=$8 AND lease_expires_at>clock_timestamp()" : "";
  const values = [fence.id, fence.session.instanceId, fence.session.domainId, fence.revision];
  const locked = await client.query(`SELECT id FROM work_items WHERE id=$1 AND session_instance_id=$2 AND domain_id=$3
    AND revision=$4 ${guard} FOR UPDATE`, execution ? [...values, execution.registrationId, execution.executionEpoch, execution.leaseToken, execution.attempt] : values);
  if (locked.rowCount !== 1) reject();
}

export function createPostgresDurableWork(tx: DurableTransaction, authorize: (check: Admission) => void): DurableWorkRepository {
  return {
    graph(domainId, input, replay) {
      const { kind, id, instanceId } = input;
      const actor = replay?.submitter;
      const key = replay && actor?.principal.domainId === domainId
        ? [replay.kind, replay.requestKey, actor.kind, actor.principal.subject, actor.kind === "agent" ? actor.agentId : null]
        : undefined;
      return tx(async (client) => {
        const refColumn = "jsonb_build_object('kind','session','id',s.session_uri,'domainId',s.domain_id,'instanceId',s.session_instance_id)";
        const locatorWhere = "r.domain_id=$1 AND r.kind=$2 AND r.resource_id=$3 AND ($4::text IS NULL OR r.instance_id=$4)";
        const locator = [domainId, kind, id, instanceId];
        const active = `FROM canonical_resources r JOIN sessions s ON s.session_instance_id=r.session_instance_id
          WHERE ${locatorWhere} AND r.lifecycle_status='active' AND s.lifecycle_status='active'`;
        const anchor = await client.query<{ ref: ResourceRef<"session"> }>(`SELECT ${refColumn} AS ref ${active} FOR SHARE OF s`, locator);
        let ref = anchor.rows[0]?.ref;
        let previousId: string | undefined;
        if (key) {
          const actorKey = "w.kind=$5 AND w.request_key=$6 AND w.submitted_by_kind=$7 AND w.submitted_by_subject=$8 AND w.submitted_by_agent_id IS NOT DISTINCT FROM $9";
          if (ref) {
            const existing = await client.query<{ id: string }>(`SELECT w.id FROM work_items w WHERE w.session_instance_id=$1 AND w.domain_id=$2
              AND w.kind=$3 AND w.request_key=$4 AND w.submitted_by_kind=$5 AND w.submitted_by_subject=$6 AND w.submitted_by_agent_id IS NOT DISTINCT FROM $7`,
            [ref.instanceId, domainId, ...key]);
            previousId = existing.rows[0]?.id;
          } else {
            const matches = await client.query<{ id: string; ref: ResourceRef<"session"> }>(`SELECT w.id,${refColumn} AS ref
              FROM work_items w JOIN sessions s ON s.session_instance_id=w.session_instance_id
              WHERE w.domain_id=$1 AND s.lifecycle_status='active' AND ${actorKey} AND NOT EXISTS (SELECT 1 ${active})
              AND EXISTS (SELECT FROM work_resource_selections a JOIN canonical_resources r ON r.resource_pk=a.resource_pk
                WHERE a.work_id=w.id AND ${locatorWhere}) ORDER BY w.session_instance_id LIMIT 2 FOR SHARE OF s`, [...locator, ...key]);
            if (matches.rowCount !== 1) return undefined;
            ref = matches.rows[0]?.ref;
            previousId = matches.rows[0]?.id;
          }
        }
        if (!ref) return undefined;
        const session = await sessionRow(client, ref);
        if (session?.lifecycle !== "active") return undefined;
        const resources = (await resourceRows(client, ref)).map((r) => r.record);
        if (anchor.rowCount && !resources.some((r) => r.lifecycle === "active" && r.ref.kind === kind && r.ref.id === id
          && (instanceId === undefined || r.ref.instanceId === instanceId))) return undefined;
        const previous = previousId && await workRow(client, domainId, previousId);
        return { session, resources, ...(previous && { previous }) };
      });
    },
    get(domainId, id) {
      return tx((client) => workRow(client, domainId, id));
    },
    async submit(command, revision, limits, admit) {
      const intent = captureWorkIntent(command);
      const { session: sessionLimit, host: hostLimit } = limits;
      if (![hostLimit, sessionLimit].every((limit) => Number.isSafeInteger(limit) && limit > 0) || !intent.scope.some((r) => r.include)) reject();
      return tx(async (client) => {
        const session = await sessionRow(client, intent.session, "share");
        if (!session || session.lifecycle !== "active" || session.graphRevision !== revision || intent.submitter.principal.domainId !== session.ref.domainId) return reject();
        const domain = session.ref.domainId;
        const existing = await client.query<{ id: string }>("SELECT id FROM work_items WHERE session_instance_id=$1 AND kind=$2 AND request_key=$3",
          [session.ref.instanceId, intent.kind, intent.requestKey]);
        const previous = existing.rows[0];
        if (previous) {
          const row = await workRow(client, domain, previous.id);
          if (!row || !sameWorkIntent(row, intent)) reject();
          authorize(admit);
          return { id: previous.id, created: false };
        }
        const rows = await resourceRows(client, session.ref);
        const scope = anchors(intent.scope, rows, domain);
        const announce = anchors(intent.announce, rows, domain);
        if (intent.targetAgentId !== null && !(await client.query(
          "SELECT 1 FROM agent_registrations WHERE domain_id=$1 AND id=$2 AND enabled FOR SHARE", [domain, intent.targetAgentId])).rowCount) reject();
        const full = await client.query<{ full: boolean }>(`SELECT EXISTS(SELECT FROM work_items WHERE status IN ('queued','leased') LIMIT 1 OFFSET $1)
          OR EXISTS(SELECT FROM work_items WHERE session_instance_id=$2 AND status IN ('queued','leased') LIMIT 1 OFFSET $3) AS full`,
        [hostLimit - 1, session.ref.instanceId, sessionLimit - 1]);
        if (full.rows[0]?.full !== false) reject();
        authorize(admit);
        const inserted = await client.query<{ id: string }>(`INSERT INTO work_items(session_instance_id,domain_id,kind,request_key,priority,input,
          submitted_data,data,max_attempts,submitted_by_kind,submitted_by_subject,submitted_by_agent_id,target_agent_id)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$7::jsonb,$8,$9,$10,$11,$12) RETURNING id`,
        [session.ref.instanceId, domain, intent.kind, intent.requestKey, intent.priority, JSON.stringify(intent.input), JSON.stringify(intent.submittedData),
          intent.maxAttempts, intent.submitter.kind, intent.submitter.principal.subject, intent.submitter.kind === "agent" ? intent.submitter.agentId : null, intent.targetAgentId]);
        const id = inserted.rows[0]?.id ?? reject();
        const selections = [...scope.map((r) => ({ ...r, purpose: "scope" })), ...announce.map((r) => ({ ...r, purpose: "announce" }))];
        await client.query(`INSERT INTO work_resource_selections(work_id,session_instance_id,domain_id,purpose,resource_pk,include,include_descendants)
          SELECT $1,$2,$3,purpose,pk,include,descendants FROM jsonb_to_recordset($4::jsonb) r(purpose text,pk uuid,include boolean,descendants boolean)`,
        [id, session.ref.instanceId, domain, JSON.stringify(selections)]);
        return { id, created: true };
      }, true); // Exclusive host row serializes host-wide quotas and concurrent inserts of one request.
    },
    async replaceData(input, change, admit) {
      const fence = structuredClone(input);
      const data = captureData(change.data);
      const expected = change.expectedDataRevision;
      return tx(async (client) => {
        await lockWork(client, fence);
        authorize(admit);
        const res = await client.query<{ dataRevision: string }>(`UPDATE work_items SET data=$1::jsonb,data_revision=data_revision+1,
          revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND data_revision=$3
          AND ($4::boolean IS FALSE OR lease_expires_at>clock_timestamp()) RETURNING data_revision::text AS "dataRevision"`,
        [JSON.stringify(data), fence.id, expected, !!fence.execution]);
        const row = res.rows[0] ?? reject();
        return { data, dataRevision: row.dataRevision };
      });
    },
    async settle(input, command, admit) {
      const fence = structuredClone(input);
      if (!fence.execution) reject();
      const status = command.status;
      const retry = command.status === "failed" && command.retryable;
      const code = command.status === "failed" ? command.code : null;
      const summary = command.status === "failed" ? command.summary : null;
      const result = command.status === "completed" ? JSON.stringify(captureData(command.result, 256 * 1024)) : null;
      const data = command.data && JSON.stringify(captureData(command.data.data));
      const expected = command.data?.expectedDataRevision;
      return tx(async (client) => {
        await lockWork(client, fence);
        authorize(admit);
        const settled = await client.query(`UPDATE work_items SET
          status=CASE WHEN $2::boolean AND attempt_count<max_attempts THEN 'queued' ELSE $3 END,
          lease_agent_id=NULL,lease_execution_epoch=NULL,lease_token=NULL,lease_expires_at=NULL,result=$4::jsonb,
          data=COALESCE($5::jsonb,data),data_revision=data_revision+CASE WHEN $5::jsonb IS NULL THEN 0 ELSE 1 END,
          revision=revision+1,updated_at=clock_timestamp(),last_failure_code=COALESCE($7,last_failure_code),
          last_failure_message=COALESCE($8,last_failure_message),last_failed_at=CASE WHEN $7::text IS NULL THEN last_failed_at ELSE clock_timestamp() END
          WHERE id=$1 AND lease_expires_at>clock_timestamp() AND ($5::jsonb IS NULL OR data_revision=$6::bigint)`,
        [fence.id, retry, status, result, data, expected, code, summary]);
        if (settled.rowCount !== 1) reject();
        return await workRow(client, fence.session.domainId, fence.id) ?? reject();
      });
    },
  };
}

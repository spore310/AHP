import { resourceKey } from "@authorization/helpers/resources";
import type { WorkResourceSelection } from "@work/helpers/selections/types";
import type { StoredWork } from "@persistence/helpers/durability/workTypes";
import type { QueryableClient } from "../../types";

// Keep all six PostgreSQL fractional-second digits for work list keysets.
const stamp = (column: string): string => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const columns = `SELECT
  w.id, jsonb_build_object('kind','session','id',s.session_uri,'domainId',s.domain_id,'instanceId',s.session_instance_id) AS session,
  s.owner_principal_subject AS owner, w.kind, w.request_key AS "requestKey", w.priority, w.input, w.submitted_data AS "submittedData",
  w.data,w.data_revision::text AS "dataRevision",w.revision::text,w.status,w.target_agent_id AS "targetAgentId",
  w.max_attempts AS "maxAttempts", w.attempt_count AS "attemptCount", ${stamp("w.created_at")} AS "createdAt", ${stamp("w.updated_at")} AS "updatedAt",
  jsonb_build_object('kind',w.submitted_by_kind,'principal',jsonb_build_object('domainId',s.domain_id,'subject',w.submitted_by_subject))
    || CASE WHEN w.submitted_by_kind='agent' THEN jsonb_build_object('agentId',w.submitted_by_agent_id) ELSE '{}'::jsonb END AS submitter,
  CASE WHEN w.status='leased' THEN jsonb_build_object('registrationId',w.lease_agent_id,'executionEpoch',w.lease_execution_epoch::text,
    'attempt',w.attempt_count,'leaseToken',w.lease_token,'expiresAt',${stamp("w.lease_expires_at")}) END AS lease,
  w.result, CASE WHEN w.last_failure_code IS NOT NULL THEN jsonb_build_object('code',w.last_failure_code,'summary',COALESCE(w.last_failure_message,''),
    'occurredAt',${stamp("w.last_failed_at")}) END AS failure,
  (SELECT jsonb_agg(jsonb_build_object('purpose',a.purpose,'rule',jsonb_build_object(
    'resource',jsonb_build_object('kind',r.kind,'domainId',r.domain_id,'id',r.resource_id,'instanceId',r.instance_id),
    'include',a.include,'includeDescendants',a.include_descendants)))
   FROM work_resource_selections a JOIN canonical_resources r ON r.resource_pk=a.resource_pk WHERE a.work_id=w.id) AS selections
  FROM work_items w JOIN sessions s ON s.session_instance_id=w.session_instance_id AND s.domain_id=w.domain_id`;

type WorkRow = Omit<StoredWork, "scope" | "announce" | "result" | "failure" | "lease"> & {
  readonly selections: readonly { readonly purpose: "scope" | "announce"; readonly rule: WorkResourceSelection }[];
  readonly lease: StoredWork["lease"] | null;
  readonly result: StoredWork["result"] | null;
  readonly failure: StoredWork["failure"] | null;
};

/** Reads work and its selector set from one statement snapshot. */
export async function workRow(db: QueryableClient, domain: string, id: string): Promise<StoredWork | undefined> {
  const { rows: [row] } = await db.query<WorkRow>(`${columns} WHERE w.domain_id=$1 AND w.id=$2`, [domain, id]);
  if (!row) return undefined;
  const { selections, lease, result, failure, ...rest } = row;
  const rules = (purpose: "scope" | "announce") => selections.filter((s) => s.purpose === purpose).map((s) => s.rule)
    .sort((a, b) => resourceKey(a.resource) < resourceKey(b.resource) ? -1 : 1);
  return { ...rest, scope: rules("scope"), announce: rules("announce"),
    ...(lease ? { lease } : {}), ...(result ? { result } : {}), ...(failure ? { failure } : {}) };
}

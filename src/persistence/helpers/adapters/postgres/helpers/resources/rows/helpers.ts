import type { ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { captureRef, captureData } from "@persistence/helpers/durability/helpers";
import type { Admission, ResourceRecord, StoredSession } from "@persistence/helpers/durability/types";
import { RepositoryError } from "@persistence/types";
import type { QueryableClient } from "../../../types";
import type { ResourceRow } from "../types";

export function reject(): never {
  throw new RepositoryError("conflict", "The durable instance or revision is unavailable.");
}
export function admit(check: Admission): void {
  const decision: unknown = check();
  if (decision instanceof Promise) void decision.catch(() => undefined);
  if (decision !== true) reject();
}
export function assertSessionRef(ref: ResourceRef): void {
  if (ref.kind !== "session") reject();
}

export function captureRecord(row: ResourceRecord): ResourceRecord {
  if (row.lifecycle !== "creating" || row.dataRevision !== "1" || row.resourceRevision !== "1") reject();
  return structuredClone({ ...row, ref: captureRef(row.ref), session: captureRef(row.session),
    ...(row.parent ? { parent: captureRef(row.parent) } : {}),
    ...(row.grantParent ? { grantParent: captureRef(row.grantParent) } : {}),
    data: captureData(row.data), recoveryInput: captureData(row.recoveryInput),
    registration: captureData(row.registration), runtimeMetadata: captureData(row.runtimeMetadata) });
}

const date = (field: string): string => `to_char(${field} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const ref = (alias: string): string => `jsonb_build_object('domainId',${alias}.domain_id, 'kind',${alias}.kind,
  'id',${alias}.resource_id, 'instanceId',${alias}.instance_id)`;
const sessionRef = "jsonb_build_object('domainId',s.domain_id,'kind','session','id',s.session_uri,'instanceId',s.session_instance_id)";
export const sessionColumns = `SELECT ${sessionRef} AS ref,
  jsonb_build_object('id',t.id,'key',t.type_key,'version',t.version) || CASE WHEN t.work_manifest->'kinds'='[]'::jsonb THEN '{}'::jsonb
    ELSE jsonb_build_object('workManifest',t.work_manifest->'kinds') END AS type,
  s.provider_id AS "providerId", s.owner_principal_subject AS owner, s.lifecycle_status AS lifecycle,
  s.durable_state AS state, s.state_revision::text AS "stateRevision", s.graph_revision::text AS "graphRevision",
  s.last_server_seq::float8 AS "lastServerSeq", ${date("s.created_at")} AS "createdAt", ${date("s.modified_at")} AS "modifiedAt"
  FROM sessions s JOIN session_types t ON t.id=s.session_type_id`;

export async function sessionRow(db: QueryableClient, session: ResourceRef<"session">, mode?: "share" | "exclusive"): Promise<StoredSession | undefined> {
  assertSessionRef(session);
  // A locked read is an admission: only the fenced owning host may take it, and the
  // row lock orders it against an ownership transfer of the same session.
  const lock = mode === undefined ? "" : `AND s.owner_host_id=current_setting('ahp.host_id', true) FOR ${mode === "share" ? "SHARE" : "UPDATE"} OF s`;
  const result = await db.query<StoredSession>(`${sessionColumns}
    WHERE s.session_instance_id=$1 AND s.domain_id=$2 AND s.session_uri=$3 ${lock}`, [session.instanceId, session.domainId, session.id]);
  return result.rows[0];
}

const resourceColumns = `SELECT r.resource_pk AS pk, jsonb_build_object(
    'ref',${ref("r")},'session',${sessionRef},'owner',r.owner_principal_subject,'providerId',r.provider_id,
    'driver',jsonb_build_object('key',r.runtime_driver_key,'version',r.runtime_driver_version),
    'operationId',r.provision_key,'registration',r.registration_data,'recoveryInput',r.recovery_input,
    'runtimeMetadata',r.runtime_metadata,'data',r.data,'dataRevision',r.data_revision::text,'lifecycle',r.lifecycle_status,
    'resourceRevision',r.resource_revision::text,'createdAt',${date("r.created_at")},'modifiedAt',${date("r.updated_at")}
  ) || CASE WHEN p.resource_pk IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('parent',${ref("p")}) END
    || CASE WHEN g.resource_pk IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('grantParent',${ref("g")}) END AS record
  FROM canonical_resources r JOIN sessions s ON s.session_instance_id=r.session_instance_id
  LEFT JOIN canonical_resources p ON p.resource_pk=r.parent_resource_pk LEFT JOIN canonical_resources g ON g.resource_pk=r.grant_parent_resource_pk`;

export async function resourceRows(db: QueryableClient, session: ResourceRef<"session">, lock?: "share"): Promise<ResourceRow[]> {
  const result = await db.query<ResourceRow>(`${resourceColumns} WHERE s.session_instance_id=$1 AND s.domain_id=$2 AND s.session_uri=$3
    ORDER BY r.resource_pk LIMIT 257 ${lock ? "FOR SHARE OF r" : ""}`, [session.instanceId, session.domainId, session.id]);
  if (result.rows.length > 256) reject();
  return result.rows;
}
export async function resourceRow(db: QueryableClient, target: ResourceRef, lock = false): Promise<ResourceRow | undefined> {
  const result = await db.query<ResourceRow>(`${resourceColumns} WHERE r.domain_id=$1 AND r.kind=$2 AND r.resource_id=$3 AND r.instance_id=$4
    ${lock ? "FOR UPDATE OF r" : ""}`,
  [target.domainId, target.kind, target.id, target.instanceId]);
  return result.rows[0];
}

/** A new public ID has no row to lock. Serialize competing reservations in this schema before admission. */
export async function lockReservation(db: QueryableClient, row: ResourceRecord, keys: string[] = []): Promise<void> {
  keys.push(JSON.stringify(["resource", row.ref.kind, row.ref.id]), JSON.stringify(["operation", row.operationId]));
  await db.query(`SELECT pg_advisory_xact_lock('host_state'::regclass::oid::int, slot)
    FROM (SELECT DISTINCT hashtext(value) AS slot FROM unnest($1::text[]) ids(value) ORDER BY slot) ordered`, [keys]);
  const used = await db.query(`SELECT 1 FROM canonical_resources WHERE provision_key=$1 OR (kind=$2 AND resource_id=$3
    AND (lifecycle_status<>'retired' OR (domain_id=$4 AND instance_id=$5))) LIMIT 1`,
  [row.operationId, row.ref.kind, row.ref.id, row.ref.domainId, row.ref.instanceId]);
  if (used.rowCount) reject();
}

export function requireRow(rows: readonly ResourceRow[], target: ResourceRef): ResourceRow {
  return rows.find((row) => sameResource(row.record.ref, target)) ?? reject();
}

export async function insertResource(db: QueryableClient, row: ResourceRecord, parent?: string, grant?: string): Promise<void> {
  await db.query(`INSERT INTO canonical_resources (session_instance_id,domain_id,kind,resource_id,instance_id,
    owner_principal_subject,provider_id,parent_resource_pk,grant_parent_resource_pk,registration_data,runtime_driver_key,
    runtime_driver_version,provision_key,recovery_input,runtime_metadata,data,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)`,
  [row.session.instanceId, row.ref.domainId, row.ref.kind, row.ref.id, row.ref.instanceId, row.owner, row.providerId, parent, grant,
    JSON.stringify(row.registration), row.driver.key, row.driver.version, row.operationId, JSON.stringify(row.recoveryInput),
    JSON.stringify(row.runtimeMetadata), JSON.stringify(row.data), row.createdAt, row.modifiedAt]);
}

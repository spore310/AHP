import type { ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { captureRef, resourceOrder } from "@persistence/helpers/durability/helpers";
import type { Admission, ResourceRecord } from "@persistence/helpers/durability/types";
import type { DurableTransaction } from "../types";
import { reject, requireRow, resourceRows, sessionRow } from "../rows/helpers";

export function retirement(tx: DurableTransaction, authorize: (check: Admission) => void) {
  async function begin(sessionRef: ResourceRef<"session">, resourceRef: ResourceRef, check: Admission): Promise<readonly ResourceRecord[]> {
    const session = captureRef(sessionRef);
    const ref = captureRef(resourceRef);
    return tx(async (client) => {
      const s = await sessionRow(client, session, "exclusive");
      if (!s || s.lifecycle === "retired") reject();
      const rows = await resourceRows(client, session);
      const target = requireRow(rows, ref);
      if (target.record.lifecycle === "retired") reject();
      const whole = sameResource(session, ref);
      const keys = new Set([target.pk]);
      const closure = resourceOrder(rows.map((row) => row.record)).filter((row) => {
        if (row.lifecycle === "retired") return false;
        if (whole || sameResource(row.ref, ref) || [row.parent, row.grantParent].some((p) => p && keys.has(requireRow(rows, p).pk))) {
          keys.add(requireRow(rows, row.ref).pk);
          return true;
        }
        return false;
      });
      await client.query("SELECT resource_pk FROM canonical_resources WHERE resource_pk=ANY($1::uuid[]) ORDER BY resource_pk FOR UPDATE", [[...keys]]);
      const workPredicate = `w.session_instance_id=$1 AND w.status IN ('queued','leased') AND ($2 OR EXISTS
          (SELECT 1 FROM work_resource_selections a WHERE a.work_id=w.id AND a.include AND a.purpose='scope' AND a.resource_pk=ANY($3::uuid[])))`;
      const workParams = [session.instanceId, whole, [...keys]];
      await client.query(`SELECT w.id FROM work_items w WHERE ${workPredicate} ORDER BY w.id FOR UPDATE`, workParams);
      authorize(check);
      const changed = await client.query(`UPDATE canonical_resources SET lifecycle_status='retiring',
        updated_at=clock_timestamp(),resource_revision=resource_revision+1 WHERE resource_pk=ANY($1::uuid[]) AND lifecycle_status<>'retiring'`, [[...keys]]);
      if (changed.rowCount) await client.query(`UPDATE sessions SET graph_revision=graph_revision+1,modified_at=clock_timestamp(),
        lifecycle_status=CASE WHEN $2 THEN 'retiring' ELSE lifecycle_status END WHERE session_instance_id=$1`, [session.instanceId, whole]);
      await client.query(`UPDATE work_items w SET status='cancelled',lease_agent_id=NULL,lease_execution_epoch=NULL,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp()
        WHERE ${workPredicate}`, workParams);
      const current = await resourceRows(client, session);
      return closure.reverse().map((row) => requireRow(current, row.ref).record);
    });
  }
  async function finish(sessionRef: ResourceRef<"session">, resourceRef: ResourceRef): Promise<void> {
    const session = captureRef(sessionRef);
    const ref = captureRef(resourceRef);
    return tx(async (client) => {
      if (!await sessionRow(client, session, "exclusive")) reject();
      const rows = await resourceRows(client, session);
      const target = requireRow(rows, ref);
      if (target.record.lifecycle !== "retiring" || rows.some(({ record }) => record.lifecycle !== "retired"
        && [record.parent, record.grantParent].some((p) => p && sameResource(p, ref)))) reject();
      await client.query(`UPDATE canonical_resources SET lifecycle_status='retired', retired_at=now(), updated_at=now(),
        resource_revision=resource_revision+1 WHERE resource_pk=$1`, [target.pk]);
      const whole = sameResource(session, ref);
      await client.query(`UPDATE sessions SET graph_revision=graph_revision+1,modified_at=now(),
        lifecycle_status=CASE WHEN $2 THEN 'retired' ELSE lifecycle_status END,
        retired_at=CASE WHEN $2 THEN now() ELSE retired_at END WHERE session_instance_id=$1`, [session.instanceId, whole]);
    });
  }
  async function purge(sessionRef: ResourceRef<"session">, retainAfter: string): Promise<boolean> {
    const session = captureRef(sessionRef);
    const cutoff = Date.parse(retainAfter);
    if (!Number.isFinite(cutoff)) reject();
    return tx(async (client) => {
      const current = await sessionRow(client, session, "exclusive");
      if (!current || current.lifecycle !== "retired" || Date.parse(current.modifiedAt) >= cutoff) return false;
      const rows = await resourceRows(client, session);
      if (rows.some(({ record }) => record.lifecycle !== "retired" || Date.parse(record.modifiedAt) >= cutoff)) return false;
      const protectedRows = await client.query(`SELECT 1 FROM work_items WHERE session_instance_id=$1
        AND (status IN ('queued','leased') OR updated_at >= $2) LIMIT 1`, [session.instanceId, retainAfter]);
      if (protectedRows.rowCount) return false;
      // Explicit retention progresses in bounded work batches. Anchor FKs survive until their job is purged.
      await client.query(`DELETE FROM work_items WHERE id IN
        (SELECT id FROM work_items WHERE session_instance_id=$1 ORDER BY id LIMIT 256)`, [session.instanceId]);
      if ((await client.query("SELECT 1 FROM work_items WHERE session_instance_id=$1 LIMIT 1", [session.instanceId])).rowCount) return false;
      for (const record of resourceOrder(rows.map((row) => row.record)).reverse()) {
        await client.query("DELETE FROM canonical_resources WHERE resource_pk=$1", [requireRow(rows, record.ref).pk]);
      }
      await client.query("DELETE FROM sessions WHERE session_instance_id=$1", [session.instanceId]);
      return true;
    });
  }
  return { begin, finish, purge };
}

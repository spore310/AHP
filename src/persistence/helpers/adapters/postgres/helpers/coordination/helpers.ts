import { captureRef } from "@persistence/helpers/durability/helpers";
import type { HostCoordination, HostMember, JsonObject, SessionLocation, StoredSession } from "@persistence/helpers/durability/types";
import { RepositoryError } from "@persistence/types";
import type { QueryableClient } from "../../types";
import { LEASE_KEY } from "../ownership/helpers";
import type { PostgresOwnership } from "../ownership";
import { reject, sessionColumns, sessionRow } from "../resources/rows/helpers";
import type { DurableTransaction } from "../resources/types";

const NOTIFY = "SELECT pg_notify('ahp_host_events', 'host_events'::regclass::oid::text)";
const location = `jsonb_build_object('domainId',s.domain_id,'kind','session','id',s.session_uri,'instanceId',s.session_instance_id) AS session,
  s.owner_host_id AS "hostId", s.ownership_epoch::text AS "ownershipEpoch", s.lifecycle_status AS lifecycle`;
const unsupported = (): never => {
  throw new RepositoryError("conflict", "This store is not shared between logical hosts.");
};
const ownershipEvent = (client: QueryableClient, kind: string, origin: string, moved: readonly SessionLocation[]): Promise<unknown> =>
  client.query(`INSERT INTO host_events (topic, kind, origin_host_id, session_instance_id, domain_id, session_uri, entity_id, revision)
    SELECT 'ownership', $1, $2, (m->'session'->>'instanceId')::uuid, m->'session'->>'domainId', m->'session'->>'id', m->>'hostId', (m->>'ownershipEpoch')::bigint
    FROM jsonb_array_elements($3::jsonb) AS moved(m)`, [kind, origin, JSON.stringify(moved)]);

interface MemberRow {
  hostId: string; instanceId: string; generation: string; role: HostMember["role"];
  endpoint: string | null; capabilities: JsonObject; policyRevision: number;
}

/** SQL for namespace membership, per-session ownership and durable events. */
export function createPostgresCoordination(
  owner: PostgresOwnership,
  tx: DurableTransaction,
  read: <T>(lookup: (db: QueryableClient) => Promise<T>) => Promise<T>,
): HostCoordination {
  const me = owner.hostId;
  // The row update waits for every transaction that already holds the namespace share lock.
  const revoke = (): Promise<number> => tx(async (client) => {
    const bumped = await client.query<{ revision: number }>(`UPDATE host_namespaces SET authority_revision=authority_revision+1,
        updated_at=clock_timestamp() RETURNING authority_revision::float8 AS revision`);
    const revision = bumped.rows[0]?.revision ?? reject();
    await client.query("INSERT INTO host_events (topic, kind, origin_host_id, revision) VALUES ('authority','revoked',$1,$2)", [me, revision]);
    await client.query(NOTIFY);
    return revision;
  }, false, false);
  return {
    namespaceId: owner.namespaceId ?? "", hostId: me, instanceId: owner.instanceId, generation: owner.generation, shared: owner.shared,
    members: () => read(async (db) => (await db.query<MemberRow>(`SELECT host_id AS "hostId", instance_id AS "instanceId",
        generation::text AS generation, role, endpoint, capabilities, policy_revision::float8 AS "policyRevision"
      FROM host_members WHERE lease_expires_at>clock_timestamp() ORDER BY host_id, instance_id LIMIT 257`)).rows
      .map(({ endpoint, ...member }) => ({ ...member, ...(endpoint === null ? {} : { endpoint }) }))),
    isCurrentMember: (hostId, instanceId, generation) => read(async (db) => /^[0-9]{1,18}$/u.test(generation) && (await db.query(
      "SELECT 1 FROM host_members WHERE host_id=$1 AND instance_id=$2 AND generation=$3::bigint AND lease_expires_at>clock_timestamp()",
      [hostId, instanceId, generation])).rowCount === 1),
    setRole: (role) => owner.setRole(role),
    locate: (target) => read(async (db) => {
      if ("sessionUri" in target) {
        return (await db.query<SessionLocation>(`SELECT ${location} FROM sessions s WHERE s.session_uri=$1 AND s.lifecycle_status<>'retired'`,
          [target.sessionUri])).rows[0];
      }
      if (!/^[0-9a-f-]{36}$/iu.test(target.workId)) return undefined;
      return (await db.query<SessionLocation>(`SELECT ${location} FROM work_items w
        JOIN sessions s ON s.session_instance_id=w.session_instance_id WHERE w.id=$1::uuid`, [target.workId])).rows[0];
    }),
    listOwned: (after) => read(async (db) => (await db.query<StoredSession>(`${sessionColumns} WHERE s.lifecycle_status<>'retired' AND s.owner_host_id=$2
      AND ($1::uuid IS NULL OR s.session_instance_id>$1) ORDER BY s.session_instance_id LIMIT 64`, [after ?? null, me])).rows),
    async transfer(session, toHostId) {
      if (!owner.shared) unsupported();
      const ref = captureRef<"session">(session);
      if (toHostId === me) reject();
      await tx(async (client) => {
        // The exclusive session lock waits for writes this owner already admitted.
        const current = await sessionRow(client, ref, "exclusive");
        if (!current || current.lifecycle === "retired" || current.lifecycle === "retiring") reject();
        // Placement is authoritative: a live, active member that declares the session's provider.
        const target = await client.query(`SELECT 1 FROM host_members WHERE host_id=$1 AND role='active' AND lease_expires_at>clock_timestamp()
          AND capabilities->'providers' ? $2 FOR SHARE`, [toHostId, current.providerId]);
        if (!target.rowCount) reject();
        await client.query("SELECT set_config('ahp.session_transfer','1',true)");
        const moved = await client.query<SessionLocation>(`UPDATE sessions s SET owner_host_id=$2, ownership_epoch=ownership_epoch+1
          WHERE session_instance_id=$1 AND owner_host_id=$3 RETURNING ${location}`, [ref.instanceId, toHostId, me]);
        if (moved.rowCount !== 1) reject();
        await ownershipEvent(client, "transferred", me, moved.rows);
        await client.query(NOTIFY);
      });
    },
    orphanedOwners: () => read(async (db) => (await db.query<{ hostId: string }>(`SELECT DISTINCT s.owner_host_id AS "hostId" FROM sessions s
      WHERE s.lifecycle_status<>'retired' AND s.owner_host_id<>$1 AND NOT EXISTS (
        SELECT FROM host_members m WHERE m.host_id=s.owner_host_id AND m.lease_expires_at>clock_timestamp())
      ORDER BY 1 LIMIT 64`, [me])).rows.map((row) => row.hostId)),
    async adopt(fromHostId, limit = 64) {
      if (!owner.shared) unsupported();
      if (fromHostId === me || !Number.isSafeInteger(limit) || limit < 1 || limit > 256) reject();
      // The previous owner's row is locked without waiting, and only after a non-waiting test shows that
      // owner is not live. This host therefore never waits on another host's row: two hosts cannot wait
      // on each other, and a transaction a dead owner left open cannot stall this host's own writes.
      // Everything this transaction waits for follows the usual order: own host row, the namespace
      // row, then session rows.
      return tx(async (client) => {
        const previous = await client.query<{ slot: number }>("SELECT lease_slot AS slot FROM host_state WHERE host_id=$1", [fromHostId]);
        const slot = previous.rows[0]?.slot;
        if (slot === undefined) return [];
        // A held lease or a live membership means the previous owner may still be authoritative.
        const free = await client.query<{ free: boolean }>(`SELECT pg_try_advisory_xact_lock(${LEASE_KEY}) AND NOT EXISTS (
          SELECT FROM host_members WHERE host_id=$2 AND lease_expires_at>clock_timestamp()) AS free`, [slot, fromHostId]);
        if (!free.rows[0]?.free) reject();
        // Refused when anything still holds that row. The caller, or the adoption sweep, tries again.
        await client.query("SELECT 1 FROM host_state WHERE host_id=$1 FOR UPDATE NOWAIT", [fromHostId]).catch(() => reject());
        await owner.lock(client);
        // Advancing the epoch fences a paused predecessor before any session changes hands.
        await client.query("UPDATE host_state SET ownership_epoch=ownership_epoch+1, updated_at=clock_timestamp() WHERE host_id=$1", [fromHostId]);
        await client.query("SELECT set_config('ahp.session_transfer','1',true)");
        const moved = await client.query<SessionLocation>(`UPDATE sessions s SET owner_host_id=$2, ownership_epoch=ownership_epoch+1
          WHERE session_instance_id IN (SELECT session_instance_id FROM sessions WHERE owner_host_id=$1 AND lifecycle_status<>'retired'
            AND provider_id=ANY($4::text[]) ORDER BY session_instance_id LIMIT $3 FOR UPDATE) RETURNING ${location}`, [fromHostId, me, limit, [...owner.providers]]);
        if (moved.rowCount) {
          await ownershipEvent(client, "adopted", me, moved.rows);
          await client.query(NOTIFY);
        }
        return moved.rows;
      }, false, false);
    },
    authorityRevision: () => owner.authorityRevision(),
    revokeAuthority: async () => {
      const revision = await revoke();
      owner.noteAuthority(revision);
      return revision;
    },
    acknowledgeAuthority: (revision) => {
      owner.acknowledgeAuthority(revision);
    },
    async allocateServerSeq(count) {
      if (!owner.shared) unsupported();
      if (!Number.isSafeInteger(count) || count < 1 || count > 16) reject();
      return read(async (db) => (await db.query<{ seq: number }>("SELECT nextval('host_server_seq')::float8 AS seq FROM generate_series(1,$1)", [count])).rows.map((row) => row.seq));
    },
    subscribeEvents: (listener) => owner.subscribeEvents(listener),
  };
}

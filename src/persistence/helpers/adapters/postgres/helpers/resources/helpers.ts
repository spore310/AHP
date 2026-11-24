import { createPostgresDurableWork } from "../durableWork/helpers";
import { fenceHostWork } from "@persistence/helpers/durability/workFences";
import type { ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { canRetrySessionStart, captureRef, captureData } from "@persistence/helpers/durability/helpers";
import type { Admission, DurableHost, DurableStorage, StoredSession, Transition } from "@persistence/helpers/durability/types";
import { RepositoryError } from "@persistence/types";
import { acquirePostgresOwnership, type PostgresOwnership } from "../ownership";
import { createPostgresPool, databaseFailure, uncertainCommit } from "../connection";
import type { PostgresOptions, QueryableClient } from "../../types";
import { admit, assertSessionRef, captureRecord, insertResource, lockReservation, reject, requireRow, resourceRow, resourceRows, sessionColumns, sessionRow } from "./rows/helpers";
import { retirement } from "./retirement/helpers";
import type { DurableTransaction, ResourceRow } from "./types";

const operational = (status: string): boolean => status === "creating" || status === "active";

function validateParents(rows: ResourceRow[], ref: ResourceRef, seen: Set<string>, heights: Map<string, number>, requireActiveAncestors = false): number {
  const target = requireRow(rows, ref);
  if (!operational(target.record.lifecycle) || seen.has(target.pk)) reject();
  if (requireActiveAncestors && ref.kind !== "session" && target.record.lifecycle !== "active") reject();
  const known = heights.get(target.pk);
  if (known !== undefined) return known;
  if (seen.size >= 32) reject();
  seen.add(target.pk);
  const heightsOfParents = [target.record.parent, target.record.grantParent]
    .map((parent) => parent ? validateParents(rows, parent, seen, heights, requireActiveAncestors) : 0);
  seen.delete(target.pk);
  const height = 1 + Math.max(...heightsOfParents);
  heights.set(target.pk, height);
  return height;
}

/** A logical host retains a dedicated lock connection and uses ordinary pooled clients for transactions. */
export function createPostgresDurableStorage(options: PostgresOptions): DurableStorage {
  return createOwnedPostgresStorage(options);
}

/** Adapter composition shares one acquired ownership lease with registration writes. */
export function createOwnedPostgresStorage(
  options: PostgresOptions,
  acquired?: (owner: PostgresOwnership, host: DurableHost) => void,
): DurableStorage {
  const { connectionString, maxConnections = 10 } = options;
  if (!connectionString || !Number.isSafeInteger(maxConnections) || maxConnections < 1) throw new Error("Invalid durable storage configuration.");
  return {
    async acquire(hostId, onLost) {
      const owner = await acquirePostgresOwnership(connectionString, hostId, onLost);
      const pool = createPostgresPool({ connectionString, maxConnections });
      let closing = false;
      let disposed: Promise<void> | undefined;
      const isOpen = (): boolean => !closing && owner.isOpen();
      const tx: DurableTransaction = async (write, checkpoint = false) => {
        if (!isOpen()) reject();
        const client = await pool.connect().catch((error: unknown) => {
          throw databaseFailure(error);
        });
        let discard = false;
        const disconnected = (): boolean => discard;
        try {
          await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          await owner.lock(client, checkpoint);
          if (!isOpen()) reject();
          const result = await write(client);
          if (!isOpen()) reject();
          try {
            await client.query("COMMIT");
          } catch (error) {
            if (uncertainCommit(error)) {
              discard = true;
              const unknown = new RepositoryError("outcome_unknown", "The durable commit outcome is uncertain.");
              unknown.name = "DurableCommitUncertain";
              throw unknown;
            }
            throw error;
          }
          return result;
        } catch (error) {
          if (!disconnected()) {
            await client.query("ROLLBACK").catch(() => {
              discard = true;
            });
          }
          throw databaseFailure(error);
        } finally {
          client.release(discard);
        }
      };
      const read = async <T>(lookup: (db: QueryableClient) => Promise<T>): Promise<T> => {
        if (!isOpen()) reject();
        try {
          const result = await lookup(pool);
          if (!isOpen()) reject();
          return result;
        } catch (error) {
          throw databaseFailure(error);
        }
      };
      const authorize = (check: Admission): void => {
        if (!isOpen()) reject();
        admit(check);
        if (!isOpen()) reject();
      };
      const retire = retirement(tx, authorize);
      async function transition(input: Transition, check: Admission): Promise<void> {
        const change = structuredClone({ ...input, ref: captureRef(input.ref), session: captureRef(input.session),
          ...(input.runtimeMetadata === undefined ? {} : { runtimeMetadata: captureData(input.runtimeMetadata) }) });
        if (["retired", "retiring"].includes(change.expected) || !["creating", "active", "failed", "suspended"].includes(change.next)) reject();
        await tx(async (client) => {
          const session = await sessionRow(client, change.session, "exclusive");
          if (!session || ["retired", "retiring"].includes(session.lifecycle)) reject();
          const resource = await resourceRow(client, change.ref, true);
          if (!resource || !sameResource(resource.record.session, change.session) || resource.record.lifecycle !== change.expected
            || resource.record.operationId !== change.operationId) reject();
          if (change.next === "creating" && (!canRetrySessionStart(resource.record) || change.runtimeMetadata !== undefined)) reject();
          if (change.next === "active" && resource.record.ref.kind !== "session") {
            if (!operational(session.lifecycle)) reject();
            const rows = await resourceRows(client, session.ref);
            const heights = new Map<string, number>();
            for (const parent of [resource.record.parent, resource.record.grantParent]) {
              if (parent) validateParents(rows, parent, new Set(), heights, true);
            }
          }
          authorize(check);
          const result = await client.query(`UPDATE canonical_resources SET lifecycle_status=$1,resource_revision=resource_revision+1,
            updated_at=clock_timestamp(),runtime_metadata=COALESCE($2::jsonb,runtime_metadata)
            WHERE resource_pk=$3 AND lifecycle_status=$4 AND provision_key=$5`,
          [change.next, JSON.stringify(change.runtimeMetadata), resource.pk, change.expected, change.operationId]);
          if (result.rowCount !== 1) reject();
          const root = sameResource(change.ref, change.session);
          if (root || change.expected !== change.next) await client.query(`UPDATE sessions SET
            lifecycle_status=CASE WHEN $2 THEN $3 ELSE lifecycle_status END, modified_at=clock_timestamp(),
            graph_revision=graph_revision+$4 WHERE session_instance_id=$1`, [change.session.instanceId, root, change.next, change.expected === change.next ? 0 : 1]);
        });
      }
      const host: DurableHost = {
        work: createPostgresDurableWork(tx, authorize, owner.epoch),
        epoch: owner.epoch, serverSeq: owner.serverSeq, isOpen,
        release() {
          closing = true;
          disposed ??= pool.end().finally(() => owner.release());
          return disposed;
        },
        sessions: {
          async reserve(record, root, check) {
            const session = structuredClone({ ...record, ref: captureRef(record.ref), state: captureData(record.state, 2 * 1024 * 1024) });
            const row = captureRecord(root);
            assertSessionRef(session.ref);
            if (!sameResource(session.ref, row.ref) || !sameResource(row.session, session.ref)
              || row.parent || row.grantParent || session.owner !== row.owner || session.providerId !== row.providerId || session.lifecycle !== "creating"
              || session.stateRevision !== "1" || session.graphRevision !== "1" || !Number.isSafeInteger(session.lastServerSeq)) reject();
            await tx(async (client) => {
              await lockReservation(client, row, [JSON.stringify(["session", session.ref.instanceId]), JSON.stringify(["typeId", session.type.id]),
                JSON.stringify(["typeVersion", session.type.key, session.type.version])]);
              const occupied = await client.query("SELECT 1 FROM sessions WHERE session_instance_id=$1 OR (session_uri=$2 AND lifecycle_status<>'retired') LIMIT 1",
                [session.ref.instanceId, session.ref.id]);
              if (occupied.rowCount) reject();
              const manifest = JSON.stringify({ kinds: session.type.workManifest ?? [] });
              const catalogue = await client.query<{ exact: boolean }>(`SELECT (id=$1 AND type_key=$2 AND version=$3 AND provider_id=$4 AND work_manifest=$5::jsonb) AS exact
                FROM session_types WHERE id=$1 OR (type_key=$2 AND version=$3) FOR SHARE`,
              [session.type.id, session.type.key, session.type.version, session.providerId, manifest]);
              if (catalogue.rows.some((r) => !r.exact)) reject();
              authorize(check);
              if (!catalogue.rowCount) {
                await client.query(`INSERT INTO session_types(id,type_key,version,provider_id,work_manifest) VALUES ($1,$2,$3,$4,$5::jsonb)
                ON CONFLICT DO NOTHING`, [session.type.id, session.type.key, session.type.version, session.providerId, manifest]);
              }
              const added = await client.query(`INSERT INTO sessions (session_instance_id,session_uri,domain_id,provider_id,session_type_id,
                owner_principal_subject,durable_state,created_at,modified_at,last_server_seq)
                SELECT $1,$2,$3,$4,t.id,$6,$7::jsonb,$8,$9,$10 FROM session_types t
                WHERE t.id=$5 AND t.type_key=$11 AND t.version=$12 AND t.provider_id=$4 AND t.work_manifest=$13::jsonb`,
              [session.ref.instanceId, session.ref.id, session.ref.domainId, session.providerId, session.type.id, session.owner,
                JSON.stringify(session.state), session.createdAt, session.modifiedAt, session.lastServerSeq, session.type.key, session.type.version, manifest]);
              if (added.rowCount !== 1) reject();
              await insertResource(client, row);
            });
          },
          get(ref) {
            const session = captureRef(ref);
            return read((db) => sessionRow(db, session));
          },
          listRecoverable(after) {
            return read(async (db) => (await db.query<StoredSession>(`${sessionColumns} WHERE s.lifecycle_status<>'retired'
              AND ($1::uuid IS NULL OR s.session_instance_id>$1) ORDER BY s.session_instance_id LIMIT 64`, [after])).rows);
          },
          async commitState(input, check) {
            const change = { ...input, ref: captureRef(input.ref), state: captureData(input.state, 2 * 1024 * 1024) };
            assertSessionRef(change.ref);
            if (!Number.isSafeInteger(change.serverSeq)) reject();
            return tx(async (client) => {
              const current = await sessionRow(client, change.ref, "exclusive");
              if (!current || current.stateRevision !== change.expectedRevision || !["active", "creating", "failed"].includes(current.lifecycle)) reject();
              const validSequence = await client.query("SELECT 1 FROM host_state WHERE host_id=$1 AND server_seq<$2", [hostId, change.serverSeq]);
              if (!validSequence.rowCount) reject();
              authorize(check);
              const updated = await client.query<{ revision: string }>(`UPDATE sessions SET state_revision=state_revision+1,durable_state=$1::jsonb,
                modified_at=$2,last_server_seq=$3 WHERE session_instance_id=$4 AND domain_id=$5 AND session_uri=$6 AND state_revision=$7
                AND lifecycle_status IN ('active','creating','failed') RETURNING state_revision::text AS revision`,
              [JSON.stringify(change.state), change.modifiedAt, change.serverSeq, change.ref.instanceId, change.ref.domainId, change.ref.id, change.expectedRevision]);
              const revision = updated.rows[0]?.revision;
              if (revision === undefined) reject();
              const checkpoint = await client.query("UPDATE host_state SET server_seq=$1,updated_at=now() WHERE host_id=$2 AND server_seq<$1",
                [change.serverSeq, hostId]);
              if (checkpoint.rowCount !== 1) reject();
              return revision;
            }, true);
          },
          transition,
          beginRetirement: (session, check) => retire.begin(session, session, check),
          finishRetirement: (session) => retire.finish(session, session),
          purge: retire.purge,
        },
        resources: {
          async reserve(input, check) {
            const row = captureRecord(input);
            await tx(async (client) => {
              await lockReservation(client, row);
              const s = await sessionRow(client, row.session, "exclusive");
              if (!s || !operational(s.lifecycle) || row.ref.kind === "session" || row.ref.domainId !== s.ref.domainId
                || row.owner !== s.owner || row.providerId !== s.providerId || !row.parent) reject();
              const rows = await resourceRows(client, s.ref);
              if (rows.length >= 256) reject();
              for (const parent of [row.parent, row.grantParent]) {
                if (parent && validateParents(rows, parent, new Set(), new Map()) >= 32) reject();
              }
              const parent = requireRow(rows, row.parent).pk;
              const grant = row.grantParent && requireRow(rows, row.grantParent).pk;
              await client.query("SELECT resource_pk FROM canonical_resources WHERE resource_pk=ANY($1::uuid[]) ORDER BY resource_pk FOR KEY SHARE",
                [grant ? [parent, grant] : [parent]]);
              authorize(check);
              await insertResource(client, row, parent, grant);
              await client.query("UPDATE sessions SET graph_revision=graph_revision+1 WHERE session_instance_id=$1", [s.ref.instanceId]);
            });
          },
          get(ref) {
            const target = captureRef(ref);
            return read(async (db) => (await resourceRow(db, target))?.record);
          },
          listSession(ref) {
            const session = captureRef(ref);
            return read(async (db) => (await resourceRows(db, session)).map((row) => row.record));
          },
          activate: transition,
          async replaceData(sessionRef, ref, change, check) {
            const session = captureRef(sessionRef);
            const target = captureRef(ref);
            const data = captureData(change.data);
            const expected = change.expectedDataRevision;
            return tx(async (client) => {
              const s = await sessionRow(client, session, "share");
              if (!s || !operational(s.lifecycle)) reject();
              const row = await resourceRow(client, target, true);
              if (!row || !sameResource(row.record.session, session) || !operational(row.record.lifecycle)) reject();
              const ancestors = [row.record.parent, row.record.grantParent].filter((p) => p && p.kind !== "session");
              if (ancestors.length) {
                const rows = await resourceRows(client, session);
                const heights = new Map<string, number>();
                for (const parent of ancestors) {
                  if (parent) validateParents(rows, parent, new Set(), heights, true);
                }
              }
              if (row.record.dataRevision !== expected) {
                authorize(check);
                return { status: "conflict" };
              }
              authorize(check);
              const result = await client.query<{ revision: string }>(`UPDATE canonical_resources SET data_revision=data_revision+1,
                resource_revision=resource_revision+1,updated_at=clock_timestamp(),data=$1::jsonb
                WHERE resource_pk=$2 AND data_revision=$3 RETURNING data_revision::text AS revision`, [JSON.stringify(data), row.pk, expected]);
              const revision = result.rows[0]?.revision;
              return revision === undefined ? { status: "conflict" } : { status: "updated", value: { data, dataRevision: revision } };
            });
          },
          beginRetirement: retire.begin,
          finishRetirement: retire.finish,
        },
      };
      const guarded = fenceHostWork(host);
      acquired?.(owner, guarded);
      return guarded;
    },
  };
}

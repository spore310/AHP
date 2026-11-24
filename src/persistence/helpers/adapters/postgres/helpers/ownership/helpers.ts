import { Client } from "pg";
import { RepositoryError } from "@persistence/types";
import type { PostgresOwnership } from "./types";

const unavailable = (): RepositoryError => new RepositoryError("database", "Durable host ownership is unavailable.");

/** The retained connection owns a database-local, relation-specific advisory lock. */
export const acquirePostgresOwnership = async (
  connectionString: string,
  hostId: string,
  onLost?: () => void,
): Promise<PostgresOwnership> => {
  if (!hostId.trim() || Buffer.byteLength(hostId) > 512) throw unavailable();
  const owner = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    application_name: "AgentHostingProtocol ownership",
  });
  let open = true;
  const isOpen = (): boolean => open;
  const lost = (): void => {
    if (!open) return;
    open = false;
    onLost?.();
  };
  owner.on("error", lost);
  owner.on("end", lost);
  try {
    await owner.connect();
    const result = await owner.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock('host_state'::regclass::oid::bigint) AS acquired",
    );
    if (!result.rows[0]?.acquired) throw unavailable();
    // A takeover waits for prior admitted transactions before returning its new epoch.
    await owner.query("SET lock_timeout = '30s'");
    const bumped = await owner.query<{ epoch: string; seq: string }>(`
      INSERT INTO host_state (host_id, ownership_epoch) VALUES ($1, 1)
      ON CONFLICT (host_id) DO UPDATE SET ownership_epoch = host_state.ownership_epoch + 1,
        updated_at = clock_timestamp()
      RETURNING ownership_epoch::text AS epoch, server_seq::text AS seq`, [hostId]);
    const row = bumped.rows[0];
    if (!row || !isOpen()) throw unavailable();
    let release: Promise<void> | undefined;
    return {
      epoch: row.epoch,
      serverSeq: Number(row.seq),
      isOpen,
      async lock(client, checkpoint = false) {
        if (!open) throw unavailable();
        const lockMode = checkpoint ? "FOR UPDATE" : "FOR SHARE";
        const held = await client.query(
          `SELECT 1 FROM host_state WHERE host_id = $1 AND ownership_epoch = $2::bigint ${lockMode}`,
          [hostId, row.epoch],
        );
        if (held.rowCount !== 1 || !isOpen()) throw unavailable();
      },
      release() {
        open = false;
        release ??= owner.end();
        return release;
      },
    };
  } catch {
    open = false;
    await owner.end().catch(() => undefined);
    throw unavailable();
  }
};

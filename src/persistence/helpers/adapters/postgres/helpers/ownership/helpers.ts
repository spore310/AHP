import { randomUUID } from "node:crypto";
import { Client, type QueryResult, type QueryResultRow } from "pg";
import type { HostClaim, HostEvent, HostEventDelivery } from "@persistence/helpers/durability/types";
import { RepositoryError } from "@persistence/types";
import { clientConfig } from "../connection";
import type { PostgresOptions } from "../../types";
import type { PostgresOwnership } from "./types";

const unavailable = (): RepositoryError => new RepositoryError("database", "Durable host ownership is unavailable.");
const PROTOCOL = "SELECT set_config('ahp.host_protocol','2',true), set_config('ahp.host_id',$1,true)";
/** Single-key space, above every relation oid, so it never meets the pre-0005 store lock or reservation locks. */
export const LEASE_KEY = "(($1::bigint << 32) | 'host_state'::regclass::oid::bigint)";
const EVENT_PAGE = 512;
const providersOf = (capabilities: HostClaim["capabilities"]): readonly string[] => {
  const providers = capabilities?.providers;
  return Array.isArray(providers) ? providers.filter((id): id is string => typeof id === "string") : [];
};

interface NamespaceRow { namespace_id: string | null; store_mode: "exclusive" | "shared"; revision: string; digest: string | null; authority: string }
interface EventRow {
  horizon: string; pruned: string; event_id: string | null; topic: HostEvent["topic"]; kind: string; origin_host_id: string | null;
  session_instance_id: string | null; domain_id: string | null; session_uri: string | null; entity_id: string | null; revision: string | null; occurred_at: Date;
}

/**
 * Joins the namespace as one runtime instance, then holds the logical host's lease.
 *
 * The retained connection owns a database-local advisory lock keyed by the host's
 * lease slot. Membership liveness uses the database clock; write fencing uses the
 * ownership epoch checked inside every transaction.
 */
export const acquirePostgresOwnership = async (
  connection: PostgresOptions | string,
  hostId: string,
  onLost?: () => void,
  claim?: HostClaim,
): Promise<PostgresOwnership> => {
  const options: PostgresOptions = typeof connection === "string" ? { connectionString: connection } : connection;
  const instanceId = claim?.instanceId ?? randomUUID();
  const leaseMs = claim?.leaseMs ?? 15_000;
  const retryMs = claim?.standby?.retryMs ?? 1_000;
  if (!hostId.trim() || Buffer.byteLength(hostId) > 512 || !instanceId.trim() || Buffer.byteLength(instanceId) > 512
    || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000
    || !Number.isSafeInteger(retryMs) || retryMs < 10 || retryMs > 60_000
    || (claim !== undefined && (!Number.isSafeInteger(claim.policy.revision) || claim.policy.revision < 0
      || (claim.maxInstances !== undefined && (!Number.isSafeInteger(claim.maxInstances) || claim.maxInstances < 1))))) throw unavailable();
  const owner = new Client({ ...clientConfig(options), connectionTimeoutMillis: 5_000, query_timeout: Math.max(leaseMs, 30_000),
    keepAlive: true, application_name: "AgentHostingProtocol ownership" });
  // One statement at a time on the retained connection. The heartbeat, the event reader, pruning and
  // role changes share it, and they are queued here in call order rather than inside the driver.
  let tail: Promise<unknown> = Promise.resolve();
  const statement = <R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[], closing = false): Promise<QueryResult<R>> => {
    const next = tail.then(() => {
      // Once ownership has ended only the statements that end it are still issued.
      if (!isOpen() && !closing) throw unavailable();
      return owner.query<R>(text, values);
    });
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
  let open = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let poller: ReturnType<typeof setInterval> | undefined;
  let pruner: ReturnType<typeof setInterval> | undefined;
  const stopTimers = (): void => {
    clearInterval(heartbeat);
    clearInterval(poller);
    clearInterval(pruner);
  };
  const isOpen = (): boolean => open;
  const lost = (): void => {
    if (!open) return;
    open = false;
    stopTimers();
    listeners.clear();
    void owner.end().catch(() => undefined);
    onLost?.();
  };
  owner.on("error", lost);
  owner.on("end", lost);
  const listeners = new Set<(delivery: HostEventDelivery) => void>();
  const policyRevision = claim?.policy.revision ?? 0;
  let authority = 0;
  let acknowledged = 0;
  let generation = "0";
  const observeAuthority = (value: string): void => {
    const revision = Number(value);
    if (revision <= authority) return;
    authority = revision;
    try {
      claim?.onAuthorityRevoked?.(revision);
    } catch { /* The fence below stays closed until the host acknowledges. */ }
  };
  const transaction = async <T>(run: () => Promise<T>): Promise<T> => {
    await statement("BEGIN");
    try {
      await statement(PROTOCOL, [hostId]);
      const result = await run();
      await statement("COMMIT");
      return result;
    } catch (error) {
      await statement("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };
  const join = (): Promise<number> => transaction(async () => {
    await statement("SELECT pg_advisory_xact_lock('host_state'::regclass::oid::int, hashtext('ahp-host-join'))");
    const { rows: [ns] } = await statement<NamespaceRow>(`SELECT namespace_id, store_mode, policy_revision::text AS revision,
      policy_digest AS digest, authority_revision::text AS authority FROM host_namespaces`);
    if (!ns) throw unavailable();
    const { rows: [others] } = await statement<{ rows: number; live: number }>(`SELECT
      (SELECT count(*) FROM host_state WHERE host_id<>$1)::int AS rows,
      (SELECT count(*) FROM host_members WHERE host_id<>$1 AND lease_expires_at>clock_timestamp())::int AS live`, [hostId]);
    if (!others) throw unavailable();
    if (claim === undefined) {
      if (ns.store_mode !== "exclusive") throw unavailable();
    } else {
      const mode = claim.shared ? "shared" : "exclusive";
      // A store that already served another logical host is never rebound by a newcomer.
      if (ns.namespace_id === null ? others.rows > 0 : ns.namespace_id !== claim.namespaceId) throw unavailable();
      // A recreated namespace starts with no policy on record: the first trusted configuration sets it.
      if (ns.store_mode !== mode && (others.live > 0 || (mode === "exclusive" && others.rows > 0))) throw unavailable();
      const revision = Number(ns.revision);
      if (claim.policy.revision < revision || (claim.policy.revision === revision && ns.digest !== null && ns.digest !== claim.policy.digest)) throw unavailable();
      if (ns.namespace_id === null || ns.store_mode !== mode || claim.policy.revision > revision || ns.digest === null) {
        await statement(`UPDATE host_namespaces SET namespace_id=$1, store_mode=$2, policy_revision=$3, policy_digest=$4, updated_at=clock_timestamp()`,
          [claim.namespaceId, mode, claim.policy.revision, claim.policy.digest]);
      }
      if (mode === "shared" && ns.store_mode !== "shared") {
        await statement(`SELECT setval('host_server_seq', GREATEST((SELECT last_value FROM host_server_seq),
          COALESCE((SELECT max(server_seq) FROM host_state),0), COALESCE((SELECT max(last_server_seq) FROM sessions),0)))`);
      }
    }
    await statement("DELETE FROM host_members WHERE lease_expires_at<=clock_timestamp()");
    const { rows: [mine] } = await statement<{ same: number; siblings: number }>(`SELECT
      count(*) FILTER (WHERE instance_id=$2)::int AS same, count(*) FILTER (WHERE instance_id<>$2)::int AS siblings
      FROM host_members WHERE host_id=$1`, [hostId, instanceId]);
    if (!mine || mine.same > 0 || (claim?.maxInstances !== undefined && mine.siblings >= claim.maxInstances)) throw unavailable();
    const member = await statement<{ generation: string }>(`INSERT INTO host_members
      (host_id, instance_id, generation, credential_id, policy_revision, endpoint, capabilities, lease_expires_at)
      VALUES ($1,$2,nextval('host_member_generation_seq'),$3,$4,$5,$6::jsonb,clock_timestamp()+($7::int*interval '1 millisecond'))
      RETURNING generation::text AS generation`,
    [hostId, instanceId, claim?.credentialId ?? null, policyRevision, claim?.endpoint ?? null, JSON.stringify(claim?.capabilities ?? {}), leaseMs]);
    generation = member.rows[0]?.generation ?? "0";
    // The guard trigger refuses a second logical host in an exclusive store.
    await statement("INSERT INTO host_state (host_id, ownership_epoch) VALUES ($1, 0) ON CONFLICT (host_id) DO NOTHING", [hostId]);
    const slot = await statement<{ slot: number }>("SELECT lease_slot AS slot FROM host_state WHERE host_id=$1", [hostId]);
    await statement("SELECT pg_notify('ahp_host_events', 'host_events'::regclass::oid::text)");
    // A joining instance holds no cached authority, so the current revision is its baseline.
    authority = Number(ns.authority);
    acknowledged = authority;
    return slot.rows[0]?.slot ?? 0;
  });
  let lastRenewed = performance.now();
  const renew = async (): Promise<void> => {
    const { rows: [row] } = await statement<{ renewed: number; policy: string; authority: string }>(`WITH renewed AS (
        UPDATE host_members SET lease_expires_at=clock_timestamp()+($4::int*interval '1 millisecond'), updated_at=clock_timestamp()
        WHERE host_id=$1 AND instance_id=$2 AND generation=$3::bigint AND lease_expires_at>clock_timestamp() RETURNING 1)
      SELECT (SELECT count(*) FROM renewed)::int AS renewed, policy_revision::text AS policy, authority_revision::text AS authority
      FROM host_namespaces`, [hostId, instanceId, generation, leaseMs]);
    // An expired or replaced membership cannot revive itself, and stale trusted configuration is fenced.
    if (row?.renewed !== 1 || Number(row.policy) !== policyRevision) throw unavailable();
    lastRenewed = performance.now();
    observeAuthority(row.authority);
  };
  const wait = (signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      if (signal.aborted) reject(unavailable());
      else resolve();
    };
    const timer = setTimeout(done, retryMs);
    signal.addEventListener("abort", done, { once: true });
  });
  try {
    await owner.connect();
    await statement("SET lock_timeout = '30s'");
    const slot = await join();
    if (!slot) throw unavailable();
    for (let waiting = false; ; waiting = true) {
      const result = await statement<{ acquired: boolean }>(`SELECT pg_try_advisory_lock(${LEASE_KEY}) AS acquired`, [slot]);
      if (result.rows[0]?.acquired) break;
      const standby = claim?.standby;
      if (!standby || standby.signal.aborted) throw unavailable();
      if (!waiting) standby.onStandby?.();
      await wait(standby.signal);
      await renew();
    }
    // A takeover waits for prior admitted transactions before returning its new epoch.
    const row = await transaction(async () => {
      const bumped = await statement<{ epoch: string; seq: string }>(`UPDATE host_state SET ownership_epoch=ownership_epoch+1,
        updated_at=clock_timestamp() WHERE host_id=$1
        RETURNING ownership_epoch::text AS epoch, GREATEST(server_seq, (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM host_server_seq))::text AS seq`, [hostId]);
      const active = await statement(`UPDATE host_members SET role='active', updated_at=clock_timestamp()
        WHERE host_id=$1 AND instance_id=$2 AND generation=$3::bigint AND lease_expires_at>clock_timestamp()`, [hostId, instanceId, generation]);
      if (active.rowCount !== 1) throw unavailable();
      return bumped.rows[0];
    });
    if (!row || !isOpen()) throw unavailable();
    await renew();
    // A revocation seen while waiting as a standby needs no acknowledgement: a newly
    // active instance holds no connection and no cached authority.
    acknowledged = authority;
    heartbeat = setInterval(() => {
      // A silent partition never reports an error. The local deadline closes admission anyway.
      if (performance.now() - lastRenewed > leaseMs) lost();
      else void renew().catch(lost);
    }, Math.max(250, Math.floor(leaseMs / 3)));
    heartbeat.unref();

    let cursor: string | undefined;
    let polling = false;
    let again = false;
    const shouldPollAgain = (): boolean => again;
    const deliver = (delivery: HostEventDelivery): void => {
      for (const listener of [...listeners]) {
        try {
          listener(delivery);
        } catch { /* One consumer cannot block another. */ }
      }
    };
    const poll = async (): Promise<void> => {
      if (!open) return;
      if (polling) {
        again = true;
        return;
      }
      polling = true;
      try {
        do {
          again = false;
          if (cursor === undefined) {
            const start = await statement<{ horizon: string }>("SELECT (pg_snapshot_xmin(pg_current_snapshot())::text)::bigint::text AS horizon");
            cursor = start.rows[0]?.horizon;
            continue;
          }
          // Every transaction below the snapshot horizon has finished, so a lower
          // identifier that commits late is still inside a range read afterwards.
          const { rows } = await statement<EventRow>(`SELECT h.horizon::text AS horizon, r.pruned_through::text AS pruned, e.event_id, e.topic, e.kind,
              e.origin_host_id, e.session_instance_id, e.domain_id, e.session_uri, e.entity_id, e.revision::text AS revision, e.occurred_at
            FROM (SELECT (pg_snapshot_xmin(pg_current_snapshot())::text)::bigint AS horizon) h CROSS JOIN host_event_retention r
            LEFT JOIN host_events e ON e.xact_id>=$1::bigint AND e.xact_id<h.horizon ORDER BY e.seq NULLS LAST LIMIT ${String(EVENT_PAGE + 1)}`, [cursor]);
          const first = rows[0];
          if (!first) break;
          const reset = rows.length > EVENT_PAGE || BigInt(first.pruned) >= BigInt(cursor);
          cursor = first.horizon;
          if (reset) {
            deliver({ type: "reset" });
            continue;
          }
          // A revocation committed elsewhere is observed now rather than at the next heartbeat.
          if (rows.some((row) => row.topic === "authority")) void renew().catch(lost);
          for (const row of rows) {
            if (row.event_id === null) continue;
            deliver({ type: "event", event: {
              eventId: row.event_id, topic: row.topic, kind: row.kind, occurredAt: row.occurred_at.toISOString(),
              ...(row.origin_host_id === null ? {} : { originHostId: row.origin_host_id }),
              ...(row.session_instance_id === null || row.domain_id === null || row.session_uri === null
                ? {}
                : { session: { domainId: row.domain_id, kind: "session" as const, id: row.session_uri, instanceId: row.session_instance_id } }),
              ...(row.entity_id === null ? {} : { entityId: row.entity_id }), ...(row.revision === null ? {} : { revision: row.revision }),
            } });
          }
        } while (shouldPollAgain() && isOpen());
      } catch {
        // The heartbeat decides whether the connection is lost. Consumers reconcile after a failed read.
        cursor = undefined;
        deliver({ type: "reset" });
      } finally {
        polling = false;
      }
    };
    owner.on("notification", () => {
      void poll();
    });
    await statement("LISTEN ahp_host_events");
    // Events committed after this point are never skipped, even before the first consumer subscribes.
    cursor = (await statement<{ horizon: string }>("SELECT (pg_snapshot_xmin(pg_current_snapshot())::text)::bigint::text AS horizon")).rows[0]?.horizon;
    poller = setInterval(() => {
      void poll();
    }, options.eventPollMs ?? 2_000);
    poller.unref();
    // Bounded retention. The watermark tells a reader that fell behind to reconcile from state.
    const retentionMs = options.eventRetentionMs ?? 900_000;
    pruner = setInterval(() => {
      if (isOpen()) void statement(`WITH removed AS (
          DELETE FROM host_events WHERE occurred_at < clock_timestamp() - ($1::bigint * interval '1 millisecond') RETURNING xact_id)
        UPDATE host_event_retention SET pruned_through = GREATEST(pruned_through, (SELECT max(xact_id) FROM removed))
        WHERE EXISTS (SELECT FROM removed)`, [retentionMs]).catch(() => undefined);
    }, Math.min(60_000, Math.max(1_000, Math.floor(retentionMs / 2))));
    pruner.unref();

    let release: Promise<void> | undefined;
    return {
      hostId, instanceId, generation, epoch: row.epoch, serverSeq: Number(row.seq), isOpen,
      namespaceId: claim?.namespaceId, shared: claim?.shared === true, providers: providersOf(claim?.capabilities),
      authorityRevision: () => authority,
      noteAuthority(revision) {
        observeAuthority(String(revision));
      },
      acknowledgeAuthority(revision) {
        if (Number.isSafeInteger(revision) && revision <= authority && revision > acknowledged) acknowledged = revision;
      },
      async setRole(role) {
        if (!open) throw unavailable();
        const result = await statement(`UPDATE host_members SET role=$4, updated_at=clock_timestamp()
          WHERE host_id=$1 AND instance_id=$2 AND generation=$3::bigint AND lease_expires_at>clock_timestamp()`, [hostId, instanceId, generation, role]);
        if (result.rowCount !== 1) throw unavailable();
        await statement("SELECT pg_notify('ahp_host_events', 'host_events'::regclass::oid::text)");
      },
      subscribeEvents(listener) {
        listeners.add(listener);
        void poll();
        return () => {
          listeners.delete(listener);
        };
      },
      async lock(client, checkpoint = false, namespace = true) {
        if (!open) throw unavailable();
        const lockMode = checkpoint ? "FOR UPDATE" : "FOR SHARE";
        const fenced = await client.query(
          `SELECT 1 FROM host_state WHERE host_id = $1 AND ownership_epoch = $2::bigint ${lockMode}`,
          [hostId, row.epoch],
        );
        if (fenced.rowCount !== 1 || !isOpen()) throw unavailable();
        // Only a transaction that passed the epoch fence may act as this host.
        const held = await client.query<{ policy: string; authority: string }>(
          `SELECT set_config('ahp.host_protocol','2',true), set_config('ahp.host_id',$1,true),
             n.policy_revision::text AS policy, n.authority_revision::text AS authority
           FROM host_namespaces n ${namespace ? "FOR SHARE OF n" : ""}`,
          [hostId],
        );
        const current = held.rows[0];
        if (held.rowCount !== 1 || !current || !isOpen()) throw unavailable();
        if (Number(current.policy) !== policyRevision) {
          lost();
          throw unavailable();
        }
        observeAuthority(current.authority);
        // The share lock orders this transaction before any later revocation. An
        // unacknowledged revocation fails closed until the host drops cached authority.
        if (namespace && Number(current.authority) !== acknowledged) throw new RepositoryError("unauthorized", "Namespace authority was revoked.");
      },
      release() {
        open = false;
        stopTimers();
        listeners.clear();
        release ??= statement("DELETE FROM host_members WHERE host_id=$1 AND instance_id=$2 AND generation=$3::bigint", [hostId, instanceId, generation], true)
          .then(() => statement("SELECT pg_notify('ahp_host_events', 'host_events'::regclass::oid::text)", undefined, true))
          .catch(() => undefined).then(() => owner.end());
        return release;
      },
    };
  } catch {
    open = false;
    stopTimers();
    if (generation !== "0") await statement("DELETE FROM host_members WHERE host_id=$1 AND instance_id=$2 AND generation=$3::bigint", [hostId, instanceId, generation], true).catch(() => undefined);
    await owner.end().catch(() => undefined);
    throw unavailable();
  }
};

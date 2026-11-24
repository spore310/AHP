import type { AgentRegistrationLimits, PersistenceProvider } from "@persistence/types";
import { RepositoryError } from "@persistence/types";
import type { DurableHost, DurableStorage } from "@persistence/helpers/durability/types";
import { captureAgentRegistrationLimits } from "@persistence/helpers/agentRegistrations";

import { createPostgresAgentRegistrationRepository } from "./helpers/agentRegistrations";
import { createPostgresPool, databaseFailure, toIso, withTransaction } from "./helpers/connection";
import { createOwnedPostgresStorage } from "./helpers/resources/helpers";
import type { PostgresOwnership } from "./helpers/ownership";
import type { PostgresOptions, PostgresWorkRepositoryOptions, VisibleWorkRow } from "./types";

export interface PostgresPersistenceOptions extends PostgresOptions, PostgresWorkRepositoryOptions {
  readonly registrationLimits?: Partial<AgentRegistrationLimits>;
}

export const createPostgresPersistenceProvider = async (
  options: PostgresPersistenceOptions,
): Promise<PersistenceProvider> => {
  if (typeof options.connectionString !== "string" || options.connectionString.length === 0
    || (options.maxConnections !== undefined
      && (!Number.isSafeInteger(options.maxConnections) || options.maxConnections < 1))
    || (options.leaseTtlSeconds !== undefined
      && (!Number.isInteger(options.leaseTtlSeconds) || options.leaseTtlSeconds < 1))) {
    throw new Error("Invalid PostgreSQL persistence options.");
  }

  const registrationLimits = captureAgentRegistrationLimits(options.registrationLimits);
  const pool = createPostgresPool(options);
  let disposal: Promise<void> | undefined;
  let owner: PostgresOwnership | undefined;
  let activeHost: DurableHost | undefined;
  const store = createOwnedPostgresStorage(options, (lease, host) => {
    owner = lease;
    activeHost = host;
  });
  const pending = new Set<Promise<DurableHost>>();
  const durability: DurableStorage = {
    async acquire(hostId, onLost) {
      if (disposal) throw new Error("The durable storage provider is closed.");
      const acquisition = store.acquire(hostId, onLost);
      pending.add(acquisition);
      try {
        const host = await acquisition;
        if (isClosed()) {
          await host.release();
          throw new Error("The durable storage provider is closed.");
        }
        return host;
      } finally {
        pending.delete(acquisition);
      }
    },
  };
  const isClosed = (): boolean => disposal !== undefined;
  const currentOwner = (): PostgresOwnership => {
    if (!owner || !activeHost?.isOpen() || isClosed()) throw new RepositoryError("unauthorized", "An active durable host is required.");
    return owner;
  };
  const unavailable = (): Promise<never> => Promise.reject(new RepositoryError("unauthorized", "This operation requires a durable exact-instance contract."));
  try {
    return {
      durability,
      registrations: createPostgresAgentRegistrationRepository(pool, registrationLimits, currentOwner),
      sessions: { ensure: unavailable, get: unavailable, delete: unavailable },
      work: {
        submit: unavailable, claim: unavailable, renew: unavailable, complete: unavailable, fail: unavailable,
        cancel: unavailable, reconcileExpired: unavailable,
        async get({ workId, principalSubject, domainId }) {
          if (!domainId) return null;
          const lease = currentOwner();
          try {
            const item = await withTransaction(pool, async (client) => {
              await lease.lock(client);
              const { rows: [row] } = await client.query<VisibleWorkRow>(
                `SELECT w.id,s.session_uri,s.session_instance_id,w.request_key,w.kind,w.input,w.status,w.result,w.target_agent_id,
                   w.lease_expires_at,w.attempt_count,w.max_attempts,w.created_at,w.updated_at
                 FROM work_items w JOIN sessions s ON s.session_instance_id=w.session_instance_id AND s.domain_id=w.domain_id
                 WHERE w.id=$1 AND s.domain_id=$2 AND s.owner_principal_subject=$3 AND s.lifecycle_status='active' FOR SHARE OF s`,
                [workId, domainId, principalSubject]);
              return row
                ? {
                    id: row.id, sessionUri: row.session_uri, sessionInstanceId: row.session_instance_id, requestKey: row.request_key,
                    kind: row.kind, input: row.input, status: row.status, result: row.result ?? undefined, targetAgentId: row.target_agent_id ?? undefined,
                    leaseExpiresAt: row.lease_expires_at === null ? undefined : toIso(row.lease_expires_at),
                    attemptCount: row.attempt_count, maxAttempts: row.max_attempts, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
                  }
                : null;
            });
            if (currentOwner() !== lease) return null;
            return item;
          } catch (error) {
            throw databaseFailure(error);
          }
        },
        async hasDependentWork(uri) {
          currentOwner();
          const result = await pool.query(`SELECT 1 FROM sessions s JOIN work_items w
            ON w.session_instance_id=s.session_instance_id AND w.domain_id=s.domain_id
            WHERE s.session_uri=$1 AND s.lifecycle_status<>'retired' LIMIT 1`, [uri]).catch((error: unknown) => {
            throw databaseFailure(error);
          });
          return result.rowCount === 1;
        },
      },
      dispose() {
        disposal ??= Promise.allSettled([...pending]).then(async () => {
          try {
            await pool.end();
          } finally {
            await activeHost?.release();
          }
        });
        return disposal;
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
};

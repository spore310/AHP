import { captureAgentRegistrationLimits } from "@persistence/helpers/agentRegistrations";
import { RepositoryError, type AgentRegistrationLimits, type AgentRegistrationRecord, type AgentRegistrationRepository } from "@persistence/types";

import { databaseFailure, toIso, withTransaction, type PoolLike } from "../connection";
import type { AgentRegistrationRow } from "../../types";
import type { PostgresOwnership } from "../ownership";

/** Registration repository over the `agent_registrations` table. */

const SELECT_COLUMNS = `
  id, domain_id, principal_subject, agent_key, display_name, enabled, execution_epoch::text, created_at
`;

const mapRegistration = (row: AgentRegistrationRow): AgentRegistrationRecord => ({
  id: row.id,
  domainId: row.domain_id,
  executionEpoch: row.execution_epoch,
  principalSubject: row.principal_subject,
  agentKey: row.agent_key,
  displayName: row.display_name ?? undefined,
  enabled: row.enabled,
  createdAt: toIso(row.created_at),
});

export const createPostgresAgentRegistrationRepository = (
  database: PoolLike,
  options?: Partial<AgentRegistrationLimits>,
  currentOwner?: () => PostgresOwnership,
): AgentRegistrationRepository => {
  const limits = captureAgentRegistrationLimits(options);
  const change = async (sql: string, values: readonly unknown[]): Promise<AgentRegistrationRecord> => {
    try {
      const owner = currentOwner?.();
      return await withTransaction(database, async (client) => {
        if (owner) await owner.lock(client);
        const result = await client.query<AgentRegistrationRow>(sql, values);
        const row = result.rows[0];
        if (!row) throw new RepositoryError("conflict", "Agent registration unavailable.");
        return mapRegistration(row);
      }, true);
    } catch (error) {
      throw databaseFailure(error);
    }
  };
  return {
    bindExecution(record) {
      return change(`UPDATE agent_registrations SET execution_epoch = execution_epoch + 1
        WHERE id = $1 AND domain_id = $2 AND principal_subject = $3 AND agent_key = $4
          AND enabled AND execution_epoch = $5::bigint RETURNING ${SELECT_COLUMNS}`,
      [record.id, record.domainId, record.principalSubject, record.agentKey, record.executionEpoch]);
    },
    setEnabled(id, domainId, enabled) {
      return change(`UPDATE agent_registrations SET enabled = $3::boolean,
        execution_epoch = execution_epoch + CASE WHEN enabled <> $3::boolean THEN 1 ELSE 0 END
        WHERE id = $1 AND domain_id = $2 RETURNING ${SELECT_COLUMNS}`, [id, domainId, enabled]);
    },
    async register(input) {
      try {
        const owner = currentOwner?.();
        const { domainId, principalSubject, agentKey, displayName } = input;
        if (!domainId?.trim()) throw new RepositoryError("unauthorized", "An authenticated registration domain is required.");
        return await withTransaction(database, async (client) => {
          await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
          if (owner) await owner.lock(client);
          // Serialize the shared limit check and write without blocking ordinary readers.
          await client.query("LOCK TABLE agent_registrations IN SHARE ROW EXCLUSIVE MODE");
          const capacity = await client.query<{ full: boolean }>(`
            SELECT CASE WHEN EXISTS (
              SELECT 1 FROM agent_registrations WHERE domain_id = $1 AND principal_subject = $2 AND agent_key = $3
            ) THEN FALSE ELSE (
              EXISTS (SELECT 1 FROM agent_registrations LIMIT 1 OFFSET $4)
              OR EXISTS (SELECT 1 FROM agent_registrations WHERE domain_id = $1 AND principal_subject = $2 LIMIT 1 OFFSET $5)
            ) END AS full
          `, [domainId, principalSubject, agentKey, limits.maxTotal - 1, limits.maxPerPrincipal - 1]);
          if (capacity.rows[0]?.full === true) {
            throw new RepositoryError("conflict", "Agent registration capacity unavailable.");
          }
          if (capacity.rows[0]?.full !== false) throw new Error("Registration capacity unavailable.");
          const result = await client.query<AgentRegistrationRow>(`
            INSERT INTO agent_registrations (domain_id, principal_subject, agent_key, display_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (domain_id, principal_subject, agent_key)
            DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, agent_registrations.display_name)
            RETURNING ${SELECT_COLUMNS}
          `, [domainId, principalSubject, agentKey, displayName ?? null]);
          const row = result.rows[0];
          if (row === undefined) throw new Error("Registration upsert returned no row.");
          return mapRegistration(row);
        }, true);
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async getById(id, domainId) {
      if (!domainId?.trim()) return undefined;
      try {
        const result = await database.query<AgentRegistrationRow>(
          `SELECT ${SELECT_COLUMNS} FROM agent_registrations WHERE id = $1::uuid AND domain_id = $2`,
          [id, domainId],
        );
        const row = result.rows[0];
        return row === undefined ? undefined : mapRegistration(row);
      } catch (error) {
        throw databaseFailure(error);
      }
    },
  };
};

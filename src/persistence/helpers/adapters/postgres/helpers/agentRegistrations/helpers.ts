import { captureAgentRegistrationLimits } from "@persistence/helpers/agentRegistrations";
import { RepositoryError, type AgentRegistrationLimits, type AgentRegistrationRecord, type AgentRegistrationRepository } from "@persistence/types";

import { databaseFailure, toIso, withTransaction, type PoolLike } from "../connection";
import type { AgentRegistrationRow } from "../../types";

/** Registration repository over the `agent_registrations` table. */

const SELECT_COLUMNS = `
  id, principal_subject, agent_key, display_name, enabled, created_at
`;

const mapRegistration = (row: AgentRegistrationRow): AgentRegistrationRecord => ({
  id: row.id,
  principalSubject: row.principal_subject,
  agentKey: row.agent_key,
  displayName: row.display_name ?? undefined,
  enabled: row.enabled,
  createdAt: toIso(row.created_at),
});

export const createPostgresAgentRegistrationRepository = (
  database: PoolLike,
  options?: Partial<AgentRegistrationLimits>,
): AgentRegistrationRepository => {
  const limits = captureAgentRegistrationLimits(options);
  return {
    async register(input) {
      try {
        return await withTransaction(database, async (client) => {
          await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
          // Serialize the shared limit check and write without blocking ordinary readers.
          await client.query("LOCK TABLE agent_registrations IN SHARE ROW EXCLUSIVE MODE");
          const capacity = await client.query<{ full: boolean }>(`
            SELECT CASE WHEN EXISTS (
              SELECT 1 FROM agent_registrations WHERE principal_subject = $1 AND agent_key = $2
            ) THEN FALSE ELSE (
              EXISTS (SELECT 1 FROM agent_registrations LIMIT 1 OFFSET $3)
              OR EXISTS (SELECT 1 FROM agent_registrations WHERE principal_subject = $1 LIMIT 1 OFFSET $4)
            ) END AS full
          `, [input.principalSubject, input.agentKey, limits.maxTotal - 1, limits.maxPerPrincipal - 1]);
          if (capacity.rows[0]?.full === true) {
            throw new RepositoryError("conflict", "Agent registration capacity unavailable.");
          }
          if (capacity.rows[0]?.full !== false) throw new Error("Registration capacity unavailable.");
          const result = await client.query<AgentRegistrationRow>(`
            INSERT INTO agent_registrations (principal_subject, agent_key, display_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (principal_subject, agent_key)
            DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, agent_registrations.display_name)
            RETURNING ${SELECT_COLUMNS}
          `, [input.principalSubject, input.agentKey, input.displayName ?? null]);
          const row = result.rows[0];
          if (row === undefined) throw new Error("Registration upsert returned no row.");
          return mapRegistration(row);
        });
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async getById(id) {
      try {
        const result = await database.query<AgentRegistrationRow>(
          `SELECT ${SELECT_COLUMNS} FROM agent_registrations WHERE id = $1::uuid`,
          [id],
        );
        const row = result.rows[0];
        return row === undefined ? undefined : mapRegistration(row);
      } catch (error) {
        throw databaseFailure(error);
      }
    },
  };
};

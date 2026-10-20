import type { QueryResultRow } from "pg";

import type { AgentRegistrationRecord, AgentRegistrationRepository } from "../types";
import { databaseFailure, toIso, type Queryable } from "./pool";

interface AgentRegistrationRow extends QueryResultRow {
  readonly id: string;
  readonly principal_subject: string;
  readonly agent_key: string;
  readonly display_name: string | null;
  readonly enabled: boolean;
  readonly created_at: Date | string;
}

const mapRegistration = (row: AgentRegistrationRow): AgentRegistrationRecord => ({
  id: row.id,
  principalSubject: row.principal_subject,
  agentKey: row.agent_key,
  displayName: row.display_name ?? undefined,
  enabled: row.enabled,
  createdAt: toIso(row.created_at),
});

const SELECT_COLUMNS = `
  id, principal_subject, agent_key, display_name, enabled, created_at
`;

export const createPostgresAgentRegistrationRepository = (
  database: Queryable,
): AgentRegistrationRepository => ({
  async register(input) {
    try {
      const result = await database.query<AgentRegistrationRow>(
        `
          INSERT INTO agent_registrations (principal_subject, agent_key, display_name)
          VALUES ($1, $2, $3)
          ON CONFLICT (principal_subject, agent_key)
          DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, agent_registrations.display_name)
          RETURNING ${SELECT_COLUMNS}
        `,
        [input.principalSubject, input.agentKey, input.displayName ?? null],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Registration upsert returned no row.");
      }
      return mapRegistration(row);
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
});

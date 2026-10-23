import {
  RepositoryError,
  type DurableSessionInput,
  type DurableSessionRepository,
} from "@persistence/types";

import { databaseFailure, toIso, withTransaction, type PoolLike } from "../connection";
import type { QueryableClient, SessionRow } from "../../types";

/**
 * Durable session projection over the `sessions` table.
 *
 * SQL, parameters, and row mapping moved unchanged from the legacy neutral
 * `src/persistence/helpers/sessions.ts` (P04). `ensureSession` stays exported
 * as the transaction-local primitive so the work adapter (P05) can run it on
 * its own transaction client — calling the public `ensure` there would open
 * an independent transaction and break `work.submit` atomicity.
 */

const mapSession = (row: SessionRow): DurableSessionInput => ({
  sessionUri: row.session_uri,
  ownerPrincipalSubject: row.owner_principal_subject,
  providerId: row.provider_id,
  sessionTypeId: row.session_type_id ?? undefined,
  createdAt: toIso(row.created_at),
  modifiedAt: toIso(row.modified_at),
  lastServerSeq: Number(row.last_server_seq),
  durableState: row.durable_state,
});

const SELECT_COLUMNS = `
  session_uri, session_type_id, provider_id, owner_principal_subject,
  created_at, modified_at, last_server_seq, durable_state
`;

/**
 * Ensures a durable session projection exists inside the caller's transaction.
 * The owner check happens before any projection update. Updates are guarded by
 * server sequence so an older snapshot cannot replace newer durable state.
 */
export const ensureSession = async (
  database: QueryableClient,
  input: DurableSessionInput,
): Promise<DurableSessionInput> => {
  const inserted = await database.query<SessionRow>(
    `
      INSERT INTO sessions (
        session_uri, session_type_id, provider_id, owner_principal_subject,
        created_at, modified_at, last_server_seq, durable_state
      )
      VALUES ($1, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::jsonb)
      ON CONFLICT (session_uri) DO NOTHING
      RETURNING ${SELECT_COLUMNS}
    `,
    [
      input.sessionUri,
      input.sessionTypeId ?? null,
      input.providerId,
      input.ownerPrincipalSubject,
      input.createdAt,
      input.modifiedAt,
      input.lastServerSeq,
      JSON.stringify(input.durableState ?? {}),
    ],
  );
  if (inserted.rows[0] !== undefined) {
    return mapSession(inserted.rows[0]);
  }

  const existing = await database.query<SessionRow>(
    `SELECT ${SELECT_COLUMNS} FROM sessions WHERE session_uri = $1`,
    [input.sessionUri],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw new RepositoryError("database", "The durable session projection was lost during insertion.");
  }
  if (row.owner_principal_subject !== input.ownerPrincipalSubject) {
    throw new RepositoryError("unauthorized", "The session belongs to another principal.");
  }

  const updated = await database.query<SessionRow>(
    `
      UPDATE sessions
      SET modified_at = GREATEST(modified_at, $2::timestamptz),
          last_server_seq = GREATEST(last_server_seq, $3),
          durable_state = CASE WHEN $3 >= last_server_seq THEN $4::jsonb ELSE durable_state END
      WHERE session_uri = $1
      RETURNING ${SELECT_COLUMNS}
    `,
    [input.sessionUri, input.modifiedAt, input.lastServerSeq, JSON.stringify(input.durableState ?? {})],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow === undefined) {
    throw new RepositoryError("database", "The durable session projection could not be updated.");
  }
  return mapSession(updatedRow);
};

export const createPostgresDurableSessionRepository = (
  pool: PoolLike,
): DurableSessionRepository => ({
  async ensure(input) {
    try {
      return await withTransaction(pool, (client) => ensureSession(client, input));
    } catch (error) {
      throw databaseFailure(error);
    }
  },

  async get(sessionUri) {
    try {
      const result = await pool.query<SessionRow>(
        `SELECT ${SELECT_COLUMNS} FROM sessions WHERE session_uri = $1`,
        [sessionUri],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : mapSession(row);
    } catch (error) {
      throw databaseFailure(error);
    }
  },

  async delete(sessionUri) {
    try {
      const result = await pool.query(
        "DELETE FROM sessions WHERE session_uri = $1 RETURNING session_uri",
        [sessionUri],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error
        && (error as { readonly code?: unknown }).code === "23503") {
        throw new RepositoryError("conflict", "The session still has dependent work.");
      }
      throw databaseFailure(error);
    }
  },
});

import type { Pool, QueryResultRow } from "pg";

import {
  RepositoryError,
  type WorkClaimInput,
  type WorkItemRecord,
  type WorkLeaseRecord,
  type WorkRepository,
  type WorkStatus,
} from "../types";
import { ensureSession } from "./sessions";
import { databaseFailure, toIso, withTransaction } from "./pool";

interface WorkRow extends QueryResultRow {
  readonly id: string;
  readonly session_uri: string;
  readonly request_key: string;
  readonly kind: string;
  readonly input: unknown;
  readonly status: WorkStatus;
  readonly target_agent_id: string | null;
  readonly lease_agent_id: string | null;
  readonly lease_token: string | null;
  readonly lease_expires_at: Date | string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly result: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const mapWork = (row: WorkRow): WorkItemRecord => ({
  id: row.id,
  sessionUri: row.session_uri,
  requestKey: row.request_key,
  kind: row.kind,
  input: row.input,
  status: row.status,
  targetAgentId: row.target_agent_id ?? undefined,
  leaseAgentId: row.lease_agent_id ?? undefined,
  leaseToken: row.lease_token ?? undefined,
  leaseExpiresAt: row.lease_expires_at === null ? undefined : toIso(row.lease_expires_at),
  attemptCount: row.attempt_count,
  maxAttempts: row.max_attempts,
  result: row.result ?? undefined,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const SELECT_WORK = `
  w.id, w.session_uri, w.request_key, w.kind, w.input, w.status,
  w.target_agent_id, w.lease_agent_id, w.lease_token, w.lease_expires_at,
  w.attempt_count, w.max_attempts, w.result, w.created_at, w.updated_at
`;

const principalGuard = `
  EXISTS (
    SELECT 1 FROM agent_registrations AS a
    WHERE a.id = $2::uuid AND a.enabled = TRUE AND a.principal_subject = $5
  )
  AND EXISTS (
    SELECT 1 FROM sessions AS s
    WHERE s.session_uri = work_items.session_uri
      AND s.owner_principal_subject = $5
  )
`;

export interface PostgresWorkRepositoryOptions {
  readonly leaseTtlSeconds?: number;
}

export const createPostgresWorkRepository = (
  pool: Pool,
  options: PostgresWorkRepositoryOptions = {},
): WorkRepository => {
  const leaseTtlSeconds = options.leaseTtlSeconds ?? 60;

  return {
    async submit(input) {
      try {
        return await withTransaction(pool, async (client) => {
          await ensureSession(client, input.session);
          const inserted = await client.query<{ readonly id: string }>(
            `
              INSERT INTO work_items (session_uri, request_key, kind, input, target_agent_id)
              VALUES ($1, $2, $3, $4::jsonb, $5::uuid)
              ON CONFLICT (session_uri, request_key) DO NOTHING
              RETURNING id
            `,
            [
              input.session.sessionUri,
              input.requestKey,
              input.kind,
              JSON.stringify(input.input),
              input.targetAgentId ?? null,
            ],
          );
          const insertedRow = inserted.rows[0];
          if (insertedRow !== undefined) {
            return { id: insertedRow.id, created: true };
          }

          const existing = await client.query<{
            readonly id: string;
            readonly same_payload: boolean;
          }>(
            `
              SELECT id,
                (kind = $3 AND input = $4::jsonb AND target_agent_id IS NOT DISTINCT FROM $5::uuid) AS same_payload
              FROM work_items
              WHERE session_uri = $1 AND request_key = $2
            `,
            [
              input.session.sessionUri,
              input.requestKey,
              input.kind,
              JSON.stringify(input.input),
              input.targetAgentId ?? null,
            ],
          );
          const existingRow = existing.rows[0];
          if (existingRow === undefined) {
            throw new RepositoryError("database", "The work row disappeared during idempotent submission.");
          }
          if (!existingRow.same_payload) {
            throw new RepositoryError("conflict", "The request key was already used with different work.");
          }
          return { id: existingRow.id, created: false };
        });
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async claim(input: WorkClaimInput): Promise<WorkLeaseRecord | null> {
      try {
        const result = await pool.query<{
          readonly id: string;
          readonly session_uri: string;
          readonly kind: string;
          readonly input: unknown;
          readonly lease_token: string;
          readonly lease_expires_at: Date | string;
          readonly attempt_count: number;
        }>(
          `
            WITH candidate AS (
              SELECT w.id
              FROM work_items AS w
              JOIN sessions AS s ON s.session_uri = w.session_uri
              JOIN agent_registrations AS a ON a.id = $1::uuid
              WHERE w.session_uri = $2
                AND a.enabled = TRUE
                AND a.principal_subject = $3
                AND s.owner_principal_subject = $3
                AND w.kind = ANY($4::text[])
                AND (w.target_agent_id IS NULL OR w.target_agent_id = a.id)
                AND w.attempt_count < w.max_attempts
                AND (
                  w.status = 'queued'
                  OR (w.status = 'leased' AND w.lease_expires_at <= statement_timestamp())
                )
              ORDER BY w.created_at, w.id
              FOR UPDATE OF w SKIP LOCKED
              LIMIT 1
            )
            UPDATE work_items AS w
            SET status = 'leased',
                lease_agent_id = $1::uuid,
                lease_token = gen_random_uuid(),
                lease_expires_at = statement_timestamp() + ($5::int * INTERVAL '1 second'),
                attempt_count = w.attempt_count + 1,
                updated_at = statement_timestamp()
            FROM candidate
            WHERE w.id = candidate.id
            RETURNING w.id, w.session_uri, w.kind, w.input, w.lease_token,
                      w.lease_expires_at, w.attempt_count
          `,
          [
            input.agentId,
            input.sessionUri,
            input.principalSubject,
            input.kinds,
            leaseTtlSeconds,
          ],
        );
        const row = result.rows[0];
        if (row === undefined) {
          return null;
        }
        return {
          workId: row.id,
          sessionUri: row.session_uri,
          kind: row.kind,
          input: row.input,
          leaseToken: row.lease_token,
          leaseExpiresAt: toIso(row.lease_expires_at),
          attempt: row.attempt_count,
        };
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async renew(input) {
      try {
        const result = await pool.query<{ readonly lease_expires_at: Date | string }>(
          `
            UPDATE work_items
            SET lease_expires_at = statement_timestamp() + ($4::int * INTERVAL '1 second'),
                updated_at = statement_timestamp()
            WHERE id = $1::uuid
              AND status = 'leased'
              AND lease_agent_id = $2::uuid
              AND lease_token = $3::uuid
              AND lease_expires_at > statement_timestamp()
              AND ${principalGuard}
            RETURNING lease_expires_at
          `,
          [input.workId, input.agentId, input.token, leaseTtlSeconds, input.principalSubject],
        );
        const row = result.rows[0];
        return row === undefined ? null : { leaseExpiresAt: toIso(row.lease_expires_at) };
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async complete(input) {
      try {
        const result = await pool.query(
          `
            UPDATE work_items
            SET status = 'completed',
                result = $4::jsonb,
                lease_agent_id = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = statement_timestamp()
            WHERE id = $1::uuid
              AND status = 'leased'
              AND lease_agent_id = $2::uuid
              AND lease_token = $3::uuid
              AND lease_expires_at > statement_timestamp()
              AND ${principalGuard}
            RETURNING id
          `,
          [input.workId, input.agentId, input.token, JSON.stringify(input.result), input.principalSubject],
        );
        return (result.rowCount ?? 0) > 0;
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async fail(input) {
      try {
        return await withTransaction(pool, async (client) => {
          const selected = await client.query<{
            readonly status: WorkStatus;
            readonly attempt_count: number;
            readonly max_attempts: number;
          }>(
            `
              SELECT w.status, w.attempt_count, w.max_attempts
              FROM work_items AS w
              WHERE w.id = $1::uuid
                AND w.status = 'leased'
                AND w.lease_agent_id = $2::uuid
                AND w.lease_token = $3::uuid
                AND w.lease_expires_at > statement_timestamp()
                AND EXISTS (
                  SELECT 1 FROM agent_registrations AS a
                  WHERE a.id = $2::uuid AND a.enabled = TRUE AND a.principal_subject = $4
                )
                AND EXISTS (
                  SELECT 1 FROM sessions AS s
                  WHERE s.session_uri = w.session_uri AND s.owner_principal_subject = $4
                )
              FOR UPDATE OF w
            `,
            [input.workId, input.agentId, input.token, input.principalSubject],
          );
          const row = selected.rows[0];
          if (row === undefined) {
            return null;
          }
          const nextStatus: WorkStatus = input.retryable && row.attempt_count < row.max_attempts
            ? "queued"
            : "failed";
          await client.query(
            `
              UPDATE work_items
              SET status = $2,
                  lease_agent_id = NULL,
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  updated_at = statement_timestamp()
              WHERE id = $1::uuid
            `,
            [input.workId, nextStatus],
          );
          return nextStatus;
        });
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async cancel(input) {
      try {
        return await withTransaction(pool, async (client) => {
          const selected = await client.query<{ readonly status: WorkStatus }>(
            `
              SELECT w.status
              FROM work_items AS w
              JOIN sessions AS s ON s.session_uri = w.session_uri
              WHERE w.id = $1::uuid AND s.owner_principal_subject = $2
              FOR UPDATE OF w
            `,
            [input.workId, input.principalSubject],
          );
          const row = selected.rows[0];
          if (row === undefined) {
            return null;
          }
          if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
            return row.status;
          }
          const updated = await client.query<{ readonly status: WorkStatus }>(
            `
              UPDATE work_items
              SET status = 'cancelled',
                  lease_agent_id = NULL,
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  updated_at = statement_timestamp()
              WHERE id = $1::uuid
              RETURNING status
            `,
            [input.workId],
          );
          return updated.rows[0]?.status ?? "cancelled";
        });
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async get(input) {
      try {
        const result = await pool.query<WorkRow>(
          `
            SELECT ${SELECT_WORK}
            FROM work_items AS w
            JOIN sessions AS s ON s.session_uri = w.session_uri
            WHERE w.id = $1::uuid AND s.owner_principal_subject = $2
          `,
          [input.workId, input.principalSubject],
        );
        const row = result.rows[0];
        return row === undefined ? null : mapWork(row);
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async reconcileExpired() {
      try {
        const result = await pool.query(
          `
            UPDATE work_items
            SET status = 'failed',
                lease_agent_id = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = statement_timestamp()
            WHERE status = 'leased'
              AND lease_expires_at <= statement_timestamp()
              AND attempt_count >= max_attempts
          `,
        );
        return result.rowCount ?? 0;
      } catch (error) {
        throw databaseFailure(error);
      }
    },

    async hasDependentWork(sessionUri) {
      try {
        const result = await pool.query<{ readonly present: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM work_items WHERE session_uri = $1) AS present",
          [sessionUri],
        );
        return result.rows[0]?.present ?? false;
      } catch (error) {
        throw databaseFailure(error);
      }
    },
  };
};

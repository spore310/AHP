import { DatabaseError, Pool } from "pg";

import { RepositoryError } from "@persistence/types";

import type { PoolClientLike, PoolLike } from "./types";
import type { PostgresOptions } from "../../types";

/** A queued checkout or a blocked transaction must eventually release host shutdown and takeover. */
export const createPostgresPool = (options: PostgresOptions): Pool => {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // pg-pool evicts a failed idle client before reporting it outside any query promise.
  pool.on("error", () => undefined);
  return pool;
};

/**
 * Runs the operation inside one transaction on **one acquired client**. A
 * rollback failure never covers the original operation or commit failure.
 */
export const withTransaction = async <TResult>(
  pool: PoolLike,
  operation: (client: PoolClientLike) => Promise<TResult>,
  classifyCommit = false,
): Promise<TResult> => {
  const client = await pool.connect();
  let discard: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    try {
      await client.query("COMMIT");
    } catch (error) {
      if (classifyCommit && uncertainCommit(error)) {
        discard = new RepositoryError("outcome_unknown", "The durable commit outcome is uncertain.");
        throw discard;
      }
      throw error;
    }
    return result;
  } catch (error) {
    if (!discard) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = new RepositoryError("database", "The durable transaction could not be rolled back.");
      }
    }
    throw error;
  } finally {
    if (discard) client.release(discard);
    else client.release();
  }
};

/** Only a PostgreSQL ErrorResponse can establish a definite COMMIT failure. */
export function uncertainCommit(error: unknown): boolean {
  const code = error instanceof DatabaseError && error.severity === "ERROR" ? error.code : undefined;
  return !code || !/^[0-9A-Z]{5}$/u.test(code) || code === "40003" || code.startsWith("08") || code.startsWith("57");
}

export const toIso = (value: Date | string): string => (
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()
);

/**
 * Classifies driver failures into owned repository errors. SQLSTATE numbers
 * are private to this adapter; other modules never inspect them.
 */
export const databaseFailure = (error: unknown): RepositoryError => {
  if (error instanceof RepositoryError) {
    return error;
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
  if (code === "23505") {
    return new RepositoryError("conflict", "The resource already exists with different immutable fields.");
  }
  if (code === "23503" || code === "22P02") {
    return new RepositoryError("not_found", "The referenced resource does not exist.");
  }
  return new RepositoryError("database", "The durable store operation failed.");
};

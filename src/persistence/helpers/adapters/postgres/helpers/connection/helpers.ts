import { Pool } from "pg";

import { RepositoryError } from "@persistence/types";

import type { PoolClientLike, PoolLike } from "./types";
import type { PostgresOptions } from "../../types";

/**
 * PostgreSQL connection, transaction, timestamp and error mechanics.
 *
 * Mechanics moved here from the legacy neutral `helpers/pool.ts` (P03). The
 * legacy module remains unchanged until its caller repositories move (P08
 * deletes it, together with every remaining neutral `pg` import). Semantics
 * are preserved byte-for-byte: pool default `max: 10`, one `BEGIN` /
 * operation / `COMMIT` sequence on the single acquired client, a best-effort
 * `ROLLBACK` that never masks the primary failure, and unconditional client
 * release after acquisition.
 */

export const createPostgresPool = (options: PostgresOptions): Pool =>
  new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
  });

/**
 * Runs the operation inside one transaction on **one acquired client**. A
 * rollback failure never covers the original operation or commit failure.
 */
export const withTransaction = async <TResult>(
  pool: PoolLike,
  operation: (client: PoolClientLike) => Promise<TResult>,
): Promise<TResult> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

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

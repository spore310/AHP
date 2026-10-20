import { Pool } from "pg";
import type { PoolClient } from "pg";

import { RepositoryError } from "../types";

export interface PostgresOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

/** The subset of a pool or transaction client used by repository helpers. */
export type Queryable = Pick<Pool, "query">;

export const createPostgresPool = (options: PostgresOptions): Pool => new Pool({
  connectionString: options.connectionString,
  max: options.maxConnections ?? 10,
});

export const withTransaction = async <TResult>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<TResult>,
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

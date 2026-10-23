import type { Pool, QueryResult, QueryResultRow } from "pg";

/**
 * Adapter-private driver surfaces.
 *
 * These describe the pg-derived subset the adapter actually uses. They never
 * cross the neutral portability boundary; the repository contracts keep plain
 * DTOs only (C08). A real `Pool` and `PoolClient` satisfy both, while tests
 * can drive the exact subset with a typed double instead of the full driver.
 */

/**
 * The query shape shared by a pool or a pooled client in this adapter. This
 * stays pg-derived inside the adapter only (P03 step 5).
 */
export type Queryable = Pick<Pool, "query">;

/**
 * The subset of a pooled client the connection helper and repository helpers
 * use: parameterized queries plus the release hook.
 */
export interface PoolClientLike {
  query<T extends QueryResultRow = never>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  release(error?: Error | false): void;
}

/**
 * The subset of a pool the connection helper needs. Sharing `query` lets
 * tests prove the transaction helper never routes statements through the
 * pool after acquiring a client.
 */
export interface PoolLike {
  connect(): Promise<PoolClientLike>;
  query<T extends QueryResultRow = never>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

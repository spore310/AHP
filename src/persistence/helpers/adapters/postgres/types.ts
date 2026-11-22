import type { QueryResult, QueryResultRow } from "pg";

import type { WorkStatus } from "@persistence/types";

/**
 * PostgreSQL adapter options (adapter-private).
 *
 * Temporary duplicate of the legacy neutral `PostgresOptions` shape so the
 * legacy `helpers/pool.ts` module keeps compiling unchanged until callers
 * migrate; this copy is owned by the adapter and never re-exported through
 * the neutral persistence root. Semantics: a pool with the original default
 * of at most `10` clients unless overridden by `maxConnections`.
 */
export interface PostgresOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

/**
 * Narrow query capability shared by a real `Pool`, a pooled transaction
 * client, and the adapter's driver doubles. It exists so repository helpers
 * can accept both a pool and a transaction client without unsafe casts
 * (P03 review N2: do not rely on `PoolClientLike` → `Queryable`
 * assignability). Adapter-private; never crosses the neutral boundary.
 */
export interface QueryableClient {
  query<T extends QueryResultRow = never>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

/** Raw `agent_registrations` row shape (snake_case as returned by pg). */
export interface AgentRegistrationRow extends QueryResultRow {
  readonly id: string;
  readonly principal_subject: string;
  readonly agent_key: string;
  readonly display_name: string | null;
  readonly enabled: boolean;
  readonly created_at: Date | string;
}

/**
 * Raw `sessions` row shape (snake_case as returned by pg). The schema stores
 * only `session_type_id`; `sessionTypeKey`/`sessionTypeVersion` on the port
 * contract have no columns and are therefore never selected or round-tripped
 * (recorded limitation, not something this adapter may invent columns or
 * claims for).
 */
export interface SessionRow extends QueryResultRow {
  readonly session_uri: string;
  readonly session_type_id: string | null;
  readonly provider_id: string;
  readonly owner_principal_subject: string;
  readonly created_at: Date | string;
  readonly modified_at: Date | string;
  readonly last_server_seq: string;
  readonly durable_state: unknown;
}

/**
 * Raw `work_items` row shape (snake_case as returned by pg).
 */
export interface WorkRow extends QueryResultRow {
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

/** Adapter-private work repository options; default lease TTL is 60 seconds.
 * Legacy-neutral twin in `helpers/workItems.ts` stays until P08.
 */
export interface PostgresWorkRepositoryOptions {
  readonly leaseTtlSeconds?: number;
}

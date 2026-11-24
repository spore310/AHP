import type { QueryableClient } from "../../types";

/** Private to the PostgreSQL adapter. Supply lock() the mutation's own transaction client. */
export interface PostgresOwnership {
  readonly epoch: string;
  readonly serverSeq: number;
  isOpen(): boolean;
  lock(client: QueryableClient, checkpoint?: boolean): Promise<void>;
  release(): Promise<void>;
}

import type { HostEventDelivery } from "@persistence/helpers/durability/types";
import type { QueryableClient } from "../../types";

/** Private to the PostgreSQL adapter. Supply lock() the mutation's own transaction client. */
export interface PostgresOwnership {
  readonly hostId: string;
  readonly instanceId: string;
  /** Membership generation of this runtime instance. */
  readonly generation: string;
  readonly namespaceId?: string;
  readonly shared: boolean;
  /** Session providers this instance can restore. Placement never targets a host without the provider. */
  readonly providers: readonly string[];
  readonly epoch: string;
  readonly serverSeq: number;
  isOpen(): boolean;
  /**
   * Fences one transaction: the ownership epoch must be current and, unless
   * `namespace` is false, no unacknowledged namespace revocation may exist.
   */
  lock(client: QueryableClient, checkpoint?: boolean, namespace?: boolean): Promise<void>;
  authorityRevision(): number;
  /** Records a revocation this host just committed itself. */
  noteAuthority(revision: number): void;
  acknowledgeAuthority(revision: number): void;
  setRole(role: "active" | "draining"): Promise<void>;
  subscribeEvents(listener: (delivery: HostEventDelivery) => void): () => void;
  release(): Promise<void>;
}

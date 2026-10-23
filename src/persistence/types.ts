/**
 * Asynchronous durable-storage ports.
 *
 * These contracts deliberately do not extend the synchronous live session
 * registry. A PostgreSQL adapter implements them; the session reducer and
 * WebSocket handlers never perform SQL directly.
 */

export type WorkStatus = "queued" | "leased" | "completed" | "failed" | "cancelled";

/** Stable, durable agent registration identity. */
export interface AgentRegistrationRecord {
  readonly id: string;
  readonly principalSubject: string;
  readonly agentKey: string;
  readonly displayName?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface AgentRegistrationRepository {
  /** Idempotently resolves the row for one verified principal and agent key. */
  register(input: {
    readonly principalSubject: string;
    readonly agentKey: string;
    readonly displayName?: string;
  }): Promise<AgentRegistrationRecord>;
  getById(id: string): Promise<AgentRegistrationRecord | undefined>;
}

/** Minimal durable projection of a live session. */
export interface DurableSessionInput {
  readonly sessionUri: string;
  readonly ownerPrincipalSubject: string;
  readonly providerId: string;
  readonly sessionTypeId?: string;
  readonly sessionTypeKey?: string;
  readonly sessionTypeVersion?: number;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly lastServerSeq: number;
  readonly durableState: unknown;
}

export interface DurableSessionRepository {
  /**
   * Inserts the projection if absent. An existing row with a different owner
   * is rejected rather than silently reassigned.
   */
  ensure(input: DurableSessionInput): Promise<DurableSessionInput>;
  get(sessionUri: string): Promise<DurableSessionInput | undefined>;
  /** Deletes only when no work row references the session. */
  delete(sessionUri: string): Promise<boolean>;
}

export interface WorkSubmitInput {
  readonly session: DurableSessionInput;
  readonly requestKey: string;
  readonly kind: string;
  readonly input: unknown;
  readonly targetAgentId?: string;
}

export interface WorkClaimInput {
  readonly agentId: string;
  readonly principalSubject: string;
  readonly sessionUri: string;
  readonly kinds: readonly string[];
}

export interface WorkLeaseRecord {
  readonly workId: string;
  readonly sessionUri: string;
  readonly kind: string;
  readonly input: unknown;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly attempt: number;
}

export interface WorkItemRecord {
  readonly id: string;
  readonly sessionUri: string;
  readonly requestKey: string;
  readonly kind: string;
  readonly input: unknown;
  readonly status: WorkStatus;
  readonly targetAgentId?: string;
  readonly leaseAgentId?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly result?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkRepository {
  /**
   * Inserts the session projection if needed, then inserts one idempotent work
   * row. A repeated key with the same JSON value returns the existing ID; a
   * changed value raises a conflict. Object key order does not affect equality;
   * array order does.
   */
  submit(input: WorkSubmitInput): Promise<{ readonly id: string; readonly created: boolean }>;
  claim(input: WorkClaimInput): Promise<WorkLeaseRecord | null>;
  renew(input: {
    readonly agentId: string;
    readonly principalSubject: string;
    readonly workId: string;
    readonly token: string;
  }): Promise<{ readonly leaseExpiresAt: string } | null>;
  complete(input: {
    readonly agentId: string;
    readonly principalSubject: string;
    readonly workId: string;
    readonly token: string;
    readonly result: unknown;
  }): Promise<boolean>;
  fail(input: {
    readonly agentId: string;
    readonly principalSubject: string;
    readonly workId: string;
    readonly token: string;
    readonly retryable: boolean;
  }): Promise<"queued" | "failed" | null>;
  cancel(input: {
    readonly workId: string;
    readonly principalSubject: string;
  }): Promise<WorkStatus | null>;
  get(input: {
    readonly workId: string;
    readonly principalSubject: string;
  }): Promise<WorkItemRecord | null>;
  /** Terminalizes expired attempts that have exhausted their retry budget. */
  reconcileExpired(): Promise<number>;
  /** True while any work row still references the session. */
  hasDependentWork(sessionUri: string): Promise<boolean>;
}

/**
 * A complete provider bundles repositories over the **same logical store and
 * ownership scope**. Combining `registrations` from one database with `work`
 * from another is not a supported provider implementation. Work submission
 * owns its atomic unit: `provider.work.submit(input)` resolves the session
 * projection and the work row inside one transactionally coherent operation.
 */
export interface PersistenceRepositories {
  readonly registrations: AgentRegistrationRepository;
  readonly sessions: DurableSessionRepository;
  readonly work: WorkRepository;
}

/** A complete, owned persistence backend with one disposal boundary. */
export interface PersistenceProvider extends PersistenceRepositories {
  dispose(): Promise<void>;
}

/** Stable, sanitized persistence failures. */
export type RepositoryErrorCode = "conflict" | "not_found" | "unauthorized" | "database";

export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

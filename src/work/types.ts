import type {
  AgentRegistrationRepository,
  DurableSessionInput,
  WorkItemRecord,
  WorkRepository,
  WorkStatus,
} from "@persistence/types";
import type { AuthenticatedPrincipal, PresenceBinding } from "@agents/types";

export type { WorkStatus };

export interface WorkSubmission {
  readonly sessionUri: string;
  readonly requestKey: string;
  readonly kind: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly targetAgentId?: string;
}

export interface WorkLease {
  readonly workId: string;
  readonly sessionUri: string;
  readonly kind: string;
  readonly input: unknown;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly attempt: number;
}

export interface WorkFailure {
  readonly retryable: boolean;
  readonly message: string;
}

export interface WorkView {
  readonly id: string;
  readonly sessionUri: string;
  readonly kind: string;
  readonly status: WorkStatus;
  readonly input: unknown;
  readonly result?: unknown;
  readonly targetAgentId?: string;
  readonly leaseExpiresAt?: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthorizedAgentContext {
  readonly principal: AuthenticatedPrincipal;
  readonly agentId: string;
  readonly connectionId: string;
  readonly generation: number;
}

/** The subset of live presence the work service revalidates on every mutation. */
export interface WorkPresence {
  getByConnection(connectionId: string): PresenceBinding | undefined;
}

export interface SessionOwnerRegistry {
  bind(sessionUri: string, principalSubject: string): void;
  owner(sessionUri: string): string | undefined;
  unbind(sessionUri: string): void;
  clear(): void;
}

export interface WorkServiceOptions {
  readonly repository: WorkRepository;
  readonly sessions: SessionOwnerRegistry;
  readonly presence: WorkPresence;
  readonly registrations: AgentRegistrationRepository;
  /** Builds the durable projection from the live session, or `undefined` if absent. */
  readonly describeSession: (sessionUri: string) => DurableSessionInput | undefined;
  readonly allowedKinds: ReadonlySet<string>;
  readonly now?: () => number;
  readonly maxInputBytes?: number;
  readonly maxResultBytes?: number;
}

export interface WorkService {
  submit(
    principal: AuthenticatedPrincipal,
    input: WorkSubmission,
  ): Promise<{ readonly id: string }>;
  claim(
    agent: AuthorizedAgentContext,
    sessionUri: string,
  ): Promise<WorkLease | null>;
  renew(
    agent: AuthorizedAgentContext,
    workId: string,
    token: string,
  ): Promise<{ readonly leaseExpiresAt: string }>;
  complete(
    agent: AuthorizedAgentContext,
    workId: string,
    token: string,
    result: unknown,
  ): Promise<void>;
  fail(
    agent: AuthorizedAgentContext,
    workId: string,
    token: string,
    reason: WorkFailure,
  ): Promise<{ readonly status: WorkStatus }>;
  cancel(principal: AuthenticatedPrincipal, workId: string): Promise<void>;
  get(principal: AuthenticatedPrincipal, workId: string): Promise<WorkView | null>;
  /** Rejects session disposal while dependent work exists. */
  assertSessionDisposable(sessionUri: string): Promise<void>;
}

export type WorkErrorCode
  = | "invalid"
    | "not_found"
    | "unauthorized"
    | "conflict"
    | "stale"
    | "exhausted";

export interface WorkViewSource {
  readonly item: WorkItemRecord;
}

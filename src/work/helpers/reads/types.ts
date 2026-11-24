import type { AuthenticatedPrincipal } from "@agents";
import type { WorkRepository, WorkStatus } from "@persistence/types";
import type { DurableWorkRepository } from "@persistence/helpers/durability/workTypes";
import type { AuthorizedWorkView } from "../commands/types";

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

export interface SessionOwnerLookup {
  owner(sessionUri: string): string | undefined;
}

export interface SessionOwnerRegistry extends SessionOwnerLookup {
  bind(sessionUri: string, principalSubject: string): void;
  unbind(sessionUri: string): void;
  clear(): void;
}

export interface WorkReadOptions {
  readonly repository: Pick<WorkRepository, "get" | "hasDependentWork">;
  readonly canonicalGet?: DurableWorkRepository["get"];
  readonly sessions: SessionOwnerLookup;
  readonly currentInstance?: (uri: string, instanceId: string, subject: string, domainId: string) => boolean;
  readonly legacyReadCurrent?: () => boolean;
}
export interface WorkReadPort {
  get(principal: AuthenticatedPrincipal, id: string, domainId?: string, guardDelivery?: (check: () => boolean) => void): Promise<WorkView | AuthorizedWorkView | null>;
  assertSessionDisposable(uri: string): Promise<void>;
}

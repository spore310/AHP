import type {
  AgentRegistrationRecord,
  AgentRegistrationRepository,
} from "@persistence/types";
import type { AuthenticatedPrincipal } from "@agents";
import type {
  AuthorizedAgentContext,
  SessionOwnerRegistry,
  WorkFailure,
  WorkLease,
  WorkService,
  WorkStatus,
  WorkSubmission,
  WorkView,
} from "@work";

export interface TestClock {
  readonly now: () => number;
  advance(milliseconds: number): void;
}

export const createTestClock = (start = 1_000_000): TestClock => {
  let current = start;
  return {
    now: (): number => current,
    advance: (milliseconds: number): void => {
      current += milliseconds;
    },
  };
};

export interface RegistrationFixture {
  readonly repository: AgentRegistrationRepository;
  readonly records: Map<string, AgentRegistrationRecord>;
  readonly registerCalls: Array<{
    principalSubject: string;
    agentKey: string;
    displayName?: string;
  }>;
}

export const createRegistrationFixture = (): RegistrationFixture => {
  const records = new Map<string, AgentRegistrationRecord>();
  const byKey = new Map<string, AgentRegistrationRecord>();
  const registerCalls: RegistrationFixture["registerCalls"] = [];
  let sequence = 0;

  const repository: AgentRegistrationRepository = {
    register: (input) => {
      registerCalls.push(input);
      const key = `${input.principalSubject}\u0000${input.agentKey}`;
      const existing = byKey.get(key);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
      sequence += 1;
      const record: AgentRegistrationRecord = {
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        principalSubject: input.principalSubject,
        agentKey: input.agentKey,
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        enabled: true,
        createdAt: new Date(0).toISOString(),
      };
      records.set(record.id, record);
      byKey.set(key, record);
      return Promise.resolve(record);
    },
    getById: (id) => Promise.resolve(records.get(id)),
  };

  return { repository, records, registerCalls };
};

export interface SessionOwnersFixture extends SessionOwnerRegistry {
  readonly owners: Map<string, string>;
}

export const createSessionOwnersFixture = (): SessionOwnersFixture => {
  const owners = new Map<string, string>();
  return {
    owners,
    bind: (sessionUri, principalSubject) => {
      owners.set(sessionUri, principalSubject);
    },
    owner: (sessionUri) => owners.get(sessionUri),
    unbind: (sessionUri) => {
      owners.delete(sessionUri);
    },
    clear: () => {
      owners.clear();
    },
  };
};

export const SESSION_URI = "ahp-session:/agent-work";
export const WORK_ID = "00000000-0000-4000-8000-000000000101";
export const LEASE_TOKEN = "00000000-0000-4000-8000-000000000102";
export const WORK_KIND = "code.review";

const defaultLease: WorkLease = {
  workId: WORK_ID,
  sessionUri: SESSION_URI,
  kind: WORK_KIND,
  input: { path: "experiment.txt" },
  leaseToken: LEASE_TOKEN,
  leaseExpiresAt: "2026-01-01T00:00:00.000Z",
  attempt: 1,
};

const defaultView: WorkView = {
  id: WORK_ID,
  sessionUri: SESSION_URI,
  kind: WORK_KIND,
  status: "completed",
  input: { path: "experiment.txt" },
  result: { ok: true },
  attemptCount: 1,
  maxAttempts: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
};

export interface WorkFixtureOptions {
  readonly lease?: WorkLease | null;
  readonly view?: WorkView | null;
  readonly failStatus?: WorkStatus;
  readonly renewExpiresAt?: string;
  readonly claimError?: Error;
}

export interface WorkFixture {
  readonly service: WorkService;
  readonly calls: string[];
  readonly submitted: Array<{
    principal: AuthenticatedPrincipal;
    input: WorkSubmission;
  }>;
  readonly claimed: Array<{
    agent: AuthorizedAgentContext;
    sessionUri: string;
  }>;
  readonly renewed: Array<{
    agent: AuthorizedAgentContext;
    workId: string;
    token: string;
  }>;
  readonly completed: Array<{
    agent: AuthorizedAgentContext;
    workId: string;
    token: string;
    result: unknown;
  }>;
  readonly failed: Array<{
    agent: AuthorizedAgentContext;
    workId: string;
    token: string;
    reason: WorkFailure;
  }>;
  readonly cancelled: Array<{
    principal: AuthenticatedPrincipal;
    workId: string;
  }>;
  readonly got: Array<{
    principal: AuthenticatedPrincipal;
    workId: string;
  }>;
  readonly assertedSessions: string[];
}

export const createWorkFixture = (options: WorkFixtureOptions = {}): WorkFixture => {
  const calls: string[] = [];
  const submitted: WorkFixture["submitted"] = [];
  const claimed: WorkFixture["claimed"] = [];
  const renewed: WorkFixture["renewed"] = [];
  const completed: WorkFixture["completed"] = [];
  const failed: WorkFixture["failed"] = [];
  const cancelled: WorkFixture["cancelled"] = [];
  const got: WorkFixture["got"] = [];
  const assertedSessions: string[] = [];

  const service: WorkService = {
    submit: (principal, input) => {
      calls.push("submit");
      submitted.push({ principal, input });
      return Promise.resolve({ id: WORK_ID });
    },
    claim: (agent, sessionUri) => {
      calls.push("claim");
      claimed.push({ agent, sessionUri });
      if (options.claimError !== undefined) {
        return Promise.reject(options.claimError);
      }
      return Promise.resolve(options.lease === undefined ? defaultLease : options.lease);
    },
    renew: (agent, workId, token) => {
      calls.push("renew");
      renewed.push({ agent, workId, token });
      return Promise.resolve({
        leaseExpiresAt: options.renewExpiresAt ?? "2026-01-01T00:00:02.000Z",
      });
    },
    complete: (agent, workId, token, result) => {
      calls.push("complete");
      completed.push({ agent, workId, token, result });
      return Promise.resolve();
    },
    fail: (agent, workId, token, reason) => {
      calls.push("fail");
      failed.push({ agent, workId, token, reason });
      return Promise.resolve({ status: options.failStatus ?? "queued" });
    },
    cancel: (principal, workId) => {
      calls.push("cancel");
      cancelled.push({ principal, workId });
      return Promise.resolve();
    },
    get: (principal, workId) => {
      calls.push("get");
      got.push({ principal, workId });
      return Promise.resolve(options.view === undefined ? defaultView : options.view);
    },
    assertSessionDisposable: (sessionUri) => {
      calls.push("assertSessionDisposable");
      assertedSessions.push(sessionUri);
      return Promise.resolve();
    },
  };

  return {
    service,
    calls,
    submitted,
    claimed,
    renewed,
    completed,
    failed,
    cancelled,
    got,
    assertedSessions,
  };
};

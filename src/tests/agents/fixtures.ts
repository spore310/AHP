import type { AgentRegistrationRecord, AgentRegistrationRepository, WorkItemRecord } from "@persistence/types";
import type { AuthenticatedPrincipal } from "@agents";
import { createSessionOwnerRegistry, createWorkReadPort } from "@work";

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
        // Mirror the real upsert: a provided display name replaces the stored
        // one on conflict (COALESCE(EXCLUDED.display_name, ...)), and `enabled`
        // is left untouched.
        const updated: AgentRegistrationRecord = input.displayName === undefined
          ? existing
          : { ...existing, displayName: input.displayName };
        byKey.set(key, updated);
        records.set(existing.id, updated);
        return Promise.resolve(updated);
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

export const createSessionOwnersFixture = createSessionOwnerRegistry;

export const SESSION_URI = "ahp-session:/agent-work";
export const WORK_ID = "00000000-0000-4000-8000-000000000101";
export const LEASE_TOKEN = "00000000-0000-4000-8000-000000000102";
export const WORK_KIND = "code.review";

/** Transport tests observe delivery through the same read-only port the host installs. */
export function createWorkFixture() {
  const calls: string[] = [];
  const submitted: unknown[] = [];
  const got: { readonly principal: AuthenticatedPrincipal; readonly workId: string }[] = [];
  const assertedSessions: string[] = [];
  const view: WorkItemRecord = { id: WORK_ID, sessionUri: SESSION_URI, requestKey: "fixture", kind: WORK_KIND, status: "completed",
    input: { path: "experiment.txt" }, result: { ok: true }, attemptCount: 1, maxAttempts: 3,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z" };
  const read = createWorkReadPort({
    sessions: createSessionOwnerRegistry(),
    repository: {
      get: ({ workId, principalSubject }) => {
        calls.push("get");
        got.push({ principal: { subject: principalSubject }, workId });
        return Promise.resolve(view);
      },
      hasDependentWork: (uri) => {
        calls.push("assertSessionDisposable");
        assertedSessions.push(uri);
        return Promise.resolve(false);
      },
    },
  });
  // An accidentally exposed mutation must be visible to the wire-denial tests.
  const service = { ...read, submit(...args: unknown[]) {
    calls.push("submit");
    submitted.push(args);
    return Promise.reject(new Error("Unexpected remote mutation."));
  } };
  return { service, calls, got, submitted, assertedSessions };
}

import { isDeepStrictEqual } from "node:util";
import {
  RepositoryError,
  type AgentRegistrationRecord,
  type DurableSessionInput,
  type PersistenceProvider,
  type WorkItemRecord,
  type WorkLeaseRecord,
  type WorkStatus,
} from "@persistence";

/** Inspectable state for the example and repository conformance checks. */
interface ExamplePersistence {
  readonly provider: PersistenceProvider;
  readonly registrations: Map<string, AgentRegistrationRecord>;
  readonly sessions: Map<string, DurableSessionInput>;
  readonly work: Map<string, WorkItemRecord>;
  seedRegistration(record: AgentRegistrationRecord): void;
  seedSession(session: DurableSessionInput): void;
  setNow(now: number): void;
  isDisposed(): boolean;
}

// Match the async repository ports while keeping this example adapter in memory.
const operation = <T extends unknown[], R>(run: (...args: T) => R): ((...args: T) => Promise<R>) => (...args) => Promise.resolve().then(() => run(...args));

/** Local example storage, scoped to a single run. Configure PostgreSQL for real durability. */
export const createExamplePersistence = (): ExamplePersistence => {
  const registrations = new Map<string, AgentRegistrationRecord>();
  const registrationKeys = new Map<string, string>();
  const sessions = new Map<string, DurableSessionInput>();
  const work = new Map<string, WorkItemRecord>();
  let sequence = 0;
  let now = 1_000_000;
  let disposed = false;
  const assertOpen = (): void => {
    if (disposed) {
      throw new RepositoryError("database", "The example provider is closed.");
    }
  };
  const nextId = (): string => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };
  const ensureSession = (input: DurableSessionInput): DurableSessionInput => {
    assertOpen();
    const existing = sessions.get(input.sessionUri);
    if (existing !== undefined && existing.ownerPrincipalSubject !== input.ownerPrincipalSubject) {
      throw new RepositoryError("unauthorized", "The session belongs to another principal.");
    }
    sessions.set(input.sessionUri, input);
    return input;
  };

  const provider: PersistenceProvider = {
    registrations: {
      register: operation((input) => {
        assertOpen();
        const key = `${input.principalSubject}\u0000${input.agentKey}`;
        const existingId = registrationKeys.get(key);
        if (existingId !== undefined) {
          const existing = registrations.get(existingId);
          if (existing !== undefined) {
            const updated = input.displayName === undefined
              ? existing
              : { ...existing, displayName: input.displayName };
            registrations.set(existingId, updated);
            return updated;
          }
        }
        const record: AgentRegistrationRecord = {
          id: nextId(),
          principalSubject: input.principalSubject,
          agentKey: input.agentKey,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          enabled: true,
          createdAt: new Date(0).toISOString(),
        };
        registrations.set(record.id, record);
        registrationKeys.set(key, record.id);
        return record;
      }),
      getById: operation((id) => {
        assertOpen();
        return registrations.get(id);
      }),
    },
    sessions: {
      ensure: operation(ensureSession),
      get: operation((sessionUri) => {
        assertOpen();
        return sessions.get(sessionUri);
      }),
      delete: operation((sessionUri) => {
        assertOpen();
        if ([...work.values()].some((item) => item.sessionUri === sessionUri)) {
          throw new RepositoryError("conflict", "The session still has dependent work.");
        }
        return sessions.delete(sessionUri);
      }),
    },
    work: {
      submit: operation((input) => {
        assertOpen();
        const owner = sessions.get(input.session.sessionUri)?.ownerPrincipalSubject;
        if (owner !== undefined && owner !== input.session.ownerPrincipalSubject) {
          throw new RepositoryError("unauthorized", "The session belongs to another principal.");
        }
        const existing = [...work.values()].find(
          (item) => item.sessionUri === input.session.sessionUri && item.requestKey === input.requestKey,
        );
        if (existing !== undefined) {
          const same = existing.kind === input.kind
            && isDeepStrictEqual(existing.input, input.input)
            && existing.targetAgentId === input.targetAgentId;
          if (!same) {
            throw new RepositoryError("conflict", "The request key was already used with different work.");
          }
          return { id: existing.id, created: false };
        }
        ensureSession(input.session);
        const id = nextId();
        const record: WorkItemRecord = {
          id,
          sessionUri: input.session.sessionUri,
          requestKey: input.requestKey,
          kind: input.kind,
          input: input.input,
          status: "queued",
          targetAgentId: input.targetAgentId,
          attemptCount: 0,
          maxAttempts: 3,
          createdAt: input.session.createdAt,
          updatedAt: input.session.modifiedAt,
        };
        work.set(id, record);
        return { id, created: true };
      }),
      claim: operation((input): WorkLeaseRecord | null => {
        assertOpen();
        const registration = registrations.get(input.agentId);
        if (registration === undefined || !registration.enabled
          || registration.principalSubject !== input.principalSubject) {
          return null;
        }
        const candidate = [...work.values()].find((item) => (
          item.sessionUri === input.sessionUri
          && sessions.get(item.sessionUri)?.ownerPrincipalSubject === input.principalSubject
          && input.kinds.includes(item.kind)
          && (item.targetAgentId === undefined || item.targetAgentId === registration.id)
          && item.status === "queued"
          && item.attemptCount < item.maxAttempts
        ));
        if (candidate === undefined) {
          return null;
        }
        const leaseToken = nextId();
        const expiresAt = new Date(now + 60_000).toISOString();
        work.set(candidate.id, {
          ...candidate,
          status: "leased",
          leaseAgentId: registration.id,
          leaseToken,
          leaseExpiresAt: expiresAt,
          attemptCount: candidate.attemptCount + 1,
        });
        return {
          workId: candidate.id,
          sessionUri: candidate.sessionUri,
          kind: candidate.kind,
          input: candidate.input,
          leaseToken,
          leaseExpiresAt: expiresAt,
          attempt: candidate.attemptCount + 1,
        };
      }),
      renew: operation((input) => {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || item.status !== "leased" || item.leaseAgentId !== input.agentId
          || item.leaseToken !== input.token || (item.leaseExpiresAt !== undefined
            && Date.parse(item.leaseExpiresAt) <= now)) {
          return null;
        }
        const leaseExpiresAt = new Date(now + 60_000).toISOString();
        work.set(item.id, { ...item, leaseExpiresAt });
        return { leaseExpiresAt };
      }),
      complete: operation((input) => {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || item.status !== "leased" || item.leaseAgentId !== input.agentId
          || item.leaseToken !== input.token) {
          return false;
        }
        work.set(item.id, {
          ...item,
          status: "completed",
          result: input.result,
          leaseAgentId: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
        });
        return true;
      }),
      fail: operation((input) => {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || item.status !== "leased" || item.leaseAgentId !== input.agentId
          || item.leaseToken !== input.token) {
          return null;
        }
        const status: WorkStatus = input.retryable && item.attemptCount < item.maxAttempts
          ? "queued"
          : "failed";
        work.set(item.id, { ...item, status, leaseAgentId: undefined, leaseToken: undefined });
        return status;
      }),
      cancel: operation((input) => {
        assertOpen();
        const item = work.get(input.workId);
        if (item === undefined || sessions.get(item.sessionUri)?.ownerPrincipalSubject !== input.principalSubject) {
          return null;
        }
        if (item.status === "queued" || item.status === "leased") {
          work.set(item.id, { ...item, status: "cancelled", leaseAgentId: undefined, leaseToken: undefined });
          return "cancelled";
        }
        return item.status;
      }),
      get: operation((input) => {
        assertOpen();
        const item = work.get(input.workId);
        return item !== undefined
          && sessions.get(item.sessionUri)?.ownerPrincipalSubject === input.principalSubject
          ? item
          : null;
      }),
      reconcileExpired: operation(() => {
        assertOpen();
        let reconciled = 0;
        for (const item of work.values()) {
          if (item.status === "leased" && item.leaseExpiresAt !== undefined
            && Date.parse(item.leaseExpiresAt) <= now && item.attemptCount >= item.maxAttempts) {
            work.set(item.id, { ...item, status: "failed", leaseAgentId: undefined, leaseToken: undefined });
            reconciled += 1;
          }
        }
        return reconciled;
      }),
      hasDependentWork: operation((sessionUri) => {
        assertOpen();
        return [...work.values()].some((item) => item.sessionUri === sessionUri);
      }),
    },
    dispose: operation(() => {
      disposed = true;
    }),
  };

  return {
    provider,
    registrations,
    sessions,
    work,
    seedRegistration: (record) => registrations.set(record.id, record),
    seedSession: (session) => sessions.set(session.sessionUri, session),
    setNow: (value) => { now = value; },
    isDisposed: () => disposed,
  };
};

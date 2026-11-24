import {
  createMemoryDurableStorage,
  RepositoryError,
  type AgentRegistrationLimits,
  type AgentRegistrationRecord,
  type AgentRegistrationRepository,
  type PersistenceProvider,
} from "@persistence";
import { captureAgentRegistrationLimits } from "@persistence/helpers/agentRegistrations";

// Match the async repository ports while keeping this example adapter in memory.
const operation = <T extends unknown[], R>(run: (...args: T) => R): ((...args: T) => Promise<R>) => (...args) => Promise.resolve().then(() => run(...args));

/** In-process registration directory shared by the example and its legacy repository fixture. */
export function createExampleRegistrationState(registrationLimits?: Partial<AgentRegistrationLimits>) {
  const limits = captureAgentRegistrationLimits(registrationLimits);
  const registrations = new Map<string, AgentRegistrationRecord>();
  const registrationKeys = new Map<string, string>();
  const registrationKey = (domain: string | undefined, subject: string, agentKey: string) => JSON.stringify([domain ?? null, subject, agentKey]);
  let sequence = 0;
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
  const repository: AgentRegistrationRepository = {
    register: operation((input) => {
      assertOpen();
      const key = registrationKey(input.domainId, input.principalSubject, input.agentKey);
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
      if (registrations.size >= limits.maxTotal
        || [...registrations.values()].filter((record) => record.domainId === input.domainId && record.principalSubject === input.principalSubject).length >= limits.maxPerPrincipal) {
        throw new RepositoryError("conflict", "Agent registration capacity unavailable.");
      }
      const record: AgentRegistrationRecord = {
        id: nextId(),
        ...(input.domainId === undefined ? {} : { domainId: input.domainId, executionEpoch: "0" }),
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
    getById: operation((id, domainId) => {
      assertOpen();
      const record = registrations.get(id);
      return domainId === undefined || record?.domainId === domainId ? record : undefined;
    }),
  };
  return {
    repository, registrations, assertOpen, nextId,
    seedRegistration: (record: AgentRegistrationRecord) => {
      registrations.set(record.id, record);
      registrationKeys.set(registrationKey(record.domainId, record.principalSubject, record.agentKey), record.id);
    },
    dispose: operation(() => { disposed = true; }),
    isDisposed: () => disposed,
  };
}

/** The example uses exact-instance storage. P0 accepts no work submissions or leases. */
export function createExamplePersistence(registrationLimits?: Partial<AgentRegistrationLimits>): { provider: PersistenceProvider } {
  const directory = createExampleRegistrationState(registrationLimits);
  const unavailable = operation((): never => {
    directory.assertOpen();
    throw new RepositoryError("unauthorized", "This operation requires a durable exact-instance contract.");
  });
  const provider: PersistenceProvider = {
    durability: createMemoryDurableStorage(undefined, directory.registrations),
    registrations: directory.repository,
    sessions: { ensure: unavailable, get: unavailable, delete: unavailable },
    work: {
      submit: unavailable, claim: unavailable, renew: unavailable, complete: unavailable, fail: unavailable,
      cancel: unavailable, reconcileExpired: unavailable,
      get: operation(() => {
        directory.assertOpen();
        return null;
      }),
      hasDependentWork: operation(() => {
        directory.assertOpen();
        return false;
      }),
    },
    dispose: directory.dispose,
  };
  return { provider };
}

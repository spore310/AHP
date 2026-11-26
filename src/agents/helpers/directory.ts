import type {
  AgentRegistrationRecord,
  AgentRegistrationRepository,
} from "@persistence/types";
import { isPortableText } from "@persistence";

import { DEFAULT_DIRECTORY_MAX_PENDING, DEFAULT_DIRECTORY_MAX_RETAINED, DEFAULT_PRESENCE_TTL_MS } from "../constants";
import type {
  AgentDirectory,
  AgentDirectoryOptions,
  AuthenticatedPrincipal,
  PresenceBinding,
} from "../types";
import { AgentDirectoryError } from "./errors";

interface RetainedIdentity {
  readonly id: string;
  readonly key: string;
  record: AgentRegistrationRecord | undefined;
  generation: number;
}

const registrationKey = (subject: string, key: string): string => JSON.stringify([subject, key]);
const registrationCapacity = (): AgentDirectoryError => new AgentDirectoryError("conflict", "Agent registration capacity unavailable.");

/**
 * Create the agent registration and in-memory presence directory.
 *
 * Presence is deliberately process-local: a registration is durable through
 * the repository, while one live binding per agent is fenced by connection and
 * generation. Closing an old connection cannot remove a newer generation.
 */
export const createAgentDirectory = (options: AgentDirectoryOptions): AgentDirectory => {
  const domainId = options.domainId;
  const registrations: AgentRegistrationRepository = options.registrations;
  const now = options.now ?? Date.now;
  const presenceTtlMs = options.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS;
  const requireDomain = (principal: AuthenticatedPrincipal) => {
    if (principal.domainId !== undefined && principal.domainId !== domainId) {
      throw new AgentDirectoryError("unauthorized", "Agent registration is unavailable.");
    }
  };
  if (!Number.isFinite(presenceTtlMs) || presenceTtlMs <= 0) {
    throw new Error("Agent presence TTL must be a positive finite number of milliseconds");
  }
  const { maxRetained = DEFAULT_DIRECTORY_MAX_RETAINED, maxPending = DEFAULT_DIRECTORY_MAX_PENDING } = options.registrationLimits ?? {};
  if (!Number.isSafeInteger(maxRetained) || maxRetained < 1 || !Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new TypeError("Invalid agent directory registration limits.");
  }

  const byAgent = new Map<string, PresenceBinding>();
  const byConnection = new Map<string, Set<string>>();
  const retainedById = new Map<string, RetainedIdentity>();
  const retainedByKey = new Map<string, RetainedIdentity>();
  const reservations = new Map<string, { waiters: number; reserved: boolean }>();
  const pendingKeys = new Map<string, { cancelled: boolean }>();
  const pendingConnections = new Map<string, { cancelled: boolean }>();
  const changing = new Set<string>();
  let reservedIdentities = 0;
  let pendingOperations = 0;

  const removeBinding = (binding: PresenceBinding): boolean => {
    const current = byAgent.get(binding.agentId);
    if (
      current === undefined
      || current.connectionId !== binding.connectionId
      || current.generation !== binding.generation
      || current.principalSubject !== binding.principalSubject
    ) {
      return false;
    }

    byAgent.delete(binding.agentId);
    const connectionBindings = byConnection.get(binding.connectionId);
    if (connectionBindings !== undefined) {
      connectionBindings.delete(binding.agentId);
      if (connectionBindings.size === 0) {
        byConnection.delete(binding.connectionId);
      }
    }
    return true;
  };

  const liveBinding = (agentId: string, at: number): PresenceBinding | undefined => {
    const current = byAgent.get(agentId);
    if (current === undefined) {
      return undefined;
    }
    if (current.expiresAt <= at) {
      removeBinding(current);
      return undefined;
    }
    return current;
  };

  const beginRegistration = (locator: string, known: RetainedIdentity | undefined, bindingOwnsSlot = false) => {
    if (!bindingOwnsSlot && pendingOperations >= maxPending) throw registrationCapacity();
    let reservation = known === undefined ? reservations.get(locator) : undefined;
    if (known === undefined && reservation === undefined) {
      if (retainedById.size + reservedIdentities >= maxRetained) throw registrationCapacity();
      reservation = { waiters: 0, reserved: true };
      reservations.set(locator, reservation);
      reservedIdentities += 1;
    }
    if (reservation !== undefined) reservation.waiters += 1;
    if (!bindingOwnsSlot) pendingOperations += 1;
    return {
      remember(record: AgentRegistrationRecord): AgentRegistrationRecord {
        const key = registrationKey(record.principalSubject, record.agentKey);
        const identity = retainedById.get(record.id);
        if ((known !== undefined && (known.id !== record.id || known.key !== key))
          || (identity !== undefined && identity.key !== key)
          || (retainedByKey.has(key) && retainedByKey.get(key) !== identity)) {
          throw new AgentDirectoryError("conflict", "Agent registration identity changed.");
        }
        if (identity !== undefined) {
          identity.record = record;
          return record;
        }
        if (reservation?.reserved !== true) throw registrationCapacity();
        reservation.reserved = false;
        reservedIdentities -= 1;
        const retained = { id: record.id, key, record, generation: 0 };
        retainedById.set(record.id, retained);
        retainedByKey.set(key, retained);
        return record;
      },
      release(): void {
        if (!bindingOwnsSlot) pendingOperations -= 1;
        if (reservation === undefined) return;
        reservation.waiters -= 1;
        if (reservation.waiters === 0) {
          reservations.delete(locator);
          if (reservation.reserved) reservedIdentities -= 1;
        }
      },
    };
  };

  const install = (
    agentId: string,
    principal: AuthenticatedPrincipal,
    connectionId: string,
    executionEpoch?: string,
  ): PresenceBinding => {
    requireDomain(principal);
    const identity = retainedById.get(agentId);
    const record = identity?.record;
    if (identity === undefined || record === undefined) {
      throw new AgentDirectoryError("not_found", "Agent registration not found");
    }
    if (record.principalSubject !== principal.subject || !record.enabled) {
      throw new AgentDirectoryError("unauthorized", "Agent registration is not available");
    }

    const at = now();
    const current = liveBinding(agentId, at);
    if (current !== undefined) {
      if (current.connectionId === connectionId) {
        return current;
      }
      throw new AgentDirectoryError("conflict", "Agent already has a live connection");
    }

    // One connection owns at most one live agent identity. This keeps
    // `getByConnection` unambiguous for work authorization.
    for (const otherAgentId of [...(byConnection.get(connectionId) ?? [])]) {
      if (otherAgentId !== agentId && liveBinding(otherAgentId, at) !== undefined) {
        throw new AgentDirectoryError("conflict", "Connection already has a live agent");
      }
    }

    const generation = identity.generation + 1;
    if (!Number.isSafeInteger(generation)) throw registrationCapacity();
    identity.generation = generation;
    const binding: PresenceBinding = Object.freeze({
      ...(executionEpoch === undefined ? {} : { executionEpoch }),
      agentId,
      principalSubject: principal.subject,
      connectionId,
      generation,
      expiresAt: at + presenceTtlMs,
    });
    byAgent.set(agentId, binding);
    const connectionBindings = byConnection.get(connectionId) ?? new Set<string>();
    connectionBindings.add(agentId);
    byConnection.set(connectionId, connectionBindings);
    return binding;
  };

  async function register(
    principal: AuthenticatedPrincipal,
    agentKey: string,
    displayName?: string,
    bindingOwnsSlot = false,
  ): Promise<AgentRegistrationRecord> {
    requireDomain(principal);
    // Keep registration text within the application's portable-text profile.
    if (!isPortableText(agentKey)
      || (displayName !== undefined && !isPortableText(displayName))) {
      throw new AgentDirectoryError("invalid", "Registration text contains unsupported characters.");
    }
    const subject = principal.subject;
    const key = registrationKey(subject, agentKey);
    const known = retainedByKey.get(key);
    if (known !== undefined && known.record === undefined) {
      throw new AgentDirectoryError("not_found", "Agent registration not found");
    }
    const admission = beginRegistration(`key:${key}`, known, bindingOwnsSlot);
    try {
      const record = await registrations.register({
        ...(domainId === undefined ? {} : { domainId }),
        principalSubject: subject,
        agentKey,
        ...(displayName !== undefined ? { displayName } : {}),
      });
      if ((record.domainId !== undefined && record.domainId !== domainId) || record.principalSubject !== subject || record.agentKey !== agentKey) {
        throw new AgentDirectoryError("conflict", "Agent registration identity changed.");
      }
      return admission.remember(record);
    } finally {
      admission.release();
    }
  }

  const directory: AgentDirectory = {
    register: (principal, agentKey, displayName) => register(principal, agentKey, displayName),

    bindPresence(agentId, principal, connectionId) {
      const identity = retainedById.get(agentId);
      if (changing.has(agentId) || pendingConnections.has(connectionId) || (identity && pendingKeys.has(identity.key))) throw registrationCapacity();
      return install(agentId, principal, connectionId);
    },

    async registerPresence(principal, agentKey, connectionId, request = {}) {
      requireDomain(principal);
      const key = registrationKey(principal.subject, agentKey);
      const known = retainedByKey.get(key);
      const supportsEpoch = !!domainId && typeof registrations.bindExecution === "function" && typeof registrations.setEnabled === "function";
      if (request.requireExecutionEpoch && !supportsEpoch) throw new AgentDirectoryError("unauthorized", "Execution registration unavailable.");
      const connected = directory.getByConnection(connectionId);
      if (connected && connected.agentId !== known?.id) throw registrationCapacity();
      const online = known && liveBinding(known.id, now());
      if (online && online.connectionId !== connectionId) throw registrationCapacity();
      if ((known && changing.has(known.id)) || pendingKeys.has(key) || pendingConnections.has(connectionId) || pendingOperations >= maxPending) throw registrationCapacity();
      const reservation = { cancelled: false };
      pendingOperations += 1;
      pendingKeys.set(key, reservation);
      pendingConnections.set(connectionId, reservation);
      const check = () => {
        if ((request.current && !request.current()) || reservation.cancelled) throw new AgentDirectoryError("unauthorized", "Connection unavailable.");
      };
      try {
        check();
        const record = await register(principal, agentKey, request.displayName, true);
        check();
        if (!record.enabled || changing.has(record.id)) throw new AgentDirectoryError("unauthorized", "Agent registration unavailable.");
        const present = liveBinding(record.id, now());
        if (present) {
          if (present.connectionId !== connectionId) throw registrationCapacity();
          if (present.executionEpoch !== undefined && present.executionEpoch !== record.executionEpoch) {
            removeBinding(present);
          } else if (!request.requireExecutionEpoch || present.executionEpoch !== undefined) {
            return present;
          } else {
            throw registrationCapacity();
          }
        }
        if (!domainId || !registrations.bindExecution || !registrations.setEnabled) {
          return install(record.id, principal, connectionId);
        }
        const committed = await registrations.bindExecution(record);
        check();
        if (!committed.enabled || committed.id !== record.id || committed.principalSubject !== principal.subject || committed.domainId !== domainId
          || committed.agentKey !== agentKey || record.executionEpoch === undefined || committed.executionEpoch !== (BigInt(record.executionEpoch) + 1n).toString()
          || changing.has(record.id)) throw new AgentDirectoryError("unauthorized", "Execution registration unavailable.");
        const identity = retainedById.get(record.id);
        if (!identity) throw registrationCapacity();
        identity.record = committed;
        return install(record.id, principal, connectionId, committed.executionEpoch);
      } finally {
        pendingOperations -= 1;
        pendingKeys.delete(key);
        pendingConnections.delete(connectionId);
      }
    },

    async attachPresence(principal, agentKey, connectionId, executionEpoch) {
      requireDomain(principal);
      if (!domainId || !registrations.bindExecution) throw new AgentDirectoryError("unauthorized", "Execution registration unavailable.");
      const key = registrationKey(principal.subject, agentKey);
      if (pendingKeys.has(key) || pendingConnections.has(connectionId) || pendingOperations >= maxPending) throw registrationCapacity();
      const reservation = { cancelled: false };
      pendingOperations += 1;
      pendingKeys.set(key, reservation);
      pendingConnections.set(connectionId, reservation);
      try {
        // A fresh durable read: the cache of another host's binding proves nothing here.
        const record = await register(principal, agentKey, undefined, true);
        if (reservation.cancelled || !record.enabled || changing.has(record.id) || record.executionEpoch === undefined
          || record.executionEpoch === "0" || record.executionEpoch !== executionEpoch) {
          throw new AgentDirectoryError("unauthorized", "Agent registration is not available");
        }
        const present = liveBinding(record.id, now());
        if (present) {
          if (present.connectionId === connectionId && present.executionEpoch === executionEpoch) return directory.renewPresence(present) ?? present;
          // A binding from an older generation is stale. One from this generation on another socket conflicts.
          if (present.executionEpoch === executionEpoch) throw registrationCapacity();
          removeBinding(present);
        }
        return install(record.id, principal, connectionId, executionEpoch);
      } finally {
        pendingOperations -= 1;
        pendingKeys.delete(key);
        pendingConnections.delete(connectionId);
      }
    },

    async setEnabled(agentId, enabled) {
      if (!domainId || !registrations.setEnabled || typeof enabled !== "boolean") throw new AgentDirectoryError("invalid", "Registration changes unavailable.");
      if (changing.has(agentId) || changing.size >= maxPending) throw registrationCapacity();
      changing.add(agentId);
      const identity = retainedById.get(agentId);
      const reservation = identity && pendingKeys.get(identity.key);
      if (reservation) reservation.cancelled = true;
      const binding = byAgent.get(agentId);
      try {
        if (!enabled && binding) {
          removeBinding(binding);
          options.changed?.();
        }
        const record = await registrations.setEnabled(agentId, domainId, enabled);
        if (identity) identity.record = record;
        return record;
      } finally {
        changing.delete(agentId);
      }
    },

    renewPresence(binding: PresenceBinding): PresenceBinding | undefined {
      const current = byAgent.get(binding.agentId);
      if (
        current === undefined
        || current.connectionId !== binding.connectionId
        || current.generation !== binding.generation
        || current.principalSubject !== binding.principalSubject
      ) {
        return undefined;
      }

      const at = now();
      if (current.expiresAt <= at) {
        removeBinding(current);
        return undefined;
      }

      const renewed: PresenceBinding = Object.freeze({ ...current, expiresAt: at + presenceTtlMs });
      byAgent.set(renewed.agentId, renewed);
      return renewed;
    },

    releasePresence(binding: PresenceBinding): void {
      removeBinding(binding);
    },

    releaseConnection(connectionId: string): void {
      const pending = pendingConnections.get(connectionId);
      if (pending) pending.cancelled = true;
      for (const agentId of [...(byConnection.get(connectionId) ?? [])]) {
        const current = byAgent.get(agentId);
        if (current !== undefined && current.connectionId === connectionId) {
          removeBinding(current);
        }
      }
      byConnection.delete(connectionId);
    },

    getOnline(agentId: string): PresenceBinding | undefined {
      return liveBinding(agentId, now());
    },
    capturePresenceFence(binding, epoch) {
      const start = performance.now();
      const deadline = start + binding.expiresAt - now();
      return () => {
        const live = byAgent.get(binding.agentId);
        const registration = retainedById.get(binding.agentId)?.record;
        return live?.executionEpoch === epoch && live.generation === binding.generation && live.connectionId === binding.connectionId
          && registration?.enabled === true && registration.executionEpoch === epoch && performance.now() < deadline;
      };
    },

    getByConnection(connectionId: string): PresenceBinding | undefined {
      const at = now();
      for (const agentId of [...(byConnection.get(connectionId) ?? [])]) {
        const binding = liveBinding(agentId, at);
        if (binding !== undefined && binding.connectionId === connectionId) {
          return binding;
        }
      }
      return undefined;
    },

    async getRegistration(agentId: string): Promise<AgentRegistrationRecord | undefined> {
      const known = retainedById.get(agentId);
      const admission = beginRegistration(`id:${agentId}`, known);
      try {
        const record = await (domainId === undefined ? registrations.getById(agentId) : registrations.getById(agentId, domainId));
        if (record === undefined) {
          if (known !== undefined) known.record = undefined;
          return undefined;
        }
        if (record.id !== agentId || (record.domainId !== undefined && record.domainId !== domainId)) throw new AgentDirectoryError("conflict", "Agent registration identity changed.");
        return admission.remember(record);
      } finally {
        admission.release();
      }
    },
  };
  return directory;
};

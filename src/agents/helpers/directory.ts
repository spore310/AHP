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
  const registrations: AgentRegistrationRepository = options.registrations;
  const now = options.now ?? Date.now;
  const presenceTtlMs = options.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS;
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

  const beginRegistration = (locator: string, known: RetainedIdentity | undefined) => {
    if (pendingOperations >= maxPending) throw registrationCapacity();
    let reservation = known === undefined ? reservations.get(locator) : undefined;
    if (known === undefined && reservation === undefined) {
      if (retainedById.size + reservedIdentities >= maxRetained) throw registrationCapacity();
      reservation = { waiters: 0, reserved: true };
      reservations.set(locator, reservation);
      reservedIdentities += 1;
    }
    if (reservation !== undefined) reservation.waiters += 1;
    pendingOperations += 1;
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
        pendingOperations -= 1;
        if (reservation === undefined) return;
        reservation.waiters -= 1;
        if (reservation.waiters === 0) {
          reservations.delete(locator);
          if (reservation.reserved) reservedIdentities -= 1;
        }
      },
    };
  };

  return {
    async register(
      principal: AuthenticatedPrincipal,
      agentKey: string,
      displayName?: string,
    ): Promise<AgentRegistrationRecord> {
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
      const admission = beginRegistration(`key:${key}`, known);
      try {
        const record = await registrations.register({
          principalSubject: subject,
          agentKey,
          ...(displayName !== undefined ? { displayName } : {}),
        });
        if (record.principalSubject !== subject || record.agentKey !== agentKey) {
          throw new AgentDirectoryError("conflict", "Agent registration identity changed.");
        }
        return admission.remember(record);
      } finally {
        admission.release();
      }
    },

    bindPresence(
      agentId: string,
      principal: AuthenticatedPrincipal,
      connectionId: string,
    ): PresenceBinding {
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
      const binding: PresenceBinding = {
        agentId,
        principalSubject: principal.subject,
        connectionId,
        generation,
        expiresAt: at + presenceTtlMs,
      };
      byAgent.set(agentId, binding);
      const connectionBindings = byConnection.get(connectionId) ?? new Set<string>();
      connectionBindings.add(agentId);
      byConnection.set(connectionId, connectionBindings);
      return binding;
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

      const renewed: PresenceBinding = { ...current, expiresAt: at + presenceTtlMs };
      byAgent.set(renewed.agentId, renewed);
      return renewed;
    },

    releasePresence(binding: PresenceBinding): void {
      removeBinding(binding);
    },

    releaseConnection(connectionId: string): void {
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
        const record = await registrations.getById(agentId);
        if (record === undefined) {
          if (known !== undefined) known.record = undefined;
          return undefined;
        }
        if (record.id !== agentId) throw new AgentDirectoryError("conflict", "Agent registration identity changed.");
        return admission.remember(record);
      } finally {
        admission.release();
      }
    },
  };
};

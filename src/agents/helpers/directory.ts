import type {
  AgentRegistrationRecord,
  AgentRegistrationRepository,
} from "@persistence/types";
import { isPortableText } from "@persistence";

import { DEFAULT_PRESENCE_TTL_MS } from "../constants";
import type {
  AgentDirectory,
  AgentDirectoryOptions,
  AuthenticatedPrincipal,
  PresenceBinding,
} from "../types";
import { AgentDirectoryError } from "./errors";

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

  const byAgent = new Map<string, PresenceBinding>();
  const byConnection = new Map<string, Set<string>>();
  const generations = new Map<string, number>();
  const registrationCache = new Map<string, AgentRegistrationRecord>();

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

  const cachedRegistration = (agentId: string): AgentRegistrationRecord | undefined => (
    registrationCache.get(agentId)
  );

  const rememberRegistration = (
    record: AgentRegistrationRecord,
  ): AgentRegistrationRecord => {
    registrationCache.set(record.id, record);
    return record;
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
      const record = await registrations.register({
        principalSubject: principal.subject,
        agentKey,
        ...(displayName !== undefined ? { displayName } : {}),
      });
      return rememberRegistration(record);
    },

    bindPresence(
      agentId: string,
      principal: AuthenticatedPrincipal,
      connectionId: string,
    ): PresenceBinding {
      const record = cachedRegistration(agentId);
      if (record === undefined) {
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

      const generation = (generations.get(agentId) ?? 0) + 1;
      generations.set(agentId, generation);
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
      const record = await registrations.getById(agentId);
      if (record === undefined) {
        registrationCache.delete(agentId);
        return undefined;
      }
      return rememberRegistration(record);
    },
  };
};

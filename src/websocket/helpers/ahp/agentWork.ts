import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { AgentDirectoryError, type AgentDirectory, type AuthenticatedPrincipal, type PresenceBinding } from "@agents";
import { RpcError } from "@jsonrpc";
import { isPortableText, RepositoryError } from "@persistence";
import { WorkError, type WorkService } from "@work";

import type { JsonRpcHandler, JsonRpcHandlers, WebSocketConnectionContext } from "../../types";
import {
  AGENT_REGISTER_METHOD,
  AGENT_RENEW_METHOD,
  AGENT_UNREGISTER_METHOD,
  WORK_GET_METHOD,
} from "./constants";

export interface AgentWorkExtensionOptions {
  readonly agents?: AgentDirectory;
  readonly work?: Pick<WorkService, "get">;
}

export interface AgentWorkExtension {
  readonly handlers: JsonRpcHandlers;
  /** Releases presence bound to the exact connection. */
  onConnectionClose(connectionId: string): void;
  /** Releases extension-owned resources. Presence is released by connection. */
  dispose(): void;
}

const version = z.literal(1);
const requiresPortableText = (value: string): boolean => isPortableText(value);
const agentKey = z.string().min(1).max(128).refine(
  (value) => value.trim().length > 0,
  { message: "Agent key must not be blank" },
).refine(requiresPortableText, {
  message: "Agent key contains unsupported characters",
});
const displayName = z.string().min(1).max(128).refine(
  (value) => value.trim().length > 0,
  { message: "Display name must not be blank" },
).refine(requiresPortableText, {
  message: "Display name contains unsupported characters",
});
const registerSchema = z.object({
  version,
  agentKey,
  displayName: displayName.optional(),
}).strict();

const renewSchema = z.object({ version }).strict();

const getSchema = z.object({
  version,
  workId: z.uuid(),
}).strict();

const invalid = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Request rejected");
};

const conflict = (): never => {
  throw new RpcError(AhpErrorCodes.Conflict, "Conflict");
};

const stale = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Request rejected");
};

const authRequired = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Authentication required");
};

const notConfigured = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Extension is not configured");
};

const mapRepositoryError = (error: RepositoryError): never => {
  switch (error.code) {
    case "conflict":
      return conflict();
    case "not_found":
    case "unauthorized":
      return invalid();
    case "database":
      throw new RpcError(JsonRpcErrorCodes.InternalError, "Internal error");
  }
};

/** Maps a work-domain failure to the shared generic wire error vocabulary. */
export const mapWorkError = (error: unknown): never => {
  if (error instanceof WorkError) {
    switch (error.code) {
      case "invalid":
        return invalid();
      case "not_found":
      case "unauthorized":
        return invalid();
      case "conflict":
        return conflict();
      case "stale":
      case "exhausted":
        return stale();
    }
  }
  if (error instanceof RepositoryError) {
    return mapRepositoryError(error);
  }
  throw error;
};

const mapAgentError = (error: unknown): never => {
  if (error instanceof AgentDirectoryError) {
    if (error.code === "conflict") {
      return conflict();
    }
    return invalid();
  }
  if (error instanceof RepositoryError) {
    return mapRepositoryError(error);
  }
  throw error;
};

const toIso = (milliseconds: number): string => new Date(milliseconds).toISOString();

/**
 * Build the versioned, authenticated agent/work request extension.
 *
 * Identity always comes from the connection context and live presence. Request
 * JSON can never supply an agent ID, principal, generation, or connection ID.
 */
export const createAgentWorkExtension = (
  options: AgentWorkExtensionOptions,
): AgentWorkExtension => {
  const requirePrincipal = (context: WebSocketConnectionContext): AuthenticatedPrincipal => {
    const { principal } = context;
    if (principal === undefined) {
      return authRequired();
    }
    return principal;
  };

  const requireAgents = (): AgentDirectory => {
    if (options.agents === undefined) {
      return notConfigured();
    }
    return options.agents;
  };

  const requireWork = (): Pick<WorkService, "get"> => {
    if (options.work === undefined) {
      return notConfigured();
    }
    return options.work;
  };

  const requireBinding = (
    agents: AgentDirectory,
    principal: AuthenticatedPrincipal,
    context: WebSocketConnectionContext,
  ): PresenceBinding => {
    const binding = agents.getByConnection(context.connectionId);
    if (binding === undefined || binding.principalSubject !== principal.subject) {
      return invalid();
    }
    return binding;
  };

  const handlers: Record<string, JsonRpcHandler> = {
    [AGENT_REGISTER_METHOD]: async (params, context) => {
      const principal = requirePrincipal(context);
      const agents = requireAgents();
      const parsed = registerSchema.parse(params);
      // A connection holding another live agent can never bind a new one, so
      // refuse before a durable registration row is created; there is no delete
      // path to clean a stranded row up later. Re-registering the connection's
      // own agent key stays allowed (the binding is idempotent).
      const connected = agents.getByConnection(context.connectionId);
      if (connected !== undefined) {
        const bound = await agents.getRegistration(connected.agentId);
        if (bound === undefined
          || bound.principalSubject !== principal.subject
          || bound.agentKey !== parsed.agentKey) {
          conflict();
        }
      }
      try {
        const registration = await agents.register(
          principal,
          parsed.agentKey,
          parsed.displayName,
        );
        const binding = agents.bindPresence(
          registration.id,
          principal,
          context.connectionId,
        );
        return {
          version: 1,
          agentId: registration.id,
          presenceExpiresAt: toIso(binding.expiresAt),
        };
      } catch (error) {
        return mapAgentError(error);
      }
    },

    [AGENT_RENEW_METHOD]: (params, context) => {
      const principal = requirePrincipal(context);
      const agents = requireAgents();
      renewSchema.parse(params);
      const binding = requireBinding(agents, principal, context);
      const renewed = agents.renewPresence(binding);
      if (renewed === undefined) {
        return invalid();
      }
      return {
        version: 1,
        agentId: renewed.agentId,
        presenceExpiresAt: toIso(renewed.expiresAt),
      };
    },

    [AGENT_UNREGISTER_METHOD]: (params, context) => {
      const principal = requirePrincipal(context);
      const agents = requireAgents();
      renewSchema.parse(params);
      const binding = agents.getByConnection(context.connectionId);
      if (binding !== undefined && binding.principalSubject === principal.subject) {
        agents.releasePresence(binding);
      }
      return null;
    },

    [WORK_GET_METHOD]: async (params, context, invocation) => {
      const principal = requirePrincipal(context);
      const work = requireWork();
      const parsed = getSchema.parse(params);
      try {
        const setup = context.security;
        if (!setup) return { version: 1, work: await work.get(principal, parsed.workId) };
        const identity = setup.context.actor.principal;
        if (identity.subject !== principal.subject || !invocation.guardReply) return invalid();
        let instanceCurrent: (() => boolean) | undefined;
        const view = await work.get(principal, parsed.workId, identity.domainId, (check) => {
          instanceCurrent = check;
        });
        const deliveryCheck = instanceCurrent;
        const current = () => context.security === setup && context.isSecurityCurrent?.() === true
          && (view === null || deliveryCheck?.() === true);
        if (!current()) return invalid();
        invocation.guardReply(current);
        return { version: 1, work: view };
      } catch (error) {
        return mapWorkError(error);
      }
    },
  };

  return {
    handlers,
    onConnectionClose(connectionId: string): void {
      options.agents?.releaseConnection(connectionId);
    },
    dispose(): void {
      // Presence is connection-scoped and released by the binding owner.
    },
  };
};

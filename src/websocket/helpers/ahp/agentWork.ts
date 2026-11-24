import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { z } from "zod";
import { workRequestSchemas } from "@work/helpers/protocol/schemas";

import { AgentDirectoryError, type AgentDirectory, type AuthenticatedPrincipal, type PresenceBinding } from "@agents";
import { RpcError } from "@jsonrpc";
import { isPortableText, RepositoryError } from "@persistence";
import { WorkError, type WorkReadPort, type AuthorizedWorkView, type WorkRequestContext, type WorkApproval } from "@work";
import { workConnection } from "./workContext";
import { createWorkMutationHandlers, type ProtectedWorkMutations } from "./workMutations";

import type { JsonRpcHandler, JsonRpcHandlers, WebSocketConnectionContext } from "../../types";
import {
  AGENT_REGISTER_METHOD,
  AGENT_RENEW_METHOD,
  AGENT_UNREGISTER_METHOD,
  WORK_GET_METHOD,
} from "./constants";

export interface AgentWorkExtensionOptions {
  readonly agents?: AgentDirectory;
  readonly work?: Pick<WorkReadPort, "get">;
  readonly protectedWork?: ProtectedWorkBinding;
}

export interface ProtectedWorkBinding {
  bindingFailed?(error: unknown): void;
  service?: ProtectedWorkMutations["service"];
  worker?: ProtectedWorkMutations["worker"];
  agentKey(context: WebSocketConnectionContext): string | undefined;
  get(caller: WorkRequestContext, id: string): Promise<AuthorizedWorkView | null>;
  changed?(): void;
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

const getSchema = workRequestSchemas.get;

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
    case "outcome_unknown":
      throw new RpcError(JsonRpcErrorCodes.InternalError, "Internal error", { version: 1, kind: "outcome_unknown", correlationId: error.correlationId });
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
    if (context.security) {
      if (context.isSecurityCurrent?.() !== true) return authRequired();
      return context.security.context.actor.principal;
    }
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

  const requireWork = (): Pick<WorkReadPort, "get"> => {
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
    ...(options.protectedWork?.service && options.protectedWork.worker
      ? createWorkMutationHandlers({ service: options.protectedWork.service, worker: options.protectedWork.worker.bind(options.protectedWork) }, mapWorkError)
      : {}),
    [AGENT_REGISTER_METHOD]: async (params, context) => {
      const principal = requirePrincipal(context);
      const agents = requireAgents();
      const parsed = registerSchema.parse(params);
      if (context.security) {
        const actor = context.security.context.actor;
        const key = options.protectedWork ? options.protectedWork.agentKey(context) : actor.kind === "agent" ? actor.agentId : undefined;
        if (actor.kind !== "agent" || key !== parsed.agentKey) return invalid();
      }
      try {
        const binding = await agents.registerPresence(principal, parsed.agentKey, context.connectionId, {
          ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName }),
          ...(context.security && { current: () => context.isSecurityCurrent?.() === true }),
          requireExecutionEpoch: options.protectedWork !== undefined,
        });
        return {
          version: 1,
          agentId: binding.agentId,
          presenceExpiresAt: toIso(binding.expiresAt),
        };
      } catch (error) {
        options.protectedWork?.bindingFailed?.(error);
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
        options.protectedWork?.changed?.();
      }
      return null;
    },

    [WORK_GET_METHOD]: async (params, context, invocation) => {
      const principal = requirePrincipal(context);
      const parsed = getSchema.parse(params);
      try {
        if (context.security) {
          if (!invocation.guardReply || invocation.kind !== "request") return invalid();
          const caller = workConnection(context);
          let receipt: WorkApproval | undefined;
          const retainReply = (approval: WorkApproval) => {
            if (receipt) return invalid();
            receipt = approval;
            invocation.onReplySettled(() => {
              approval.release();
            });
          };
          const view = await options.protectedWork?.get({ ...caller, retainReply }, parsed.workId) ?? null;
          const check = () => caller.isCurrent() && (view === null || receipt?.isCurrent() === true);
          if (!check()) return invalid();
          invocation.guardReply(check);
          return { version: 1, work: view };
        }
        return { version: 1, work: await requireWork().get(principal, parsed.workId) };
      } catch (error) {
        return mapWorkError(error);
      }
    },
  };

  return {
    handlers,
    onConnectionClose(connectionId: string): void {
      options.agents?.releaseConnection(connectionId);
      options.protectedWork?.changed?.();
    },
    dispose(): void {
      // Presence is connection-scoped and released by the binding owner.
    },
  };
};

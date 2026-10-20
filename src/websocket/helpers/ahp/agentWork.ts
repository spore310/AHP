import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { AgentDirectoryError, type AgentDirectory, type AuthenticatedPrincipal, type PresenceBinding } from "@agents";
import { RpcError } from "@jsonrpc";
import { RepositoryError } from "@persistence";
import { sessionUriSchema } from "@sessions/types";
import { WorkError, type AuthorizedAgentContext, type SessionOwnerRegistry, type WorkService } from "@work";

import type { JsonRpcHandler, JsonRpcHandlers, WebSocketConnectionContext } from "../../types";
import {
  AGENT_REGISTER_METHOD,
  AGENT_RENEW_METHOD,
  AGENT_UNREGISTER_METHOD,
  MAX_AGENT_WORK_PAYLOAD_BYTES,
  WORK_CANCEL_METHOD,
  WORK_CLAIM_METHOD,
  WORK_COMPLETE_METHOD,
  WORK_FAIL_METHOD,
  WORK_GET_METHOD,
  WORK_RENEW_METHOD,
  WORK_SUBMIT_METHOD,
} from "./constants";

export interface AgentWorkExtensionOptions {
  readonly agents?: AgentDirectory;
  readonly work?: WorkService;
  readonly sessionOwners: SessionOwnerRegistry;
}

export interface AgentWorkExtension {
  readonly handlers: JsonRpcHandlers;
  /** Releases presence bound to the exact connection. */
  onConnectionClose(connectionId: string): void;
  /** Releases extension-owned resources. Presence is released by connection. */
  dispose(): void;
}

const version = z.literal(1);
const agentKey = z.string().min(1).max(128).refine(
  (value) => value.trim().length > 0,
  { message: "Agent key must not be blank" },
);
const displayName = z.string().min(1).max(128);
const requestKey = z.string().min(1).max(128).refine(
  (value) => value.trim().length > 0,
  { message: "Request key must not be blank" },
);
const workKind = z.string().min(1).max(128).refine(
  (value) => value.trim().length > 0,
  { message: "Work kind must not be blank" },
);
const workId = z.uuid();
const leaseToken = z.uuid();
const failureMessage = z.string().min(1).max(512).refine(
  (value) => value.trim().length > 0,
  { message: "Failure message must not be blank" },
);

const isBoundedJson = (value: unknown): boolean => {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return false;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= MAX_AGENT_WORK_PAYLOAD_BYTES;
  } catch {
    return false;
  }
};

const boundedJson = z.unknown().refine(isBoundedJson, {
  message: "Payload must be bounded JSON",
});

const boundedObject = z.record(z.string(), z.unknown()).refine(isBoundedJson, {
  message: "Payload must be bounded JSON",
});

const registerSchema = z.object({
  version,
  agentKey,
  displayName: displayName.optional(),
}).strict();

const renewSchema = z.object({ version }).strict();

const boundedSessionUri = sessionUriSchema.max(2_048);

const submitSchema = z.object({
  version,
  sessionUri: boundedSessionUri,
  requestKey,
  kind: workKind,
  input: boundedObject,
  targetAgentId: z.uuid().optional(),
}).strict();

const claimSchema = z.object({
  version,
  sessionUri: boundedSessionUri,
}).strict();

const leaseSchema = z.object({
  version,
  workId,
  leaseToken,
}).strict();

const completeSchema = z.object({
  version,
  workId,
  leaseToken,
  result: boundedJson,
}).strict();

const failSchema = z.object({
  version,
  workId,
  leaseToken,
  retryable: z.boolean(),
  message: failureMessage,
}).strict();

const cancelOrGetSchema = z.object({
  version,
  workId,
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

  const requireWork = (): WorkService => {
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

  const authorizedAgentContext = (
    context: WebSocketConnectionContext,
  ): AuthorizedAgentContext => {
    const principal = requirePrincipal(context);
    const agents = requireAgents();
    const binding = requireBinding(agents, principal, context);
    return {
      principal,
      agentId: binding.agentId,
      connectionId: context.connectionId,
      generation: binding.generation,
    };
  };

  const assertOwnedSession = (
    sessionUri: string,
    principal: AuthenticatedPrincipal,
  ): void => {
    const owner = options.sessionOwners.owner(sessionUri);
    if (owner !== undefined && owner !== principal.subject) {
      invalid();
    }
  };

  const handlers: Record<string, JsonRpcHandler> = {
    [AGENT_REGISTER_METHOD]: async (params, context) => {
      const principal = requirePrincipal(context);
      const agents = requireAgents();
      const parsed = registerSchema.parse(params);
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

    [WORK_SUBMIT_METHOD]: async (params, context) => {
      const principal = requirePrincipal(context);
      const work = requireWork();
      const parsed = submitSchema.parse(params);
      assertOwnedSession(parsed.sessionUri, principal);
      try {
        const submitted = await work.submit(principal, {
          sessionUri: parsed.sessionUri,
          requestKey: parsed.requestKey,
          kind: parsed.kind,
          input: parsed.input,
          ...(parsed.targetAgentId !== undefined
            ? { targetAgentId: parsed.targetAgentId }
            : {}),
        });
        return { version: 1, workId: submitted.id };
      } catch (error) {
        return mapWorkError(error);
      }
    },

    [WORK_CLAIM_METHOD]: async (params, context) => {
      const work = requireWork();
      const agent = authorizedAgentContext(context);
      const parsed = claimSchema.parse(params);
      assertOwnedSession(parsed.sessionUri, agent.principal);
      try {
        const lease = await work.claim(agent, parsed.sessionUri);
        if (lease === null) {
          return { version: 1, work: null };
        }
        return {
          version: 1,
          work: {
            workId: lease.workId,
            sessionUri: lease.sessionUri,
            kind: lease.kind,
            input: lease.input,
            leaseToken: lease.leaseToken,
            leaseExpiresAt: lease.leaseExpiresAt,
            attempt: lease.attempt,
          },
        };
      } catch (error) {
        return mapWorkError(error);
      }
    },

    [WORK_RENEW_METHOD]: async (params, context) => {
      const work = requireWork();
      const agent = authorizedAgentContext(context);
      const parsed = leaseSchema.parse(params);
      try {
        const renewed = await work.renew(agent, parsed.workId, parsed.leaseToken);
        return { version: 1, leaseExpiresAt: renewed.leaseExpiresAt };
      } catch (error) {
        return mapWorkError(error);
      }
    },

    [WORK_COMPLETE_METHOD]: async (params, context) => {
      const work = requireWork();
      const agent = authorizedAgentContext(context);
      const parsed = completeSchema.parse(params);
      try {
        await work.complete(agent, parsed.workId, parsed.leaseToken, parsed.result);
        return null;
      } catch (error) {
        return mapWorkError(error);
      }
    },

    [WORK_FAIL_METHOD]: async (params, context) => {
      const work = requireWork();
      const agent = authorizedAgentContext(context);
      const parsed = failSchema.parse(params);
      try {
        const failed = await work.fail(agent, parsed.workId, parsed.leaseToken, {
          retryable: parsed.retryable,
          message: parsed.message,
        });
        return { version: 1, status: failed.status };
      } catch (error) {
        return mapWorkError(error);
      }
    },

    [WORK_CANCEL_METHOD]: async (params, context) => {
      const principal = requirePrincipal(context);
      const work = requireWork();
      const parsed = cancelOrGetSchema.parse(params);
      try {
        await work.cancel(principal, parsed.workId);
        return null;
      } catch (error) {
        return mapWorkError(error);
      }
    },

    [WORK_GET_METHOD]: async (params, context) => {
      const principal = requirePrincipal(context);
      const work = requireWork();
      const parsed = cancelOrGetSchema.parse(params);
      try {
        const view = await work.get(principal, parsed.workId);
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

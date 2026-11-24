import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import { RpcError } from "@jsonrpc";
import type { SessionsFactory } from "@sessions/types";
import { parseClientSessionAction } from "@sessions/helpers/actions";
import { ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED, ACTION_TYPE_SESSION_IS_READ_CHANGED, ACTION_TYPE_SESSION_TITLE_CHANGED } from "@sessions/constants";
import { sameResource } from "@authorization/helpers/context";
import type { JsonRpcHandlers, WebSocketConnectionContext } from "@websocket/types";

import { AGENT_WORK_REQUEST_METHODS, TOOL_PRIVATE_REQUEST_METHODS, TOOL_COMPLETE_METHOD } from "./constants";
import { createAHPKernel, type AHPBinding } from "./helpers/kernel/helpers";
import { channelParamsSchema, dispatchActionParamsSchema, initializeParamsSchema, type AHPBindingOptions, type AHPDiagnostic, type NativeSessionWrites } from "./types";

export type { AHPBinding } from "./helpers/kernel/helpers";

const unavailable = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
};

const mayReadGlobalSequence = (context: WebSocketConnectionContext): boolean => {
  try {
    const setup = context.security;
    const permission: unknown = setup?.allowGlobalSequence;
    return setup !== undefined && permission === true
      && context.connectionGeneration !== undefined
      && setup.fence.connectionId === context.connectionId
      && setup.context.connectionId === context.connectionId
      && setup.fence.connectionGeneration === context.connectionGeneration
      && context.isSecurityCurrent?.() === true;
  } catch {
    return false;
  }
};

/** Safe supported facade. Native reads require explicit canonical resource-view configuration. */
export const createAHPBinding = (
  factory: SessionsFactory,
  reportDiagnostic: (diagnostic: AHPDiagnostic) => void = () => undefined,
  options?: AHPBindingOptions,
): AHPBinding => {
  const authorization = factory.authorization;
  const admitWrite = options?.nativeWrites?.admit.bind(options.nativeWrites);
  if (admitWrite !== undefined && (authorization === undefined || factory.durability === undefined || options?.protectedViews === undefined)) {
    throw new Error("Native session writes require protected durable sessions and views.");
  }
  if (authorization !== undefined && options?.sessionOwners !== undefined) {
    throw new Error("Protected creation cannot use a competing mutable owner registry.");
  }
  const lifetimes = new Map<WebSocketConnectionContext, AbortController>();
  const maxSubscriptions = options?.maxInitialSubscriptions ?? 128;
  if (!Number.isInteger(maxSubscriptions) || maxSubscriptions < 1 || maxSubscriptions > 1024) {
    throw new Error("Invalid initial subscription limit.");
  }
  const kernel = createAHPKernel(factory, reportDiagnostic, options);
  const handlers: Record<string, JsonRpcHandlers[string]> = {};
  for (const [method, handler] of Object.entries(kernel.handlers)) {
    handlers[method] = (params, context, invocation) => {
      if (TOOL_PRIVATE_REQUEST_METHODS.has(method)) {
        kernel.beforeDispatch({ method, params, context, invocation, kind: invocation.kind });
        return Promise.resolve().then(() => handler(params, context, invocation)).catch(() => {
          throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Tool operation unavailable");
        });
      }
      if (method === TOOL_COMPLETE_METHOD) {
        kernel.beforeDispatch({ method, params, context, invocation, kind: invocation.kind });
        return handler(params, context, invocation);
      }
      if (admitWrite !== undefined && authorization !== undefined && (method === "dispatchAction" || method === "disposeSession")) {
        kernel.beforeDispatch({ method, params, context, invocation, kind: invocation.kind });
        const clientId = kernel.initializedClientId(context);
        const setup = context.security;
        const lifetime = lifetimes.get(context);
        if (!setup || !lifetime || clientId === undefined || !mayReadGlobalSequence(context)) return unavailable();
        const { channel } = channelParamsSchema.parse(params);
        const session = authorization.getResource(channel);
        if (!session || session.domainId !== setup.context.actor.principal.domainId
          || (method === "dispatchAction" && !authorization.isReady(session))) return unavailable();
        const current = () => {
          if (!mayReadGlobalSequence(context) || context.security !== setup || lifetime.signal.aborted) return false;
          if (method === "dispatchAction" && !authorization.isReady(session)) return false;
          const actual = authorization.getResource(channel);
          return actual !== undefined && sameResource(actual, session) && !lifetime.signal.aborted;
        };
        const admission = (command: Parameters<NativeSessionWrites["admit"]>[0]["command"]) => () => {
          if (!current()) return false;
          const allowed: unknown = admitWrite(Object.freeze({ context: setup.context, session, command }));
          if (allowed !== true) {
            void Promise.resolve(allowed).catch(() => undefined);
            return false;
          }
          return current();
        };
        if (method === "disposeSession") {
          return authorization.disposeSession(session, admission(Object.freeze({ type: "disposeSession" }))).then((retired) => retired ? null : unavailable(), unavailable);
        }
        const parsed = dispatchActionParamsSchema.parse(params);
        const action = parseClientSessionAction(parsed.action);
        if (action.type !== ACTION_TYPE_SESSION_TITLE_CHANGED && action.type !== ACTION_TYPE_SESSION_IS_READ_CHANGED && action.type !== ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED) return unavailable();
        return factory.dispatchAction({ channel, clientId, clientSeq: parsed.clientSeq, action, admission: admission(Object.freeze(action)) })
          .then((envelope) => envelope.rejectionReason === undefined ? null : unavailable(), unavailable);
      }
      if (method === "createSession") {
        // Preserve canonical ready-state/kind gating; a live setup alone is not initialized.
        kernel.beforeDispatch({ method, params, context, invocation, kind: invocation.kind });
        const setup = context.security;
        const lifetime = lifetimes.get(context);
        const generation = context.connectionGeneration;
        if (authorization === undefined || setup === undefined || lifetime === undefined || generation === undefined || !mayReadGlobalSequence(context)) return unavailable();
        return authorization.createSession(params, {
          context: setup.context, connectionId: context.connectionId, connectionGeneration: generation,
          validUntil: setup.validUntil, signal: lifetime.signal,
          isCurrent: () => !lifetime.signal.aborted && lifetimes.get(context) === lifetime && context.security === setup && mayReadGlobalSequence(context),
        }).then(() => null, () => unavailable());
      }
      if (method === "initialize") {
        // Native initialize includes the genuine shared cursor even with empty snapshots.
        // Deny before the kernel/getter; never fabricate a substitute sequence.
        if (!mayReadGlobalSequence(context)) {
          return unavailable();
        }
        if (typeof params === "object" && "initialSubscriptions" in params
          && Array.isArray(params.initialSubscriptions) && params.initialSubscriptions.length > maxSubscriptions) {
          throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Too many initial subscriptions");
        }
        const parsed = initializeParamsSchema.parse(params);
        if (options?.protectedViews === undefined && (parsed.initialSubscriptions?.length ?? 0) !== 0) {
          return unavailable();
        }
      } else if (options?.protectedViews !== undefined && (method === "subscribe" || method === "listSessions")) {
        if (!mayReadGlobalSequence(context)) return unavailable();
      } else if (method !== "ping" && method !== "unsubscribe" && !AGENT_WORK_REQUEST_METHODS.has(method)) {
        return unavailable();
      }
      if (AGENT_WORK_REQUEST_METHODS.has(method) && context.security !== undefined && context.isSecurityCurrent?.() !== true) {
        return unavailable();
      }
      if (options?.protectedViews !== undefined && (method === "initialize" || method === "subscribe" || method === "listSessions")) {
        return Promise.resolve().then(() => handler(params, context, invocation)).catch(() => unavailable());
      }
      return handler(params, context, invocation);
    };
  }
  return {
    handlers,
    drainTools: kernel.drainTools.bind(kernel),
    toolStats: kernel.toolStats.bind(kernel),
    onConnection: (context) => {
      const lifetime = new AbortController();
      lifetimes.set(context, lifetime);
      context.onClose(() => {
        lifetimes.delete(context);
        lifetime.abort();
      });
      kernel.onConnection(context);
    },
    beforeDispatch: kernel.beforeDispatch.bind(kernel),
    dispose: () => {
      for (const lifetime of lifetimes.values()) lifetime.abort();
      lifetimes.clear();
      kernel.dispose();
    },
  };
};

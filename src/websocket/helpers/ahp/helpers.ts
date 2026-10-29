import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import { RpcError } from "@jsonrpc";
import type { SessionsFactory } from "@sessions/types";
import type { JsonRpcHandlers, WebSocketConnectionContext } from "@websocket/types";

import { AGENT_WORK_REQUEST_METHODS } from "./constants";
import { createAHPKernel, type AHPBinding } from "./helpers/kernel/helpers";
import { initializeParamsSchema, type AHPBindingOptions, type AHPDiagnostic } from "./types";

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

/** Safe supported facade. P10 must supply authorized projections before native protected routes reopen. */
export const createAHPBinding = (
  factory: SessionsFactory,
  reportDiagnostic: (diagnostic: AHPDiagnostic) => void = () => undefined,
  options?: AHPBindingOptions,
): AHPBinding => {
  const authorization = factory.authorization;
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
        if ((parsed.initialSubscriptions?.length ?? 0) !== 0) {
          return unavailable();
        }
      } else if (method !== "ping" && method !== "unsubscribe" && !AGENT_WORK_REQUEST_METHODS.has(method)) {
        return unavailable();
      }
      if (AGENT_WORK_REQUEST_METHODS.has(method) && context.security !== undefined && context.isSecurityCurrent?.() !== true) {
        return unavailable();
      }
      return handler(params, context, invocation);
    };
  }
  return {
    handlers,
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
    isToolCompletion: () => false,
    dispose: () => {
      for (const lifetime of lifetimes.values()) lifetime.abort();
      lifetimes.clear();
      kernel.dispose();
    },
  };
};

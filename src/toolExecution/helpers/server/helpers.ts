import { createAuthorizationSchemas, POLICY_LIMIT_ABSOLUTE } from "@authorization";
import type { ResourceOperationAuthority, ResourceRoute, TrustedRequestContext } from "@authorization";
import { sameRoute } from "@authorization/helpers/context";
import { canonicalJsonEqual } from "@tools";
import { createToolActionRegistration } from "../action";
import { captureToolValue } from "../action/helpers";
import { createToolDispatcher } from "../dispatcher";
import type { ToolDispatcher } from "../dispatcher";
import { ToolDispatchFailure } from "../dispatcher/types";
import { createToolExecutorPolicy } from "../policy";
import type { ToolExecutorProof } from "../policy";
import type { ServerToolBrokerOptions, ServerToolDispatchRequest, ServerToolRegistration, ServerToolRegistrationOptions } from "./types";

const schemas = createAuthorizationSchemas(POLICY_LIMIT_ABSOLUTE);
const captureLimits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 };
const exactlyTrue = (value: unknown): boolean => {
  if (value !== true) void Promise.resolve(value).catch(() => undefined);
  return value === true;
};
const revision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new TypeError("Invalid server registration revision.");
  return value;
};

/** Compile the trusted action's schemas without installing authority or starting a runtime. */
export function createServerToolRegistration<TInput, TOutput, TPrepared = void>(options: ServerToolRegistrationOptions<TInput, TOutput, TPrepared>): ServerToolRegistration {
  const action = createToolActionRegistration(options);
  if (action.implementation.location !== "server") throw new TypeError("Server action requires a host binding.");
  return Object.freeze({ definition: action.definition, implementation: action.implementation, revision: revision(options.revision),
    source: Object.freeze({ id: schemas.identifierSchema.parse(options.source.id), revision: revision(options.source.revision) }), action });
}

/** Local action adapter; the host may share one lifecycle owner with client execution. */
export function createServerToolDispatcher(options: ServerToolBrokerOptions, sharedDispatcher?: ToolDispatcher) {
  const policy = createToolExecutorPolicy(options, "server");
  const actions = new Map(policy.registrations.map((registration, index) => {
    const raw = options.registrations[index];
    if (raw === undefined || !canonicalJsonEqual(raw.action.definition, registration.definition)
      || !canonicalJsonEqual(raw.action.implementation, registration.implementation)) throw new TypeError("Server action metadata mismatch.");
    const create = raw.action.create.bind(raw.action);
    return [registration, createToolActionRegistration({ definition: registration.definition, implementation: registration.implementation, create })] as const;
  }));
  if (new Set(policy.registrations.map((entry) => entry.definition.id)).size !== policy.registrations.length) throw new TypeError("Ambiguous server tool registration.");
  const executorContext = captureToolValue(schemas.trustedRequestContextSchema.parse(captureToolValue(options.executor.context, captureLimits).value), captureLimits).value as TrustedRequestContext;
  const generation = revision(options.executor.generation);
  const executorCurrent = options.executor.current.bind(options.executor);
  const executorFence = options.executor.fence.bind(options.executor);
  const dispatcher = sharedDispatcher ?? createToolDispatcher(options.dispatcher);
  const executorFor = (registration: ServerToolDispatchRequest["registration"]) => schemas.executorRevisionSchema.parse({ actor: executorContext.actor,
    connectionId: executorContext.connectionId, generation, registrationRevision: registration.revision });
  return Object.freeze({
    policy,
    executor: Object.freeze({ context: executorContext, generation }),
    executorFor,
    executorCurrent: () => exactlyTrue(executorCurrent()) && exactlyTrue(executorFence()),
    executorFence: () => exactlyTrue(executorFence()),
    stats: dispatcher.stats.bind(dispatcher), shutdown: dispatcher.shutdown.bind(dispatcher), invalidateChallenges: dispatcher.invalidateChallenges.bind(dispatcher),
    dispatch(raw: ServerToolDispatchRequest) {
      const action = actions.get(raw.registration);
      if (action === undefined) throw new ToolDispatchFailure("denied");
      const current = raw.current.bind(raw), fence = raw.fence.bind(raw);
      const request = { ...raw, input: captureToolValue(raw.input, captureLimits).value,
        caller: schemas.trustedRequestContextSchema.parse(captureToolValue(raw.caller, captureLimits).value) };
      const executor = executorFor(raw.registration);
      let proofs: readonly ToolExecutorProof[] = [];
      let canonical: { readonly input: unknown; readonly route: ResourceRoute } | undefined;
      const proofsCurrent = (cohort: readonly ToolExecutorProof[], resourceAuthority?: ResourceOperationAuthority): boolean => {
        try {
          return exactlyTrue(current()) && exactlyTrue(executorCurrent()) && policy.current(cohort, resourceAuthority)
            && exactlyTrue(fence()) && exactlyTrue(executorFence());
        } catch {
          return false;
        }
      };
      const isCurrent = () => proofsCurrent(proofs);
      const resolveAuthorization = async (input: unknown, signal: AbortSignal) => {
        const base = { ...request, input, signal };
        const resolution = await policy.resolve(base);
        const invoke = await policy.authorize({ ...base, resolution, operation: "invoke" });
        const execute = await policy.authorize({ ...base, resolution, operation: "execute", executor, executorContext });
        const cohort = [invoke, execute];
        if (!proofsCurrent(cohort)) throw new ToolDispatchFailure("stale");
        const facts = { caller: request.caller, executor, resources: resolution.route, contract: { id: request.registration.definition.id, revision: request.registration.definition.version },
          implementation: request.registration.implementation, callId: request.callId, authority: execute.authority };
        return { cohort, facts, challengeRequired: invoke.challengeRequired || execute.challengeRequired };
      };
      const handle = dispatcher.dispatch({ callId: request.callId, input: request.input, signal: request.signal, registration: action,
        ports: {
          resolve: async (input, signal) => {
            const resolved = await resolveAuthorization(input, signal);
            if (canonical !== undefined && (!canonicalJsonEqual(input, canonical.input) || !sameRoute(resolved.facts.resources, canonical.route))) throw new ToolDispatchFailure("stale");
            proofs = resolved.cohort;
            return resolved.facts;
          },
          coarse: isCurrent,
          authorize: async (context, input) => {
            const authorized = await resolveAuthorization(input, context.signal);
            if (!sameRoute(context.resources, authorized.facts.resources)
              || (canonical !== undefined && (!canonicalJsonEqual(input, canonical.input) || !sameRoute(canonical.route, authorized.facts.resources)))) throw new ToolDispatchFailure("stale");
            canonical = Object.freeze({ input: captureToolValue(input, captureLimits).value, route: authorized.facts.resources });
            proofs = authorized.cohort;
            return { decision: { effect: "allow", reveal: false, challengeRequired: authorized.challengeRequired }, authority: authorized.facts.authority };
          },
          current: isCurrent,
          admitProjection: (_context, authority) => proofsCurrent(proofs, authority),
        } });
      return Object.freeze({ ...handle, current: isCurrent, admitted: handle.admission,
        async refresh(signal: AbortSignal = request.signal): Promise<(() => boolean) | undefined> {
          const captured = canonical;
          if (captured === undefined || signal.aborted) return undefined;
          try {
            const authorized = await resolveAuthorization(captured.input, signal);
            if (!sameRoute(authorized.facts.resources, captured.route)) return undefined;
            return () => !signal.aborted && canonical === captured && proofsCurrent(authorized.cohort);
          } catch {
            return undefined;
          }
        } });
    },
  });
}

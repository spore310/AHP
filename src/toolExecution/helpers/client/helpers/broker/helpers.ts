import { createAuthorizationSchemas, POLICY_LIMIT_ABSOLUTE } from "@authorization";
import { sameRoute } from "@authorization/helpers/context";
import { captureToolValue } from "@toolExecution/helpers/action/helpers";
import { ToolDispatchFailure } from "@toolExecution/helpers/dispatcher/types";
import type { ToolDispatchAdmission, ToolDispatcher } from "@toolExecution/helpers/dispatcher";
import { createToolDispatcher } from "@toolExecution/helpers/dispatcher";
import { createToolExecutorPolicy } from "@toolExecution/helpers/policy";
import { createToolActionRegistration } from "@toolExecution/helpers/action";
import { ToolAction } from "@toolExecution/types";
import type { ToolActionContext } from "@toolExecution/types";
import type { ResourceOperationAuthority, ResourceRoute } from "@authorization";
import type { ClientToolBrokerOptions, ClientToolDispatchRequest, ClientToolProof } from "./types";

const schemas = createAuthorizationSchemas(POLICY_LIMIT_ABSOLUTE);
const limits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 };

/** Client-only compatibility boundary over the shared canonical policy path. */
export function createClientToolPolicy(options: ClientToolBrokerOptions) {
  return createToolExecutorPolicy(options, "client");
}

/** Host proxy lifecycle. The supplied send port never runs the remote client's callbacks here. */
export function createClientToolDispatcher(options: ClientToolBrokerOptions, sharedDispatcher?: ToolDispatcher) {
  const policy = createClientToolPolicy(options);
  const dispatcher = sharedDispatcher ?? createToolDispatcher(options.dispatcher);
  return Object.freeze({
    policy,
    stats: dispatcher.stats.bind(dispatcher),
    shutdown: dispatcher.shutdown.bind(dispatcher),
    invalidateChallenges: dispatcher.invalidateChallenges.bind(dispatcher),
    dispatch(raw: ClientToolDispatchRequest) {
      const current = raw.current.bind(raw);
      const fence = raw.fence.bind(raw);
      const send = raw.send.bind(raw);
      const request = { ...raw, input: captureToolValue(raw.input, limits).value,
        caller: schemas.trustedRequestContextSchema.parse(captureToolValue(raw.caller, limits).value),
        executor: schemas.executorRevisionSchema.parse(captureToolValue(raw.executor, limits).value),
        executorContext: schemas.trustedRequestContextSchema.parse(captureToolValue(raw.executorContext, limits).value) };
      let proofs: readonly ClientToolProof[] = [];
      let challengeRequired = false;
      const admission = Promise.withResolvers<ToolDispatchAdmission>();
      const enqueued = Promise.withResolvers<boolean>();
      let executedRoute: ResourceRoute | undefined;
      const proofsCurrent = (cohort: readonly ClientToolProof[], resourceAuthority?: ResourceOperationAuthority): boolean => {
        try {
          const live: unknown = current();
          if (live !== true) {
            void Promise.resolve(live).catch(() => undefined);
            return false;
          }
          const owned: unknown = policy.current(cohort, resourceAuthority) && fence();
          if (owned !== true) void Promise.resolve(owned).catch(() => undefined);
          return owned === true;
        } catch {
          return false;
        }
      };
      const isCurrent = (): boolean => proofsCurrent(proofs);
      const resolveAuthorization = async (input: unknown, signal: AbortSignal) => {
        const base = { ...request, input, signal };
        const resolution = await policy.resolve(base);
        const invoke = await policy.authorize({ ...base, resolution, operation: "invoke", executor: undefined, executorContext: undefined });
        const advertisement = await policy.authorize({ ...base, caller: request.executorContext, resolution, operation: "advertise", executor: undefined, executorContext: undefined });
        const execute = await policy.authorize({ ...base, resolution, operation: "execute" });
        const cohort = [invoke, advertisement, execute];
        if (!proofsCurrent(cohort)) throw new ToolDispatchFailure("stale");
        const facts = { caller: request.caller, executor: request.executor, resources: resolution.route,
          contract: { id: request.registration.definition.id, revision: request.registration.definition.version },
          implementation: request.registration.implementation, callId: request.callId, authority: execute.authority };
        return { cohort, facts, challengeRequired: invoke.challengeRequired || execute.challengeRequired };
      };
      const authorize = async (input: unknown, signal: AbortSignal) => {
        const authorized = await resolveAuthorization(input, signal);
        if (executedRoute !== undefined && !sameRoute(authorized.facts.resources, executedRoute)) throw new ToolDispatchFailure("stale");
        executedRoute = authorized.facts.resources;
        proofs = authorized.cohort;
        challengeRequired = authorized.challengeRequired;
        return authorized.facts;
      };
      class RemoteAction extends ToolAction<unknown, unknown> {
        override execute(input: unknown, context: ToolActionContext): Promise<unknown> {
          if (!isCurrent()) throw new ToolDispatchFailure("stale");
          executedRoute = context.resources;
          return send(input, context, () => {
            if (!isCurrent() || context.signal.aborted) return;
            admission.resolve({ status: "ready" });
            enqueued.resolve(true);
          });
        }
      }
      const registration = createToolActionRegistration({ definition: request.registration.definition,
        implementation: request.registration.implementation, create: () => new RemoteAction() });
      const handle = dispatcher.dispatch({ callId: request.callId, input: request.input, signal: request.signal, registration,
        ports: {
          resolve: authorize,
          coarse: () => proofs.length === 3 && isCurrent(),
          authorize: async (context, input) => {
            const facts = await authorize(input, context.signal);
            return { decision: { effect: "allow", reveal: false, challengeRequired }, authority: facts.authority };
          },
          current: isCurrent,
          admitProjection: (_context, authority) => proofsCurrent(proofs, authority),
        },
      });
      void handle.admission.then((receipt) => {
        if (receipt.status !== "ready") admission.resolve(receipt);
      });
      void handle.result.then(() => {
        admission.resolve({ status: "denied" });
        enqueued.resolve(false);
      });
      return Object.freeze({ ...handle, current: isCurrent, admitted: admission.promise,
        async resume(proofRef: string): Promise<boolean> {
          if (!await handle.resume(proofRef)) return false;
          return enqueued.promise;
        },
        async refresh(signal: AbortSignal = request.signal): Promise<(() => boolean) | undefined> {
          if (executedRoute === undefined || signal.aborted) return undefined;
          try {
            const authorized = await resolveAuthorization(request.input, signal);
            if (!sameRoute(authorized.facts.resources, executedRoute)) return undefined;
            return () => !signal.aborted && proofsCurrent(authorized.cohort);
          } catch {
            return undefined;
          }
        } });
    },
  });
}

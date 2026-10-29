import { createAuthorizationSchemas, POLICY_LIMIT_ABSOLUTE } from "@authorization";
import { sameActor, sameResource, sameRoute } from "@authorization/helpers/context";
import { defineToolContract, canonicalJsonEqual } from "@tools";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";
import { captureToolValue } from "@toolExecution/helpers/action/helpers";
import { ToolDispatchFailure } from "@toolExecution/helpers/dispatcher/types";
import { createToolDispatcher } from "@toolExecution/helpers/dispatcher";
import { createToolActionRegistration } from "@toolExecution/helpers/action";
import { ToolAction } from "@toolExecution/types";
import type { ToolActionContext } from "@toolExecution/types";
import type { ClientToolBrokerOptions, ClientToolDispatchRequest, ClientToolPolicyRequest, ClientToolProof, ClientToolRegistration, ClientToolResolutionRequest, ClientToolRoute } from "./types";

const schemas = createAuthorizationSchemas(POLICY_LIMIT_ABSOLUTE);
const limits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 };
const deny = (): never => {
  throw new ToolDispatchFailure("denied");
};

/** Selection and immutable approved implementation metadata; all authority stays in the registry. */
export function createClientToolPolicy(options: ClientToolBrokerOptions) {
  const registry = options.registry;
  const policies = options.policies;
  const coherent: unknown = registry.usesPolicyFactory(policies);
  if (coherent !== true || options.registrations.length > 128) throw new TypeError("Invalid client tool registry.");
  const resolve = options.resolve.bind(options);
  const select = policies.select.bind(policies);
  const project = registry.projectAssignments.bind(registry);
  const validate = registry.validateAssignments.bind(registry);
  const readBindings = registry.readBindings.bind(registry);
  const getContract = registry.getContract.bind(registry);
  const registrations = options.registrations.map((raw): ClientToolRegistration => {
    const definition = defineToolContract(raw.definition);
    const implementation = toolExecutionBindingSchema.parse(raw.implementation);
    if (implementation.location !== "client" || !Number.isSafeInteger(raw.revision) || raw.revision < 1
      || !Number.isSafeInteger(raw.source.revision) || raw.source.revision < 1) throw new TypeError("Invalid client tool registration.");
    const source = Object.freeze({ id: schemas.identifierSchema.parse(raw.source.id), revision: raw.source.revision });
    return Object.freeze({ definition, implementation: Object.freeze(implementation), revision: raw.revision, source });
  });
  const identities = new Set<string>();
  for (const entry of registrations) {
    const key = JSON.stringify([entry.definition.id, entry.implementation, entry.revision]);
    if (identities.has(key)) throw new TypeError("Duplicate client tool registration.");
    identities.add(key);
  }
  const issued = new Set(registrations);
  const captureRequest = (request: ClientToolResolutionRequest): ClientToolResolutionRequest => {
    if (!issued.has(request.registration) || request.signal.aborted) return deny();
    return Object.freeze({
      ...request,
      caller: schemas.trustedRequestContextSchema.parse(captureToolValue(request.caller, limits).value),
      origin: schemas.resourceRefSchema.parse(captureToolValue(request.origin, limits).value),
      sessionType: Object.freeze({ key: schemas.identifierSchema.parse(request.sessionType.key), version: request.sessionType.version }),
      providerId: schemas.identifierSchema.parse(request.providerId),
      input: captureToolValue(request.input, limits).value,
    });
  };

  return Object.freeze({
    registrations: Object.freeze(registrations),
    async resolve(request: ClientToolResolutionRequest): Promise<ClientToolRoute> {
      const captured = captureRequest(request);
      const rawResolution = captureToolValue(await resolve(captured), limits).value;
      if (typeof rawResolution !== "object" || rawResolution === null) return deny();
      const resolution = rawResolution as ClientToolRoute;
      if (captured.signal.aborted
        || !sameResource(schemas.resourceRefSchema.parse(resolution.route.origin), captured.origin)
        || !Array.isArray(resolution.route.targets) || resolution.route.targets.length > 64) return deny();
      for (const target of resolution.route.targets) schemas.resourceRefSchema.parse(target);
      return resolution;
    },
    async authorize(raw: ClientToolPolicyRequest): Promise<ClientToolProof> {
      const request = captureRequest(raw);
      const aborted = () => request.signal.aborted;
      const resolution = captureToolValue(raw.resolution, limits).value as ClientToolRoute;
      const executor = raw.executor === undefined ? undefined : schemas.executorRevisionSchema.parse(captureToolValue(raw.executor, limits).value);
      const executorContext = raw.executorContext === undefined ? undefined : schemas.trustedRequestContextSchema.parse(captureToolValue(raw.executorContext, limits).value);
      const operation = raw.operation;
      if (!sameResource(resolution.route.origin, request.origin)
        || (operation === "execute" ? executor === undefined : executor !== undefined)
        || (executor !== undefined && (executorContext === undefined || !sameActor(executor.actor, executorContext.actor)
          || executor.connectionId !== executorContext.connectionId))
        || (executor !== undefined && executor.registrationRevision !== request.registration.revision)) return deny();
      const registered = getContract(request.registration.definition.id);
      if (registered === undefined || !canonicalJsonEqual(registered, request.registration.definition)) return deny();
      const selected = await select({ sessionType: request.sessionType, providerId: request.providerId,
        context: { actor: executorContext ?? request.caller, resource: request.origin, session: request.origin,
          tool: { id: registered.id, revision: registered.version }, input: request.input } }).catch(() => undefined);
      if (selected?.effect !== "selected" || aborted()) return deny();
      const recipient = executor?.actor ?? request.caller.actor;
      const bindings = readBindings({ actor: recipient, scope: request.origin });
      const tools = bindings.bindings.flatMap((binding) => selected.alternatives
        .filter((policy) => binding.policies.some((ref) => ref.id === policy.id && ref.revision === policy.revision))
        .map((policyRef) => ({ contractId: registered.id, bindingId: binding.id, policyRef })));
      if (tools.length === 0 || tools.length > 128) return deny();
      for (const tool of tools) {
        const authorization = await project({ actor: request.caller, purpose: operation,
          recipient: operation === "execute" ? "executor" : "caller", scope: request.origin, route: resolution.route, tools: [tool],
          ...(executor === undefined ? {} : { executor }),
          ...(resolution.externalProofs === undefined ? {} : { externalProofs: resolution.externalProofs }),
          ...(resolution.mandatoryBindings === undefined ? {} : { mandatoryBindings: resolution.mandatoryBindings }),
        });
        const admitted = authorization.admitted.find((entry) => entry.allowed && !entry.challengeRequired
          && entry.tuple.operation === operation && entry.tuple.contract.id === registered.id
          && entry.tuple.contract.key === registered.key && entry.tuple.contract.version === registered.version
          && sameActor(entry.tuple.recipient, recipient) && sameResource(entry.tuple.resource, request.origin)
          && sameRoute(entry.tuple.route, resolution.route)
          && (operation !== "execute" || canonicalJsonEqual(entry.tuple.implementation, request.registration.implementation)));
        if (aborted()) return deny();
        if (admitted === undefined || !validate(authorization, request.caller)) continue;
        return Object.freeze({ authorization, authority: admitted.decision.stamp.authority,
          current: () => !request.signal.aborted && validate(authorization, request.caller) });
      }
      return deny();
    },
  });
}

/** Host proxy lifecycle. The supplied send port never runs the remote client's callbacks here. */
export function createClientToolDispatcher(options: ClientToolBrokerOptions) {
  const policy = createClientToolPolicy(options);
  const dispatcher = createToolDispatcher(options.dispatcher);
  return Object.freeze({
    policy,
    stats: dispatcher.stats.bind(dispatcher),
    shutdown: dispatcher.shutdown.bind(dispatcher),
    dispatch(raw: ClientToolDispatchRequest) {
      const current = raw.current.bind(raw);
      const fence = raw.fence.bind(raw);
      const send = raw.send.bind(raw);
      const request = { ...raw, caller: schemas.trustedRequestContextSchema.parse(captureToolValue(raw.caller, limits).value),
        executor: schemas.executorRevisionSchema.parse(captureToolValue(raw.executor, limits).value),
        executorContext: schemas.trustedRequestContextSchema.parse(captureToolValue(raw.executorContext, limits).value) };
      let proofs: readonly ClientToolProof[] = [];
      const isCurrent = (): boolean => {
        try {
          const live: unknown = current();
          if (live !== true) {
            void Promise.resolve(live).catch(() => undefined);
            return false;
          }
          const owned: unknown = proofs.every((proof) => proof.current()) && fence();
          if (owned !== true) void Promise.resolve(owned).catch(() => undefined);
          return owned === true;
        } catch {
          return false;
        }
      };
      const authorize = async (input: unknown, signal: AbortSignal) => {
        const base = { ...request, input, signal };
        const resolution = await policy.resolve(base);
        const invoke = await policy.authorize({ ...base, resolution, operation: "invoke", executor: undefined, executorContext: undefined });
        const advertisement = await policy.authorize({ ...base, caller: request.executorContext, resolution, operation: "advertise", executor: undefined, executorContext: undefined });
        const execute = await policy.authorize({ ...base, resolution, operation: "execute" });
        proofs = [invoke, advertisement, execute];
        if (!isCurrent()) throw new ToolDispatchFailure("stale");
        return { caller: request.caller, executor: request.executor, resources: resolution.route,
          contract: { id: request.registration.definition.id, revision: request.registration.definition.version },
          implementation: request.registration.implementation, callId: request.callId, authority: execute.authority };
      };
      class RemoteAction extends ToolAction<unknown, unknown> {
        override execute(input: unknown, context: ToolActionContext): Promise<unknown> {
          if (!isCurrent()) throw new ToolDispatchFailure("stale");
          return send(input, context);
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
            return { decision: { effect: "allow", reveal: false, challengeRequired: false }, authority: facts.authority };
          },
          current: isCurrent,
        },
      });
      return Object.freeze({ ...handle, current: isCurrent });
    },
  });
}

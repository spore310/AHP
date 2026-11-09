import { createAuthorizationSchemas, POLICY_LIMIT_ABSOLUTE } from "@authorization";
import type { ResourceOperationAuthority, AssignmentAuthorization, TrustedRequestContext } from "@authorization";
import { sameActor, sameResource, sameRoute } from "@authorization/helpers/context";
import { defineToolContract, canonicalJsonEqual } from "@tools";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";
import { captureToolValue } from "../action/helpers";
import { ToolDispatchFailure } from "../dispatcher/types";
import type { ToolExecutionLocation, ToolExecutorPolicyOptions, ToolPolicyRegistration, ToolPolicyResolutionRequest, ToolExecutorPolicyRequest, ToolExecutorProof, ToolPolicyRoute } from "./types";

const schemas = createAuthorizationSchemas(POLICY_LIMIT_ABSOLUTE);
const limits = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 };
const deny = (): never => {
  throw new ToolDispatchFailure("denied");
};

/** Selection and immutable approved implementation metadata; all authority stays in the registry. */
export function createToolExecutorPolicy<TLocation extends ToolExecutionLocation>(options: ToolExecutorPolicyOptions<TLocation>, location: TLocation) {
  const registry = options.registry;
  const policies = options.policies;
  const coherent: unknown = registry.usesPolicyFactory(policies);
  if (coherent !== true || options.registrations.length > 128) throw new TypeError("Invalid tool policy registry.");
  const resolve = options.resolve.bind(options);
  const select = policies.select.bind(policies);
  const project = registry.projectAssignments.bind(registry);
  const validate = registry.validateAssignments.bind(registry);
  const validateCohort = registry.validateAuthorityCohort.bind(registry);
  const readBindings = registry.readBindings.bind(registry);
  const getContract = registry.getContract.bind(registry);
  const registrations = options.registrations.map((raw): ToolPolicyRegistration<TLocation> => {
    const definition = defineToolContract(raw.definition);
    const implementation = toolExecutionBindingSchema.parse(raw.implementation);
    if (implementation.location !== location || !Number.isSafeInteger(raw.revision) || raw.revision < 1
      || !Number.isSafeInteger(raw.source.revision) || raw.source.revision < 1) throw new TypeError("Invalid tool policy registration.");
    const source = Object.freeze({ id: schemas.identifierSchema.parse(raw.source.id), revision: raw.source.revision });
    return Object.freeze({ definition, implementation: Object.freeze(implementation) as ToolPolicyRegistration<TLocation>["implementation"], revision: raw.revision, source });
  });
  const identities = new Set<string>();
  for (const entry of registrations) {
    const key = JSON.stringify([entry.definition.id, entry.implementation, entry.revision]);
    if (identities.has(key)) throw new TypeError("Duplicate tool policy registration.");
    identities.add(key);
  }
  const issued = new Set(registrations);
  const issuedProofs = new WeakMap<ToolExecutorProof, { readonly authorization: AssignmentAuthorization; readonly actor: TrustedRequestContext; readonly signal: AbortSignal }>();
  const captureRequest = (request: ToolPolicyResolutionRequest<TLocation>): ToolPolicyResolutionRequest<TLocation> => {
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
    current(proofs: readonly ToolExecutorProof[], resourceAuthority?: ResourceOperationAuthority): boolean {
      if (resourceAuthority !== undefined && resourceAuthority.registry !== registry) return false;
      const candidate: unknown = proofs;
      if (!Array.isArray(candidate)) return false;
      const count = proofs.length;
      if (!Number.isSafeInteger(count) || count < 1 || count > 512) return false;
      const captured = [];
      for (let index = 0; index < count; index += 1) {
        const proof = proofs[index];
        const member = proof === undefined ? undefined : issuedProofs.get(proof);
        if (member === undefined || member.signal.aborted) return false;
        captured.push(member);
      }
      return validateCohort(captured, resourceAuthority?.decisions ?? []) && captured.every((member) => !member.signal.aborted);
    },
    async resolve(request: ToolPolicyResolutionRequest<TLocation>): Promise<ToolPolicyRoute> {
      const captured = captureRequest(request);
      const rawResolution = captureToolValue(await resolve(captured), limits).value;
      if (typeof rawResolution !== "object" || rawResolution === null) return deny();
      const resolution = rawResolution as ToolPolicyRoute;
      if (captured.signal.aborted
        || !sameResource(schemas.resourceRefSchema.parse(resolution.route.origin), captured.origin)
        || !Array.isArray(resolution.route.targets) || resolution.route.targets.length > 64) return deny();
      for (const target of resolution.route.targets) schemas.resourceRefSchema.parse(target);
      return resolution;
    },
    async authorize(raw: ToolExecutorPolicyRequest<TLocation>): Promise<ToolExecutorProof> {
      const request = captureRequest(raw);
      const aborted = () => request.signal.aborted;
      const resolution = captureToolValue(raw.resolution, limits).value as ToolPolicyRoute;
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
        const admitted = authorization.admitted.find((entry) => entry.allowed
          && (operation !== "discover" || entry.reveal)
          && entry.tuple.operation === operation && entry.tuple.contract.id === registered.id
          && entry.tuple.contract.key === registered.key && entry.tuple.contract.version === registered.version
          && sameActor(entry.tuple.recipient, recipient) && sameResource(entry.tuple.resource, request.origin)
          && sameRoute(entry.tuple.route, resolution.route)
          && (operation !== "execute" || canonicalJsonEqual(entry.tuple.implementation, request.registration.implementation)));
        if (aborted()) return deny();
        if (admitted === undefined || !validate(authorization, request.caller)) continue;
        const proof = Object.freeze({ challengeRequired: admitted.challengeRequired, authorization, authority: admitted.decision.stamp.authority,
          current: () => !request.signal.aborted && validate(authorization, request.caller) });
        issuedProofs.set(proof, { authorization, actor: request.caller, signal: request.signal });
        return proof;
      }
      return deny();
    },
  });
}

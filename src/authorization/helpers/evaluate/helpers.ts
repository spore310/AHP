import { defineToolContract, type ToolContractDefinition } from "@tools";
import { toolExecutionBindingSchema } from "@toolPolicy/helpers/validation";

import { MAX_POLICY_REVISION, POLICY_LIMIT_ABSOLUTE, POLICY_LIMIT_DEFAULTS } from "../../constants";
import { executorRevisionSchema, identifierSchema, policyActorRefSchema, resourceRefSchema, scopedPolicyBindingSchema, securitySubjectRefSchema } from "../validation";
import type {
  ExecutorRevision,
  PolicyActorRef,
  PolicyRef,
  PolicyScopeRules,
  ResourceRef,
  ResourceRoute,
  ScopedPolicyBinding,
  TrustedRequestContext,
} from "../../types";
import { bindingExpired, includesPolicy } from "../bindings";
import type { BindingInstallationState, BindingInstallationToken, CanonicalBindingToken, InstalledBinding, ResourceBindingBasis, ResourceInstallationState, ResourceInstallationToken, ScopedBindingSnapshot } from "../bindings/types";
import type { ResourceRegistration } from "../resources/types";
import { DEFAULT_GRANT_RESOURCE_DEPTH, DEFAULT_INVALIDATION_LISTENERS, MAX_GRANT_RESOURCE_DEPTH, MAX_INVALIDATION_LISTENERS } from "../grants/constants";
import { buildGrantService } from "../grants/helpers";
import type { BoundGrantContext, CanonicalGrantBasisState, CanonicalGrantPort, CapturedGrantBasis, GrantService, GrantServiceOptions, InvalidationListenerState, LocalInvalidation } from "../grants/types";
import { sameActor, sameResource, sameRoute } from "../context";
import { findResource, resourceKey, sameOwner } from "../resources";
import type { RegisteredResource } from "../resources";
import { DEFAULT_DECISION_TTL_MS, DEFAULT_REFERENCE_CAPS, DEFAULT_REFERENCE_INPUT_LIMITS, MAX_REFERENCE_CAP, MAX_REFERENCE_INPUT_LIMIT } from "./constants";
import type {
  AdmittedAssignment,
  CapturedExternalProof,
  EvaluateSelector,
  LocalDecisionStamp,
  PresentedExternalProof,
  ReferenceAuthorizer,
  ReferenceAuthorizerOptions,
  ReferenceInputLimits,
  ReferenceRegistryCaps,
  StampedDecision,
  ToolAssignmentRecord,
} from "./types";

interface StoredResource extends RegisteredResource {
  readonly installation: ResourceInstallationToken;
  readonly admissionKey?: string;
}

interface StoredAdmission {
  readonly rules: PolicyScopeRules;
  readonly ceiling: readonly PolicyRef[];
}

const finite = (value: number): boolean => Number.isFinite(value);

const copy = <T>(value: T): T => structuredClone(value);

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const entry of Object.values(value)) {
      freeze(entry);
    }
  }
  return value;
};

const sameRef = (left: PolicyRef, right: PolicyRef): boolean => left.id === right.id && left.revision === right.revision;

const sameExecutor = (left: ExecutorRevision | undefined, right: ExecutorRevision | undefined): boolean => (
  left !== undefined && right !== undefined
  && sameActor(left.actor, right.actor)
  && left.connectionId === right.connectionId
  && left.generation === right.generation
  && left.registrationRevision === right.registrationRevision
);

const capValue = (value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_REFERENCE_CAP) {
    throw new Error("Invalid authorization registry cap.");
  }
  return resolved;
};

const capsFrom = (input: Partial<ReferenceRegistryCaps> | undefined): ReferenceRegistryCaps => Object.freeze({
  maxResources: capValue(input?.maxResources, DEFAULT_REFERENCE_CAPS.maxResources),
  maxBindings: capValue(input?.maxBindings, DEFAULT_REFERENCE_CAPS.maxBindings),
  maxTools: capValue(input?.maxTools, DEFAULT_REFERENCE_CAPS.maxTools),
  maxExecutors: capValue(input?.maxExecutors, DEFAULT_REFERENCE_CAPS.maxExecutors),
  maxAdmissions: capValue(input?.maxAdmissions, DEFAULT_REFERENCE_CAPS.maxAdmissions),
  maxToolAssignments: capValue(input?.maxToolAssignments, DEFAULT_REFERENCE_CAPS.maxToolAssignments),
  maxPermissionEvaluators: capValue(input?.maxPermissionEvaluators, DEFAULT_REFERENCE_CAPS.maxPermissionEvaluators),
  maxExtensionEvaluators: capValue(input?.maxExtensionEvaluators, DEFAULT_REFERENCE_CAPS.maxExtensionEvaluators),
  maxExternalInvalidations: capValue(input?.maxExternalInvalidations, DEFAULT_REFERENCE_CAPS.maxExternalInvalidations),
});

const ruleAdmits = (
  rule: { readonly actor: { readonly mode: string; readonly actors: readonly string[] | { readonly user?: { readonly anyOf: readonly string[] }; readonly agent?: { readonly anyOf: readonly string[] } } }; readonly requiredPermissions?: readonly string[] } | undefined,
  actor: PolicyActorRef,
  roles: readonly string[],
): boolean => {
  if (rule === undefined) {
    return false;
  }
  if (rule.actor.mode === "direct-grant" && Array.isArray(rule.actor.actors)) {
    return rule.actor.actors.includes(actor.kind);
  }
  if (!Array.isArray(rule.actor.actors)) {
    const actors = rule.actor.actors as { readonly user?: { readonly anyOf: readonly string[] }; readonly agent?: { readonly anyOf: readonly string[] } };
    const branch = actor.kind === "user" ? actors.user : actors.agent;
    return branch !== undefined && branch.anyOf.some((role) => roles.includes(role));
  }
  return false;
};

const assignmentKey = (record: ToolAssignmentRecord): string => (
  `${resourceKey(record.resource)}\u0000${record.contract.id}\u0000${record.operation}\u0000${record.bindingId}\u0000${record.policyRef.id}`
);

const inputLimitValue = (value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_REFERENCE_INPUT_LIMIT) {
    throw new Error("Invalid authorization input limit.");
  }
  return resolved;
};

const inputLimitsFrom = (input: ReferenceAuthorizerOptions["inputLimits"]): ReferenceInputLimits => Object.freeze({
  maxAdmissionInstalls: inputLimitValue(input?.maxAdmissionInstalls, DEFAULT_REFERENCE_INPUT_LIMITS.maxAdmissionInstalls),
  maxRouteTargets: inputLimitValue(input?.maxRouteTargets, DEFAULT_REFERENCE_INPUT_LIMITS.maxRouteTargets),
  maxProofs: inputLimitValue(input?.maxProofs, DEFAULT_REFERENCE_INPUT_LIMITS.maxProofs),
  maxMandatorySelectors: inputLimitValue(input?.maxMandatorySelectors, DEFAULT_REFERENCE_INPUT_LIMITS.maxMandatorySelectors),
  maxProjectionTools: inputLimitValue(input?.maxProjectionTools, DEFAULT_REFERENCE_INPUT_LIMITS.maxProjectionTools),
});

export const createReferenceAuthorizer = (options: ReferenceAuthorizerOptions): ReferenceAuthorizer => {
  const caps = capsFrom(options.caps);
  const inputLimits = inputLimitsFrom(options.inputLimits);
  const maxResourceDepth = options.maxGrantResourceDepth === undefined ? DEFAULT_GRANT_RESOURCE_DEPTH : options.maxGrantResourceDepth;
  const maxListeners = options.maxInvalidationListeners === undefined ? DEFAULT_INVALIDATION_LISTENERS : options.maxInvalidationListeners;
  if (!Number.isSafeInteger(maxListeners) || maxListeners < 1 || maxListeners > MAX_INVALIDATION_LISTENERS) throw new Error("Invalid invalidation listener limit.");
  if (!Number.isSafeInteger(maxResourceDepth) || maxResourceDepth < 1 || maxResourceDepth > MAX_GRANT_RESOURCE_DEPTH) throw new Error("Invalid grant resource depth.");
  const decisionTtlMs = options.decisionTtlMs ?? DEFAULT_DECISION_TTL_MS;
  if (!finite(decisionTtlMs) || decisionTtlMs < 1) {
    throw new Error("Invalid decision TTL.");
  }
  const resources = new Map<string, StoredResource>();
  const bindings = new Map<string, InstalledBinding>();
  const resourceInstallations = new WeakMap<ResourceInstallationToken, ResourceInstallationState>();
  const bindingInstallations = new WeakMap<BindingInstallationToken, BindingInstallationState>();
  const bindingTokens = new WeakMap<CanonicalBindingToken, InstalledBinding>();
  const bindingSnapshots = new WeakMap<ScopedBindingSnapshot, readonly ResourceBindingBasis[]>();
  const grantBases = new WeakMap<CapturedGrantBasis, CanonicalGrantBasisState>();
  const serviceIdentity = Object.freeze({});
  let grantService: GrantService | undefined;
  let grantServiceOptions: GrantServiceOptions | undefined;
  let serviceActive = false;
  let constructingService = false;
  const tools = new Map<string, ToolContractDefinition>();
  const assignments = new Map<string, ToolAssignmentRecord>();
  const executorAssignments = new Map<string, ToolAssignmentRecord>();
  const admissions = new Map<string, StoredAdmission>();
  const extensionEvaluators = new Map<string, ReferenceAuthorizerOptions extends never ? never : NonNullable<Parameters<ReferenceAuthorizer["installPolicyExtensionEvaluator"]>[1]>>();
  const permissionEvaluators = new Map<string, NonNullable<ReferenceAuthorizerOptions["permissionEvaluators"]>[string]>();
  const invalidated = new Set<string>();
  let epoch = 0;
  let grantRevision = 0;
  let externalUnavailable = false;
  const issued = new WeakSet<object>();
  const now = options.now;
  const policyRegistry = options.policies;
  const hookDeadlineMs = options.hookDeadlineMs ?? POLICY_LIMIT_DEFAULTS.asyncHookDeadlineMs;
  if (!finite(hookDeadlineMs) || hookDeadlineMs < 1 || hookDeadlineMs > POLICY_LIMIT_ABSOLUTE.asyncHookDeadlineMs) {
    throw new Error("Invalid authorization hook deadline.");
  }

  if (options.permissionEvaluators !== undefined) {
    for (const key of Object.keys(options.permissionEvaluators)) {
      if (!Object.hasOwn(options.permissionEvaluators, key)) {
        continue;
      }
      if (permissionEvaluators.size >= caps.maxPermissionEvaluators) {
        throw new Error("Authorization evaluator limit exceeded.");
      }
      const evaluator = options.permissionEvaluators[key];
      if (evaluator !== undefined) {
        permissionEvaluators.set(key, evaluator);
      }
    }
  }

  const listeners = new Set<InvalidationListenerState>();
  let notice: LocalInvalidation | undefined;
  let delivering = false;
  let queued = false;
  let shouldDrain = false;
  const drainInvalidations = (): void => {
    if (delivering || notice === undefined) return;
    const current = notice;
    notice = undefined;
    shouldDrain = false;
    delivering = true;
    try {
      for (const state of [...listeners]) {
        if (!state.active) continue;
        state.running = true;
        let asynchronous = false;
        try {
          const listener = state.listener;
          const result = listener(current);
          if (result !== null && (typeof result === "object" || typeof result === "function")
            && "then" in result && typeof result.then === "function") {
            state.active = false;
            asynchronous = true;
            const settled = (): void => {
              state.running = false;
              listeners.delete(state);
            };
            void Promise.resolve(result).then(settled, settled);
          }
        } catch {
          state.active = false;
        } finally {
          if (!asynchronous) {
            state.running = false;
            if (!state.active) listeners.delete(state);
          }
        }
      }
    } finally {
      delivering = false;
    }
  };
  const bump = (): void => {
    epoch += 1;
    grantRevision += 1;
    notice = Object.freeze({ epoch, grantRevision, cause: "authority" });
    if (!delivering) {
      shouldDrain = true;
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (shouldDrain) drainInvalidations();
        });
      }
    }
  };

  const deny = (code: string, input: EvaluateSelector, actor: PolicyActorRef): StampedDecision => freeze({
    decision: { effect: "deny", code },
    stamp: stampFor(input, actor, [], []),
  });

  const stampFor = (
    input: EvaluateSelector,
    actor: PolicyActorRef,
    policyRevisions: readonly PolicyRef[],
    proofs: readonly CapturedExternalProof[],
    bindingExpiries: readonly { readonly bindingId: string; readonly expiresAt?: string }[] = [],
  ): LocalDecisionStamp => {
    const deadlines = [
      now() + decisionTtlMs,
      ...bindingExpiries.flatMap((item) => item.expiresAt === undefined ? [] : [Date.parse(item.expiresAt)]),
      ...proofs.map((proof) => proof.validUntil),
    ].filter(finite);
    return freeze({
      authority: {
        domainId: input.scope.domainId,
        actor: input.actor.actor,
        authRevision: input.actor.authRevision,
        connectionId: input.actor.connectionId,
        ...(input.actor.agentGeneration === undefined ? {} : { agentGeneration: input.actor.agentGeneration }),
        ...(input.actor.delegationRef === undefined ? {} : { delegationRef: input.actor.delegationRef }),
        ...(input.executor === undefined ? {} : { executor: input.executor }),
        route: copy(input.route),
        relationshipRevision: findResource(resources, input.scope)?.relationshipRevision ?? 0,
        policyRevisions: copy(policyRevisions),
        grantRevision,
      },
      validUntil: Math.min(...deadlines),
      epoch,
      grantRevision,
      relationshipRevisions: routeResources(input.route).map((resource) => ({
        resource: copy(resource),
        revision: findResource(resources, resource)?.relationshipRevision ?? 0,
      })),
      bindingExpiries: copy(bindingExpiries),
      externalProofs: copy(proofs),
    });
  };

  const routeResources = (route: ResourceRoute): ResourceRef[] => {
    const seen = new Set<string>();
    const refs: ResourceRef[] = [];
    for (const resource of [route.origin, ...route.targets]) {
      const key = resourceKey(resource);
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(resource);
      }
    }
    return refs;
  };

  const captureProofs = (input: EvaluateSelector, required: readonly StoredResource[]): CapturedExternalProof[] | "invalid" | "missing" | "expired" => {
    const provided: PresentedExternalProof[] = [
      ...(input.external === undefined ? [] : [{ ...input.external, resource: input.external.resource ?? input.scope }]),
      ...(input.externalProofs ?? []),
    ];
    const captured: CapturedExternalProof[] = [];
    const seen = new Set<string>();
    for (const proof of provided) {
      const resource = proof.resource ?? input.scope;
      if (!finite(proof.validUntil)) {
        return "invalid";
      }
      const key = resourceKey(resource);
      if (seen.has(key)) {
        return "invalid";
      }
      seen.add(key);
      captured.push(freeze({ resource: copy(resource), revision: proof.revision, validUntil: proof.validUntil }));
    }
    for (const resource of required) {
      if (resource.externalAuthority !== "required") {
        continue;
      }
      const proof = captured.find((item) => sameResource(item.resource, resource.resource));
      if (proof === undefined) {
        return "missing";
      }
      if (proof.validUntil <= now() || invalidated.has(proof.revision)) {
        return "expired";
      }
    }
    return captured;
  };

  const obligationsFor = (resource: StoredResource): PolicyRef[] => {
    const refs = resource.mandatory.filter((item) => item.applicable).map((item) => item.ref);
    if (resource.admissionKey !== undefined) {
      const admission = admissions.get(resource.admissionKey);
      for (const ref of admission?.rules.mandatory ?? []) {
        const host = resource.mandatory.find((item) => sameRef(item.ref, ref));
        if (host?.applicable === false) {
          continue;
        }
        if (!refs.some((item) => sameRef(item, ref))) {
          refs.push(ref);
        }
      }
    }
    return refs;
  };

  const chooseBinding = (
    actor: PolicyActorRef,
    resource: ResourceRef,
    policyRef: PolicyRef,
    selector: string | undefined,
  ): ScopedPolicyBinding | "missing" | "ambiguous" | "expired" => {
    const matches = [...bindings.values()].map((item) => item.binding).filter((item) => (
      sameActor(item.actor, actor) && sameResource(item.scope, resource) && includesPolicy(item, policyRef)
    ));
    const chosen = selector === undefined
      ? matches
      : matches.filter((item) => item.id === selector);
    if (chosen.length === 0) {
      return "missing";
    }
    if (selector === undefined && chosen.length > 1) {
      return "ambiguous";
    }
    const [binding] = chosen;
    if (binding === undefined) {
      return "missing";
    }
    const installed = bindings.get(binding.id);
    return installed === undefined || !bindingUsable(installed, now()) ? "expired" : binding;
  };

  const liveMatches = (stamp: LocalDecisionStamp, actor: TrustedRequestContext): boolean => {
    const currentTime = now();
    pruneBindings(currentTime);
    if (!issued.has(stamp) || !finite(currentTime) || !finite(stamp.validUntil) || currentTime >= stamp.validUntil || stamp.epoch !== epoch || stamp.grantRevision !== grantRevision) {
      return false;
    }
    if (externalUnavailable && stamp.externalProofs.length > 0) {
      return false;
    }
    if (!sameActor(stamp.authority.actor, actor.actor)
      || stamp.authority.connectionId !== actor.connectionId
      || stamp.authority.authRevision !== actor.authRevision
      || stamp.authority.delegationRef !== actor.delegationRef
      || stamp.authority.agentGeneration !== actor.agentGeneration) {
      return false;
    }
    for (const captured of stamp.relationshipRevisions) {
      const current = findResource(resources, captured.resource);
      if (current === undefined || current.relationshipRevision !== captured.revision) {
        return false;
      }
    }
    for (const item of stamp.bindingExpiries) {
      const binding = bindings.get(item.bindingId)?.binding;
      if (binding === undefined || binding.expiresAt !== item.expiresAt || bindingExpired(binding, currentTime)) {
        return false;
      }
    }
    return stamp.externalProofs.every((proof) => finite(proof.validUntil) && currentTime < proof.validUntil && !invalidated.has(proof.revision));
  };

  const proofCount = (input: { readonly external?: unknown; readonly externalProofs?: readonly unknown[] }): number => (
    (input.external === undefined ? 0 : 1) + (input.externalProofs?.length ?? 0)
  );

  const oversizedDeny = (): StampedDecision => {
    const stamp: LocalDecisionStamp = {
      authority: {
        domainId: "rejected",
        actor: { kind: "user", principal: { domainId: "rejected", subject: "rejected" } },
        authRevision: "rejected",
        connectionId: "rejected",
        route: { origin: { domainId: "rejected", kind: "rejected", id: "rejected", instanceId: "rejected" }, targets: [] },
        relationshipRevision: 0,
        policyRevisions: [],
        grantRevision,
      },
      validUntil: now(),
      epoch,
      grantRevision,
      relationshipRevisions: [],
      bindingExpiries: [],
      externalProofs: [],
    };
    return freeze({ decision: { effect: "deny", code: "invalid-input" }, stamp });
  };

  const inputWithinLimits = (input: {
    readonly route: ResourceRoute;
    readonly external?: unknown;
    readonly externalProofs?: readonly unknown[];
    readonly mandatoryBindings?: readonly unknown[];
    readonly tools?: readonly unknown[];
  }): boolean => (
    input.route.targets.length <= inputLimits.maxRouteTargets
    && proofCount(input) <= inputLimits.maxProofs
    && (input.mandatoryBindings?.length ?? 0) <= inputLimits.maxMandatorySelectors
    && (input.tools?.length ?? 0) <= inputLimits.maxProjectionTools
  );

  const evaluateSnapshot = async (input: EvaluateSelector): Promise<StampedDecision> => {
    if (!inputWithinLimits(input)) {
      return oversizedDeny();
    }
    const snapshot = freeze(copy(input));
    const actor = snapshot.operation === "execute" && snapshot.executor !== undefined
      ? snapshot.executor.actor
      : snapshot.actor.actor;
    const sampledTime = now();
    const priorSelection = bindings.get(snapshot.bindingId)?.binding;
    // Preserve this request's existing expiry diagnostic while physically reclaiming expired rows.
    const selectedExpired = priorSelection !== undefined && sameActor(priorSelection.actor, actor)
      && sameResource(priorSelection.scope, snapshot.scope) && includesPolicy(priorSelection, snapshot.policyRef)
      && bindingExpired(priorSelection, sampledTime);
    pruneBindings(sampledTime);
    const evaluationEpoch = epoch;
    if (!routeResources(snapshot.route).some((resource) => sameResource(resource, snapshot.scope))) {
      return deny("missing-authority", snapshot, actor);
    }
    const resourcesOnRoute = routeResources(snapshot.route).map((resource) => findResource(resources, resource));
    if (resourcesOnRoute.some((resource) => resource === undefined)) {
      return deny("missing-authority", snapshot, actor);
    }
    const stored = resourcesOnRoute.filter((resource): resource is StoredResource => resource !== undefined);
    if (stored.some((resource) => !sameRoute(resource.route, snapshot.route) && sameResource(resource.resource, snapshot.scope))) {
      return deny("missing-authority", snapshot, actor);
    }
    const proofs = captureProofs(snapshot, stored);
    if (proofs === "invalid") {
      return deny("external-invalid", snapshot, actor);
    }
    if (proofs === "missing") {
      return deny("missing-authority", snapshot, actor);
    }
    if (proofs === "expired" || (externalUnavailable && stored.some((resource) => resource.externalAuthority === "required"))) {
      return deny("external-expired", snapshot, actor);
    }
    const positive = chooseBinding(actor, snapshot.scope, snapshot.policyRef, snapshot.bindingId);
    if (positive === "expired" || (positive === "missing" && selectedExpired)) {
      return deny("expired", snapshot, actor);
    }
    if (typeof positive !== "object") {
      return deny("missing-authority", snapshot, actor);
    }
    const scopeResource = resources.get(resourceKey(snapshot.scope));
    const admissionKey = scopeResource?.admissionKey;
    if (admissionKey !== undefined) {
      const admission = admissions.get(admissionKey);
      if (admission === undefined || !admission.ceiling.some((item) => sameRef(item, snapshot.policyRef))) {
        return deny("missing-authority", snapshot, actor);
      }
    }
    const compiled = policyRegistry.getPolicy(snapshot.policyRef);
    const rule = compiled?.operations[snapshot.operation];
    if (!ruleAdmits(rule, actor, positive.roles)) {
      return deny("missing-authority", snapshot, actor);
    }
    const obligations: { readonly resource: ResourceRef; readonly policyRef: PolicyRef }[] = [];
    for (const resource of stored) {
      for (const policyRef of obligationsFor(resource)) {
        obligations.push({ resource: resource.resource, policyRef });
      }
    }
    const selectors = snapshot.mandatoryBindings ?? [];
    const selectorKeys = new Set<string>();
    for (const item of selectors) {
      const key = `${resourceKey(item.resource)}\u0000${item.policyRef.id}\u0000${String(item.policyRef.revision)}`;
      if (selectorKeys.has(key)) {
        return deny("ambiguous-authority", snapshot, actor);
      }
      selectorKeys.add(key);
    }
    const bindingExpiries = contributors(positive.id).map((binding) => ({ bindingId: binding.id, expiresAt: binding.expiresAt }));
    let challengeRequired = compiled?.challenge.required === true;
    let reveal = rule?.reveal === true;
    for (const obligation of obligations) {
      const selector = snapshot.mandatoryBindings?.find((item) => (
        sameResource(item.resource, obligation.resource) && sameRef(item.policyRef, obligation.policyRef)
      ));
      const chosen = chooseBinding(actor, obligation.resource, obligation.policyRef, selector?.bindingId);
      if (chosen === "expired") {
        return deny("expired", snapshot, actor);
      }
      if (typeof chosen !== "object") {
        return deny(chosen === "ambiguous" ? "ambiguous-authority" : "mandatory-deny", snapshot, actor);
      }
      for (const binding of contributors(chosen.id)) {
        if (!bindingExpiries.some((item) => item.bindingId === binding.id)) bindingExpiries.push({ bindingId: binding.id, expiresAt: binding.expiresAt });
      }
      const mandatoryPolicy = policyRegistry.getPolicy(obligation.policyRef);
      const mandatoryRule = mandatoryPolicy?.operations[snapshot.operation];
      if (!ruleAdmits(mandatoryRule, actor, chosen.roles)) {
        return deny("mandatory-deny", snapshot, actor);
      }
      if (mandatoryPolicy?.challenge.required === true) {
        challengeRequired = true;
      }
      if (snapshot.operation === "discover") {
        reveal = reveal && mandatoryRule?.reveal === true;
      }
      if (mandatoryPolicy?.extension !== undefined) {
        const extensionEvaluator = extensionEvaluators.get(`${obligation.policyRef.id}\u0000${String(obligation.policyRef.revision)}`);
        if (extensionEvaluator === undefined) {
          return deny("missing-evaluator", snapshot, actor);
        }
        const extensionStarted = epoch;
        const extensionResult = await runCallback(() => extensionEvaluator({
          policyRef: obligation.policyRef,
          extension: mandatoryPolicy.extension,
          actor,
          scope: obligation.resource,
        }));
        if (extensionResult !== "allow" || extensionStarted !== epoch) {
          return deny(extensionResult === "allow" ? "stale" : "missing-evaluator", snapshot, actor);
        }
      }
      const mandatoryPermissions = mandatoryRule?.requiredPermissions ?? [];
      const mandatoryStarted = epoch;
      const mandatoryResult = await runPermissions(snapshot, actor, mandatoryPermissions, mandatoryStarted, obligation.resource);
      if (mandatoryResult !== "allow" || mandatoryStarted !== epoch) {
        return deny(mandatoryStarted !== epoch ? "stale" : mandatoryResult, snapshot, actor);
      }
    }
    if (compiled?.extension !== undefined) {
      const extensionEvaluator = extensionEvaluators.get(`${snapshot.policyRef.id}\u0000${String(snapshot.policyRef.revision)}`);
      if (extensionEvaluator === undefined) {
        return deny("missing-evaluator", snapshot, actor);
      }
      const extensionStarted = epoch;
      const extensionResult = await runCallback(() => extensionEvaluator({
        policyRef: snapshot.policyRef,
        extension: compiled.extension,
        actor,
        scope: snapshot.scope,
      }));
      if (extensionResult !== "allow" || extensionStarted !== epoch) {
        return deny(extensionResult === "allow" ? "stale" : extensionResult, snapshot, actor);
      }
    }
    const started = epoch;
    const permissionResult = await runPermissions(snapshot, actor, rule?.requiredPermissions ?? [], started);
    if (permissionResult !== "allow" || started !== epoch) {
      return deny(started !== epoch ? "stale" : permissionResult, snapshot, actor);
    }
    for (const item of bindingExpiries) {
      const binding = bindings.get(item.bindingId)?.binding;
      if (binding === undefined || bindingExpired(binding, now())) {
        return deny("expired", snapshot, actor);
      }
    }
    if (proofs.some((proof) => now() >= proof.validUntil || invalidated.has(proof.revision))) {
      return deny("external-expired", snapshot, actor);
    }
    const stamp = stampFor(snapshot, actor, [snapshot.policyRef, ...obligations.map((item) => item.policyRef)], proofs, bindingExpiries);
    const decision: StampedDecision = freeze({
      decision: { effect: "allow", reveal, challengeRequired },
      stamp,
    });
    issued.add(decision.stamp);
    if (!liveMatches(decision.stamp, snapshot.actor) || evaluationEpoch !== epoch) {
      return deny("stale", snapshot, actor);
    }
    issued.add(decision);
    return decision;
  };

  const runCallback = async (
    work: () => Promise<"allow" | "deny"> | "allow" | "deny",
  ): Promise<"allow" | "evaluator-failed" | "mandatory-deny"> => {
    try {
      const result = await new Promise<"allow" | "deny" | "timeout">((resolve) => {
        const timer = setTimeout(() => {
          resolve("timeout");
        }, hookDeadlineMs);
        Promise.resolve().then(work).then((value) => {
          clearTimeout(timer);
          resolve(value);
        }, () => {
          clearTimeout(timer);
          resolve("timeout");
        });
      });
      if (result === "timeout") {
        return "evaluator-failed";
      }
      return result === "allow" ? "allow" : "mandatory-deny";
    } catch {
      return "evaluator-failed";
    }
  };

  const runPermissions = async (
    snapshot: EvaluateSelector,
    actor: PolicyActorRef,
    permissions: readonly string[],
    started: number,
    scope: ResourceRef = snapshot.scope,
  ): Promise<"allow" | "missing-evaluator" | "evaluator-failed" | "mandatory-deny" | "stale"> => {
    for (const permission of permissions) {
      const evaluator = permissionEvaluators.get(permission);
      if (evaluator === undefined) {
        return "missing-evaluator";
      }
      const result = await runCallback(() => evaluator({ permission, actor, scope }));
      if (started !== epoch) {
        return "stale";
      }
      if (result !== "allow") {
        return result;
      }
    }
    return "allow";
  };

  const installAdmissions: ReferenceAuthorizer["installAdmissions"] = (inputs) => {
    const declarations: Parameters<ReferenceAuthorizer["installAdmissions"]>[0] = inputs;
    if (!Array.isArray(inputs)) throw new Error("Invalid admission input list.");
    const count = declarations.length;
    if (!Number.isSafeInteger(count) || count < 0 || count > inputLimits.maxAdmissionInstalls) {
      throw new Error("Authorization admission input limit exceeded.");
    }
    const captured: Array<Parameters<ReferenceAuthorizer["installAdmission"]>[0]> = [];
    for (let index = 0; index < count; index += 1) {
      const input = declarations[index];
      if (input === undefined) throw new Error("Invalid admission selector.");
      const sessionType = input.sessionType;
      captured.push({ sessionType: { key: sessionType.key, version: sessionType.version }, providerId: input.providerId });
    }
    const staged = new Map<string, StoredAdmission>();
    for (const input of captured) {
      const keyPart = input.sessionType.key;
      const version = input.sessionType.version;
      const providerId = input.providerId;
      // Exact lookup uses the compiler's captured validated budgets, not a new
      // default-budget restriction on selectors that it already registered.
      if (typeof keyPart !== "string" || typeof providerId !== "string" || !Number.isSafeInteger(version) || version < 1 || version > MAX_POLICY_REVISION) {
        throw new Error("Invalid admission selector.");
      }
      const rules = policyRegistry.forSessionType({ key: keyPart, version }, providerId);
      const installed = policyRegistry.inspect().namespaces;
      const ceiling: PolicyRef[] = [];
      const remember = (policyRef: PolicyRef): void => {
        if (policyRegistry.getPolicy(policyRef) === undefined) {
          throw new Error("Unknown compiled policy.");
        }
        if (!ceiling.some((item) => sameRef(item, policyRef))) {
          ceiling.push(copy(policyRef));
        }
      };
      for (const policyRef of rules.admitted.policies) remember(policyRef);
      for (const namespace of rules.admitted.namespaces) {
        const closure = installed.find((item) => item.name === namespace.name && item.revision === namespace.revision);
        if (closure === undefined) throw new Error("Unknown namespace closure.");
        for (const policyRef of closure.expanded) remember(policyRef);
      }
      const key = `${keyPart}\u0000${String(version)}\u0000${providerId}`;
      const stored = freeze({ rules: copy(rules), ceiling });
      const duplicate = staged.get(key);
      if (duplicate !== undefined && JSON.stringify(duplicate) !== JSON.stringify(stored)) {
        throw new Error("Conflicting admission.");
      }
      staged.set(key, stored);
    }
    // All compiler callbacks are finished. Validate against the CURRENT canonical
    // map/capacity, then publish without any intervening callback or await.
    const additions: Array<readonly [string, StoredAdmission]> = [];
    for (const [key, stored] of staged) {
      const existing = admissions.get(key);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) throw new Error("Conflicting admission.");
      } else additions.push([key, stored]);
    }
    if (admissions.size + additions.length > caps.maxAdmissions) throw new Error("Authorization admission limit exceeded.");
    if (additions.length === 0) return;
    for (const [key, stored] of additions) admissions.set(key, stored);
    bump();
  };

  const captureRegistration = (input: ResourceRegistration): ResourceRegistration => {
    if (input.route.targets.length > inputLimits.maxRouteTargets || (input.mandatory?.length ?? 0) > inputLimits.maxMandatorySelectors) {
      throw new Error("Authorization route limit exceeded.");
    }
    const captured = copy(input);
    resourceRefSchema.parse(captured.resource);
    securitySubjectRefSchema.parse(captured.owner);
    if (captured.grantParent !== undefined) resourceRefSchema.parse(captured.grantParent);
    resourceRefSchema.parse(captured.route.origin);
    for (const target of captured.route.targets) resourceRefSchema.parse(target);
    return freeze(captured);
  };
  const prepareResourceInstallation = (input: ResourceRegistration): ResourceInstallationToken => {
    const captured = captureRegistration(input);
    const token: ResourceInstallationToken = Object.freeze({ kind: "resource-installation" });
    resourceInstallations.set(token, { input: captured, state: "prepared" });
    return token;
  };
  const isResourceInstallationCurrent = (token: ResourceInstallationToken): boolean => {
    const receipt = resourceInstallations.get(token);
    return receipt?.state === "installed" && resources.get(resourceKey(receipt.input.resource))?.installation === token;
  };
  const isBindingInstallationCurrent = (token: BindingInstallationToken): boolean => {
    const receipt = bindingInstallations.get(token);
    return receipt?.state === "installed" && bindings.get(receipt.binding.id)?.installation === token
      && (receipt.resource === undefined || isResourceInstallationCurrent(receipt.resource));
  };
  const resourceBasis = (scope: ResourceRef): readonly ResourceBindingBasis[] | undefined => {
    const result: ResourceBindingBasis[] = [];
    const seen = new Set<string>();
    let cursor: ResourceRef | undefined = scope;
    while (cursor !== undefined) {
      const key = resourceKey(cursor);
      if (seen.has(key) || result.length > maxResourceDepth || cursor.domainId !== scope.domainId) return undefined;
      seen.add(key);
      const current = resources.get(key);
      if (current === undefined) return undefined;
      result.push({ resource: current.resource, installation: current.installation, relationshipRevision: current.relationshipRevision });
      cursor = current.grantParent;
    }
    return result;
  };
  const basisCurrent = (basis: readonly ResourceBindingBasis[]): boolean => basis.every((item) => {
    const current = resources.get(resourceKey(item.resource));
    return current?.installation === item.installation && current.relationshipRevision === item.relationshipRevision;
  });
  const parentEntry = (entry: InstalledBinding): InstalledBinding | undefined => {
    if (entry.parent === undefined) return undefined;
    const parent = bindingInstallations.get(entry.parent);
    const current = parent === undefined ? undefined : bindings.get(parent.binding.id);
    return current?.installation === entry.parent ? current : undefined;
  };
  const bindingUsable = (entry: InstalledBinding, time: number): boolean => {
    if (!finite(time)) return false;
    const seen = new Set<BindingInstallationToken>();
    let cursor: InstalledBinding | undefined = entry;
    while (cursor !== undefined) {
      if (seen.has(cursor.installation) || seen.size > POLICY_LIMIT_ABSOLUTE.delegationDepth || bindingExpired(cursor.binding, time)
        || resourceBasis(cursor.binding.scope) === undefined
        || (cursor.resourceInstallation !== undefined && !isResourceInstallationCurrent(cursor.resourceInstallation))
        || (cursor.relationships !== undefined && !basisCurrent(cursor.relationships))) return false;
      seen.add(cursor.installation);
      if (cursor.parent === undefined) return cursor.binding.authority.kind === "host-policy";
      cursor = parentEntry(cursor);
    }
    return false;
  };
  const contributors = (id: string): readonly ScopedPolicyBinding[] => {
    const result: ScopedPolicyBinding[] = [];
    let cursor = bindings.get(id);
    while (cursor !== undefined && result.length <= POLICY_LIMIT_ABSOLUTE.delegationDepth) {
      result.push(cursor.binding);
      cursor = parentEntry(cursor);
    }
    return result;
  };
  const removeClosure = (seeds: ReadonlySet<string>, publish = true): boolean => {
    const removed = new Set(seeds);
    for (let depth = 0; depth <= POLICY_LIMIT_ABSOLUTE.delegationDepth; depth += 1) {
      let changed = false;
      for (const [id, entry] of bindings) {
        const parent = entry.parent === undefined ? undefined : bindingInstallations.get(entry.parent);
        if (!removed.has(id) && parent !== undefined && removed.has(parent.binding.id)) {
          removed.add(id);
          changed = true;
        }
      }
      if (!changed) break;
    }
    let changed = false;
    for (const id of removed) {
      const entry = bindings.get(id);
      if (entry === undefined) continue;
      const receipt = bindingInstallations.get(entry.installation);
      if (receipt !== undefined) receipt.state = "retired";
      bindings.delete(id);
      changed = true;
    }
    for (const registry of [assignments, executorAssignments]) {
      for (const [key, assignment] of registry) if (removed.has(assignment.bindingId)) registry.delete(key);
    }
    if (changed && publish) bump();
    return changed;
  };
  const pruneBindings = (time: number): void => {
    if (!finite(time)) return;
    const invalid = new Set<string>();
    for (const [id, entry] of bindings) {
      if (bindingExpired(entry.binding, time)
        || ((entry.parent !== undefined || entry.resourceInstallation !== undefined) && !bindingUsable(entry, time))) invalid.add(id);
    }
    if (invalid.size > 0) removeClosure(invalid);
  };
  const removeBindingById = (id: string): boolean => bindings.has(id) && removeClosure(new Set([id]));
  const teardown = (resource: ResourceRef): void => {
    const installed = resources.get(resourceKey(resource));
    if (installed !== undefined) {
      const receipt = resourceInstallations.get(installed.installation);
      if (receipt !== undefined) receipt.state = "retired";
    }
    resources.delete(resourceKey(resource));
    for (const registry of [assignments, executorAssignments]) {
      for (const [key, assignment] of registry) {
        if (sameResource(assignment.resource, resource)
          || routeResources(assignment.route).some((ref) => sameResource(ref, resource))) registry.delete(key);
      }
    }
    const removed = new Set<string>();
    for (const [id, entry] of bindings) {
      if (sameResource(entry.binding.scope, resource) || entry.relationships?.some((basis) => sameResource(basis.resource, resource))) removed.add(id);
    }
    removeClosure(removed, false);
    bump();
  };

  const snapshotCurrent = (snapshot: ScopedBindingSnapshot, time: number): boolean => {
    if (!finite(time)) return false;
    // Canonicalize expiry using the already sampled clock; no callback follows
    // the final revision/installation comparison.
    pruneBindings(time);
    const basis = bindingSnapshots.get(snapshot);
    return basis !== undefined && finite(time) && snapshot.epoch === epoch && snapshot.grantRevision === grantRevision && basisCurrent(basis)
      && snapshot.tokens.every((token) => {
        const entry = bindingTokens.get(token);
        return entry !== undefined && bindings.get(entry.binding.id) === entry && bindingUsable(entry, time);
      });
  };
  const rootOf = (scope: ResourceRef, time: number): ResourceRef<"session"> => {
    const root = finite(time) ? resourceBasis(scope)?.at(-1)?.resource : undefined;
    if (root?.kind !== "session") throw new Error("Grant scope unavailable.");
    return root as ResourceRef<"session">;
  };
  const historicalAncestors = (entry: InstalledBinding): readonly InstalledBinding[] => {
    const result: InstalledBinding[] = [];
    let cursor: InstalledBinding | undefined = entry;
    while (cursor !== undefined && result.length <= POLICY_LIMIT_ABSOLUTE.delegationDepth) {
      result.push(cursor);
      cursor = cursor.parent === undefined ? undefined : bindingInstallations.get(cursor.parent)?.entry;
    }
    return result;
  };
  const captureGrantBasis = (context: BoundGrantContext, time: number): CapturedGrantBasis => {
    if (!serviceActive || !finite(time)) throw new Error("Grant scope unavailable.");
    pruneBindings(time);
    const parent = bindingTokens.get(context.basis);
    const relationships = resourceBasis(context.scope);
    if (parent === undefined || bindings.get(parent.binding.id) !== parent || !bindingUsable(parent, time)
      || !sameActor(parent.binding.actor, context.context.actor) || relationships === undefined
      || context.context.actor.principal.domainId !== context.scope.domainId
      || !relationships.some((item) => sameResource(item.resource, parent.binding.scope))) throw new Error("Grant scope unavailable.");
    const root = rootOf(context.scope, time);
    const target = context.revokeTarget === undefined ? undefined : bindingTokens.get(context.revokeTarget);
    if (context.revokeTarget !== undefined && (target === undefined || !sameResource(target.binding.scope, context.scope)
      || (bindings.has(target.binding.id) && bindings.get(target.binding.id) !== target))) throw new Error("Grant target unavailable.");
    const targetAncestry = target === undefined ? [] : historicalAncestors(target).slice(1);
    const resource = resources.get(resourceKey(context.scope));
    const admitted = resource?.admissionKey === undefined ? undefined : admissions.get(resource.admissionKey)?.ceiling;
    const basis: CapturedGrantBasis = freeze({ epoch, grantRevision, scope: copy(context.scope), root,
      parent: parent.binding, ancestors: contributors(parent.binding.id),
      ...(parent.control === undefined ? {} : { controls: parent.control }),
      ...(target === undefined ? {} : { target: target.binding }), targetAbsent: target !== undefined && !bindings.has(target.binding.id),
      targetDescendsFromBasis: targetAncestry.includes(parent), targetIssuedByBasis: target?.parent === parent.installation,
      ...(admitted === undefined ? {} : { admitted }), relationships: freeze(relationships),
    });
    grantBases.set(basis, { parent, ...(target === undefined ? {} : { target }), used: false });
    return basis;
  };
  const grantBasisCurrent = (basis: CapturedGrantBasis, time: number): boolean => {
    if (!finite(time)) return false;
    pruneBindings(time);
    const state = grantBases.get(basis);
    return serviceActive && finite(time) && state !== undefined && !state.used && basis.epoch === epoch && basis.grantRevision === grantRevision
      && basisCurrent(basis.relationships) && bindings.get(state.parent.binding.id) === state.parent && bindingUsable(state.parent, time)
      && (state.target === undefined || (basis.targetAbsent ? !bindings.has(state.target.binding.id) : bindings.get(state.target.binding.id) === state.target));
  };
  const grantCapacity: CanonicalGrantPort["capacity"] = (basis, actor, limits) => {
    const state = grantBases.get(basis);
    if (state === undefined || bindings.size >= caps.maxBindings) return false;
    let actorCount = 0;
    let childCount = 0;
    for (const entry of bindings.values()) {
      if (sameActor(entry.binding.actor, actor) && sameResource(entry.binding.scope, basis.scope)) actorCount += 1;
      if (entry.parent === state.parent.installation) childCount += 1;
    }
    return actorCount < limits.maxBindingsPerActor && childCount < limits.maxChildrenPerParent;
  };
  const registry: ReferenceAuthorizer = {
    onInvalidate(listener) {
      if (typeof listener !== "function" || listeners.size >= maxListeners) throw new Error("Invalidation listener limit exceeded.");
      const state: InvalidationListenerState = { listener, active: true, running: false };
      listeners.add(state);
      return () => {
        state.active = false;
        if (!state.running) listeners.delete(state);
      };
    },
    drainInvalidations,
    createGrantService(options) {
      if (grantService !== undefined) {
        if (options !== grantServiceOptions) throw new Error("Grant service already configured.");
        return grantService;
      }
      if (constructingService) throw new Error("Grant service configuration in progress.");
      constructingService = true;
      try {
        const service = buildGrantService(options, {
          registry, identity: serviceIdentity, now: () => now(), policyKnown: (ref) => policyRegistry.getPolicy(ref) !== undefined,
          root: rootOf, snapshotCurrent, drain: drainInvalidations, capture: captureGrantBasis, basisCurrent: grantBasisCurrent, capacity: grantCapacity,
          commit(basis, binding, control, limits, time) {
            const state = grantBases.get(basis);
            if (state === undefined || !grantBasisCurrent(basis, time) || !grantCapacity(basis, binding.actor, limits)
              || bindings.has(binding.id) || bindingExpired(binding, time) || control.service !== serviceIdentity
              || !sameResource(binding.scope, basis.scope)) return false;
            const resource = resources.get(resourceKey(basis.scope));
            if (resource === undefined) return false;
            const installation: BindingInstallationToken = Object.freeze({ kind: "binding-installation" });
            const entry: InstalledBinding = freeze({ binding, installation, resourceInstallation: resource.installation,
              parent: state.parent.installation, relationships: basis.relationships, control });
            state.used = true;
            bindingInstallations.set(installation, { binding, resource: resource.installation, state: "installed", entry });
            bindings.set(binding.id, entry);
            bump();
            return true;
          },
          revoke(basis, time) {
            const state = grantBases.get(basis);
            if (state?.target === undefined || !grantBasisCurrent(basis, time)) return false;
            state.used = true;
            if (!basis.targetAbsent) removeClosure(new Set([state.target.binding.id]));
            return true;
          },
          sweep(limit, time) {
            if (!finite(time)) return;
            const roots = new Set<string>();
            for (const [id, entry] of bindings) {
              if (!bindingUsable(entry, time)) roots.add(id);
              if (roots.size >= limit) break;
            }
            if (roots.size > 0) removeClosure(roots);
          },
          dispose() {
            if (!serviceActive) return;
            serviceActive = false;
            const removed = new Set<string>();
            for (const [id, entry] of bindings) if (entry.control?.service === serviceIdentity) removed.add(id);
            removeClosure(removed, false);
            bump();
          },
        });
        grantService = service;
        grantServiceOptions = options;
        serviceActive = true;
        bump();
        return service;
      } finally {
        constructingService = false;
      }
    },
    readBindings(query) {
      const actor = freeze(policyActorRefSchema.parse(query.actor));
      const scope = freeze(resourceRefSchema.parse(query.scope));
      if (actor.principal.domainId !== scope.domainId) throw new Error("Binding scope unavailable.");
      const time = now();
      if (!finite(time)) throw new Error("Binding time unavailable.");
      pruneBindings(time);
      const basis = resourceBasis(scope);
      if (basis === undefined) throw new Error("Binding scope unavailable.");
      const entries = [...bindings.values()].filter((entry) => sameActor(entry.binding.actor, actor) && sameResource(entry.binding.scope, scope) && bindingUsable(entry, time));
      const tokens = entries.map((entry): CanonicalBindingToken => {
        const token = freeze({ bindingId: entry.binding.id, scope: entry.binding.scope, revision: entry.binding.revision, incarnation: entry.installation });
        bindingTokens.set(token, entry);
        return token;
      });
      const snapshot: ScopedBindingSnapshot = freeze({ actor, scope, epoch, grantRevision, bindings: entries.map((entry) => entry.binding), tokens });
      bindingSnapshots.set(snapshot, freeze(basis));
      return snapshot;
    },
    isBindingSnapshotCurrent(snapshot) {
      const basis = bindingSnapshots.get(snapshot);
      if (basis === undefined) return false;
      const time = now();
      if (!finite(time)) return false;
      pruneBindings(time);
      return snapshot.epoch === epoch && snapshot.grantRevision === grantRevision && basisCurrent(basis)
        && snapshot.tokens.every((token) => {
          const entry = bindingTokens.get(token);
          return entry !== undefined && bindings.get(entry.binding.id) === entry && bindingUsable(entry, time);
        });
    },
    prepareResourceInstallation,
    prepareBindingInstallation(binding, resource) {
      const captured = freeze(scopedPolicyBindingSchema.parse(binding));
      const owner = resourceInstallations.get(resource);
      if (owner === undefined || (owner.state !== "prepared" && owner.state !== "installed")
        || !sameResource(owner.input.resource, captured.scope)) throw new Error("Invalid resource installation.");
      const token: BindingInstallationToken = Object.freeze({ kind: "binding-installation" });
      bindingInstallations.set(token, { binding: captured, resource, state: "prepared" });
      return token;
    },
    isResourceInstallationCurrent,
    isBindingInstallationCurrent,
    removeInstalledBinding(token) {
      const receipt = bindingInstallations.get(token);
      if (receipt === undefined) return false;
      if (receipt.state === "installed" && bindings.get(receipt.binding.id)?.installation === token) {
        return removeBindingById(receipt.binding.id);
      }
      receipt.state = "retired";
      return false;
    },
    teardownInstalledResource(token) {
      const receipt = resourceInstallations.get(token);
      if (receipt === undefined) return false;
      if (isResourceInstallationCurrent(token)) {
        teardown(receipt.input.resource);
        return true;
      }
      receipt.state = "retired";
      return false;
    },
    usesPolicyFactory: (factory) => factory === policyRegistry,
    removeBinding(expected) {
      const id = identifierSchema.parse(expected.bindingId);
      const scope = resourceRefSchema.parse(expected.scope);
      const revision = expected.revision;
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("Invalid expected binding revision.");
      }
      const binding = bindings.get(id)?.binding;
      if (binding === undefined || binding.revision !== revision || !sameResource(binding.scope, scope)) {
        return false;
      }
      return removeBindingById(id);
    },
    installAdmissions,
    installAdmission: (input) => {
      installAdmissions([input]);
    },
    installResource(input, installation) {
      const receipt = installation === undefined ? undefined : resourceInstallations.get(installation);
      if (installation !== undefined) {
        if (receipt?.state !== "prepared") throw new Error("Invalid or consumed resource installation.");
        receipt.state = "failed";
      }
      const captured = captureRegistration(input);
      if (receipt !== undefined && JSON.stringify(receipt.input) !== JSON.stringify(captured)) {
        throw new Error("Resource installation input changed.");
      }
      const key = resourceKey(captured.resource);
      if (!resources.has(key) && resources.size >= caps.maxResources) {
        throw new Error("Authorization resource limit exceeded.");
      }
      if (captured.grantParent !== undefined) {
        const ancestry = resourceBasis(captured.grantParent);
        if (captured.resource.kind === "session" || ancestry === undefined || ancestry.length > maxResourceDepth
          || ancestry.at(-1)?.resource.kind !== "session" || ancestry.some((item) => sameResource(item.resource, captured.resource))
          || captured.grantParent.domainId !== captured.resource.domainId) throw new Error("Invalid grant resource parent.");
      }
      const existing = resources.get(key);
      if (installation !== undefined && existing !== undefined) throw new Error("Resource installation already exists.");
      if (existing !== undefined && !sameOwner(existing.owner, captured.owner)) {
        throw new Error("Resource owner is immutable.");
      }
      const admissionKey = captured.admission === undefined
        ? undefined
        : `${captured.admission.sessionType.key}\u0000${String(captured.admission.sessionType.version)}\u0000${captured.admission.providerId}`;
      if (existing?.admissionKey !== undefined && admissionKey !== existing.admissionKey) {
        throw new Error("Resource admission is immutable.");
      }
      const identity = installation ?? existing?.installation ?? prepareResourceInstallation(captured);
      const stored: StoredResource = {
        installation: identity,
        resource: captured.resource,
        owner: captured.owner,
        route: captured.route,
        mandatory: captured.mandatory ?? [],
        externalAuthority: captured.externalAuthority,
        relationshipRevision: existing?.relationshipRevision ?? 1,
        ...(admissionKey === undefined ? {} : { admissionKey }),
        ...(captured.grantParent === undefined ? {} : { grantParent: captured.grantParent }),
      };
      if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(stored)) {
        return;
      }
      resources.set(key, freeze({ ...stored, relationshipRevision: (existing?.relationshipRevision ?? 0) + 1 }));
      const installedReceipt = resourceInstallations.get(identity);
      if (installedReceipt !== undefined) installedReceipt.state = "installed";
      bump();
    },
    installBinding(binding, installation) {
      const receipt = installation === undefined ? undefined : bindingInstallations.get(installation);
      if (installation !== undefined) {
        if (receipt?.state !== "prepared") throw new Error("Invalid or consumed binding installation.");
        receipt.state = "failed";
      }
      const parsedBinding = scopedPolicyBindingSchema.safeParse(binding);
      if (!parsedBinding.success) {
        throw new Error("Invalid binding.");
      }
      const stored = freeze(parsedBinding.data);
      const installationTime = now();
      if (!finite(installationTime)) throw new Error("Binding time unavailable.");
      if (receipt !== undefined && (JSON.stringify(receipt.binding) !== JSON.stringify(stored)
        || receipt.resource === undefined || !isResourceInstallationCurrent(receipt.resource))) {
        throw new Error("Binding installation input or resource changed.");
      }
      const existing = bindings.get(stored.id);
      if (installation !== undefined && existing !== undefined) throw new Error("Binding installation already exists.");
      if (existing !== undefined && JSON.stringify(existing.binding) === JSON.stringify(stored)) {
        return;
      }
      if (existing !== undefined) {
        throw new Error("Conflicting binding replacement.");
      }
      if (bindings.size >= caps.maxBindings) {
        throw new Error("Authorization binding limit exceeded.");
      }
      let parent: InstalledBinding | undefined;
      let relationships: readonly ResourceBindingBasis[] | undefined;
      if (stored.authority.kind === "delegation") {
        parent = bindings.get(stored.authority.parentGrantId);
        relationships = resourceBasis(stored.scope);
        if (parent === undefined || !bindingUsable(parent, installationTime) || !sameActor(parent.binding.actor, stored.authority.issuer)
          || contributors(parent.binding.id).length > POLICY_LIMIT_ABSOLUTE.delegationDepth
          || relationships === undefined || !relationships.some((item) => sameResource(item.resource, parent?.binding.scope ?? stored.scope))) {
          throw new Error("Invalid delegated binding lineage.");
        }
      }
      const identity: BindingInstallationToken = installation ?? Object.freeze({ kind: "binding-installation" });
      const resourceInstallation = receipt?.resource ?? resources.get(resourceKey(stored.scope))?.installation;
      const entry: InstalledBinding = freeze({ binding: stored, installation: identity,
        ...(resourceInstallation === undefined ? {} : { resourceInstallation }),
        ...(parent === undefined ? {} : { parent: parent.installation }),
        ...(relationships === undefined ? {} : { relationships: freeze(relationships) }),
      });
      bindingInstallations.set(identity, { binding: stored, ...(resourceInstallation === undefined ? {} : { resource: resourceInstallation }), state: "installed", entry });
      bindings.set(stored.id, entry);
      bump();
    },
    installTool(contract) {
      const defined = defineToolContract(contract);
      const existing = tools.get(defined.id);
      if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(defined)) {
        return;
      }
      if (existing !== undefined) {
        throw new Error("Conflicting tool replacement.");
      }
      if (tools.size >= caps.maxTools) {
        throw new Error("Authorization tool limit exceeded.");
      }
      tools.set(defined.id, defined);
      bump();
    },
    installToolAssignment(record) {
      if (record.route.targets.length > inputLimits.maxRouteTargets) {
        throw new Error("Authorization route limit exceeded.");
      }
      const key = assignmentKey(record);
      const stored = freeze(copy(record));
      const existing = assignments.get(key);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) {
          throw new Error("Conflicting assignment.");
        }
        return;
      }
      if (assignments.size >= caps.maxToolAssignments) {
        throw new Error("Authorization assignment limit exceeded.");
      }
      assignments.set(key, stored);
      bump();
    },
    installExecutorAssignment(record) {
      if (!toolExecutionBindingSchema.safeParse(record.implementation).success) {
        throw new Error("Invalid executor implementation.");
      }
      if (record.route.targets.length > inputLimits.maxRouteTargets) {
        throw new Error("Authorization route limit exceeded.");
      }
      const key = assignmentKey(record);
      const stored = freeze(copy(record));
      const existing = executorAssignments.get(key);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) {
          throw new Error("Conflicting assignment.");
        }
        return;
      }
      if (executorAssignments.size >= caps.maxExecutors) {
        throw new Error("Authorization executor limit exceeded.");
      }
      executorAssignments.set(key, stored);
      bump();
    },
    installPolicyExtensionEvaluator(policyRef, evaluator) {
      const key = `${policyRef.id}\u0000${String(policyRef.revision)}`;
      const existing = extensionEvaluators.get(key);
      if (existing === evaluator) {
        return;
      }
      if (existing !== undefined) {
        throw new Error("Conflicting extension evaluator.");
      }
      if (extensionEvaluators.size >= caps.maxExtensionEvaluators) {
        throw new Error("Authorization evaluator limit exceeded.");
      }
      extensionEvaluators.set(key, evaluator);
      bump();
    },
    invalidateExternal(revision) {
      if (!invalidated.has(revision) && invalidated.size >= caps.maxExternalInvalidations) {
        externalUnavailable = true;
        bump();
        throw new Error("Authorization invalidation limit exceeded.");
      }
      invalidated.add(revision);
      bump();
    },
    teardown,
    owner(resource) {
      return findResource(resources, resource)?.owner;
    },
    evaluate: evaluateSnapshot,
    async projectAssignments(input) {
      if (!inputWithinLimits(input)) {
        const denied = oversizedDeny();
        return freeze({ decisions: [denied], stamps: [denied.stamp], admitted: [] });
      }
      const snapshot = freeze(copy(input));
      const decisions: StampedDecision[] = [];
      const admitted: AdmittedAssignment[] = [];
      const executing = snapshot.purpose === "execute";
      const recipient = executing && snapshot.executor !== undefined
        ? snapshot.executor.actor
        : snapshot.actor.actor;
      const recipientValid = executing
        ? snapshot.recipient === "executor" && executorRevisionSchema.safeParse(snapshot.executor).success
        : snapshot.recipient === "caller" && snapshot.executor === undefined;
      const registry = executing ? executorAssignments : assignments;
      for (const tool of snapshot.tools) {
        const selector: EvaluateSelector = {
          actor: snapshot.actor,
          operation: tool.operation ?? snapshot.purpose,
          bindingId: tool.bindingId,
          policyRef: tool.policyRef,
          scope: snapshot.scope,
          route: snapshot.route,
          ...(snapshot.external === undefined ? {} : { external: snapshot.external }),
          ...(snapshot.externalProofs === undefined ? {} : { externalProofs: snapshot.externalProofs }),
          ...(snapshot.executor === undefined ? {} : { executor: snapshot.executor }),
          ...(snapshot.mandatoryBindings === undefined ? {} : { mandatoryBindings: snapshot.mandatoryBindings }),
        };
        const decision = await evaluateSnapshot(selector);
        const contract = tools.get(tool.contractId);
        const tuple = [...registry.values()].find((item) => (
          item.contract.id === tool.contractId
          && contract !== undefined && item.contract.key === contract.key && item.contract.version === contract.version
          && item.bindingId === tool.bindingId
          && sameRef(item.policyRef, tool.policyRef)
          && item.operation === (tool.operation ?? snapshot.purpose)
          && sameResource(item.resource, snapshot.scope)
          && sameActor(item.recipient, recipient)
          && sameRoute(item.route, snapshot.route)
          && (executing
            ? sameExecutor(item.executor, snapshot.executor) && item.implementation !== undefined
            : item.executor === undefined)
        ));
        if (!recipientValid || selector.operation !== snapshot.purpose || tuple === undefined) {
          decisions.push(decision.decision.effect === "deny" ? decision : deny("missing-assignment", selector, recipient));
          continue;
        }
        decisions.push(decision);
        admitted.push(freeze({
          tuple,
          allowed: decision.decision.effect === "allow",
          reveal: decision.decision.effect === "allow" && decision.decision.reveal,
          challengeRequired: decision.decision.effect === "allow" && decision.decision.challengeRequired,
          decision,
        }));
      }
      const authorization = freeze({
        decisions,
        stamps: decisions.map((item) => item.stamp),
        admitted,
      });
      issued.add(authorization);
      return authorization;
    },
    matches(stamp, actor) {
      return liveMatches(stamp, actor);
    },
    validateAssignments(authorization, actor) {
      if (!issued.has(authorization)) {
        return false;
      }
      return authorization.stamps.every((stamp) => liveMatches(stamp, actor))
        && authorization.admitted.every((item) => {
          const registry = item.tuple.operation === "execute" ? executorAssignments : assignments;
          const current = registry.get(assignmentKey(item.tuple));
          return current !== undefined && JSON.stringify(current) === JSON.stringify(item.tuple)
            && (item.tuple.operation !== "execute"
              || (current.implementation !== undefined
                && sameExecutor(current.executor, item.decision.stamp.authority.executor)));
        });
    },
    getContract(id) {
      return tools.get(id);
    },
  };
  return registry;
};

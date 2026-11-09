import { TOOL_OPERATIONS } from "@toolPolicy/constants";
import { capturePlainJson, identifierSchema, policyRefSchema, resourceRefSchema, trustedRequestContextSchema } from "../validation";
import type { PresentedExternalProof } from "../evaluate/types";
import type { ResourceKindAdapter, ResourceTypeRegistration, ResourceRegistration, ResourceOperationsOptions, ResourceOperations, ResourceOperationRequest, ResourceOperationAuthority, ResourceOperationTicket, ResourceOperation, ResourceOperationHandle } from "./types";
import type { ResourceRef, SecuritySubjectRef } from "../../types";
import { sameResource, sameRoute } from "../context";
import type { RegisteredResource } from "./types";

export const resourceKey = (resource: ResourceRef): string => (
  `${resource.domainId}\u0000${resource.kind}\u0000${resource.id}\u0000${resource.instanceId}`
);

export const sameOwner = (left: SecuritySubjectRef, right: SecuritySubjectRef): boolean => (
  left.domainId === right.domainId && left.subject === right.subject
);

export const findResource = (
  resources: ReadonlyMap<string, RegisteredResource>,
  resource: ResourceRef,
): RegisteredResource | undefined => {
  const found = resources.get(resourceKey(resource));
  return found !== undefined && sameResource(found.resource, resource) ? found : undefined;
};

const exactlyTrue = (value: unknown): boolean => {
  if (value !== true) void Promise.resolve(value).catch(() => undefined);
  return value === true;
};
const operationJsonLimits = { maxBytes: 1024 * 1024, maxDepth: 64, maxKeys: 65536 };
const freezeOperation = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeOperation(child);
  }
  return value;
};
const operationCopy = <T>(value: T): T => {
  // Expand repeated references into a tree; reject cycles/accessors before reading values.
  const ancestors = new Set<object>();
  let keys = 0;
  let characters = 0;
  const invalid = (): never => {
    throw new TypeError("Invalid resource operation data.");
  };
  const visit = (entry: unknown, depth: number): unknown => {
    if (depth > operationJsonLimits.maxDepth) return invalid();
    if (typeof entry === "string") {
      characters += entry.length;
      if (characters > operationJsonLimits.maxBytes) return invalid();
      return entry;
    }
    if (entry === null || typeof entry === "boolean" || typeof entry === "number") return entry;
    if (typeof entry !== "object" || ancestors.has(entry)) return invalid();
    const array = Array.isArray(entry);
    const prototype: unknown = Object.getPrototypeOf(entry);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    if (Object.getOwnPropertySymbols(entry).length > 0) return invalid();
    const names = Object.getOwnPropertyNames(entry).filter((name) => !array || name !== "length");
    keys += names.length;
    if (keys > operationJsonLimits.maxKeys || (array && names.length !== entry.length)) return invalid();
    const output: unknown[] | Record<string, unknown> = array ? [] : {};
    ancestors.add(entry);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (name === undefined || (array && name !== String(index))) return invalid();
      characters += name.length;
      if (characters > operationJsonLimits.maxBytes) return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(entry, name);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return invalid();
      Object.defineProperty(output, name, { value: visit(descriptor.value, depth + 1), enumerable: true });
    }
    ancestors.delete(entry);
    return output;
  };
  const copied = visit(value, 0);
  if (!capturePlainJson(copied, operationJsonLimits)) return invalid();
  return freezeOperation(copied) as T;
};
const typeKey = (kind: string, type: { readonly key: string; readonly version: number }, provider: string): string => JSON.stringify([kind, type.key, type.version, provider]);

/** Bounded policy adapter. All ownership and grants remain in the canonical registry. */
export function createResourceOperations(options: ResourceOperationsOptions): ResourceOperations {
  const registry = options.registry;
  const policies = options.policies;
  const maxPending = options.maxPending ?? 64;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!exactlyTrue(registry.usesPolicyFactory(policies)) || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 64
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 || options.kinds.length > 32 || options.types.length > 128) throw new TypeError("Invalid resource operation configuration.");
  const kinds = new Map<string, ResourceKindAdapter>();
  const types = new Map<string, ResourceTypeRegistration>();
  for (const kind of options.kinds) {
    const name = identifierSchema.parse(kind.kind);
    if (kinds.has(name)) throw new TypeError("Duplicate resource kind.");
    kinds.set(name, Object.freeze({ kind: name, resolve: kind.resolve.bind(kind), current: kind.current.bind(kind), fence: kind.fence.bind(kind), ...(kind.proof === undefined ? {} : { proof: kind.proof.bind(kind) }) }));
  }
  for (const type of options.types) {
    identifierSchema.parse(type.kind);
    identifierSchema.parse(type.type.key);
    identifierSchema.parse(type.providerId);
    if (!kinds.has(type.kind) || !Number.isSafeInteger(type.type.version) || type.type.version < 1 || type.operations.length > 64) throw new TypeError("Invalid resource type.");
    const names = new Set<string>();
    const operations = type.operations.map((operation) => {
      const name = identifierSchema.parse(operation.name);
      if (names.has(name) || !TOOL_OPERATIONS.includes(operation.purpose) || operation.policies.length < 1 || operation.policies.length > 128) throw new TypeError("Invalid resource operation.");
      names.add(name);
      const refs = operationCopy(operation.policies.map((ref) => policyRefSchema.parse(ref)));
      if (refs.some((ref) => policies.getPolicy(ref) === undefined)) throw new TypeError("Unknown operation policy.");
      return Object.freeze({ name, purpose: operation.purpose, policies: refs, ...(operation.validate === undefined ? {} : { validate: operation.validate.bind(operation) }), ...(operation.commit === undefined ? {} : { commit: operation.commit.bind(operation) }) });
    });
    const key = typeKey(type.kind, type.type, type.providerId);
    if (types.has(key)) throw new TypeError("Duplicate resource type.");
    types.set(key, Object.freeze({ kind: type.kind, type: operationCopy(type.type), providerId: type.providerId, operations: Object.freeze(operations) }));
    // The existing compiler's type/provider binding owns admitted and mandatory refs.
    registry.installAdmission({ sessionType: type.type, providerId: type.providerId });
  }
  interface Pending {
    readonly controller: AbortController;
    readonly deadline: number;
    readonly request: ResourceOperationRequest;
    readonly stop: () => void;
    readonly cancel: () => void;
    readonly fence: () => boolean;
    settled: boolean;
    consumed: boolean;
    commit?: (admission: (authority: ResourceOperationAuthority) => boolean) => boolean;
  }
  const pending = new Set<Pending>();
  const tickets = new WeakMap<ResourceOperationTicket, Pending>();
  let closed = false;
  const unavailable = () => closed || pending.size >= maxPending;
  const getType = (resource: RegisteredResource): ResourceTypeRegistration | undefined => resource.admission === undefined
    ? undefined
    : types.get(typeKey(resource.resource.kind, resource.admission.sessionType, resource.admission.providerId));
  const release = (state: Pending): void => {
    if (state.settled) {
      state.stop();
      pending.delete(state);
    }
  };
  const alive = (state: Pending): boolean => !closed && !state.controller.signal.aborted && !state.request.signal.aborted && Date.now() < state.deadline && state.fence();
  return Object.freeze({
    install(input: ResourceRegistration) {
      const captured = operationCopy(input);
      if (closed || captured.admission === undefined || !types.has(typeKey(captured.resource.kind, captured.admission.sessionType, captured.admission.providerId))) throw new TypeError("Unsupported resource type.");
      registry.installResource(captured);
    },
    authorize(raw: ResourceOperationRequest): ResourceOperationHandle {
      const denied: ResourceOperationHandle = Object.freeze({ ticket: Promise.resolve(undefined), settled: Promise.resolve(undefined) });
      if (unavailable() || raw.signal.aborted) return denied;
      let request: ResourceOperationRequest;
      try {
        const data = operationCopy({ actor: raw.actor, route: raw.route, target: raw.target, operation: raw.operation, payload: raw.payload });
        trustedRequestContextSchema.parse(data.actor);
        resourceRefSchema.parse(data.target);
        identifierSchema.parse(data.operation);
        const refs = [data.route.origin, ...data.route.targets];
        if (refs.length > 64 || !refs.some((ref) => sameResource(ref, data.target)) || refs.some((ref) => ref.domainId !== data.actor.actor.principal.domainId)) return denied;
        for (const ref of refs) resourceRefSchema.parse(ref);
        request = Object.freeze({ ...data, signal: raw.signal });
      } catch {
        return denied;
      }
      if (unavailable() || request.signal.aborted) return denied;
      const controller = new AbortController();
      const result = Promise.withResolvers<ResourceOperationTicket | undefined>();
      const settled = Promise.withResolvers<undefined>();
      const abort = () => {
        controller.abort();
        result.resolve(undefined);
        release(state);
      };
      const timer = setTimeout(abort, timeoutMs);
      const state: Pending = { controller, request, cancel: abort, fence: registry.captureFence(), deadline: Date.now() + timeoutMs, settled: false, consumed: false,
        stop: () => {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", abort);
        } };
      pending.add(state);
      request.signal.addEventListener("abort", abort, { once: true });
      const ownedRequest = Object.freeze({ ...request, signal: controller.signal });
      const work = async (): Promise<ResourceOperationTicket | undefined> => {
        try {
          const refs = [...new Map([request.route.origin, ...request.route.targets].map((ref) => [resourceKey(ref), ref])).values()];
          const resolved: Array<{ readonly ref: ResourceRef; readonly adapter: ResourceKindAdapter; readonly resource: RegisteredResource; readonly type: ResourceTypeRegistration; readonly operation: ResourceOperation }> = [];
          const externalProofs: PresentedExternalProof[] = [];
          for (const ref of refs) {
            const adapter = kinds.get(ref.kind);
            const resource = registry.readResource(ref);
            const type = resource === undefined ? undefined : getType(resource);
            const operation = type?.operations.find((entry) => entry.name === request.operation);
            if (adapter === undefined || resource === undefined || type === undefined || operation === undefined
              || ![resource.route, ...(resource.allowedRoutes ?? [])].some((route) => sameRoute(route, request.route))) return undefined;
            const actual = await adapter.resolve({ kind: ref.kind, id: ref.id }, controller.signal);
            if (!alive(state) || actual === undefined || !sameResource(resourceRefSchema.parse(operationCopy(actual)), ref)) return undefined;
            const proof = await adapter.proof?.(ref, request.actor, controller.signal);
            if (!alive(state)) return undefined;
            if (proof !== undefined) externalProofs.push(operationCopy(proof));
            resolved.push({ ref, adapter, resource, type, operation });
          }
          const decisions: ResourceOperationAuthority["decisions"][number][] = [];
          for (const item of resolved) {
            const selection = await policies.select({ sessionType: item.type.type, providerId: item.type.providerId,
              context: { actor: request.actor, resource: item.ref, input: request.payload } });
            if (!alive(state) || selection.effect !== "selected") return undefined;
            const bindings = registry.readBindings({ actor: request.actor.actor, scope: item.ref });
            let selected = false;
            let attempts = 0;
            for (const binding of bindings.bindings) {
              for (const ref of selection.alternatives) {
                if (!item.operation.policies.some((policy) => policy.id === ref.id && policy.revision === ref.revision)
                  || !binding.policies.some((policy) => policy.id === ref.id && policy.revision === ref.revision)) continue;
                attempts += 1;
                if (attempts > 128) return undefined;
                const decision = await registry.evaluate({ actor: request.actor, operation: item.operation.purpose, bindingId: binding.id,
                  policyRef: ref, scope: item.ref, route: request.route, externalProofs });
                if (!alive(state)) return undefined;
                if (decision.decision.effect === "allow" && !decision.decision.challengeRequired) {
                  decisions.push(Object.freeze({ stamp: decision.stamp, actor: request.actor }));
                  selected = true;
                  break;
                }
              }
              if (selected) break;
            }
            if (!selected) return undefined;
          }
          const target = resolved.find((item) => sameResource(item.ref, request.target));
          if (target?.operation.validate === undefined || target.operation.commit === undefined || !exactlyTrue(target.operation.validate(request.payload)) || !alive(state)) return undefined;
          const commit = target.operation.commit.bind(target.operation);
          const authority: ResourceOperationAuthority = Object.freeze({ registry, decisions: Object.freeze(decisions) });
          const registryFence = state.fence;
          const fence = () => alive(state) && registryFence() && resolved.every((item) => exactlyTrue(item.adapter.fence(item.ref)));
          if (!registry.validateAuthorityCohort([], decisions) || !fence()) return undefined;
          state.commit = (admission) => {
            let attempted = false;
            let accepting = true;
            const active = () => accepting;
            let admitted = false;
            const wasAdmitted = () => admitted;
            try {
              const result: unknown = commit(request.payload, ownedRequest, () => {
                if (!active() || attempted) return false;
                attempted = true;
                if (!alive(state) || !resolved.every((item) => exactlyTrue(item.adapter.current(item.ref)))) return false;
                if (!exactlyTrue(admission(authority)) || !fence()) return false;
                admitted = true;
                return true;
              });
              if (result !== true) void Promise.resolve(result).catch(() => undefined);
              return wasAdmitted() && result === true;
            } finally {
              accepting = false;
            }
          };
          const ticket: ResourceOperationTicket = Object.freeze({ kind: "resource-operation" });
          tickets.set(ticket, state);
          return ticket;
        } catch {
          return undefined;
        } finally {
          state.settled = true;
          if (state.commit === undefined || !alive(state)) release(state);
          settled.resolve(undefined);
        }
      };
      void work().then(result.resolve, () => {
        result.resolve(undefined);
      });
      return Object.freeze({ ticket: result.promise, settled: settled.promise });
    },
    commit(ticket: ResourceOperationTicket, admission: (authority: ResourceOperationAuthority) => boolean): boolean {
      const state = tickets.get(ticket);
      if (state === undefined || state.consumed || state.commit === undefined || !alive(state)) return false;
      state.consumed = true;
      try {
        return state.commit(admission);
      } catch {
        return false;
      } finally {
        release(state);
      }
    },
    cancel(ticket: ResourceOperationTicket) {
      const state = tickets.get(ticket);
      if (state !== undefined) {
        state.cancel();
      }
    },
    dispose() {
      closed = true;
      for (const state of pending) {
        state.controller.abort();
        release(state);
      }
    },
    stats: () => ({ active: pending.size }),
  });
}

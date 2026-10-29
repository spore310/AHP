import type { BindingQuery, GrantIssueRequest, GrantRevocation, PolicyRef, PreparedGrant, ScopedPolicyBinding } from "../../types";
import type { ScopedBindingSnapshot } from "../bindings/types";
import { sameActor, sameResource } from "../context";
import { capturePlainJson, policyRefSchema, resourceRefSchema, trustedRequestContextSchema } from "../validation";
import { DEFAULT_GRANT_LIMITS, MAX_GRANT_LIMITS } from "./constants";
import { approvalSchema, callable, issueSchema, revokeSchema, ruleSchema, targetSchema } from "./types";
import type { BoundGrantContext, CanonicalGrantPort, CapturedGrantBasis, GrantAssignmentCeiling, GrantControlFacts, GrantControlRequest, GrantMutationSlot, GrantService, GrantServiceLimits, GrantServiceOptions, RegisteredGrantControlRule } from "./types";

const unavailable: () => never = () => {
  throw new Error("Grant authority unavailable.");
};
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
const refKey = (ref: PolicyRef): string => `${ref.id}\u0000${String(ref.revision)}`;
const sameRef = (a: PolicyRef, b: PolicyRef): boolean => a.id === b.id && a.revision === b.revision;
const contains = (refs: readonly PolicyRef[], ref: PolicyRef): boolean => refs.some((item) => sameRef(item, ref));
const guard = (callback: () => unknown): boolean => {
  try {
    const value = callback();
    if (value !== null && typeof value === "object") void Promise.resolve(value).catch(() => undefined);
    return value === true;
  } catch {
    return false;
  }
};
const capture = <T>(value: T, maxBytes: number): T => {
  const active = new Set<object>();
  let units = 0;
  let keys = 0;
  const detach = (item: unknown, depth: number): unknown => {
    units += typeof item === "string" ? item.length + 2 : 1;
    if (units > maxBytes || depth > 8 || keys > 8192) unavailable();
    if (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) return item;
    if (typeof item !== "object" || active.has(item) || Object.getOwnPropertySymbols(item).length > 0) unavailable();
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) unavailable();
    const names = Object.getOwnPropertyNames(item).filter((name) => !(array && name === "length"));
    if (array && Object.getOwnPropertyDescriptor(item, "length")?.value !== names.length) unavailable();
    keys += names.length;
    if (keys > 8192) unavailable();
    active.add(item);
    const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
    for (const name of names) {
      units += name.length + 3;
      if (units > maxBytes || (array && (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= names.length))) unavailable();
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) unavailable();
      Object.defineProperty(output, name, { value: detach(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    active.delete(item);
    return output;
  };
  // Detach each occurrence so ordinary shared PolicyRef/actor values are accepted,
  // without invoking getters or serializing an unbounded graph first.
  const detached = detach(value, 0);
  if (!capturePlainJson(detached, { maxBytes, maxDepth: 8, maxKeys: 8192 })) unavailable();
  return freeze(detached as T);
};
const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;
const readLimits = (input: GrantServiceOptions["limits"]): GrantServiceLimits => {
  const result: Record<keyof GrantServiceLimits, number> = { ...DEFAULT_GRANT_LIMITS };
  for (const key of Object.keys(result) as Array<keyof GrantServiceLimits>) {
    const candidate = input?.[key];
    const value = candidate === undefined ? result[key] : candidate;
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_GRANT_LIMITS[key]) throw new Error("Invalid grant limit.");
    result[key] = value;
  }
  return Object.freeze(result);
};

/** One registry-owned service; all returned issuer handles share its bounded work pool. */
export const buildGrantService = (options: GrantServiceOptions, port: CanonicalGrantPort): GrantService => {
  const usesRegistry = options.sessions.usesRegistry.bind(options.sessions);
  const isReady = options.sessions.isReady.bind(options.sessions);
  if (!guard(() => usesRegistry(port.registry))) throw new Error("Grant registry identity mismatch.");
  const limits = readLimits(options.limits);
  const resolveTarget = options.resolveTarget.bind(options);
  const sourceRules = options.rules;
  const isArray: boolean = Array.isArray(sourceRules);
  if (!isArray || sourceRules.length > limits.maxRegisteredRules) unavailable();
  const rules = new Map<string, RegisteredGrantControlRule>();
  for (const source of sourceRules) {
    const prepare = source.prepare.bind(source);
    const { ref, issuerKinds, root, delegated, assign, revoke } = source;
    const data = ruleSchema.parse(capture({ ref, issuerKinds, ...(root === undefined ? {} : { root }), ...(delegated === undefined ? {} : { delegated }),
      ...(assign === undefined ? {} : { assign }), ...(revoke === undefined ? {} : { revoke }) }, limits.maxMutationInputBytes));
    if (rules.has(refKey(data.ref)) || !unique(data.issuerKinds) || (data.root === undefined && data.delegated !== true)) unavailable();
    // Root anchors are explicitly registered grant-control facts, not tool-use permissions.
    const referenced = data.assign?.policies ?? [];
    if (referenced.some((item) => !port.policyKnown(item))) unavailable();
    if (data.assign !== undefined && (!unique(data.assign.roles) || !unique(data.assign.policies.map(refKey)) || !unique(data.assign.childRules.map(refKey)))) unavailable();
    rules.set(refKey(data.ref), freeze({ ...data, prepare }));
  }
  for (const rule of rules.values()) for (const ref of rule.assign?.childRules ?? []) if (!rules.has(refKey(ref))) unavailable();

  let disposed = false;
  const isDisposed = (): boolean => disposed;
  const slots = new Set<GrantMutationSlot>();
  const receipts = new WeakMap<PreparedGrant, { readonly slot: GrantMutationSlot; readonly basis: CapturedGrantBasis;
    readonly binding: ScopedPolicyBinding; readonly control: GrantControlFacts; readonly bound: BoundGrantContext; }>();
  const retire = (slot: GrantMutationSlot): void => {
    if (slot.closed && slot.work === 0) slots.delete(slot);
  };
  const runRelease = (slot: GrantMutationSlot, release: () => unknown): void => {
    slot.work += 1;
    void Promise.resolve().then(release).catch(() => undefined).finally(() => {
      slot.work -= 1;
      retire(slot);
    });
  };
  const ownResult = (slot: GrantMutationSlot, value: unknown): void => {
    if (value === null || typeof value !== "object" || !("release" in value)) return;
    const release = callable.parse(value.release).bind(value);
    let released = false;
    const once = (): unknown => {
      if (released) return;
      released = true;
      return release();
    };
    if (slot.closed) runRelease(slot, once);
    else slot.releases.push(once);
  };
  const close = (slot: GrantMutationSlot): void => {
    if (slot.closed) return;
    slot.closed = true;
    if (slot.timer !== undefined) clearTimeout(slot.timer);
    slot.signal.removeEventListener("abort", slot.abort);
    slot.reject(new Error("Grant preparation cancelled."));
    slot.controller.abort();
    for (const release of slot.releases.splice(0)) runRelease(slot, release);
    retire(slot);
  };
  const arm = (slot: GrantMutationSlot, time: number): void => {
    if (slot.timer !== undefined) clearTimeout(slot.timer);
    if (!Number.isFinite(time) || time >= slot.deadline) {
      close(slot);
      unavailable();
    }
    slot.timer = setTimeout(() => {
      close(slot);
    }, slot.deadline - time);
  };
  const reserve = (bound: BoundGrantContext, time: number): GrantMutationSlot => {
    if (disposed || bound.signal.aborted || !Number.isFinite(time) || time >= bound.validUntil
      || slots.size >= limits.maxPendingMutations || [...slots].filter((slot) => sameActor(slot.actor, bound.context.actor)).length >= limits.maxPendingPerActor) unavailable();
    let reject: (error: Error) => void = () => undefined;
    const aborted = new Promise<never>((_resolve, no) => {
      reject = no;
    });
    void aborted.catch(() => undefined);
    const slot: GrantMutationSlot = { actor: bound.context.actor, controller: new AbortController(), signal: bound.signal,
      abort: () => {
        close(slot);
      }, aborted, reject, guards: [bound.isCurrent.bind(bound)], releases: [], work: 0, closed: false,
      deadline: Math.min(bound.validUntil, time + limits.prepareDeadlineMs) };
    slots.add(slot);
    bound.signal.addEventListener("abort", slot.abort, { once: true });
    arm(slot, time);
    return slot;
  };
  const invoke = async <T>(slot: GrantMutationSlot, callback: () => Promise<T>): Promise<T> => {
    slot.work += 1;
    const pending = Promise.resolve().then(() => {
      if (slot.closed || disposed) unavailable();
      return callback();
    }).then((value) => {
      ownResult(slot, value);
      return value;
    }).finally(() => {
      slot.work -= 1;
      retire(slot);
    });
    return Promise.race([pending, slot.aborted]);
  };
  const isClosed = (slot: GrantMutationSlot): boolean => disposed || slot.closed || slot.signal.aborted;
  const current = (slot: GrantMutationSlot, root: CapturedGrantBasis["root"], ready: boolean): number => {
    const time = port.now();
    if (isClosed(slot) || !slot.guards.every(guard)) unavailable();
    if (!Number.isFinite(time) || time >= slot.deadline || (ready && !guard(() => isReady(root)))) unavailable();
    if (isClosed(slot)) unavailable();
    return time;
  };
  const rootAuthorized = (rule: RegisteredGrantControlRule, basis: CapturedGrantBasis): boolean => {
    if (!rule.issuerKinds.includes(basis.parent.actor.kind)) return false;
    if (basis.parent.authority.kind === "host-policy") {
      const root = rule.root;
      return root !== undefined && sameRef(root.authorityPolicy, basis.parent.authority.policy)
        && root.requiredPolicies.every((ref) => contains(basis.parent.policies, ref))
        && (root.mode === "direct" || root.anyOf.some((role) => basis.parent.roles.includes(role)));
    }
    return rule.delegated === true && basis.controls?.service === port.identity && contains(basis.controls.ceiling.childRules, rule.ref);
  };
  const effectiveCeiling = (rule: RegisteredGrantControlRule, basis: CapturedGrantBasis): GrantAssignmentCeiling => {
    if (rule.assign === undefined || !rootAuthorized(rule, basis)) unavailable();
    const direct = rule.assign;
    const inherited = basis.controls?.ceiling;
    if (basis.parent.authority.kind === "host-policy") return direct;
    if (inherited === undefined) unavailable();
    return freeze({ actorKinds: direct.actorKinds.filter((kind) => inherited.actorKinds.includes(kind)),
      roles: direct.roles.filter((role) => inherited.roles.includes(role) && basis.parent.roles.includes(role)),
      policies: direct.policies.filter((ref) => contains(inherited.policies, ref) && contains(basis.parent.policies, ref)),
      scope: direct.scope === "same" || inherited.scope === "same" ? "same" : "descendant",
      maxLifetimeMs: Math.min(direct.maxLifetimeMs, inherited.maxLifetimeMs), maxDepth: Math.min(direct.maxDepth, inherited.maxDepth),
      childRules: direct.childRules.filter((ref) => contains(inherited.childRules, ref)),
    });
  };
  const approve = async (slot: GrantMutationSlot, rule: RegisteredGrantControlRule, request: GrantControlRequest): Promise<void> => {
    const value = await invoke(slot, () => rule.prepare({ request, signal: slot.controller.signal }));
    const approval = approvalSchema.parse(value);
    if (approval.request !== request) unavailable();
    slot.guards.push(approval.isCurrent.bind(value));
    slot.deadline = Math.min(slot.deadline, approval.validUntil);
    arm(slot, port.now());
  };

  const readBindings = port.registry.readBindings.bind(port.registry);
  const snapshotCurrent = (snapshot: ScopedBindingSnapshot, identityGuard: () => boolean): boolean => {
    try {
      const time = port.now();
      if (disposed || !Number.isFinite(time) || !guard(identityGuard)) return false;
      const root = port.root(snapshot.scope, time);
      return guard(() => isReady(root)) && !isDisposed() && port.snapshotCurrent(snapshot, time);
    } catch {
      return false;
    }
  };
  return Object.freeze({
    isBindingSnapshotCurrent: snapshotCurrent,
    bindings: { read: (query: BindingQuery) => {
      try {
        if (disposed) unavailable();
        const snapshot = readBindings(query);
        if (query.grantRevision !== snapshot.grantRevision || !snapshotCurrent(snapshot, () => true)) unavailable();
        return Promise.resolve(snapshot.bindings);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("Grant authority unavailable."));
      }
    } },
    issuer(input: BoundGrantContext) {
      const context = freeze(trustedRequestContextSchema.parse(capture(input.context, limits.maxMutationInputBytes)));
      const ruleRef = freeze(policyRefSchema.parse(capture(input.rule, limits.maxMutationInputBytes)));
      const scope = freeze(resourceRefSchema.parse(capture(input.scope, limits.maxMutationInputBytes)));
      if (context.connectionId !== input.connectionId || !Number.isSafeInteger(input.connectionGeneration) || input.connectionGeneration < 1
        || !Number.isFinite(input.validUntil)) unavailable();
      const bound: BoundGrantContext = Object.freeze({ context, connectionId: input.connectionId, connectionGeneration: input.connectionGeneration,
        validUntil: input.validUntil, signal: input.signal, rule: ruleRef, basis: input.basis, scope,
        ...(input.revokeTarget === undefined ? {} : { revokeTarget: input.revokeTarget }), isCurrent: input.isCurrent.bind(input) });
      const rule = rules.get(refKey(ruleRef));
      if (rule === undefined || disposed) unavailable();
      return Object.freeze({
        async prepare(input: GrantIssueRequest) {
          const intent = issueSchema.parse(capture(input, limits.maxMutationInputBytes));
          const started = port.now();
          const basis = port.capture(bound, started);
          const ceiling = effectiveCeiling(rule, basis);
          if (!sameActor(intent.issuer, context.actor) || !sameResource(intent.scope, scope) || intent.actor.principal.domainId !== scope.domainId
            || intent.authority.kind !== "delegation" || intent.authority.parentGrantId !== basis.parent.id || !sameActor(intent.authority.issuer, context.actor)
            || intent.delegationDepth !== basis.ancestors.length || intent.delegationDepth > ceiling.maxDepth
            || !ceiling.actorKinds.includes(intent.actor.kind) || !unique(intent.roles) || !unique(intent.policies.map(refKey))
            || intent.roles.some((role) => !ceiling.roles.includes(role)) || intent.policies.some((ref) => !contains(ceiling.policies, ref))
            || (basis.admitted !== undefined && intent.policies.some((ref) => !contains(basis.admitted ?? [], ref)))
            || (ceiling.scope === "same" && !sameResource(scope, basis.parent.scope)) || !port.capacity(basis, intent.actor, limits)) unavailable();
          const maximumExpiry = Math.min(started + Math.min(ceiling.maxLifetimeMs, limits.maxGrantLifetimeMs),
            ...basis.ancestors.flatMap((binding) => binding.expiresAt === undefined ? [] : [Date.parse(binding.expiresAt)]));
          const expiry = intent.expiresAt === undefined ? maximumExpiry : Date.parse(intent.expiresAt);
          if (!Number.isFinite(expiry) || expiry <= started || expiry > maximumExpiry) unavailable();
          const request: GrantIssueRequest = freeze({ ...intent, expiresAt: new Date(expiry).toISOString() });
          const slot = reserve(bound, started);
          try {
            const rawTarget = await invoke(slot, () => resolveTarget(request.actor, slot.controller.signal));
            const target = targetSchema.parse(rawTarget);
            if (!sameActor(target.actor, request.actor)) unavailable();
            slot.guards.push(target.isCurrent.bind(rawTarget));
            slot.deadline = Math.min(slot.deadline, target.validUntil);
            arm(slot, port.now());
            if (!port.basisCurrent(basis, current(slot, basis.root, false))) unavailable();
            const approvalRequest = freeze({ rule: rule.ref, context, scope, issuerBinding: basis.parent, request });
            await approve(slot, rule, approvalRequest);
            if (!port.basisCurrent(basis, current(slot, basis.root, true))) unavailable();
            const prepared: PreparedGrant = freeze({ id: globalThis.crypto.randomUUID(), instanceId: scope.instanceId, revision: 1, request });
            const binding: ScopedPolicyBinding = freeze({ id: prepared.id, actor: request.actor, scope, roles: request.roles, policies: request.policies,
              authority: request.authority, revision: 1, expiresAt: request.expiresAt });
            const control: GrantControlFacts = freeze({ service: port.identity, ceiling,
              ...(rule.revoke === undefined ? {} : { revokeRelation: rule.revoke.relation }) });
            slot.receipt = prepared;
            receipts.set(prepared, { slot, basis, binding, control, bound });
            return prepared;
          } catch (error) {
            close(slot);
            throw error;
          }
        },
        commit(prepared: PreparedGrant) {
          const entry = receipts.get(prepared);
          if (entry === undefined || entry.bound !== bound || entry.slot.closed || entry.slot.receipt !== prepared) unavailable();
          try {
            const time = current(entry.slot, entry.basis.root, true);
            if (!port.commit(entry.basis, entry.binding, entry.control, limits, time)) unavailable();
            close(entry.slot);
            port.drain();
            return entry.binding;
          } catch (error) {
            close(entry.slot);
            throw error;
          }
        },
        rollback(prepared: PreparedGrant) {
          const entry = receipts.get(prepared);
          if (entry?.bound === bound) close(entry.slot);
        },
        async revoke(input: GrantRevocation) {
          const request = freeze(revokeSchema.parse(capture(input, limits.maxMutationInputBytes)));
          const started = port.now();
          const basis = port.capture(bound, started);
          const branch = rule.revoke;
          if (branch === undefined || !rootAuthorized(rule, basis) || basis.target === undefined
            || !sameActor(request.issuer, context.actor) || request.grantId !== basis.target.id || request.instanceId !== scope.instanceId
            || (branch.scope === "same" && !sameResource(scope, basis.parent.scope))
            || (branch.relation === "issued" && !basis.targetIssuedByBasis)
            || (branch.relation === "descendants" && !basis.targetDescendsFromBasis)) unavailable();
          if (basis.parent.authority.kind === "delegation") {
            const inherited = basis.controls?.revokeRelation;
            if (inherited === undefined || (basis.controls?.ceiling.scope === "same" && !sameResource(scope, basis.parent.scope))
              || (inherited === "issued" && !basis.targetIssuedByBasis)
              || (inherited === "descendants" && !basis.targetDescendsFromBasis)) unavailable();
          }
          const slot = reserve(bound, started);
          try {
            await approve(slot, rule, freeze({ rule: rule.ref, context, scope, issuerBinding: basis.parent, request }));
            const time = current(slot, basis.root, false);
            if (!port.revoke(basis, time)) unavailable();
          } finally {
            close(slot);
            port.drain();
          }
        },
      });
    },
    sweep: () => {
      if (!disposed) {
        port.sweep(limits.maxCleanupRoots, port.now());
        port.drain();
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const slot of slots) close(slot);
      port.dispose();
      port.drain();
    },
  });
};

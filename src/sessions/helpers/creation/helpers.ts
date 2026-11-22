import { randomUUID } from "node:crypto";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { POLICY_LIMIT_ABSOLUTE, POLICY_LIMIT_DEFAULTS, identifierSchema, policyRefSchema, policyScopeRulesSchema, resourceRefSchema, roleNameSchema, trustedRequestContextSchema, type BindingInstallationToken, type ReferenceAuthorizer, type ResourceRef, type ResourceInstallationToken, type ResourceRegistration, type ScopedPolicyBinding } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { DEFAULT_DECISION_TTL_MS } from "@authorization/helpers/evaluate/constants";
import { createSessionParamsSchema } from "@sessions/createSession/types";
import { SessionsError } from "@sessions/helpers/errors";
import type { SessionApplicationOptions } from "@sessions/helpers/application/types";
import type { ResolvedSessionType } from "@sessions/helpers/sessionTypes/types";
import type { SessionRecord, SessionsDependencies } from "@sessions/types";

import { BOOTSTRAP_LIFETIME_DEFAULT_MS, BOOTSTRAP_LIFETIME_MAX_MS, CREATION_COUNT_DEFAULT, CREATION_COUNT_MAX, CREATION_INPUT_BYTES } from "./constants";
import type { SessionCreationContext, SessionCreationFacts, SessionCreationSecurityOptions, SessionFactoryAuthorization, SessionRecordOwnership, SessionTypePolicyRegistration } from "./types";

export const freezeCreation = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeCreation(item);
  }
  return value;
};
function unavailable(): never {
  throw new SessionsError(JsonRpcErrorCodes.InvalidRequest, "Protected session creation unavailable.");
}
const budget = (value: number | undefined, fallback: number, max: number): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new Error("Invalid creation limit.");
  return result;
};

/** Count JSON bytes before parsing/copying, with finite depth/work and no coercion hooks. */
export const captureCreationJson = <T>(value: T, limit = CREATION_INPUT_BYTES): T => {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const add = (amount: number): void => {
    bytes += amount;
    if (bytes > limit) unavailable();
  };
  const text = (input: string): void => {
    if (Buffer.byteLength(input) > limit) unavailable();
    add(Buffer.byteLength(JSON.stringify(input)));
  };
  const visit = (input: unknown, depth: number): void => {
    nodes += 1;
    if (depth > 64 || nodes > limit) unavailable();
    if (input === null || typeof input === "boolean") {
      add(input === null ? 4 : input ? 4 : 5);
      return;
    }
    if (typeof input === "string") {
      text(input);
      return;
    }
    if (typeof input === "number" && Number.isFinite(input)) {
      add(String(input).length);
      return;
    }
    if (typeof input !== "object" || seen.has(input)) unavailable();
    seen.add(input);
    if (Array.isArray(input)) {
      if (input.length > limit) unavailable();
      add(2 + Math.max(0, input.length - 1));
      for (const entry of input) visit(entry, depth + 1);
    } else {
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) unavailable();
      const keys = Object.keys(input);
      add(2 + Math.max(0, keys.length - 1));
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || ["__proto__", "constructor", "prototype"].includes(key)) unavailable();
        text(key);
        add(1);
        visit(descriptor.value, depth + 1);
      }
    }
    seen.delete(input);
  };
  visit(value, 0);
  return structuredClone(value);
};
const revision = z.number().int().min(1).max(2147483647);
const templateEntrySchema = z.strictObject({ key: identifierSchema, purpose: z.enum(["admitted", "mandatory"]),
  roles: z.array(roleNameSchema).max(POLICY_LIMIT_DEFAULTS.maxRoles), policies: z.array(policyRefSchema).min(1).max(POLICY_LIMIT_DEFAULTS.maxPolicyRefs),
  authority: z.strictObject({ kind: z.literal("host-policy"), policy: policyRefSchema }), maxLifetimeMs: z.number().int().positive().max(BOOTSTRAP_LIFETIME_MAX_MS),
});
const policyDataSchema = z.strictObject({ rules: policyScopeRulesSchema,
  capability: z.strictObject({ key: identifierSchema, revision }),
  creatorBootstrap: z.strictObject({ id: identifierSchema, revision, bindings: z.array(templateEntrySchema).min(1).max(CREATION_COUNT_MAX) }).optional(),
});
export const captureCreationPolicy = (policy: SessionTypePolicyRegistration): SessionTypePolicyRegistration => {
  if ((policy.creatorBootstrap?.bindings.length ?? 0) > CREATION_COUNT_MAX) unavailable();
  const data = policyDataSchema.parse(captureCreationJson({ rules: policy.rules, capability: policy.creation.capability,
    ...(policy.creatorBootstrap === undefined ? {} : { creatorBootstrap: policy.creatorBootstrap }),
  }));
  return freezeCreation({ rules: data.rules, ...(data.creatorBootstrap === undefined ? {} : { creatorBootstrap: data.creatorBootstrap }),
    creation: { capability: data.capability, prepare: policy.creation.prepare.bind(policy.creation) },
  });
};

/** Captured before registryFactory/provider parsers or any admission mutation. */
export const captureCreationSecurity = (options: SessionCreationSecurityOptions | undefined) => {
  if (options === undefined) return undefined;
  const coherent: unknown = options.registry.usesPolicyFactory(options.policies);
  if (coherent !== true) throw new Error("Creation compiler identity mismatch.");
  const source = options.registry;
  return Object.freeze({
    originalRegistry: source,
    registry: { owner: source.owner.bind(source), installAdmissions: source.installAdmissions.bind(source), installResource: source.installResource.bind(source),
      installBinding: source.installBinding.bind(source),
      prepareResourceInstallation: source.prepareResourceInstallation.bind(source), prepareBindingInstallation: source.prepareBindingInstallation.bind(source),
      isResourceInstallationCurrent: source.isResourceInstallationCurrent.bind(source), isBindingInstallationCurrent: source.isBindingInstallationCurrent.bind(source),
      removeInstalledBinding: source.removeInstalledBinding.bind(source), teardownInstalledResource: source.teardownInstalledResource.bind(source) },
    policies: options.policies,
    deadline: budget(options.prepareDeadlineMs, POLICY_LIMIT_DEFAULTS.asyncHookDeadlineMs, POLICY_LIMIT_ABSOLUTE.asyncHookDeadlineMs),
    pending: budget(options.maxPendingCreates, CREATION_COUNT_DEFAULT, CREATION_COUNT_MAX),
    settling: budget(options.maxSettlingSessions, CREATION_COUNT_DEFAULT, CREATION_COUNT_MAX),
    bindings: budget(options.maxBootstrapBindings, CREATION_COUNT_DEFAULT, CREATION_COUNT_MAX),
    lifetime: budget(options.maxBootstrapLifetimeMs, BOOTSTRAP_LIFETIME_DEFAULT_MS, BOOTSTRAP_LIFETIME_MAX_MS),
    bytes: budget(options.maxCreationInputBytes, CREATION_INPUT_BYTES, CREATION_INPUT_BYTES),
  });
};
export type CapturedCreationSecurity = NonNullable<ReturnType<typeof captureCreationSecurity>>;
const samePolicy = (a: { id: string; revision: number }, b: { id: string; revision: number }) => a.id === b.id && a.revision === b.revision;
export const validateCreationRegistrations = (security: CapturedCreationSecurity, application: SessionApplicationOptions | undefined): void => {
  if (application === undefined || application.role !== undefined || application.authorizedTools !== undefined) throw new Error("Protected creation requires typed, non-role configuration.");
  const admissions: Array<{ sessionType: { key: string; version: number }; providerId: string }> = [];
  for (const definition of application.catalogue.list()) {
    const resolved = application.catalogue.resolveExisting(definition);
    const policy = resolved.policy;
    if (policy === undefined) continue;
    const actual = security.policies.forSessionType(definition, definition.providerId);
    if (JSON.stringify(policy.rules) !== JSON.stringify(actual)) throw new Error("Creation admission mismatch.");
    const ceiling = [...actual.admitted.policies];
    for (const namespace of actual.admitted.namespaces) {
      const found = security.policies.inspect().namespaces.find((item) => item.name === namespace.name && item.revision === namespace.revision);
      if (found === undefined) throw new Error("Unknown creation namespace.");
      ceiling.push(...found.expanded);
    }
    const entries = policy.creatorBootstrap?.bindings ?? [];
    if (entries.length > security.bindings || new Set(entries.map((entry) => entry.key)).size !== entries.length) throw new Error("Invalid bootstrap entries.");
    for (const entry of entries) {
      const allowed = entry.purpose === "admitted" ? ceiling : actual.mandatory;
      if (new Set(entry.roles).size !== entry.roles.length || new Set(entry.policies.map((ref) => `${ref.id}@${String(ref.revision)}`)).size !== entry.policies.length
        || entry.maxLifetimeMs > security.lifetime || !entry.policies.some((ref) => samePolicy(ref, entry.authority.policy))
        || entry.policies.some((ref) => security.policies.getPolicy(ref) === undefined || !allowed.some((item) => samePolicy(item, ref)))) throw new Error("Invalid bootstrap policy ceiling.");
    }
    admissions.push({ sessionType: { key: definition.key, version: definition.version }, providerId: definition.providerId });
  }
  // The canonical registry stages the entire cohort and its aggregate capacity atomically.
  security.registry.installAdmissions(admissions);
};

interface PreparedRecord { readonly record: SessionRecord; readonly config: Readonly<Record<string, unknown>>; readonly workingDirectories: readonly string[] }
interface CreationHooks {
  prepare(params: unknown): PreparedRecord;
  publish(record: SessionRecord): void;
  start(prepared: PreparedRecord, beforeFailure: () => void): Promise<void>;
  changed(): void;
  isStopping(): boolean;
}
interface Pending { readonly ref: SessionCreationFacts["candidate"]; readonly cancel: () => void }
const live = (check: () => unknown): boolean => {
  try {
    const result = check();
    if (result instanceof Promise) void result.catch(() => undefined);
    return result === true;
  } catch {
    return false;
  }
};
const releaseFor = (value: unknown): (() => void) => {
  let done = false;
  let drop = (): void => undefined;
  try {
    if (value !== null && typeof value === "object" && "release" in value && typeof value.release === "function") {
      const captured = z.custom<() => unknown>((method) => typeof method === "function").parse(value.release).bind(value);
      drop = () => {
        const result = captured();
        if (result instanceof Promise) void result.catch(() => undefined);
      };
    }
  } catch { /* A malformed result cannot authorize attachment. */ }
  return () => {
    if (done) return;
    done = true;
    try {
      drop();
    } catch { /* Cleanup cannot undo a committed record or strand cancellation. */ }
  };
};
const fn = z.custom<() => boolean>((value) => typeof value === "function");
const releaseSchema = z.custom<() => void>((value) => typeof value === "function");

export const createSessionAuthorization = (dependencies: SessionsDependencies, security: CapturedCreationSecurity, hooks: CreationHooks) => {
  const pending = new Map<string, Pending>();
  // A cancelled reservation is gone, but its uncooperative callback still owns capacity.
  let outstandingPreparations = 0;
  const settling = new Map<string, { readonly ref: SessionCreationFacts["candidate"]; readonly token: object }>();
  const receipts = new WeakMap<SessionRecord, SessionRecordOwnership>();
  let epoch = 0;
  const now = (): number => {
    const value = dependencies.now().getTime();
    if (!Number.isFinite(value)) unavailable();
    return value;
  };
  const teardown = (record: SessionRecord): void => {
    const receipt = receipts.get(record);
    if (receipt === undefined) return;
    security.registry.teardownInstalledResource(receipt.resource);
    receipts.delete(record);
  };
  const withdraw = (record: SessionRecord): void => {
    const receipt = receipts.get(record);
    if (receipt === undefined) return;
    for (const binding of receipt.bootstrap) security.registry.removeInstalledBinding(binding);
    receipt.bootstrap = [];
  };
  const ownedResource = (record: SessionRecord | undefined): SessionCreationFacts["candidate"] | undefined => {
    if (record === undefined) return undefined;
    const receipt = receipts.get(record);
    if (receipt === undefined || record.resource !== receipt.ref) return undefined;
    const current: unknown = security.registry.isResourceInstallationCurrent(receipt.resource);
    return current === true ? receipt.ref : undefined;
  };
  const authorization: SessionFactoryAuthorization = Object.freeze({
    usesRegistry: (registry: ReferenceAuthorizer) => registry === security.originalRegistry,
    isReady: (expected: ResourceRef<"session">) => {
      const record = dependencies.sessions.get(expected.id);
      const lifecycle: string | undefined = record?.state.lifecycle;
      if (record === undefined || record.resource === undefined || !sameResource(record.resource, expected)
        || lifecycle !== "ready" || record.backend === undefined || hooks.isStopping() || settling.has(expected.id)) return false;
      return ownedResource(record) !== undefined;
    },
    getResource: (uri: string) => ownedResource(dependencies.sessions.get(uri)),
    isSettling: (uri: string) => settling.has(uri),
    disposeSession: async (input: SessionCreationFacts["candidate"]): Promise<boolean> => {
      const expected = freezeCreation(resourceRefSchema.parse(input));
      const reservation = pending.get(expected.id);
      if (reservation !== undefined && sameResource(reservation.ref, expected)) {
        reservation.cancel();
        return true;
      }
      const record = dependencies.sessions.get(expected.id);
      if (record?.resource === undefined || !sameResource(record.resource, expected)) return false;
      if (settling.size >= security.settling) unavailable();
      const marker = { ref: record.resource, token: {} };
      settling.set(expected.id, marker);
      try {
        dependencies.sessions.delete(expected.id);
        teardown(record);
        dependencies.emitCatalogueNotification({ method: "root/sessionRemoved", params: { channel: "ahp-root://", session: expected.id } });
        hooks.changed();
        if (record.backend !== undefined) {
          try {
            await record.backend.dispose();
          } catch {
            throw new SessionsError(JsonRpcErrorCodes.InternalError, "Session backend failed to dispose.");
          }
        }
        return true;
      } finally {
        if (settling.get(expected.id) === marker) settling.delete(expected.id);
      }
    },
    createSession: async (raw: unknown, caller: SessionCreationContext): Promise<void> => {
      const captured = captureCreationJson(raw, security.bytes);
      const params = createSessionParamsSchema.parse(captured);
      const context = freezeCreation(trustedRequestContextSchema.parse(caller.context));
      const ref = freezeCreation({ domainId: context.actor.principal.domainId, kind: "session" as const, id: params.channel, instanceId: randomUUID() });
      resourceRefSchema.parse(ref); // Accepted default URI/resource bound before parsers, reservation and authority callbacks.
      const connectionId = caller.connectionId;
      const generation = caller.connectionGeneration;
      const check = caller.isCurrent.bind(caller);
      const deadline = caller.validUntil;
      const signal = caller.signal;
      const callerAborted = (): boolean => signal.aborted;
      if (context.connectionId !== connectionId || !Number.isSafeInteger(generation) || generation < 1
        || (context.actor.kind === "agent" && (!Number.isSafeInteger(context.agentGeneration) || (context.agentGeneration ?? 0) < 1))
        || !Number.isFinite(deadline) || now() >= deadline || !(signal instanceof AbortSignal) || callerAborted() || !live(check) || hooks.isStopping()) unavailable();
      const initial = hooks.prepare(params);
      const initialBinding = initial.record.application;
      if (initialBinding === undefined || dependencies.application === undefined) unavailable();
      const binding = freezeCreation({ ...initialBinding, config: captureCreationJson(initialBinding.config, security.bytes) });
      const prepared = { ...initial, config: freezeCreation(captureCreationJson(initial.config, security.bytes)), record: { ...initial.record, application: binding } };
      const resolved: ResolvedSessionType = dependencies.application.catalogue.resolveForCreation(binding);
      const policy = resolved.policy;
      if (policy === undefined) unavailable();
      const preparedAt = now();
      if (!live(check) || callerAborted() || hooks.isStopping() || preparedAt >= deadline) unavailable();
      if (pending.has(ref.id) || settling.has(ref.id) || dependencies.sessions.has(ref.id) || pending.size >= security.pending || outstandingPreparations >= security.pending || security.registry.owner(ref) !== undefined) unavailable();
      const started = preparedAt;
      const attemptEpoch = epoch;
      const controller = new AbortController();
      let cancelled = false;
      const wasCancelled = (): boolean => cancelled;
      let committed = false;
      let release = (): void => undefined;
      let rejectWait: (error: Error) => void = () => undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectWait = reject;
      });
      const reservation: Pending = { ref, cancel: () => {
        if (cancelled || committed) return;
        cancelled = true;
        if (pending.get(ref.id) === reservation) pending.delete(ref.id);
        controller.abort();
        rejectWait(new SessionsError(JsonRpcErrorCodes.InvalidRequest, "Session creation cancelled."));
      } };
      pending.set(ref.id, reservation);
      signal.addEventListener("abort", reservation.cancel, { once: true });
      const timer = setTimeout(reservation.cancel, Math.min(security.deadline, Math.max(1, deadline - started)));
      const cleanup = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", reservation.cancel);
      };
      try {
        const request: SessionCreationFacts = freezeCreation({ attemptId: randomUUID(), caller: context, connectionGeneration: generation,
          candidate: ref, type: { id: resolved.definition.id, key: resolved.definition.key, version: resolved.definition.version, providerId: resolved.definition.providerId },
          capability: policy.creation.capability, rules: policy.rules, ...(policy.creatorBootstrap === undefined ? {} : { bootstrap: policy.creatorBootstrap }),
          config: captureCreationJson(binding.config, security.bytes), workingDirectories: [...prepared.workingDirectories],
        });
        outstandingPreparations += 1;
        const promise = Promise.resolve().then(() => {
          if (cancelled || controller.signal.aborted) unavailable();
          return policy.creation.prepare({ request, signal: controller.signal });
        }).finally(() => {
          // Settlement only: never reset this count on cancel, dispose or factory reuse.
          outstandingPreparations -= 1;
        }).then((value) => {
          const ownedRelease = releaseFor(value);
          if (cancelled) ownedRelease();
          else release = ownedRelease;
          return value;
        });
        const value = await Promise.race([promise, aborted]);
        if (value.effect === "allow" && value.bootstrap.kind === "template" && value.bootstrap.bindings.length > security.bindings) unavailable();
        const approval = z.strictObject({ effect: z.literal("allow"), request: z.custom<SessionCreationFacts>((item) => item === request),
          bootstrap: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("none") }), z.strictObject({ kind: z.literal("template"), id: identifierSchema, revision,
            bindings: z.array(z.strictObject({ key: identifierSchema, lifetimeMs: z.number().int().positive() })).max(security.bindings),
          })]), validUntil: z.number(), isCurrent: fn, release: releaseSchema,
        }).parse(value);
        if (approval.validUntil > started + DEFAULT_DECISION_TTL_MS) unavailable();
        const template = policy.creatorBootstrap;
        const approved = approval.bootstrap;
        if (template === undefined
          ? approved.kind !== "none"
          : approved.kind !== "template" || approved.id !== template.id || approved.revision !== template.revision
            || approved.bindings.length !== template.bindings.length || new Set(approved.bindings.map((item) => item.key)).size !== template.bindings.length) unavailable();
        const bindings: ScopedPolicyBinding[] = [];
        for (const entry of template?.bindings ?? []) {
          const match = approved.kind === "template" ? approved.bindings.find((item) => item.key === entry.key) : undefined;
          if (match === undefined || match.lifetimeMs > entry.maxLifetimeMs || match.lifetimeMs > security.lifetime) unavailable();
          bindings.push({ id: randomUUID(), actor: context.actor, scope: ref, roles: entry.roles, policies: entry.policies, authority: entry.authority, revision: 1,
            expiresAt: new Date(started + match.lifetimeMs).toISOString() });
        }
        const record: SessionRecord = { ...prepared.record, resource: ref };
        const registration: ResourceRegistration = { resource: ref, owner: context.actor.principal, route: { origin: ref, targets: [ref] }, externalAuthority: "none",
          admission: { sessionType: { key: binding.key, version: binding.version }, providerId: resolved.definition.providerId } };
        let resourceInstallation: ResourceInstallationToken | undefined;
        const ownedBindings: Array<{ readonly grant: ScopedPolicyBinding; readonly installation: BindingInstallationToken }> = [];
        try {
          resourceInstallation = security.registry.prepareResourceInstallation(registration);
          for (const grant of bindings) ownedBindings.push({ grant, installation: security.registry.prepareBindingInstallation(grant, resourceInstallation) });
          const approvalCurrent = approval.isCurrent.bind(value);
          if (!live(check) || !live(approvalCurrent)) unavailable();
          const attachmentTime = now();
          // SDK-owned recheck AFTER application callbacks; receipt identity is already held if an install throws.
          if (wasCancelled() || controller.signal.aborted || callerAborted() || epoch !== attemptEpoch || hooks.isStopping() || pending.get(ref.id) !== reservation
            || settling.has(ref.id) || dependencies.sessions.has(ref.id) || attachmentTime >= Math.min(deadline, approval.validUntil)
            || bindings.some((item) => attachmentTime >= Date.parse(item.expiresAt ?? "")) || security.registry.owner(ref) !== undefined) unavailable();
          dependencies.sessions.add(record);
          if (dependencies.sessions.get(ref.id) !== record) unavailable();
          security.registry.installResource(registration, resourceInstallation);
          for (const owned of ownedBindings) security.registry.installBinding(owned.grant, owned.installation);
          const installedResource = resourceInstallation;
          if (dependencies.sessions.get(ref.id) !== record || epoch !== attemptEpoch || wasCancelled() || pending.get(ref.id) !== reservation
            || !live(() => security.registry.isResourceInstallationCurrent(installedResource))
            || ownedBindings.some((owned) => !live(() => security.registry.isBindingInstallationCurrent(owned.installation)))) unavailable();
          receipts.set(record, { ref, resource: resourceInstallation, bootstrap: ownedBindings.map((owned) => owned.installation) });
        } catch (error) {
          if (dependencies.sessions.get(ref.id) === record) dependencies.sessions.delete(ref.id);
          // Attempt every owned compensation, retaining the primary attachment failure.
          for (const owned of ownedBindings) {
            try {
              security.registry.removeInstalledBinding(owned.installation);
            } catch { /* Remaining owned cleanup must still run. */ }
          }
          if (resourceInstallation !== undefined) {
            try {
              security.registry.teardownInstalledResource(resourceInstallation);
            } catch { /* Preserve primary error. */ }
          }
          throw error;
        }
        committed = true;
        pending.delete(ref.id);
        cleanup();
        release();
        if (dependencies.sessions.get(ref.id) !== record) return;
        hooks.publish(record);
        await hooks.start({ ...prepared, record }, () => {
          withdraw(record);
        });
        if (dependencies.sessions.get(ref.id) === record) hooks.changed();
      } finally {
        cleanup();
        if (pending.get(ref.id) === reservation) pending.delete(ref.id);
        if (!committed) controller.abort();
        release();
      }
    },
  });
  return { authorization, teardown, cancelAll: (): void => {
    epoch += 1;
    for (const item of pending.values()) item.cancel();
  } };
};

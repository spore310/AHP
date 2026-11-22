import { z } from "zod";

import { POLICY_LIMIT_ABSOLUTE, POLICY_LIMIT_DEFAULTS } from "@authorization/constants";
import { DEFAULT_DECISION_TTL_MS } from "@authorization/helpers/evaluate";
import { sameActor, sameResource } from "@authorization/helpers/context";
import {
  identifierSchema, policyAdmissionSchema, policyRefSchema, resourceRefSchema,
  scopedPolicyBindingSchema, securitySubjectRefSchema, trustedRequestContextSchema,
} from "@authorization/helpers/validation";
import type { FreshnessNotice } from "@authorization/types";

import { DEFAULT_INITIAL_AUTHORITY_COUNT, MAX_INITIAL_AUTHORITY_COUNT } from "./constants";
import type { AHPServerSecurityOptions, ConnectionSetupAdapter, InitialScopeAuthority } from "./types";

export const setupCount = (value: number | undefined): number => {
  const resolved = value ?? DEFAULT_INITIAL_AUTHORITY_COUNT;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_INITIAL_AUTHORITY_COUNT) {
    throw new Error("Invalid initial authority count limit.");
  }
  return resolved;
};
export const setupDeadline = (value: number | undefined): number => {
  const resolved = value ?? POLICY_LIMIT_DEFAULTS.asyncHookDeadlineMs;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > POLICY_LIMIT_ABSOLUTE.asyncHookDeadlineMs) {
    throw new Error("Invalid connection setup deadline.");
  }
  return resolved;
};
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
};
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const seedScopeSchema = z.strictObject({ scope: resourceRefSchema, grantRevision: revision });
const resolutionSchema = z.strictObject({
  resource: resourceRefSchema, owner: securitySubjectRefSchema,
  operations: z.array(identifierSchema).max(MAX_INITIAL_AUTHORITY_COUNT),
  origin: resourceRefSchema.optional(), related: z.array(resourceRefSchema).max(MAX_INITIAL_AUTHORITY_COUNT),
  admitted: policyAdmissionSchema, mandatory: z.array(policyRefSchema).max(POLICY_LIMIT_DEFAULTS.maxPolicyRefs),
});
const noticeSchema = z.strictObject({ domainId: identifierSchema, revision, expiresAt: z.iso.datetime({ offset: true }).optional(), invalidated: z.boolean() });
const noticeDeadline = (notice: FreshnessNotice): number => notice.expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(notice.expiresAt);

/** Captures configuration once; preparation only reads existing scoped facts, never installs/ issues them. */
export const createConnectionSetupAdapter = (options: AHPServerSecurityOptions): ConnectionSetupAdapter => {
  setupDeadline(options.setupDeadlineMs);
  setupCount(options.maxInitialSubscriptions);
  const scopeLimit = setupCount(options.maxInitialScopes);
  const bindingLimit = setupCount(options.maxInitialBindings);
  const now = options.now ?? Date.now;
  const workDomain = options.workDomainId === undefined ? undefined : identifierSchema.parse(options.workDomainId);
  const { composition, initialAuthority } = options;
  const authenticate = composition.identity.authenticate.bind(composition.identity);
  const resolveActor = composition.actors.resolve.bind(composition.actors);
  const resolveResource = composition.resources.resolve.bind(composition.resources);
  const readBindings = composition.bindings.read.bind(composition.bindings);
  const freshness = composition.freshness.current.bind(composition.freshness);
  const prepare = initialAuthority.prepare.bind(initialAuthority);
  return {
    async prepare(input) {
      const assertLive = (): void => {
        if (input.signal.aborted) {
          throw new Error("Connection setup cancelled.");
        }
      };
      assertLive();
      const authenticated = await authenticate(input.handshake);
      assertLive();
      if (authenticated === undefined) {
        return undefined;
      }
      const principal = securitySubjectRefSchema.parse(authenticated);
      if (workDomain !== undefined && principal.domainId !== workDomain) {
        throw new Error("Work identity domain mismatch.");
      }
      const context = freeze(trustedRequestContextSchema.parse(await resolveActor({
        principal, connectionId: input.fence.connectionId, authRevision: input.authRevision,
      })));
      assertLive();
      if (context.actor.principal.domainId !== principal.domainId || context.actor.principal.subject !== principal.subject
        || context.connectionId !== input.fence.connectionId || context.authRevision !== input.authRevision) {
        throw new Error("Actor context mismatch.");
      }
      if (context.actor.kind === "agent" && (!Number.isSafeInteger(context.agentGeneration) || (context.agentGeneration ?? 0) < 1)) {
        return undefined;
      }
      const prepared = await prepare({ context, fence: input.fence, signal: input.signal });
      const check = prepared.isCurrent.bind(prepared);
      const dispose = prepared.release.bind(prepared);
      let released = false;
      const release = (): void => {
        if (!released) {
          released = true;
          try {
            dispose();
          } catch {
            // Adapter cleanup cannot prevent transport cleanup.
          }
        }
      };
      let retained = false;
      try {
        assertLive();
        if (!Array.isArray(prepared.scopes) || prepared.scopes.length > scopeLimit || !Number.isFinite(prepared.validUntil)) {
          throw new Error("Invalid initial scopes.");
        }
        const sequencePermission: unknown = prepared.allowGlobalSequence;
        if (sequencePermission instanceof Promise) {
          void sequencePermission.catch(() => undefined);
        }
        if (sequencePermission !== undefined && typeof sequencePermission !== "boolean") {
          throw new Error("Invalid global sequence permission.");
        }
        const allowGlobalSequence = sequencePermission === true;
        const seedDeadline = prepared.validUntil;
        const scopes = freeze(prepared.scopes.map((scope) => seedScopeSchema.parse(scope)));
        const scopeKeys = new Set(scopes.map((item) => JSON.stringify(item.scope)));
        if (scopeKeys.size !== scopes.length || scopes.some((item) => item.scope.domainId !== principal.domainId)) {
          throw new Error("Invalid initial scope identity.");
        }
        const available = (): boolean => !released && !input.signal.aborted;
        const current = (deadline = seedDeadline): boolean => {
          try {
            if (!available() || !Number.isFinite(deadline)) return false;
            const time = now();
            if (!Number.isFinite(time) || time >= deadline || !available()) return false;
            // The source's canonical comparison is the last application callback.
            // Clocks and other callbacks may reenter and revoke that authority.
            const result: unknown = check();
            if (result instanceof Promise) {
              void result.catch(() => undefined);
            }
            return result === true && available();
          } catch {
            return false;
          }
        };
        if (!current()) {
          throw new Error("Stale initial authority.");
        }
        const before = noticeSchema.parse(await freshness(principal.domainId));
        assertLive();
        if (before.domainId !== principal.domainId || before.invalidated || now() >= noticeDeadline(before)) {
          throw new Error("Stale identity domain.");
        }
        const captured: InitialScopeAuthority[] = [];
        let bindingCount = 0;
        const deadlines = [seedDeadline, noticeDeadline(before), now() + DEFAULT_DECISION_TTL_MS];
        const bindingIds = new Set<string>();
        for (const scope of scopes) {
          assertLive();
          const resource = await resolveResource({ domainId: scope.scope.domainId, kind: scope.scope.kind, id: scope.scope.id });
          assertLive();
          // Reject lists before a schema parser/deep copy traverses the adapter output.
          if (!Array.isArray(resource.related) || resource.related.length > MAX_INITIAL_AUTHORITY_COUNT
            || !Array.isArray(resource.operations) || resource.operations.length > MAX_INITIAL_AUTHORITY_COUNT
            || !Array.isArray(resource.mandatory) || resource.mandatory.length > POLICY_LIMIT_DEFAULTS.maxPolicyRefs
            || !Array.isArray(resource.admitted.policies) || resource.admitted.policies.length > POLICY_LIMIT_DEFAULTS.maxPolicyRefs
            || !Array.isArray(resource.admitted.namespaces) || resource.admitted.namespaces.length > POLICY_LIMIT_DEFAULTS.maxPolicyRefs) {
            throw new Error("Invalid initial resource lists.");
          }
          const resolution = resolutionSchema.parse(resource);
          if (!sameResource(resolution.resource, scope.scope)) {
            throw new Error("Resource incarnation mismatch.");
          }
          const read = await readBindings({ actor: context.actor, scope: scope.scope, grantRevision: scope.grantRevision });
          assertLive();
          if (!Array.isArray(read) || read.length > bindingLimit - bindingCount) {
            throw new Error("Initial binding limit exceeded.");
          }
          const bindings = read.map((item) => scopedPolicyBindingSchema.parse(item));
          for (const binding of bindings) {
            if (!sameActor(binding.actor, context.actor) || !sameResource(binding.scope, scope.scope) || bindingIds.has(binding.id)) {
              throw new Error("Initial binding identity mismatch.");
            }
            bindingIds.add(binding.id);
            if (binding.expiresAt !== undefined) {
              deadlines.push(Date.parse(binding.expiresAt));
            }
          }
          bindingCount += bindings.length;
          captured.push({ ...scope, resolution, bindings });
        }
        const after = noticeSchema.parse(await freshness(principal.domainId));
        assertLive();
        if (after.domainId !== principal.domainId || after.invalidated || after.revision !== before.revision) {
          throw new Error("Setup revision changed.");
        }
        deadlines.push(noticeDeadline(after));
        const validUntil = Math.min(...deadlines);
        const snapshot = freeze({ context, fence: { ...input.fence }, scopes: captured, allowGlobalSequence, validUntil });
        const isCurrent = (): boolean => current(validUntil);
        if (!isCurrent()) {
          throw new Error("Stale prepared setup.");
        }
        retained = true;
        return { snapshot, isCurrent, release };
      } finally {
        if (!retained) {
          release();
        }
      }
    },
  };
};

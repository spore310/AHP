import { z } from "zod";

import {
  MAX_POLICY_REVISION,
  POLICY_LIMIT_ABSOLUTE,
  POLICY_LIMIT_DEFAULTS,
  RESERVED_OBJECT_KEYS,
  type PolicyLimits,
} from "../../constants";
import type { PlainJsonLimits } from "./types";

const reservedKeys = new Set(RESERVED_OBJECT_KEYS);

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
};

const limitField = (absolute: number, fallback: number): z.ZodDefault<z.ZodNumber> => (
  z.int().min(1).max(absolute).default(fallback)
);

/** Validates a budget. It does not parse policy documents. */
export const policyLimitsSchema = z.strictObject({
  namespaceIncludeDepth: limitField(
    POLICY_LIMIT_ABSOLUTE.namespaceIncludeDepth,
    POLICY_LIMIT_DEFAULTS.namespaceIncludeDepth,
  ),
  maxNamespaceIncludes: limitField(
    POLICY_LIMIT_ABSOLUTE.maxNamespaceIncludes,
    POLICY_LIMIT_DEFAULTS.maxNamespaceIncludes,
  ),
  expandedPoliciesPerNamespace: limitField(
    POLICY_LIMIT_ABSOLUTE.expandedPoliciesPerNamespace,
    POLICY_LIMIT_DEFAULTS.expandedPoliciesPerNamespace,
  ),
  maxResourceIdLength: limitField(
    POLICY_LIMIT_ABSOLUTE.maxResourceIdLength,
    POLICY_LIMIT_DEFAULTS.maxResourceIdLength,
  ),
  delegationDepth: limitField(POLICY_LIMIT_ABSOLUTE.delegationDepth, POLICY_LIMIT_DEFAULTS.delegationDepth),
  pendingChallengesPerActor: limitField(
    POLICY_LIMIT_ABSOLUTE.pendingChallengesPerActor,
    POLICY_LIMIT_DEFAULTS.pendingChallengesPerActor,
  ),
  pendingChallengesPerHost: limitField(
    POLICY_LIMIT_ABSOLUTE.pendingChallengesPerHost,
    POLICY_LIMIT_DEFAULTS.pendingChallengesPerHost,
  ),
  challengeLifetimeSeconds: limitField(
    POLICY_LIMIT_ABSOLUTE.challengeLifetimeSeconds,
    POLICY_LIMIT_DEFAULTS.challengeLifetimeSeconds,
  ),
  retainedCompletedCallsPerHost: limitField(
    POLICY_LIMIT_ABSOLUTE.retainedCompletedCallsPerHost,
    POLICY_LIMIT_DEFAULTS.retainedCompletedCallsPerHost,
  ),
  aggregateResultBudgetBytes: limitField(
    POLICY_LIMIT_ABSOLUTE.aggregateResultBudgetBytes,
    POLICY_LIMIT_DEFAULTS.aggregateResultBudgetBytes,
  ),
  completedCallRetentionSeconds: limitField(
    POLICY_LIMIT_ABSOLUTE.completedCallRetentionSeconds,
    POLICY_LIMIT_DEFAULTS.completedCallRetentionSeconds,
  ),
  maxRoles: limitField(POLICY_LIMIT_ABSOLUTE.maxRoles, POLICY_LIMIT_DEFAULTS.maxRoles),
  maxPolicyRefs: limitField(POLICY_LIMIT_ABSOLUTE.maxPolicyRefs, POLICY_LIMIT_DEFAULTS.maxPolicyRefs),
  maxMetadataStringLength: limitField(
    POLICY_LIMIT_ABSOLUTE.maxMetadataStringLength,
    POLICY_LIMIT_DEFAULTS.maxMetadataStringLength,
  ),
  asyncHookDeadlineMs: limitField(
    POLICY_LIMIT_ABSOLUTE.asyncHookDeadlineMs,
    POLICY_LIMIT_DEFAULTS.asyncHookDeadlineMs,
  ),
  extensionDepth: limitField(POLICY_LIMIT_ABSOLUTE.extensionDepth, POLICY_LIMIT_DEFAULTS.extensionDepth),
  extensionBytes: limitField(POLICY_LIMIT_ABSOLUTE.extensionBytes, POLICY_LIMIT_DEFAULTS.extensionBytes),
  extensionKeys: limitField(POLICY_LIMIT_ABSOLUTE.extensionKeys, POLICY_LIMIT_DEFAULTS.extensionKeys),
  maxIdentifierLength: limitField(
    POLICY_LIMIT_ABSOLUTE.maxIdentifierLength,
    POLICY_LIMIT_DEFAULTS.maxIdentifierLength,
  ),
});

const captureLimits = (input: PolicyLimits): PolicyLimits => Object.freeze({
  ...policyLimitsSchema.parse(input),
});

const safeString = (max: number): z.ZodType<string> => z.string().min(1).max(max).refine(
  (value) => !reservedKeys.has(value) && !hasControlCharacter(value),
  "Unsafe identifier",
);

/**
 * Builds identifier, role, ref, and binding schemas from one captured budget.
 * Include depth is not the include-list count.
 */
export const createAuthorizationSchemas = (input: PolicyLimits) => {
  const limits = captureLimits(input);
  const identifierSchema = safeString(limits.maxIdentifierLength);
  const roleNameSchema = safeString(limits.maxMetadataStringLength);
  const revisionSchema = z.int().min(1).max(MAX_POLICY_REVISION);
  const securitySubjectRefSchema = z.strictObject({
    domainId: identifierSchema,
    subject: identifierSchema,
  });
  const policyActorRefSchema = z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("user"),
      principal: securitySubjectRefSchema,
    }),
    z.strictObject({
      kind: z.literal("agent"),
      principal: securitySubjectRefSchema,
      agentId: identifierSchema,
    }),
  ]);
  const resourceRefSchema = z.strictObject({
    domainId: identifierSchema,
    kind: identifierSchema,
    id: safeString(limits.maxResourceIdLength),
    instanceId: identifierSchema,
  });
  const trustedRequestContextSchema = z.strictObject({
    actor: policyActorRefSchema,
    connectionId: identifierSchema,
    authRevision: identifierSchema,
    agentGeneration: z.int().min(0).max(MAX_POLICY_REVISION).optional(),
    delegationRef: identifierSchema.optional(),
  }).superRefine((value, ctx) => {
    if (value.actor.kind === "agent" && value.agentGeneration === undefined) {
      ctx.addIssue("Agent context requires a generation.");
    }
    if (value.actor.kind === "user" && value.agentGeneration !== undefined) {
      ctx.addIssue("User context cannot carry an agent generation.");
    }
  });
  const policyRefSchema = z.strictObject({
    id: identifierSchema,
    revision: revisionSchema,
  });
  const namespaceRefSchema = z.strictObject({
    name: identifierSchema,
    revision: revisionSchema,
  });
  const policyAdmissionSchema = z.strictObject({
    policies: z.array(policyRefSchema).max(limits.maxPolicyRefs).default(() => []),
    namespaces: z.array(namespaceRefSchema).max(limits.maxNamespaceIncludes).default(() => []),
  });
  const policyScopeRulesSchema = z.strictObject({
    admitted: policyAdmissionSchema,
    mandatory: z.array(policyRefSchema).max(limits.maxPolicyRefs).default(() => []),
  });
  const grantAuthoritySchema = z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("host-policy"),
      policy: policyRefSchema,
    }),
    z.strictObject({
      kind: z.literal("delegation"),
      issuer: policyActorRefSchema,
      parentGrantId: identifierSchema,
    }),
  ]);
  const scopedPolicyBindingSchema = z.strictObject({
    id: identifierSchema,
    actor: policyActorRefSchema,
    scope: resourceRefSchema,
    roles: z.array(roleNameSchema).max(limits.maxRoles).default(() => []),
    policies: z.array(policyRefSchema).max(limits.maxPolicyRefs).default(() => []),
    authority: grantAuthoritySchema,
    revision: revisionSchema,
    expiresAt: z.iso.datetime().optional(),
  });
  const executorRevisionSchema = z.strictObject({
    actor: policyActorRefSchema,
    connectionId: identifierSchema,
    generation: z.int().min(0).max(MAX_POLICY_REVISION),
    registrationRevision: revisionSchema,
  });
  const authorityRevisionStampSchema = z.strictObject({
    domainId: identifierSchema,
    actor: policyActorRefSchema,
    authRevision: identifierSchema,
    connectionId: identifierSchema,
    agentGeneration: z.int().min(0).max(MAX_POLICY_REVISION).optional(),
    delegationRef: identifierSchema.optional(),
    executor: executorRevisionSchema.optional(),
    route: z.strictObject({
      origin: resourceRefSchema,
      targets: z.array(resourceRefSchema).max(limits.maxPolicyRefs),
    }),
    relationshipRevision: revisionSchema,
    policyRevisions: z.array(policyRefSchema).max(limits.maxPolicyRefs),
    grantRevision: revisionSchema,
  });
  const policyDecisionSchema = z.discriminatedUnion("effect", [
    z.strictObject({
      effect: z.literal("deny"),
      code: identifierSchema,
    }),
    z.strictObject({
      effect: z.literal("allow"),
      reveal: z.boolean(),
      challengeRequired: z.boolean(),
    }),
  ]);

  return Object.freeze({
    limits,
    identifierSchema,
    roleNameSchema,
    securitySubjectRefSchema,
    policyActorRefSchema,
    resourceRefSchema,
    trustedRequestContextSchema,
    policyRefSchema,
    namespaceRefSchema,
    policyAdmissionSchema,
    policyScopeRulesSchema,
    grantAuthoritySchema,
    scopedPolicyBindingSchema,
    authorityRevisionStampSchema,
    policyDecisionSchema,
    executorRevisionSchema,
  });
};

const defaultSchemas = createAuthorizationSchemas(POLICY_LIMIT_DEFAULTS);

export const {
  identifierSchema,
  roleNameSchema,
  securitySubjectRefSchema,
  policyActorRefSchema,
  resourceRefSchema,
  trustedRequestContextSchema,
  policyRefSchema,
  namespaceRefSchema,
  policyAdmissionSchema,
  policyScopeRulesSchema,
  grantAuthoritySchema,
  scopedPolicyBindingSchema,
  authorityRevisionStampSchema,
  policyDecisionSchema,
  executorRevisionSchema,
} = defaultSchemas;

export type AuthorizationSchemas = ReturnType<typeof createAuthorizationSchemas>;

/**
 * Accepts only bounded plain JSON data.
 * Byte accounting is the UTF-8 size of the JSON text, including escapes and
 * container delimiters. Scanning stops once that budget is exceeded.
 * It does not call getters, `toJSON`, or `JSON.stringify`, and it does not sandbox Proxies.
 */
export const capturePlainJson = (value: unknown, limits: PlainJsonLimits): boolean => {
  const seen = new Set<object>();
  let visits = 0;
  let keys = 0;
  let bytes = 0;
  const maxVisits = (limits.maxKeys + 1) * (limits.maxDepth + 1);
  const add = (count: number): boolean => {
    bytes += count;
    return bytes <= limits.maxBytes;
  };
  const appendJsonString = (text: string): boolean => {
    if (!add(1)) {
      return false;
    }
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index);
      let next = 0;
      if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
        const low = text.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          next = 4;
          index += 1;
        }
      }
      if (next === 0) {
        if (
          unit === 0x22
          || unit === 0x5c
          || unit === 0x08
          || unit === 0x0c
          || unit === 0x0a
          || unit === 0x0d
          || unit === 0x09
        ) {
          next = 2;
        } else if (unit < 0x20 || (unit >= 0xd800 && unit <= 0xdfff)) {
          next = 6;
        } else if (unit <= 0x7f) {
          next = 1;
        } else if (unit <= 0x7ff) {
          next = 2;
        } else {
          next = 3;
        }
      }
      if (!add(next)) {
        return false;
      }
    }
    return add(1);
  };

  const visit = (current: unknown, depth: number): boolean => {
    if (visits >= maxVisits || depth > limits.maxDepth || keys > limits.maxKeys || bytes > limits.maxBytes) {
      return false;
    }
    visits += 1;
    if (current === null) {
      return add(4);
    }
    if (typeof current === "string") {
      return appendJsonString(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return false;
      }
      const rendered = JSON.stringify(current);
      return typeof rendered === "string" && add(rendered.length);
    }
    if (typeof current === "boolean") {
      return add(current ? 4 : 5);
    }
    if (typeof current !== "object") {
      return false;
    }
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        return false;
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        return false;
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
      if (
        lengthDescriptor === undefined
        || lengthDescriptor.get !== undefined
        || lengthDescriptor.set !== undefined
        || typeof lengthDescriptor.value !== "number"
      ) {
        return false;
      }
      const length = lengthDescriptor.value;
      if (length > limits.maxKeys) {
        return false;
      }
      const names = Object.getOwnPropertyNames(current);
      if (names.length > limits.maxKeys + 1) {
        return false;
      }
      for (const name of names) {
        if (name === "length") {
          continue;
        }
        const index = Number(name);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== name) {
          return false;
        }
      }
      keys += length;
      if (keys > limits.maxKeys || !add(1)) {
        return false;
      }
      for (let index = 0; index < length; index += 1) {
        if (index > 0 && !add(1)) {
          return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)) {
          return false;
        }
        const element: unknown = descriptor === undefined ? null : descriptor.value as unknown;
        if (!visit(element, depth + 1)) {
          return false;
        }
      }
      return add(1);
    }
    const prototype: unknown = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      return false;
    }
    const names = Object.getOwnPropertyNames(current);
    if (names.length > limits.maxKeys) {
      return false;
    }
    keys += names.length;
    if (keys > limits.maxKeys || !add(1)) {
      return false;
    }
    let emitted = 0;
    for (const name of names) {
      if (reservedKeys.has(name)) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
        return false;
      }
      if (descriptor.enumerable !== true) {
        return false;
      }
      if (emitted > 0 && !add(1)) {
        return false;
      }
      emitted += 1;
      if (!appendJsonString(name) || !add(1) || !visit(descriptor.value, depth + 1)) {
        return false;
      }
    }
    return add(1);
  };

  return visit(value, 1);
};

/** True when a value uses a reserved key, accessor, cycle, or non-plain prototype. */
export const rejectReservedKeys = (value: unknown): boolean => !capturePlainJson(value, {
  maxDepth: POLICY_LIMIT_ABSOLUTE.extensionDepth,
  maxKeys: POLICY_LIMIT_ABSOLUTE.extensionKeys,
  maxBytes: POLICY_LIMIT_ABSOLUTE.extensionBytes,
});

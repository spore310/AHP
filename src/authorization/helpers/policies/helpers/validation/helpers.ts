import { z } from "zod";

import { POLICY_LIMIT_DEFAULTS, type PolicyLimits } from "@authorization/constants";
import { capturePlainJson, createAuthorizationSchemas } from "@authorization/helpers/validation";

import { DIRECT_GRANT_ACTOR_KINDS, type PolicyOperation } from "../../constants";

/**
 * Builds manifest and extension schemas from a validated budget.
 * `namespaceIncludeDepth` is not the include-list count.
 */
export const createPolicySchemas = (input: PolicyLimits) => {
  const authorization = createAuthorizationSchemas(input);
  const limits = authorization.limits;
  const roleNameSchema = authorization.roleNameSchema;
  const roleBranchSchema = z.strictObject({
    anyOf: z.array(roleNameSchema).max(limits.maxRoles).default(() => []),
  });
  const actorPolicySchema = z.strictObject({
    user: roleBranchSchema.optional(),
    agent: roleBranchSchema.optional(),
  });
  const actorRuleSchema = z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("roles"),
      actors: actorPolicySchema,
    }),
    z.strictObject({
      mode: z.literal("direct-grant"),
      actors: z.array(z.enum(DIRECT_GRANT_ACTOR_KINDS)).max(DIRECT_GRANT_ACTOR_KINDS.length),
    }),
  ]);
  const policyOperationRuleSchema = z.strictObject({
    actor: actorRuleSchema,
    requiredPermissions: z.array(roleNameSchema).max(limits.maxRoles).optional(),
    reveal: z.boolean().optional(),
  });
  const operationShape = {
    discover: policyOperationRuleSchema.optional(),
    propose: policyOperationRuleSchema.optional(),
    approve: policyOperationRuleSchema.optional(),
    advertise: policyOperationRuleSchema.optional(),
    publish: policyOperationRuleSchema.optional(),
    invoke: policyOperationRuleSchema.optional(),
    execute: policyOperationRuleSchema.optional(),
  } satisfies Record<PolicyOperation, z.ZodOptional<typeof policyOperationRuleSchema>>;
  const boundedExtensionSchema = z.unknown().superRefine((value, ctx) => {
    if (!capturePlainJson(value, {
      maxDepth: limits.extensionDepth,
      maxKeys: limits.extensionKeys,
      maxBytes: limits.extensionBytes,
    })) {
      ctx.addIssue("Extension is not bounded plain JSON.");
    }
  });
  const policyDefinitionManifestSchema = z.strictObject({
    id: authorization.identifierSchema,
    revision: z.int().min(1).max(2_147_483_647),
    operations: z.strictObject(operationShape),
    challenge: z.strictObject({ required: z.boolean() }),
    extension: boundedExtensionSchema.optional(),
  });

  const policyNamespaceManifestSchema = z.strictObject({
    name: authorization.identifierSchema,
    revision: z.int().min(1).max(2_147_483_647),
    policies: z.array(authorization.policyRefSchema).max(limits.expandedPoliciesPerNamespace),
    includes: z.array(authorization.namespaceRefSchema).max(limits.maxNamespaceIncludes).optional(),
  });

  return Object.freeze({
    limits,
    roleNameSchema,
    actorPolicySchema,
    actorRuleSchema,
    policyOperationRuleSchema,
    boundedExtensionSchema,
    policyDefinitionManifestSchema,
    policyNamespaceManifestSchema,
  });
};

const defaultSchemas = createPolicySchemas(POLICY_LIMIT_DEFAULTS);

export const {
  roleNameSchema,
  actorPolicySchema,
  actorRuleSchema,
  policyOperationRuleSchema,
  boundedExtensionSchema,
  policyDefinitionManifestSchema,
  policyNamespaceManifestSchema,
} = defaultSchemas;

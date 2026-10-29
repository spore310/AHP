import { z } from "zod";

import { POLICY_LIMIT_DEFAULTS, type PolicyLimits } from "@authorization/constants";
import { capturePlainJson, createAuthorizationSchemas } from "@authorization/helpers/validation";

import { DIRECT_GRANT_ACTOR_KINDS, type ToolOperation } from "../../constants";

/**
 * Builds manifest and extension schemas from a validated budget.
 * `namespaceIncludeDepth` is not the include-list count.
 */
export const createToolPolicySchemas = (input: PolicyLimits) => {
  const authorization = createAuthorizationSchemas(input);
  const limits = authorization.limits;
  const roleNameSchema = authorization.roleNameSchema;
  const roleBranchSchema = z.strictObject({
    anyOf: z.array(roleNameSchema).max(limits.maxRoles).default(() => []),
  });
  const toolActorPolicySchema = z.strictObject({
    user: roleBranchSchema.optional(),
    agent: roleBranchSchema.optional(),
  });
  const toolActorRuleSchema = z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("roles"),
      actors: toolActorPolicySchema,
    }),
    z.strictObject({
      mode: z.literal("direct-grant"),
      actors: z.array(z.enum(DIRECT_GRANT_ACTOR_KINDS)).max(DIRECT_GRANT_ACTOR_KINDS.length),
    }),
  ]);
  const toolOperationRuleSchema = z.strictObject({
    actor: toolActorRuleSchema,
    requiredPermissions: z.array(roleNameSchema).max(limits.maxRoles).optional(),
    reveal: z.boolean().optional(),
  });
  const operationShape = {
    discover: toolOperationRuleSchema.optional(),
    propose: toolOperationRuleSchema.optional(),
    approve: toolOperationRuleSchema.optional(),
    advertise: toolOperationRuleSchema.optional(),
    publish: toolOperationRuleSchema.optional(),
    invoke: toolOperationRuleSchema.optional(),
    execute: toolOperationRuleSchema.optional(),
  } satisfies Record<ToolOperation, z.ZodOptional<typeof toolOperationRuleSchema>>;
  const boundedExtensionSchema = z.unknown().superRefine((value, ctx) => {
    if (!capturePlainJson(value, {
      maxDepth: limits.extensionDepth,
      maxKeys: limits.extensionKeys,
      maxBytes: limits.extensionBytes,
    })) {
      ctx.addIssue("Extension is not bounded plain JSON.");
    }
  });
  const toolExecutionPolicyManifestSchema = z.strictObject({
    id: authorization.identifierSchema,
    revision: z.int().min(1).max(2_147_483_647),
    operations: z.strictObject(operationShape),
    challenge: z.strictObject({ required: z.boolean() }),
    extension: boundedExtensionSchema.optional(),
  });
  const toolExecutionBindingSchema = z.discriminatedUnion("implementation", [
    z.strictObject({
      location: z.literal("server"),
      suppliedBy: z.literal("server"),
      implementation: z.literal("host"),
      implementationId: authorization.identifierSchema,
    }),
    z.strictObject({
      location: z.literal("client"),
      suppliedBy: z.enum(["server", "client"]),
      implementation: z.literal("client-owned"),
      implementationId: authorization.identifierSchema,
    }),
    z.strictObject({
      location: z.literal("client"),
      suppliedBy: z.literal("server"),
      implementation: z.literal("approved-artifact"),
      artifactRef: authorization.identifierSchema,
    }),
  ]);
  const toolPolicyNamespaceManifestSchema = z.strictObject({
    name: authorization.identifierSchema,
    revision: z.int().min(1).max(2_147_483_647),
    policies: z.array(authorization.policyRefSchema).max(limits.expandedPoliciesPerNamespace),
    includes: z.array(authorization.namespaceRefSchema).max(limits.maxNamespaceIncludes).optional(),
  });

  return Object.freeze({
    limits,
    roleNameSchema,
    toolActorPolicySchema,
    toolActorRuleSchema,
    toolOperationRuleSchema,
    boundedExtensionSchema,
    toolExecutionPolicyManifestSchema,
    toolExecutionBindingSchema,
    toolPolicyNamespaceManifestSchema,
  });
};

const defaultSchemas = createToolPolicySchemas(POLICY_LIMIT_DEFAULTS);

export const {
  roleNameSchema,
  toolActorPolicySchema,
  toolActorRuleSchema,
  toolOperationRuleSchema,
  boundedExtensionSchema,
  toolExecutionPolicyManifestSchema,
  toolExecutionBindingSchema,
  toolPolicyNamespaceManifestSchema,
} = defaultSchemas;

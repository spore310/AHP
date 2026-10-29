export { policyDecisionSchema } from "@authorization";
export type { PolicyDecision } from "@authorization";

export { DIRECT_GRANT_ACTOR_KINDS, TOOL_OPERATIONS } from "./constants";
export type { DirectGrantActorKind, ToolOperation } from "./constants";

export type {
  DefineToolPolicyNamespaceInput,
  PolicyResolutionContext,
  ToolActorPolicy,
  ToolActorRule,
  ToolExecutionBinding,
  ToolExecutionPolicy,
  ToolExecutionPolicyBase,
  ToolOperationRule,
  ToolPolicyNamespace,
  ToolPolicyNamespaceManifest,
} from "./types";

export { createToolPolicyFactory, ToolPolicyFactoryError } from "./helpers/factory";
export type {
  CompiledToolPolicy,
  PolicySelectionResult,
  ToolPolicyBindingRegistration,
  ToolPolicyFactory,
  ToolPolicyFactoryOptions,
} from "./helpers/factory";
export { projectAssignedDescriptors } from "./helpers/assignments";
export type { AdmittedTool } from "./helpers/assignments";
export { defineToolPolicyNamespace } from "./helpers/namespace";
export type { CapturedNamespaceData } from "./helpers/namespace";

export type { ToolPolicySchemas } from "./helpers/validation";
export {
  boundedExtensionSchema,
  createToolPolicySchemas,
  roleNameSchema,
  toolActorPolicySchema,
  toolActorRuleSchema,
  toolExecutionBindingSchema,
  toolExecutionPolicyManifestSchema,
  toolOperationRuleSchema,
  toolPolicyNamespaceManifestSchema,
} from "./helpers/validation";

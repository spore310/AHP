export { policyDecisionSchema } from "@authorization/helpers/validation";
export type { PolicyDecision } from "@authorization/types";

export { DIRECT_GRANT_ACTOR_KINDS, POLICY_OPERATIONS } from "./constants";
export type { DirectGrantActorKind, PolicyOperation } from "./constants";

export type {
  DefinePolicyNamespaceInput,
  PolicyResolutionContext,
  ActorPolicy,
  ActorRule,
  PolicyDefinition,
  PolicyDefinitionBase,
  PolicyOperationRule,
  PolicyNamespace,
  PolicyNamespaceManifest,
} from "./types";

export { createPolicyFactory, PolicyFactoryError } from "./helpers/factory";
export type {
  CompiledPolicy,
  PolicySelectionResult,
  PolicyBindingRegistration,
  PolicyFactory,
  PolicyFactoryOptions,
} from "./helpers/factory";
export { definePolicyNamespace } from "./helpers/namespace";
export type { CapturedNamespaceData } from "./helpers/namespace";

export type { PolicySchemas } from "./helpers/validation";
export {
  boundedExtensionSchema,
  createPolicySchemas,
  roleNameSchema,
  actorPolicySchema,
  actorRuleSchema,
  policyDefinitionManifestSchema,
  policyOperationRuleSchema,
  policyNamespaceManifestSchema,
} from "./helpers/validation";

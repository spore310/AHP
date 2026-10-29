import { POLICY_LIMIT_DEFAULTS, policyLimitsSchema, type PolicyLimits } from "@authorization";

import type { DefineToolPolicyNamespaceInput, ToolExecutionPolicyBase, ToolPolicyNamespace } from "../../types";
import { captureDeclaredPolicy, capturePolicy } from "../factory/helpers";
import { ToolPolicyFactoryError } from "../factory/types";

/**
 * Captures one namespace declaration.
 * Include closure and conflict checks belong to the factory, which revalidates
 * this snapshot against the factory budget.
 */
export const defineToolPolicyNamespace = <const TPolicies extends readonly ToolExecutionPolicyBase[]>(
  input: DefineToolPolicyNamespaceInput<TPolicies>,
  limits?: PolicyLimits,
): ToolPolicyNamespace<TPolicies[number]> => {
  const parsed = policyLimitsSchema.safeParse(limits ?? POLICY_LIMIT_DEFAULTS);
  if (!parsed.success || typeof input.resolve !== "function") {
    throw new ToolPolicyFactoryError("invalid-definition", "Invalid policy configuration.");
  }
  const captured = Object.freeze(input.policies.map((policy) => captureDeclaredPolicy(policy, parsed.data)));
  const includes = input.includes?.map((include) => Object.freeze({
    name: include.name,
    revision: include.revision,
  }));
  const name = capturePolicy({
    id: input.name,
    revision: input.revision,
    operations: {},
    challenge: { required: false },
  }, parsed.data);
  return Object.freeze({
    name: name.id,
    revision: name.revision,
    policies: captured,
    ...(includes !== undefined ? { includes: Object.freeze(includes) } : {}),
    resolve: input.resolve,
  });
};

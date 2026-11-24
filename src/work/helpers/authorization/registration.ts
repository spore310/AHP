import { z } from "zod";
import { POLICY_LIMIT_DEFAULTS, policyRefSchema, type PolicyRef, type PolicyScopeRules } from "@authorization";
import { POLICY_OPERATIONS } from "@authorization/helpers/policies/constants";
import type { PolicyFactory } from "@authorization/policies";
import { captureData } from "@persistence/helpers/durability/helpers";
import type { SessionWorkPolicyRegistration } from "./types";

export const workOperations = ["submit", "read", "claim", "renew", "complete", "fail", "cancel", "updateData", "announce"] as const;
const rules = z.partialRecord(z.enum(workOperations), z.strictObject({
  purpose: z.enum(POLICY_OPERATIONS), policies: z.array(policyRefSchema).min(1).max(POLICY_LIMIT_DEFAULTS.maxPolicyRefs),
}));
export const samePolicy = (a: PolicyRef, b: PolicyRef): boolean => a.id === b.id && a.revision === b.revision;
export function captureWorkPolicy(policy: SessionWorkPolicyRegistration): SessionWorkPolicyRegistration {
  const captured = rules.parse(captureData(policy.operations));
  if (policy.prepare !== undefined && typeof policy.prepare !== "function") throw new TypeError("Invalid work restriction.");
  return { operations: captured, ...(policy.prepare && { prepare: policy.prepare.bind(policy) }) };
}

export function validateWorkRegistration(work: SessionWorkPolicyRegistration, policies: PolicyFactory, scope: PolicyScopeRules): void {
  const available = [...scope.admitted.policies];
  const namespaces = policies.inspect().namespaces;
  for (const ref of scope.admitted.namespaces) {
    const match = namespaces.find((ns) => ns.name === ref.name && ns.revision === ref.revision);
    if (!match) throw new TypeError("Unknown work namespace.");
    available.push(...match.expanded);
  }
  if (scope.mandatory.some((ref) => policies.getPolicy(ref)?.challenge.required !== false)) throw new TypeError("Unsupported mandatory work challenge.");
  for (const entry of Object.values(work.operations)) {
    for (const ref of entry.policies) {
      const compiled = policies.getPolicy(ref);
      if (!compiled || compiled.challenge.required || !compiled.operations[entry.purpose] || !available.some((item) => samePolicy(item, ref))) {
        throw new TypeError("Unknown or unsupported work operation policy.");
      }
    }
  }
}

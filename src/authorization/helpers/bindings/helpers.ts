import type { PolicyRef, ScopedPolicyBinding } from "../../types";

export const includesPolicy = (
  binding: ScopedPolicyBinding,
  policy: PolicyRef,
): boolean => binding.policies.some((item) => item.id === policy.id && item.revision === policy.revision);

export const bindingExpired = (binding: ScopedPolicyBinding, now: number): boolean => {
  if (binding.expiresAt === undefined) {
    return false;
  }
  const expiry = Date.parse(binding.expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
};

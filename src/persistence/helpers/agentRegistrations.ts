import type { AgentRegistrationLimits, AgentRegistrationRepository } from "../types";

import type { PersistenceOperationScope } from "./lifecycle/types";

const DEFAULT_MAX_TOTAL = 4_096;
const DEFAULT_MAX_PER_PRINCIPAL = 128;

export function captureAgentRegistrationLimits(input: unknown = {}): AgentRegistrationLimits {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Invalid agent registration limits.");
  }
  const limits = input as Partial<Record<keyof AgentRegistrationLimits, unknown>>;
  const maxTotal = limits.maxTotal === undefined ? DEFAULT_MAX_TOTAL : limits.maxTotal;
  const maxPerPrincipal = limits.maxPerPrincipal === undefined
    ? DEFAULT_MAX_PER_PRINCIPAL
    : limits.maxPerPrincipal;
  if (typeof maxTotal !== "number" || !Number.isSafeInteger(maxTotal) || maxTotal < 1
    || typeof maxPerPrincipal !== "number" || !Number.isSafeInteger(maxPerPrincipal) || maxPerPrincipal < 1) {
    throw new TypeError("Invalid agent registration limits.");
  }
  return Object.freeze({ maxTotal, maxPerPrincipal });
}

export const createAgentRegistrationFacade = (
  repository: AgentRegistrationRepository,
  scope: PersistenceOperationScope,
): AgentRegistrationRepository => ({
  register: (input) => scope.run(() => repository.register(input)),
  getById: (id) => scope.run(() => repository.getById(id)),
});

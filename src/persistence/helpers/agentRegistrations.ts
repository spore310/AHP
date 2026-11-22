import type { AgentRegistrationRepository } from "../types";

import type { PersistenceOperationScope } from "./lifecycle/types";

export const createAgentRegistrationFacade = (
  repository: AgentRegistrationRepository,
  scope: PersistenceOperationScope,
): AgentRegistrationRepository => ({
  register: (input) => scope.run(() => repository.register(input)),
  getById: (id) => scope.run(() => repository.getById(id)),
});

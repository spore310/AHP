import type { PersistenceProvider } from "../../types";
import { createAgentRegistrationFacade } from "../agentRegistrations";
import { createPersistenceOperationScope } from "../lifecycle";
import { createDurableSessionFacade } from "../sessions";
import { createWorkFacade } from "../workItems";

export const createPersistence = (provider: PersistenceProvider): PersistenceProvider => {
  const scope = createPersistenceOperationScope(() => provider.dispose());
  return {
    registrations: createAgentRegistrationFacade(provider.registrations, scope),
    sessions: createDurableSessionFacade(provider.sessions, scope),
    work: createWorkFacade(provider.work, scope),
    dispose: () => scope.dispose(),
  };
};

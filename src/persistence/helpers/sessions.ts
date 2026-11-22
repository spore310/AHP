import type { DurableSessionRepository } from "../types";

import type { PersistenceOperationScope } from "./lifecycle/types";

export const createDurableSessionFacade = (
  repository: DurableSessionRepository,
  scope: PersistenceOperationScope,
): DurableSessionRepository => ({
  ensure: (input) => scope.run(() => repository.ensure(input)),
  get: (sessionUri) => scope.run(() => repository.get(sessionUri)),
  delete: (sessionUri) => scope.run(() => repository.delete(sessionUri)),
});

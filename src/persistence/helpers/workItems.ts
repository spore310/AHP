import type { WorkRepository } from "../types";

import type { PersistenceOperationScope } from "./lifecycle/types";

export const createWorkFacade = (
  repository: WorkRepository,
  scope: PersistenceOperationScope,
): WorkRepository => ({
  submit: (input) => scope.run(() => repository.submit(input)),
  claim: (input) => scope.run(() => repository.claim(input)),
  renew: (input) => scope.run(() => repository.renew(input)),
  complete: (input) => scope.run(() => repository.complete(input)),
  fail: (input) => scope.run(() => repository.fail(input)),
  cancel: (input) => scope.run(() => repository.cancel(input)),
  get: (input) => scope.run(() => repository.get(input)),
  reconcileExpired: () => scope.run(() => repository.reconcileExpired()),
  hasDependentWork: (sessionUri) => scope.run(() => repository.hasDependentWork(sessionUri)),
});

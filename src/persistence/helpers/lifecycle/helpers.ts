import { RepositoryError } from "@persistence/types";

import type { PersistenceOperationScope } from "./types";

const normalizeError = (error: unknown): RepositoryError => {
  if (error instanceof RepositoryError) {
    return error;
  }
  return new RepositoryError("database", "The persistence operation failed.");
};

export const createPersistenceOperationScope = (
  cleanup: () => Promise<void>,
): PersistenceOperationScope => {
  let state: "open" | "closing" | "closed" = "open";
  const pending = new Set<Promise<void>>();
  let disposal: Promise<void> | undefined;

  return {
    run<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
      if (state !== "open") {
        return Promise.reject(new RepositoryError("database", "Persistence is closed."));
      }

      let resolveOperation!: (result: TResult) => void;
      let rejectOperation!: (error: RepositoryError) => void;
      const trackedOperation = new Promise<TResult>((resolve, reject) => {
        resolveOperation = resolve;
        rejectOperation = reject;
      });
      const settled = trackedOperation.then(() => undefined, () => undefined);
      pending.add(settled);
      void settled.then(() => pending.delete(settled));

      try {
        Promise.resolve(operation()).then(resolveOperation, (error: unknown) => {
          rejectOperation(normalizeError(error));
        });
      } catch (error) {
        rejectOperation(normalizeError(error));
      }
      return trackedOperation;
    },

    dispose(): Promise<void> {
      if (disposal !== undefined) {
        return disposal;
      }
      state = "closing";
      disposal = (async () => {
        await Promise.all([...pending]);
        try {
          await cleanup();
        } finally {
          state = "closed";
        }
      })();
      return disposal;
    },
  };
};

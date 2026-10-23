import { describe, expect, it, vi } from "vitest";

import { RepositoryError } from "@persistence/types";
import { createPersistenceOperationScope } from "@persistence/helpers/lifecycle";

// Lifecycle cleanup fakes resolve immediately unless a test injects failure.
/* eslint-disable @typescript-eslint/require-await */
const deferred = <TResult>() => {
  let resolve!: (value: TResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("persistence operation scope", () => {
  it("drains admitted operations and shares one disposal promise", async () => {
    const operation = deferred<number>();
    const cleanup = vi.fn(() => Promise.resolve());
    const scope = createPersistenceOperationScope(cleanup);
    const result = scope.run(() => operation.promise);
    const disposal = scope.dispose();
    expect(scope.dispose()).toBe(disposal);
    await expect(scope.run(async () => 1)).rejects.toMatchObject({ code: "database" });
    expect(cleanup).not.toHaveBeenCalled();
    operation.resolve(4);
    await expect(result).resolves.toBe(4);
    await disposal;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("normalizes failures while still cleaning up", async () => {
    const cleanup = vi.fn(() => Promise.resolve());
    const scope = createPersistenceOperationScope(cleanup);
    const result = scope.run(() => Promise.reject(new Error("secret driver detail")));
    await expect(result).rejects.toEqual(new RepositoryError("database", "The persistence operation failed."));
    await scope.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("contains synchronous throws and caches cleanup failure", async () => {
    const cleanup = vi.fn(() => Promise.reject(new Error("cleanup detail")));
    const scope = createPersistenceOperationScope(cleanup);
    await expect(scope.run(() => {
      throw new Error("sync driver detail");
    }))
      .rejects.toMatchObject({ code: "database", message: "The persistence operation failed." });
    const first = scope.dispose();
    await expect(first).rejects.toThrow("cleanup detail");
    expect(scope.dispose()).toBe(first);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("registers an operation before a synchronous reentrant dispose", async () => {
    const operation = deferred<number>();
    const cleanup = vi.fn(() => Promise.resolve());
    const scope = createPersistenceOperationScope(cleanup);
    let disposal!: Promise<void>;
    const result = scope.run(() => {
      disposal = scope.dispose();
      return operation.promise;
    });
    expect(cleanup).not.toHaveBeenCalled();
    operation.resolve(9);
    await expect(result).resolves.toBe(9);
    await disposal;
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves owned errors and closes the operation scope", async () => {
    const expected = new RepositoryError("unauthorized", "Access denied.");
    const scope = createPersistenceOperationScope(() => Promise.resolve());
    await expect(scope.run(() => Promise.reject(expected))).rejects.toBe(expected);
    await scope.dispose();
  });
});

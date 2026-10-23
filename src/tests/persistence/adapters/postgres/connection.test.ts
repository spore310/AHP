import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { PoolClientLike, PoolLike } from "@persistence/helpers/adapters/postgres/helpers/connection";
import {
  createPostgresPool,
  databaseFailure,
  toIso,
  withTransaction,
} from "@persistence/helpers/adapters/postgres/helpers/connection";
import type { PostgresOptions } from "@persistence/helpers/adapters/postgres/types";
import { RepositoryError } from "@persistence/types";

export const emptyResult = <T extends QueryResultRow>(): QueryResult<T> => ({
  rows: [],
  rowCount: 0,
  command: "SELECT",
  oid: 0,
  fields: [],
});

interface DriverDouble {
  readonly pool: PoolLike;
  readonly client: PoolClientLike;
  /** Statement attempts routed to the acquired client, in call order. */
  readonly clientStatementAttempts: string[];
  /** Statements routed through pool.query — the transaction helper must produce none. */
  readonly poolStatements: string[];
  releaseCount(): number;
}

interface DriverDoubleConfig {
  /** Statement text whose client execution rejects (for example "COMMIT"). */
  readonly failStatement?: string;
  readonly connectFails?: boolean;
}

const statementError = (statement: string): Error =>
  new Error(`double rejected ${statement}`);

const createDriverDouble = (config: DriverDoubleConfig = {}): DriverDouble => {
  const clientStatementAttempts: string[] = [];
  const poolStatements: string[] = [];
  let releases = 0;
  const client: PoolClientLike = {
    query<T extends QueryResultRow = never>(text: string): Promise<QueryResult<T>> {
      clientStatementAttempts.push(text);
      if (config.failStatement === text) {
        return Promise.reject(statementError(text));
      }
      return Promise.resolve(emptyResult<T>());
    },
    release(): void {
      releases += 1;
    },
  };
  const pool: PoolLike = {
    connect(): Promise<PoolClientLike> {
      if (config.connectFails) {
        throw statementError("connect");
      }
      return Promise.resolve(client);
    },
    query<T extends QueryResultRow = never>(text: string): Promise<QueryResult<T>> {
      poolStatements.push(text);
      return Promise.resolve(emptyResult<T>());
    },
  };
  return {
    pool,
    client,
    clientStatementAttempts,
    poolStatements,
    releaseCount: () => releases,
  };
};

const unusedOperation = (): Promise<string> => Promise.resolve("unused");

describe("adapter connection — withTransaction", () => {
  it("keeps BEGIN/COMMIT and the operation on one acquired client, never pool.query", async () => {
    const double = createDriverDouble();
    const seenClients: PoolClientLike[] = [];

    const result = await withTransaction(double.pool, async (client) => {
      seenClients.push(client);
      await client.query("SELECT 1", []);
      return "propagated";
    });

    expect(result).toBe("propagated");
    expect(double.clientStatementAttempts).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    // The transaction helper must not route statements through pool.query:
    // pool-level statements would run on a different client and escape BEGIN.
    expect(double.poolStatements).toEqual([]);
    expect(seenClients).toEqual([double.client]);
  });

  it("releases the acquired client exactly once on success", async () => {
    const double = createDriverDouble();
    await withTransaction(double.pool, unusedOperation);
    expect(double.releaseCount()).toBe(1);
  });

  it("releases exactly once and rolls back when the operation fails, preserving the primary error", async () => {
    const double = createDriverDouble();
    const primaryError = new Error("operation exploded");

    const attempt = withTransaction(double.pool, async (client) => {
      await client.query("INSERT 1", []);
      throw primaryError;
    });

    await expect(attempt).rejects.toBe(primaryError);
    expect(double.clientStatementAttempts).toEqual(["BEGIN", "INSERT 1", "ROLLBACK"]);
    expect(double.poolStatements).toEqual([]);
    expect(double.releaseCount()).toBe(1);
  });

  it("releases exactly once and rolls back when COMMIT fails, preserving the commit error", async () => {
    const double = createDriverDouble({ failStatement: "COMMIT" });

    const attempt = withTransaction(double.pool, async (client) => {
      await client.query("INSERT 1", []);
      return "never returned";
    });

    await expect(attempt).rejects.toHaveProperty("message", "double rejected COMMIT");
    expect(double.clientStatementAttempts).toEqual(["BEGIN", "INSERT 1", "COMMIT", "ROLLBACK"]);
    expect(double.poolStatements).toEqual([]);
    expect(double.releaseCount()).toBe(1);
  });

  it("does not mask an operation failure with a failing ROLLBACK", async () => {
    const double = createDriverDouble({ failStatement: "ROLLBACK" });
    const primaryError = new Error("primary failure");

    const attempt = withTransaction(double.pool, async (client) => {
      await client.query("INSERT 1", []);
      throw primaryError;
    });

    await expect(attempt).rejects.toBe(primaryError);
    expect(double.clientStatementAttempts).toEqual(["BEGIN", "INSERT 1", "ROLLBACK"]);
    expect(double.releaseCount()).toBe(1);
  });

  it("rejects with the connect failure, never touching a client", async () => {
    const double = createDriverDouble({ connectFails: true });

    const attempt = withTransaction(double.pool, unusedOperation);

    await expect(attempt).rejects.toHaveProperty("message", "double rejected connect");
    expect(double.clientStatementAttempts).toEqual([]);
    expect(double.releaseCount()).toBe(0);
  });

  it("propagates the operation result plainly", async () => {
    const double = createDriverDouble();
    const sentinel = { ok: true };
    const result = await withTransaction(double.pool, () => Promise.resolve(sentinel));
    expect(result).toBe(sentinel);
  });
});

describe("adapter connection — databaseFailure", () => {
  it("maps SQLSTATE 23505 conflicts", () => {
    for (const code of ["23505", 23505]) {
      const failure = databaseFailure({ code });
      expect(failure).toBeInstanceOf(RepositoryError);
      expect(failure.code).toBe("conflict");
      expect(failure.message).toBe("The resource already exists with different immutable fields.");
    }
  });

  it("maps reference violations (23503, 22P02) to not_found without leaking SQL text or state", () => {
    for (const code of ["23503", "22P02"]) {
      const failure = databaseFailure({ code, message: "sensitive: select * from sessions" });
      expect(failure.code).toBe("not_found");
      expect(failure.message).toBe("The referenced resource does not exist.");
      expect(failure.message).not.toContain("sensitive");
      expect(failure.message).not.toContain(code);
    }
  });

  it("maps anything else to the sanitized database error", () => {
    for (const error of [
      new Error("something raw"),
      { code: "42P01" },
      "string failure",
    ]) {
      const failure = databaseFailure(error);
      expect(failure).toBeInstanceOf(RepositoryError);
      expect(failure.code).toBe("database");
      expect(failure.message).toBe("The durable store operation failed.");
    }
  });

  it("passes an owned RepositoryError through unchanged", () => {
    const original = new RepositoryError("unauthorized", "The session belongs to another principal.");
    expect(databaseFailure(original)).toBe(original);
  });
});

describe("adapter connection — toIso", () => {
  it("normalizes Date and string timestamps to ISO strings", () => {
    expect(toIso(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)))).toBe("2026-01-02T03:04:05.678Z");
    expect(toIso("2026-02-03T10:00:00Z")).toBe("2026-02-03T10:00:00.000Z");
  });
});

describe("adapter connection — createPostgresPool (offline construction only)", () => {
  it("keeps the original default of 10 maximum clients", () => {
    const options: PostgresOptions = { connectionString: "postgresql://localhost:5432/probe" };
    const pool = createPostgresPool(options);
    expect(pool.options.max).toBe(10);
  });

  it("preserves an explicit maxConnections override", () => {
    const options: PostgresOptions = {
      connectionString: "postgresql://localhost:5432/probe",
      maxConnections: 5,
    };
    const pool = createPostgresPool(options);
    expect(pool.options.max).toBe(5);
  });
});

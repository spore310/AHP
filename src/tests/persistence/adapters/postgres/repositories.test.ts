import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { PoolClientLike, PoolLike } from "@persistence/helpers/adapters/postgres/helpers/connection";
import { createPostgresAgentRegistrationRepository } from "@persistence/helpers/adapters/postgres/helpers/agentRegistrations";
import {
  createPostgresDurableSessionRepository,
} from "@persistence/helpers/adapters/postgres/helpers/sessions";
import { ensureSession } from "@persistence/helpers/adapters/postgres/helpers/sessions/helpers";
import type {
  AgentRegistrationRow,
  QueryableClient,
  SessionRow,
} from "@persistence/helpers/adapters/postgres/types";
import type { DurableSessionInput } from "@persistence/types";

/** Same type-level assertion helper contracts.test.ts uses. */
type Expect<T extends true> = T;

/**
 * Compile proof (P03 review N2): real pg driver objects satisfy the
 * adapter-private shapes with no unsafe casts. Exported so the aliased
 * assertion is never reported as an unused type declaration.
 */
export type RealDriverShapesMatchAdapter = Expect<
  (
    ([Pool] extends [PoolLike] ? true : false) extends true
      ? [PoolClient] extends [QueryableClient] ? true : false
      : false
  ) extends true
    ? true
    : false
>;

interface PlannedQueryResult {
  readonly rows?: readonly QueryResultRow[];
  readonly rowCount?: number;
  readonly command?: string;
}

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
  readonly surface: "pool" | "client";
}

interface DatabaseDouble {
  readonly pool: PoolLike;
  readonly client: PoolClientLike;
  readonly calls: RecordedQuery[];
  connectCount(): number;
}

interface DatabaseDoubleConfig {
  /** All queries reject with this simulated driver error. */
  readonly failAllWith?: SimulatedDriverError;
}

/** A driver failure with the SQLSTATE `code` surface the repository layers inspect. */
class SimulatedDriverError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("simulated driver failure (SQLSTATE " + code + ")");
    this.name = "SimulatedDriverError";
    this.code = code;
  }
}

/**
 * Transaction control statements issued by withTransaction. They share the
 * query surface but must not consume planned statement results — otherwise the
 * plan queue desynchronizes and projection SQL gets the wrong rows.
 */
const CONTROL_STATEMENTS = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);

const callAt = (calls: readonly RecordedQuery[], index: number): RecordedQuery => {
  const call = calls[index];
  if (call === undefined) {
    throw new Error("no recorded statement at index " + String(index));
  }
  return call;
};

const createQuerySurface = (
  surface: "pool" | "client",
  calls: RecordedQuery[],
  plannedResults: PlannedQueryResult[],
  config: DatabaseDoubleConfig,
): PoolClientLike["query"] => {
  return <T extends QueryResultRow = never>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> => {
    calls.push({ text, values: values ?? [], surface });
    if (config.failAllWith !== undefined) {
      return Promise.reject(config.failAllWith);
    }
    if (CONTROL_STATEMENTS.has(text)) {
      return Promise.resolve({
        rows: [],
        rowCount: 0,
        command: text,
        oid: 0,
        fields: [],
      } satisfies QueryResult<T>);
    }
    const next = plannedResults.shift();
    if (next === undefined) {
      return Promise.reject(new Error("double exhausted"));
    }
    return Promise.resolve({
      rows: next.rows as T[],
      rowCount: next.rowCount ?? (next.rows ?? []).length,
      command: next.command ?? "SELECT",
      oid: 0,
      fields: [],
    } satisfies QueryResult<T>);
  };
};

const createDatabaseDouble = (
  planned: PlannedQueryResult[],
  config: DatabaseDoubleConfig = {},
): DatabaseDouble => {
  const calls: RecordedQuery[] = [];
  let connects = 0;
  const client: PoolClientLike = {
    query: createQuerySurface("client", calls, planned, config),
    release() {
      // Release accounting for withTransaction itself is covered in
      // connection.test.ts; this double records statement affinity instead.
    },
  };
  const pool: PoolLike = {
    connect: (): Promise<PoolClientLike> => {
      connects += 1;
      return Promise.resolve(client);
    },
    query: createQuerySurface("pool", calls, planned, config),
  };
  return { pool, client, calls, connectCount: () => connects };
};

const REGISTRATION_ID = "018f4d1e-6a7b-7c8d-9e0f-1a2b3c4d5e6f";
const SESSION_URI = "ahp-session:/p04-unit";

const sessionInput = (overrides: Partial<DurableSessionInput> = {}): DurableSessionInput => ({
  sessionUri: SESSION_URI,
  ownerPrincipalSubject: "alice",
  providerId: "ahp-mock",
  createdAt: "2026-10-22T10:00:00.000Z",
  modifiedAt: "2026-10-22T10:05:00.000Z",
  lastServerSeq: 15,
  durableState: { cursor: 42 },
  ...overrides,
});

const sessionRow = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  session_uri: SESSION_URI,
  session_type_id: null,
  provider_id: "ahp-mock",
  owner_principal_subject: "alice",
  created_at: new Date(Date.UTC(2026, 2, 3, 10, 0, 0)),
  modified_at: "2026-03-04T10:00:00.000Z",
  last_server_seq: "7",
  durable_state: { cursor: 41 },
  ...overrides,
});

const registrationRow = (overrides: Partial<AgentRegistrationRow> = {}): AgentRegistrationRow => ({
  id: REGISTRATION_ID,
  principal_subject: "alice",
  agent_key: "agent-1",
  display_name: null,
  enabled: true,
  created_at: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)),
  ...overrides,
});

describe("postgres agent registration repository", () => {
  it("register upserts with the original SQL, parameters and optional display name", async () => {
    const double = createDatabaseDouble([{
      rows: [registrationRow({ display_name: "Willa", created_at: "2026-01-02T03:04:05.678Z" })],
    }]);
    const repository = createPostgresAgentRegistrationRepository(double.client);

    const record = await repository.register({
      principalSubject: "alice",
      agentKey: "agent-1",
      displayName: "Willa",
    });

    expect(double.calls).toHaveLength(1);
    expect(callAt(double.calls, 0).surface).toBe("client");
    expect(callAt(double.calls, 0).text.replace(/\s+/g, " ").trim()).toBe(
      "INSERT INTO agent_registrations (principal_subject, agent_key, display_name)"
      + " VALUES ($1, $2, $3)"
      + " ON CONFLICT (principal_subject, agent_key)"
      + " DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, agent_registrations.display_name)"
      + " RETURNING id, principal_subject, agent_key, display_name, enabled, created_at",
    );
    expect([...callAt(double.calls, 0).values]).toEqual(["alice", "agent-1", "Willa"]);
    expect(record).toEqual({
      id: REGISTRATION_ID,
      principalSubject: "alice",
      agentKey: "agent-1",
      displayName: "Willa",
      enabled: true,
      createdAt: "2026-01-02T03:04:05.678Z",
    });
  });

  it("register maps a missing display name to undefined (port optional mapping)", async () => {
    const double = createDatabaseDouble([{ rows: [registrationRow()] }]);
    const repository = createPostgresAgentRegistrationRepository(double.client);

    const record = await repository.register({ principalSubject: "alice", agentKey: "agent-1" });

    expect([...callAt(double.calls, 0).values]).toEqual(["alice", "agent-1", null]);
    expect(record.displayName).toBeUndefined();
    expect(record.createdAt).toBe("2026-01-02T03:04:05.678Z");
  });

  it("register maps a driver failure through the owned error vocabulary", async () => {
    const double = createDatabaseDouble([], { failAllWith: new SimulatedDriverError("23505") });
    const repository = createPostgresAgentRegistrationRepository(double.client);

    const attempt = repository.register({ principalSubject: "alice", agentKey: "agent-1" });

    await expect(attempt).rejects.toMatchObject({
      code: "conflict",
      message: "The resource already exists with different immutable fields.",
    });
  });

  it("register keeps a missing RETURNING row a sanitized database failure", async () => {
    const double = createDatabaseDouble([{ rows: [] }]);
    const repository = createPostgresAgentRegistrationRepository(double.client);

    await expect(
      repository.register({ principalSubject: "alice", agentKey: "agent-1" }),
    ).rejects.toHaveProperty("message", "The durable store operation failed.");
  });

  it("getById returns the mapped record for the UUID parameter", async () => {
    const double = createDatabaseDouble([{ rows: [registrationRow()] }]);
    const repository = createPostgresAgentRegistrationRepository(double.client);

    const record = await repository.getById(REGISTRATION_ID);

    expect(callAt(double.calls, 0).text.replace(/\s+/g, " ")).toBe(
      "SELECT id, principal_subject, agent_key, display_name, enabled, created_at"
      + " FROM agent_registrations WHERE id = $1::uuid",
    );
    expect([...callAt(double.calls, 0).values]).toEqual([REGISTRATION_ID]);
    expect(record).toEqual({
      id: REGISTRATION_ID,
      principalSubject: "alice",
      agentKey: "agent-1",
      displayName: undefined,
      enabled: true,
      createdAt: "2026-01-02T03:04:05.678Z",
    });
  });

  it("getById preserves the undefined absence sentinel", async () => {
    const double = createDatabaseDouble([{ rows: [] }]);
    const repository = createPostgresAgentRegistrationRepository(double.client);

    await expect(repository.getById(REGISTRATION_ID)).resolves.toBeUndefined();
  });

  it("getById sends constraint violations to the sanitized database class", async () => {
    const double = createDatabaseDouble([], { failAllWith: new SimulatedDriverError("42P01") });
    const repository = createPostgresAgentRegistrationRepository(double.client);

    await expect(repository.getById(REGISTRATION_ID)).rejects.toMatchObject({
      code: "database",
      message: "The durable store operation failed.",
    });
  });
});

describe("postgres durable sessions — transaction-local ensureSession", () => {
  it("ensureSession inserts with the original parameters, including the JSONB payload", async () => {
    const double = createDatabaseDouble([{ rows: [sessionRow()] }]);
    const input = sessionInput();

    const ensured = await ensureSession(double.client, input);

    expect(double.calls.map((call) => call.text.trimStart().slice(0, 6))).toEqual(["INSERT"]);
    const inserted = callAt(double.calls, 0);
    expect(inserted.text.replace(/\s+/g, " ").trim()).toBe(
      "INSERT INTO sessions ( session_uri, session_type_id, provider_id, owner_principal_subject, "
      + "created_at, modified_at, last_server_seq, durable_state ) "
      + "VALUES ($1, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::jsonb) "
      + "ON CONFLICT (session_uri) DO NOTHING "
      + "RETURNING session_uri, session_type_id, provider_id, owner_principal_subject, "
      + "created_at, modified_at, last_server_seq, durable_state",
    );
    expect(double.connectCount()).toBe(0);
    expect(double.calls.map((call) => call.surface)).toEqual(["client"]);
    expect(inserted.values[0]).toBe(SESSION_URI);
    expect(inserted.values[1]).toBe(null);
    expect(inserted.values[2]).toBe("ahp-mock");
    expect(inserted.values[3]).toBe("alice");
    expect(inserted.values[4]).toBe("2026-10-22T10:00:00.000Z");
    expect(inserted.values[5]).toBe("2026-10-22T10:05:00.000Z");
    expect(inserted.values[6]).toBe(15);
    expect(inserted.values[7]).toBe(JSON.stringify({ cursor: 42 }));
    expect(ensured.lastServerSeq).toBe(7);
    expect(typeof ensured.lastServerSeq).toBe("number");
    expect(ensured.durableState).toEqual({ cursor: 41 });
    expect(ensured.createdAt).toBe("2026-03-03T10:00:00.000Z");
    expect(ensured.modifiedAt).toBe("2026-03-04T10:00:00.000Z");
    expect(ensured.sessionTypeId).toBeUndefined();
  });

  it("ensureSession falls through to the owner-checked sequence-monotonic update", async () => {
    const double = createDatabaseDouble([
      { rows: [] },
      { rows: [sessionRow({ owner_principal_subject: "alice" })] },
      { rows: [sessionRow({ last_server_seq: "20" })] },
    ]);

    const ensured = await ensureSession(double.client, sessionInput({ lastServerSeq: 20 }));

    expect(double.calls.map((call) => call.text.trimStart().slice(0, 6))).toEqual([
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    const update = callAt(double.calls, 2);
    expect(update.values[0]).toBe(SESSION_URI);
    expect(update.values[1]).toBe("2026-10-22T10:05:00.000Z");
    expect(update.values[2]).toBe(20);
    expect(update.values[3]).toBe(JSON.stringify({ cursor: 42 }));
    expect(update.text.replace(/\s+/g, " ")).toContain(
      "modified_at = GREATEST(modified_at, $2::timestamptz)",
    );
    expect(update.text.replace(/\s+/g, " ")).toContain(
      "last_server_seq = GREATEST(last_server_seq, $3)",
    );
    expect(update.text.replace(/\s+/g, " ")).toContain(
      "durable_state = CASE WHEN $3 >= last_server_seq THEN $4::jsonb ELSE durable_state END",
    );
    expect(ensured.lastServerSeq).toBe(20);
  });

  it("ensureSession serializes an undefined durable state as an empty object", async () => {
    const double = createDatabaseDouble([{ rows: [sessionRow()] }]);
    const input = sessionInput({ durableState: undefined });

    await ensureSession(double.client, input);

    expect(callAt(double.calls, 0).values[7]).toBe("{}");
  });

  it("ensureSession rejects a projection owned by another principal as unauthorized", async () => {
    const double = createDatabaseDouble([
      { rows: [] },
      { rows: [sessionRow({ owner_principal_subject: "bob" })] },
    ]);

    const attempt = ensureSession(double.client, sessionInput());

    await expect(attempt).rejects.toMatchObject({
      code: "unauthorized",
      message: "The session belongs to another principal.",
    });
  });

  it("ensureSession treats a vanished row as a database failure", async () => {
    const double = createDatabaseDouble([{ rows: [] }, { rows: [] }]);

    await expect(ensureSession(double.client, sessionInput())).rejects.toMatchObject({
      code: "database",
      message: "The durable session projection was lost during insertion.",
    });
  });
});

describe("postgres durable session repository", () => {
  it("ensure runs the projection primitive on ONE client acquired ONCE", async () => {
    const double = createDatabaseDouble([
      { rows: [] },
      { rows: [sessionRow()] },
      { rows: [sessionRow({ last_server_seq: "15" })] },
    ]);
    const repository = createPostgresDurableSessionRepository(double.pool);

    await repository.ensure(sessionInput());

    expect(double.connectCount()).toBe(1);
    const surfaces = new Set(double.calls.map((call) => call.surface));
    expect([...surfaces]).toEqual(["client"]);
    expect(double.calls.map((call) => call.text.trimStart().slice(0, 5))).toEqual([
      "BEGIN",
      "INSER",
      "SELEC",
      "UPDAT",
      "COMMI",
    ]);
  });

  it("ensure failures surface through the sanitized owned class", async () => {
    const double = createDatabaseDouble([], { failAllWith: new SimulatedDriverError("23503") });
    const repository = createPostgresDurableSessionRepository(double.pool);

    await expect(repository.ensure(sessionInput())).rejects.toMatchObject({
      code: "not_found",
      message: "The referenced resource does not exist.",
    });
    expect(double.connectCount()).toBe(1);
  });

  it("get selects the projection by session URI and maps the row", async () => {
    const double = createDatabaseDouble([{ rows: [sessionRow()] }]);
    const repository = createPostgresDurableSessionRepository(double.pool);

    const projected = await repository.get(SESSION_URI);

    expect(callAt(double.calls, 0).surface).toBe("pool");
    expect(callAt(double.calls, 0).text.replace(/\s+/g, " ")).toBe(
      "SELECT session_uri, session_type_id, provider_id, owner_principal_subject,"
      + " created_at, modified_at, last_server_seq, durable_state"
      + " FROM sessions WHERE session_uri = $1",
    );
    expect([...callAt(double.calls, 0).values]).toEqual([SESSION_URI]);
    expect(projected).toEqual({
      sessionUri: SESSION_URI,
      ownerPrincipalSubject: "alice",
      providerId: "ahp-mock",
      sessionTypeId: undefined,
      createdAt: "2026-03-03T10:00:00.000Z",
      modifiedAt: "2026-03-04T10:00:00.000Z",
      lastServerSeq: 7,
      durableState: { cursor: 41 },
    });
  });

  it("get preserves the undefined absence sentinel", async () => {
    const double = createDatabaseDouble([{ rows: [] }]);
    const repository = createPostgresDurableSessionRepository(double.pool);

    await expect(repository.get(SESSION_URI)).resolves.toBeUndefined();
  });

  it("delete returns true only for a deleted row and false for no affected row", async () => {
    const deleted = createDatabaseDouble([
      { rows: [{ session_uri: SESSION_URI }], rowCount: 1 },
    ]);
    const repository = createPostgresDurableSessionRepository(deleted.pool);
    await expect(repository.delete(SESSION_URI)).resolves.toBe(true);

    const absent = createDatabaseDouble([{ rows: [], rowCount: 0 }]);
    await expect(
      createPostgresDurableSessionRepository(absent.pool).delete(SESSION_URI),
    ).resolves.toBe(false);

    expect(callAt(deleted.calls, 0).text).toBe(
      "DELETE FROM sessions WHERE session_uri = $1 RETURNING session_uri",
    );
    expect([...callAt(deleted.calls, 0).values]).toEqual([SESSION_URI]);
  });

  it("delete maps the dependent-work constraint (23503) to conflict over the generic class", async () => {
    const double = createDatabaseDouble([], { failAllWith: new SimulatedDriverError("23503") });
    const repository = createPostgresDurableSessionRepository(double.pool);

    await expect(repository.delete(SESSION_URI)).rejects.toMatchObject({
      code: "conflict",
      message: "The session still has dependent work.",
    });
  });

  it("delete maps other driver failures to the database class", async () => {
    const double = createDatabaseDouble([], { failAllWith: new SimulatedDriverError("42P01") });
    const repository = createPostgresDurableSessionRepository(double.pool);

    await expect(repository.delete(SESSION_URI)).rejects.toMatchObject({
      code: "database",
      message: "The durable store operation failed.",
    });
  });

  it("the optional session type fields stay unclaimed (F-P00-2 characterization)", () => {
    const row = sessionRow();
    expect(row).not.toHaveProperty("session_type_key");
    expect(row).not.toHaveProperty("session_type_version");
  });
});

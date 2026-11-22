import type { PoolClientLike, PoolLike } from "@persistence/helpers/adapters/postgres/helpers/connection";
import { createPostgresWorkRepository } from "@persistence/helpers/adapters/postgres/helpers/workItems";
import type {
  DurableSessionInput,
  WorkClaimInput,
  WorkStatus,
} from "@persistence/types";
import type { WorkRow } from "@persistence/helpers/adapters/postgres/types";
import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

/** Driver-shaped failure surface the repository layers inspect. */
class SimulatedDriverError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("simulated driver failure (SQLSTATE " + code + ")");
    this.name = "SimulatedDriverError";
    this.code = code;
  }
}

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

interface WorkDatabaseDouble {
  readonly pool: PoolLike;
  readonly client: PoolClientLike;
  readonly calls: RecordedQuery[];
  connectCount(): number;
}

interface WorkDoubleConfig {
  /** All queries reject with this simulated driver error. */
  readonly failAllWith?: Error;
  /** Any statement matching this predicate rejects with `failReason`. */
  readonly failOn?: (text: string) => boolean;
  readonly failReason?: SimulatedDriverError;
}

/** Transaction control statements never consume planned results. */
const CONTROL_STATEMENTS = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);

const FAILED_LEASE_WORK = "The referenced resource does not exist.";
const DATABASE_WORK = "The durable store operation failed.";

const callAt = (calls: readonly RecordedQuery[], index: number): RecordedQuery => {
  const call = calls[index];
  if (call === undefined) {
    throw new Error("no recorded statement at index " + String(index));
  }
  return call;
};

const normalized = (text: string): string => text.replace(/\s+/g, " ").trim();

const createWorkDouble = (
  planned: PlannedQueryResult[],
  config: WorkDoubleConfig = {},
): WorkDatabaseDouble => {
  const calls: RecordedQuery[] = [];
  let connects = 0;
  const createQuery = (
    surface: "pool" | "client",
  ): PoolClientLike["query"] => <T extends QueryResultRow = never>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> => {
    calls.push({ text, values: values ?? [], surface });
    if (config.failAllWith !== undefined) {
      return Promise.reject(config.failAllWith);
    }
    if (config.failOn !== undefined && config.failOn(text)) {
      return Promise.reject(config.failReason ?? new SimulatedDriverError("P0001"));
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
    const next = planned.shift();
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
  const client: PoolClientLike = {
    query: createQuery("client"),
    release() {
      // Release accounting for withTransaction is covered by connection.test.ts.
    },
  };
  const pool: PoolLike = {
    connect: (): Promise<PoolClientLike> => {
      connects += 1;
      return Promise.resolve(client);
    },
    query: createQuery("pool"),
  };
  return { pool, client, calls, connectCount: () => connects };
};

const WORK_ID = "018f4d1e-aaaa-7c8d-9e0f-1a2b3c4d5e6f";
const REGISTRATION_ID = "018f4d1e-bbbb-7c8d-9e0f-1a2b3c4d5e6f";
const SESSION_URI = "ahp-session:/p05-unit";

const sessionInput = (): DurableSessionInput => ({
  sessionUri: SESSION_URI,
  ownerPrincipalSubject: "alice",
  providerId: "ahp-mock",
  createdAt: "2026-10-22T10:00:00.000Z",
  modifiedAt: "2026-10-22T10:05:00.000Z",
  lastServerSeq: 15,
  durableState: { cursor: 42 },
});

const sessionRow = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  session_uri: SESSION_URI,
  session_type_id: null,
  provider_id: "ahp-mock",
  owner_principal_subject: "alice",
  created_at: "2026-10-22T10:00:00.000Z",
  modified_at: "2026-10-22T10:05:00.000Z",
  last_server_seq: "15",
  durable_state: { cursor: 42 },
  ...overrides,
});

const claimInput = (overrides: Partial<WorkClaimInput> = {}): WorkClaimInput => ({
  sessionUri: SESSION_URI,
  agentId: REGISTRATION_ID,
  principalSubject: "alice",
  kinds: ["turn.process"],
  ...overrides,
});

const fenceInput = () => ({
  workId: WORK_ID,
  agentId: REGISTRATION_ID,
  principalSubject: "alice",
  token: "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
});

const workRow = (overrides: Partial<WorkRow> = {}): WorkRow => ({
  id: WORK_ID,
  session_uri: SESSION_URI,
  request_key: "req-1",
  kind: "turn.process",
  input: { prompt: "hi" },
  status: "queued",
  target_agent_id: null,
  lease_agent_id: null,
  lease_token: null,
  lease_expires_at: null,
  attempt_count: 0,
  max_attempts: 3,
  result: null,
  created_at: new Date(Date.UTC(2026, 9, 22, 9, 0, 0)),
  updated_at: new Date(Date.UTC(2026, 9, 22, 9, 0, 0)),
  ...overrides,
});

const leaseRow = (): Record<string, unknown> => ({
  id: WORK_ID,
  session_uri: SESSION_URI,
  kind: "turn.process",
  input: { prompt: "hi" },
  lease_token: "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
  lease_expires_at: "2026-10-22T10:05:00.000Z",
  attempt_count: 2,
});

const submitPlanInsert = (): PlannedQueryResult[] => [
  { rows: [sessionRow()] },
  { rows: [{ id: WORK_ID }] },
];

const statementPrefixes = (double: WorkDatabaseDouble): string[] =>
  double.calls.map((call) => call.text.trimStart().split(/\s+/)[0] ?? "");

describe("postgres work repository — submit (one transaction: session + work on one client)", () => {
  it("submit runs ensureSession, the work insert and COMMIT on ONE client acquired ONCE", async () => {
    const double = createWorkDouble(submitPlanInsert());
    const repository = createPostgresWorkRepository(double.pool);

    const outcome = await repository.submit({
      session: sessionInput(),
      requestKey: "req-1",
      kind: "turn.process",
      input: { prompt: "hi" },
    });

    expect(outcome).toEqual({ id: WORK_ID, created: true });
    expect(double.connectCount()).toBe(1);
    expect([...new Set(double.calls.map((call) => call.surface))]).toEqual(["client"]);
    expect(statementPrefixes(double)).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
    const sessionInsert = callAt(double.calls, 1);
    expect(normalized(sessionInsert.text)).toContain("INSERT INTO sessions");
    expect(sessionInsert.values[0]).toBe(SESSION_URI);
    const workInsert = callAt(double.calls, 2);
    expect(normalized(workInsert.text)).toEqual(
      "INSERT INTO work_items (session_uri, request_key, kind, input, target_agent_id)"
      + " VALUES ($1, $2, $3, $4::jsonb, $5::uuid)"
      + " ON CONFLICT (session_uri, request_key) DO NOTHING RETURNING id",
    );
    expect([...workInsert.values]).toEqual([
      SESSION_URI,
      "req-1",
      "turn.process",
      JSON.stringify({ prompt: "hi" }),
      null,
    ]);
  });

  it("submit pins the optional target agent and JSONB payload binding", async () => {
    const double = createWorkDouble(submitPlanInsert());
    const repository = createPostgresWorkRepository(double.pool);

    await repository.submit({
      session: sessionInput(),
      requestKey: "req-1",
      kind: "turn.process",
      input: { prompt: "hi" },
      targetAgentId: REGISTRATION_ID,
    });

    expect([...callAt(double.calls, 2).values]).toEqual([
      SESSION_URI,
      "req-1",
      "turn.process",
      JSON.stringify({ prompt: "hi" }),
      REGISTRATION_ID,
    ]);
  });

  it("a repeated key with the same JSONB payload replays the existing ID (created=false)", async () => {
    const double = createWorkDouble([
      { rows: [sessionRow()] },
      { rows: [] },
      { rows: [{ id: WORK_ID, same_payload: true }] },
    ]);
    const repository = createPostgresWorkRepository(double.pool);

    const outcome = await repository.submit({
      session: sessionInput(),
      requestKey: "req-1",
      kind: "turn.process",
      input: { prompt: "hi" },
    });

    expect(outcome).toEqual({ id: WORK_ID, created: false });
    expect(statementPrefixes(double)).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "SELECT",
      "COMMIT",
    ]);
    const lookup = callAt(double.calls, 3);
    expect(normalized(lookup.text)).toEqual(
      "SELECT id,"
      + " (kind = $3 AND input = $4::jsonb AND target_agent_id IS NOT DISTINCT FROM $5::uuid) AS same_payload"
      + " FROM work_items WHERE session_uri = $1 AND request_key = $2",
    );
    expect([...lookup.values]).toEqual([
      SESSION_URI,
      "req-1",
      "turn.process",
      JSON.stringify({ prompt: "hi" }),
      null,
    ]);
  });

  it("a repeated key with different work raises the exact conflict", async () => {
    const double = createWorkDouble([
      { rows: [sessionRow()] },
      { rows: [] },
      { rows: [{ id: WORK_ID, same_payload: false }] },
    ]);
    const repository = createPostgresWorkRepository(double.pool);

    const attempt = repository.submit({
      session: sessionInput(),
      requestKey: "req-1",
      kind: "turn.process",
      input: { prompt: "bye" },
    });

    await expect(attempt).rejects.toMatchObject({
      code: "conflict",
      message: "The request key was already used with different work.",
    });
    // Characterization note: the legacy module throws the conflict INSIDE the
    // transaction callback, so withTransaction rolls the unit back — any
    // session projection written before the conflict lookup is discarded with
    // it (RepositoryError identity passes through databaseFailure untouched).
    expect(statementPrefixes(double)).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "SELECT",
      "ROLLBACK",
    ]);
    expect(double.calls.some((call) => call.text === "COMMIT")).toBe(false);
  });

  it("a vanished conflict-lookup row is a database failure, not a fake replay", async () => {
    const double = createWorkDouble([
      { rows: [sessionRow()] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = createPostgresWorkRepository(double.pool);

    await expect(
      repository.submit({
        session: sessionInput(),
        requestKey: "req-1",
        kind: "turn.process",
        input: { prompt: "hi" },
      }),
    ).rejects.toMatchObject({
      code: "database",
      message: "The work row disappeared during idempotent submission.",
    });
  });

  it("a work-insert failure after the session write rolls back the WHOLE unit with no COMMIT", async () => {
    const double = createWorkDouble(
      [{ rows: [sessionRow()] }],
      {
        failOn: (text) => text.includes("INSERT INTO work_items"),
        failReason: new SimulatedDriverError("23503"),
      },
    );
    const repository = createPostgresWorkRepository(double.pool);

    await expect(
      repository.submit({
        session: sessionInput(),
        requestKey: "req-1",
        kind: "turn.process",
        input: { prompt: "hi" },
      }),
    ).rejects.toMatchObject({
      code: "not_found",
      message: FAILED_LEASE_WORK,
    });
    expect(statementPrefixes(double)).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "ROLLBACK",
    ]);
    expect(double.calls.some((call) => call.text === "COMMIT")).toBe(false);
    expect(double.connectCount()).toBe(1);
  });

  it("submit maps driver failures to the sanitized owned class", async () => {
    const double = createWorkDouble([], { failAllWith: new SimulatedDriverError("23503") });
    const repository = createPostgresWorkRepository(double.pool);

    await expect(
      repository.submit({
        session: sessionInput(),
        requestKey: "req-1",
        kind: "turn.process",
        input: { prompt: "hi" },
      }),
    ).rejects.toMatchObject({ code: "not_found", message: FAILED_LEASE_WORK });
    expect(double.connectCount()).toBe(1);
    expect(double.calls.some((call) => call.text === "COMMIT")).toBe(false);
  });
});

describe("postgres work repository — claim (atomic scout; pool surface, no client)", () => {
  it("claim carries the vulnerable predicates and maps the lease record", async () => {
    const double = createWorkDouble([{ rows: [leaseRow()] }]);
    const repository = createPostgresWorkRepository(double.pool);

    const lease = await repository.claim({
      agentId: REGISTRATION_ID,
      principalSubject: "alice",
      sessionUri: SESSION_URI,
      kinds: ["turn.process", "tool.call"],
    });

    expect(double.connectCount()).toBe(0);
    expect(callAt(double.calls, 0).surface).toBe("pool");
    const text = normalized(callAt(double.calls, 0).text);
    expect(text).toContain("FOR UPDATE OF w SKIP LOCKED");
    expect(text).toContain("w.status = 'queued'");
    expect(text).toContain("(w.status = 'leased' AND w.lease_expires_at <= statement_timestamp())");
    expect(text).toContain("w.attempt_count < w.max_attempts");
    expect(text).toContain("w.kind = ANY($4::text[])");
    expect(text).toContain("(w.target_agent_id IS NULL OR w.target_agent_id = a.id)");
    expect(text).toContain("ORDER BY w.created_at, w.id");
    expect(text).toContain("lease_token = gen_random_uuid()");
    expect(text).toContain(
      "lease_expires_at = statement_timestamp() + ($5::int * INTERVAL '1 second')",
    );
    expect(text).toContain("attempt_count = w.attempt_count + 1");
    expect([...callAt(double.calls, 0).values]).toEqual([
      REGISTRATION_ID,
      SESSION_URI,
      "alice",
      ["turn.process", "tool.call"],
      60,
    ]);
    expect(lease).toEqual({
      workId: WORK_ID,
      sessionUri: SESSION_URI,
      kind: "turn.process",
      input: { prompt: "hi" },
      leaseToken: "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
      leaseExpiresAt: "2026-10-22T10:05:00.000Z",
      attempt: 2,
    });
  });

  it("claim keeps the configured lease TTL and the exact default", async () => {
    const defaultTtl = createWorkDouble([{ rows: [] }]);
    await createPostgresWorkRepository(defaultTtl.pool).claim({
      agentId: REGISTRATION_ID,
      principalSubject: "alice",
      sessionUri: SESSION_URI,
      kinds: ["turn.process"],
    });
    expect([...callAt(defaultTtl.calls, 0).values][4]).toBe(60);

    const customTtl = createWorkDouble([{ rows: [] }]);
    await createPostgresWorkRepository(customTtl.pool, { leaseTtlSeconds: 90 }).claim({
      agentId: REGISTRATION_ID,
      principalSubject: "alice",
      sessionUri: SESSION_URI,
      kinds: ["turn.process"],
    });
    expect([...callAt(customTtl.calls, 0).values][4]).toBe(90);
  });

  it("claim returns null for no candidate and maps driver failures", async () => {
    const empty = createWorkDouble([{ rows: [] }]);
    await expect(
      createPostgresWorkRepository(empty.pool).claim({
        agentId: REGISTRATION_ID,
        principalSubject: "alice",
        sessionUri: SESSION_URI,
        kinds: ["turn.process"],
      }),
    ).resolves.toBeNull();

    const failing = createWorkDouble([], {
      failAllWith: new SimulatedDriverError("23503"),
    });
    await expect(
      createPostgresWorkRepository(failing.pool).claim(claimInput()),
    ).rejects.toMatchObject({ code: "not_found", message: FAILED_LEASE_WORK });
  });
});

describe("postgres work repository — renew/complete (fenced pool-surface settlement)", () => {
  it("renew re-extends only the still-live lease and preserves the principal guard", async () => {
    const double = createWorkDouble([
      { rows: [{ lease_expires_at: "2026-10-22T11:30:00.000Z" }] },
    ]);
    const repository = createPostgresWorkRepository(double.pool, { leaseTtlSeconds: 90 });

    const renewed = await repository.renew(fenceInput());

    const text = normalized(callAt(double.calls, 0).text);
    expect(text).toContain(
      "lease_expires_at = statement_timestamp() + ($4::int * INTERVAL '1 second')",
    );
    expect(text).toContain("lease_agent_id = $2::uuid");
    expect(text).toContain("lease_token = $3::uuid");
    expect(text).toContain("lease_expires_at > statement_timestamp()");
    expect(text).toContain("a.principal_subject = $5");
    expect(text).toContain("s.owner_principal_subject = $5");
    expect([...callAt(double.calls, 0).values]).toEqual([
      WORK_ID,
      REGISTRATION_ID,
      "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
      90,
      "alice",
    ]);
    expect(renewed).toEqual({ leaseExpiresAt: "2026-10-22T11:30:00.000Z" });
  });

  it("renew returns null when the fence no longer holds", async () => {
    const double = createWorkDouble([{ rows: [] }]);
    await expect(createPostgresWorkRepository(double.pool).renew(fenceInput())).resolves.toBeNull();
  });

  it("complete settles conditionally and clears the lease columns", async () => {
    const settled = createWorkDouble([{ rows: [{ id: WORK_ID }] }]);
    const repository = createPostgresWorkRepository(settled.pool);

    const completed = repository.complete({
      workId: WORK_ID,
      agentId: REGISTRATION_ID,
      token: "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
      principalSubject: "alice",
      result: { answer: 1 },
    });

    await expect(completed).resolves.toBe(true);
    const completeCall = callAt(settled.calls, 0);
    const text = normalized(completeCall.text);
    expect(completeCall.surface).toBe("pool");
    expect(text).toContain("SET status = 'completed'");
    expect(text).toContain("result = $4::jsonb");
    expect(text).toContain("lease_agent_id = NULL");
    expect(text).toContain("lease_token = NULL");
    expect(text).toContain("lease_expires_at = NULL");
    expect(text).toContain("lease_token = $3::uuid");
    expect(text).toContain("RETURNING id");
    expect([...completeCall.values]).toEqual([
      WORK_ID,
      REGISTRATION_ID,
      "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
      JSON.stringify({ answer: 1 }),
      "alice",
    ]);

    const missed = createWorkDouble([{ rows: [], rowCount: 0 }]);
    await expect(
      createPostgresWorkRepository(missed.pool).complete({ ...fenceInput(), result: undefined }),
    ).resolves.toBe(false);
    const missedValues = callAt(missed.calls, 0).values;
    expect(missedValues[3]).toBe(JSON.stringify(undefined));
  });
});

describe("postgres work repository — fail (transaction: locked select then status decision)", () => {
  it("fail requeues a retryable failure with remaining budget, on ONE client", async () => {
    const double = createWorkDouble([
      { rows: [{ status: "leased", attempt_count: 1, max_attempts: 3 }] },
      { rows: [] },
    ]);
    const repository = createPostgresWorkRepository(double.pool);

    const outcome = await repository.fail({ ...fenceInput(), retryable: true });

    expect(outcome).toBe("queued");
    expect(double.connectCount()).toBe(1);
    expect([...new Set(double.calls.map((call) => call.surface))]).toEqual(["client"]);
    expect(statementPrefixes(double)).toEqual(["BEGIN", "SELECT", "UPDATE", "COMMIT"]);
    const select = callAt(double.calls, 1);
    const selectText = normalized(select.text);
    expect(selectText).toContain("w.status = 'leased'");
    expect(selectText).toContain("FOR UPDATE OF w");
    expect(selectText).toContain("a.principal_subject = $4");
    expect(selectText).toContain("s.owner_principal_subject = $4");
    expect([...select.values]).toEqual([
      WORK_ID,
      REGISTRATION_ID,
      "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
      "alice",
    ]);
    const update = callAt(double.calls, 2);
    expect(normalized(update.text)).toContain("SET status = $2");
    expect([...update.values]).toEqual([WORK_ID, "queued"]);
  });

  it("fail terminalizes a non-retryable failure or an exhausted budget", async () => {
    const nonRetryable = createWorkDouble([
      { rows: [{ status: "leased", attempt_count: 1, max_attempts: 3 }] },
      { rows: [] },
    ]);
    await expect(
      createPostgresWorkRepository(nonRetryable.pool).fail({ ...fenceInput(), retryable: false }),
    ).resolves.toBe("failed");
    expect([...callAt(nonRetryable.calls, 2).values]).toEqual([WORK_ID, "failed"]);

    const exhausted = createWorkDouble([
      { rows: [{ status: "leased", attempt_count: 3, max_attempts: 3 }] },
      { rows: [] },
    ]);
    await expect(
      createPostgresWorkRepository(exhausted.pool).fail({ ...fenceInput(), retryable: true }),
    ).resolves.toBe("failed");
  });

  it("fail returns null without an UPDATE when the lease no longer validates", async () => {
    const double = createWorkDouble([{ rows: [] }]);
    const repository = createPostgresWorkRepository(double.pool);

    await expect(repository.fail({ ...fenceInput(), retryable: true })).resolves.toBeNull();
    expect(statementPrefixes(double)).toEqual(["BEGIN", "SELECT", "COMMIT"]);
  });
});

describe("postgres work repository — cancel (transaction; terminal rows stay terminal)", () => {
  it("cancel locks, skirts terminal rows, and cancels an active one — all in one transaction", async () => {
    const terminal = createWorkDouble([{ rows: [{ status: "completed" }] }]);
    await expect(
      createPostgresWorkRepository(terminal.pool).cancel({
        workId: WORK_ID,
        principalSubject: "alice",
      }),
    ).resolves.toBe("completed");
    expect(statementPrefixes(terminal)).toEqual(["BEGIN", "SELECT", "COMMIT"]);
    const terminalText = normalized(callAt(terminal.calls, 1).text);
    expect(terminalText).toContain("JOIN sessions AS s ON s.session_uri = w.session_uri");
    expect(terminalText).toContain("s.owner_principal_subject = $2");
    expect(terminalText).toContain("FOR UPDATE OF w");

    const active = createWorkDouble([
      { rows: [{ status: "leased" }] },
      { rows: [{ status: "cancelled" }] },
    ]);
    await expect(
      createPostgresWorkRepository(active.pool).cancel({
        workId: WORK_ID,
        principalSubject: "alice",
      }),
    ).resolves.toBe("cancelled");
    expect(statementPrefixes(active)).toEqual(["BEGIN", "SELECT", "UPDATE", "COMMIT"]);
    expect(normalized(callAt(active.calls, 2).text)).toContain("SET status = 'cancelled'");

    const missing = createWorkDouble([{ rows: [] }]);
    await expect(
      createPostgresWorkRepository(missing.pool).cancel({
        workId: WORK_ID,
        principalSubject: "alice",
      }),
    ).resolves.toBeNull();
    expect(statementPrefixes(missing)).toEqual(["BEGIN", "SELECT", "COMMIT"]);
  });
});

describe("postgres work repository — get/reconcileExpired/hasDependentWork (pool surface)", () => {
  it("get maps the full record through the owner filter with the work null sentinel", async () => {
    const double = createWorkDouble([{
      rows: [workRow({
        status: "queued" as WorkStatus,
        target_agent_id: REGISTRATION_ID,
        created_at: "2026-10-22T09:00:00.000Z",
        updated_at: new Date(Date.UTC(2026, 9, 22, 9, 30, 0)),
      })],
    }]);
    const repository = createPostgresWorkRepository(double.pool);

    const item = await repository.get({
      workId: WORK_ID,
      principalSubject: "alice",
    });

    expect(callAt(double.calls, 0).surface).toBe("pool");
    expect(normalized(callAt(double.calls, 0).text)).toEqual(
      "SELECT w.id, w.session_uri, w.request_key, w.kind, w.input, w.status,"
      + " w.target_agent_id, w.lease_agent_id, w.lease_token, w.lease_expires_at,"
      + " w.attempt_count, w.max_attempts, w.result, w.created_at, w.updated_at"
      + " FROM work_items AS w"
      + " JOIN sessions AS s ON s.session_uri = w.session_uri"
      + " WHERE w.id = $1::uuid AND s.owner_principal_subject = $2",
    );
    expect([...callAt(double.calls, 0).values]).toEqual([WORK_ID, "alice"]);
    expect(item).toEqual({
      id: WORK_ID,
      sessionUri: SESSION_URI,
      requestKey: "req-1",
      kind: "turn.process",
      input: { prompt: "hi" },
      status: "queued",
      targetAgentId: REGISTRATION_ID,
      leaseAgentId: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      attemptCount: 0,
      maxAttempts: 3,
      result: undefined,
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: "2026-10-22T09:30:00.000Z",
    });

    const absent = createWorkDouble([{ rows: [] }]);
    await expect(
      createPostgresWorkRepository(absent.pool).get({
        workId: WORK_ID,
        principalSubject: "alice",
      }),
    ).resolves.toBeNull();
  });

  it("get maps live lease data and null results through the WorkItemRecord optionals", async () => {
    const double = createWorkDouble([{
      rows: [workRow({
        status: "leased" as WorkStatus,
        lease_agent_id: REGISTRATION_ID,
        lease_token: "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
        lease_expires_at: new Date(Date.UTC(2026, 9, 22, 10, 5, 0)),
        result: { settled: true },
      })],
    }]);
    const item = await createPostgresWorkRepository(double.pool).get({
      workId: WORK_ID,
      principalSubject: "alice",
    });
    expect(item).toEqual({
      id: WORK_ID,
      sessionUri: SESSION_URI,
      requestKey: "req-1",
      kind: "turn.process",
      input: { prompt: "hi" },
      status: "leased",
      targetAgentId: undefined,
      leaseAgentId: REGISTRATION_ID,
      leaseToken: "018f4d1e-cccc-7c8d-9e0f-1a2b3c4d5e6f",
      leaseExpiresAt: "2026-10-22T10:05:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      result: { settled: true },
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: "2026-10-22T09:00:00.000Z",
    });
  });

  it("reconcileExpired terminalizes exhausted leases and returns the affected row count", async () => {
    const double = createWorkDouble([{ rows: [], rowCount: 3 }]);
    const repository = createPostgresWorkRepository(double.pool);

    await expect(repository.reconcileExpired()).resolves.toBe(3);
    const text = normalized(callAt(double.calls, 0).text);
    expect(text).toContain("SET status = 'failed'");
    expect(text).toContain("WHERE status = 'leased'");
    expect(text).toContain("lease_expires_at <= statement_timestamp()");
    expect(text).toContain("attempt_count >= max_attempts");
    expect(callAt(double.calls, 0).values).toEqual([]);
    expect(callAt(double.calls, 0).surface).toBe("pool");

    const none = createWorkDouble([{ rows: [], rowCount: 0 }]);
    await expect(createPostgresWorkRepository(none.pool).reconcileExpired()).resolves.toBe(0);
  });

  it("hasDependentWork reflects any work referencing the session", async () => {
    const dependent = createWorkDouble([{ rows: [{ present: true }] }]);
    await expect(
      createPostgresWorkRepository(dependent.pool).hasDependentWork(SESSION_URI),
    ).resolves.toBe(true);
    expect(callAt(dependent.calls, 0).text).toBe(
      "SELECT EXISTS (SELECT 1 FROM work_items WHERE session_uri = $1) AS present",
    );
    expect([...callAt(dependent.calls, 0).values]).toEqual([SESSION_URI]);

    const free = createWorkDouble([{ rows: [{ present: false }] }]);
    await expect(
      createPostgresWorkRepository(free.pool).hasDependentWork(SESSION_URI),
    ).resolves.toBe(false);

    const empty = createWorkDouble([{ rows: [] }]);
    await expect(
      createPostgresWorkRepository(empty.pool).hasDependentWork(SESSION_URI),
    ).resolves.toBe(false);
  });
});

describe("postgres work repository — error vocabulary across surfaces", () => {
  it("pool-surface settlement errors map through the owned SQLSTATE vocabulary", async () => {
    const guard = createWorkDouble([], {
      failAllWith: new SimulatedDriverError("42P01"),
    });
    await expect(
      createPostgresWorkRepository(guard.pool).renew(fenceInput()),
    ).rejects.toMatchObject({ code: "database", message: DATABASE_WORK });

    const leaked = new Error("leaked driver detail: select * from work_items");
    await expect((async () => {
      const double = createWorkDouble([], { failAllWith: leaked });
      return createPostgresWorkRepository(double.pool).hasDependentWork(SESSION_URI);
    })()).rejects.toMatchObject({ code: "database", message: DATABASE_WORK });
  });
});

import { assertDurableResourceConformance } from "../../conformance/helpers";
import { createPostgresDurableStorage } from "@persistence/helpers/adapters/postgres";
import { testPublicLifecycle } from "./publicLifecycle";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { acquirePostgresOwnership } from "@persistence/helpers/adapters/postgres/helpers/ownership";
import { withTransaction } from "@persistence/helpers/adapters/postgres/helpers/connection";
import { testDurableAdapter } from "./durableAdapter";
import { createPostgresAgentRegistrationRepository } from "@persistence/helpers/adapters/postgres/helpers/agentRegistrations";
import { assertRegistrationQuotaConformance } from "../../conformance/helpers";
import { createPersistence } from "@persistence";
import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";

const migrations = ["0001_session_tool_baseline", "0002_agent_work", "0003_durable_session_resources"];
const migration = (name: string): Promise<string> => readFile(
  new URL(`../../../../../database/migrations/${name}.sql`, import.meta.url), "utf8",
);

const rejectsCheck = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "23514";

const sessionId = randomUUID();
const typeId = randomUUID();
const insertSession = (client: PoolClient, id = sessionId) => client.query(`INSERT INTO sessions
  (session_instance_id, domain_id, session_uri, session_type_id, provider_id, owner_principal_subject)
  VALUES ($1, 'example', $2, $3, 'provider', 'owner')`, [id, `ahp-session:/${id}`, typeId]);
const insertRoot = (client: PoolClient, id = sessionId, owner = "owner") => client.query(`INSERT INTO canonical_resources
  (session_instance_id, domain_id, kind, resource_id, instance_id, owner_principal_subject, provider_id,
   runtime_driver_key, runtime_driver_version, registration_data)
  VALUES ($1, 'example', 'session', $2, $1::uuid::text, $3, 'provider', 'session', 1, '{}')`,
[id, `ahp-session:/${id}`, owner]);

const rootAndDataLocks = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("INSERT INTO session_types (id, type_key, version, provider_id) VALUES ($1, 'sample', 1, 'provider')", [typeId]);
    await client.query("BEGIN");
    await insertSession(client);
    await assert.rejects(client.query("COMMIT"), rejectsCheck);
    await client.query("BEGIN");
    await insertSession(client);
    await insertRoot(client, sessionId, "wrong-owner");
    await assert.rejects(client.query("COMMIT"), rejectsCheck);
    for (const rootFirst of [false, true]) {
      const id = rootFirst ? randomUUID() : sessionId;
      await client.query("BEGIN");
      if (rootFirst) await insertRoot(client, id);
      await insertSession(client, id);
      if (!rootFirst) await insertRoot(client, id);
      await client.query("COMMIT");
      await client.query("BEGIN");
      await client.query("SELECT session_instance_id FROM sessions WHERE session_instance_id = $1 FOR UPDATE", [id]);
      const activateSession = "UPDATE sessions SET lifecycle_status = 'active' WHERE session_instance_id = $1";
      const activateRoot = "UPDATE canonical_resources SET lifecycle_status = 'active' WHERE session_instance_id = $1";
      await client.query(rootFirst ? activateRoot : activateSession, [id]);
      await client.query(rootFirst ? activateSession : activateRoot, [id]);
      await client.query("COMMIT");
    }
    await client.query(`INSERT INTO canonical_resources
      (session_instance_id, domain_id, kind, resource_id, instance_id, owner_principal_subject, provider_id,
       parent_resource_pk, runtime_driver_key, runtime_driver_version, registration_data)
      SELECT session_instance_id, domain_id, 'chat', child_id, child_id, owner_principal_subject, provider_id,
        resource_pk, 'chat', 1, '{}'::jsonb FROM canonical_resources CROSS JOIN unnest(ARRAY['left', 'right']) child_id
      WHERE session_instance_id = $1 AND kind = 'session'`, [sessionId]);

    const other = await pool.connect();
    try {
      await Promise.all([client.query("BEGIN"), other.query("BEGIN")]);
      const lock = "SELECT 1 FROM sessions WHERE session_instance_id = $1 FOR SHARE";
      await Promise.all([client.query(lock, [sessionId]), other.query(lock, [sessionId])]);
      const replace = "UPDATE canonical_resources SET data_revision = data_revision + 1 WHERE session_instance_id = $1 AND resource_id = $2";
      await Promise.all([client.query(replace, [sessionId, "left"]), other.query(replace, [sessionId, "right"])]);
      await Promise.all([client.query("COMMIT"), other.query("COMMIT")]);
      const written = await client.query("SELECT 1 FROM canonical_resources WHERE session_instance_id = $1 AND data_revision = 2", [sessionId]);
      assert.equal(written.rowCount, 2);
    } finally {
      await other.query("ROLLBACK");
      other.release();
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
};

const waitForBlocker = async (pool: Pool, pid: number): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid]);
    if (waiting.rowCount === 1) return;
    await setTimeout(10);
  }
  assert.fail("Expected database operation did not reach the held lock.");
};

async function parkedRegistration(url: URL, sql: Pool): Promise<void> {
  const provider = createPersistence(await createPostgresPersistenceProvider({ connectionString: url.href, maxConnections: 1 }));
  const blocker = await sql.connect();
  try {
    assert.ok(provider.durability);
    await provider.durability.acquire("p0-conformance", () => {});
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE agent_registrations IN ACCESS EXCLUSIVE MODE");
    const { rows: [row] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    assert.ok(row);
    const registration = Promise.allSettled([provider.registrations.register({ principalSubject: "parked", agentKey: "blocked" })]);
    await waitForBlocker(sql, row.pid);
    const queued = assert.rejects(provider.registrations.getById(randomUUID()), { code: "database" });
    const draining = provider.dispose();
    await Promise.race([
      queued,
      setTimeout(10_000, undefined, { ref: false }).then(() => assert.fail("A queued read exceeded the checkout deadline.")),
    ]);
    await waitForBlocker(sql, row.pid);
    await Promise.race([
      Promise.all([registration, draining]).then(([writes]) => {
        assert.equal(writes[0].status, "rejected");
      }),
      setTimeout(40_000, undefined, { ref: false }).then(() => assert.fail("Provider shutdown did not bound the parked registration.")),
    ]);
    const successor = await acquirePostgresOwnership(url.href, "p0-conformance");
    await successor.release();
    const remaining = await blocker.query("SELECT 1 FROM agent_registrations WHERE principal_subject = 'parked'");
    assert.equal(remaining.rowCount, 0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await provider.dispose();
  }
}

const ownership = async (url: string, first: Pool, second: Pool): Promise<void> => {
  const lost = Promise.withResolvers<undefined>();
  const owner = await acquirePostgresOwnership(url, "p0-conformance", () => {
    lost.resolve(undefined);
  });
  try {
    await assert.rejects(acquirePostgresOwnership(url, "p0-conformance"));
    await assert.rejects(acquirePostgresOwnership(url, "different-host"));
    await Promise.all([first, second].map((pool) => withTransaction(pool, (client) => owner.lock(client))));
    const limits = { maxPerPrincipal: 1, maxTotal: 2 };
    await assertRegistrationQuotaConformance(
      createPostgresAgentRegistrationRepository(first, limits, () => owner),
      createPostgresAgentRegistrationRepository(second, limits, () => owner),
    );
    const old = await first.connect();
    const delayed = await first.connect();
    const allowQuery = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    let matched: number | null = null;
    await delayed.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    // The old worker is admitted locally before takeover but has not locked the host row.
    const stale = assert.rejects(owner.lock({
      async query<T extends QueryResultRow>(statement: string, values?: readonly unknown[]) {
        entered.resolve(undefined);
        await allowQuery.promise;
        const result = await delayed.query<T>(statement, values && [...values]);
        matched = result.rowCount;
        return result;
      },
    }));
    try {
      await entered.promise;
      await old.query("BEGIN");
      await owner.lock(old);
      const { rows: [transaction] } = await old.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      assert.ok(transaction);
      // Scope termination to our isolated schema's exact relation advisory lock.
      const killed = await second.query<{ killed: boolean }>(`SELECT pg_terminate_backend(pid) AS killed FROM pg_locks
        WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = 0 AND objid = 'host_state'::regclass::oid AND objsubid = 1 AND granted`);
      assert.deepEqual(killed.rows, [{ killed: true }]);
      await Promise.race([lost.promise, setTimeout(5000, null, { ref: false }).then(() => assert.fail("Ownership loss did not close admission."))]);
      assert.equal(owner.isOpen(), false);
      await assert.rejects(withTransaction(second, (client) => owner.lock(client)));
      const pending = acquirePostgresOwnership(url, "p0-conformance");
      try {
        await waitForBlocker(second, transaction.pid);
      } finally {
        await old.query("COMMIT");
      }
      const replacement = await pending;
      try {
        assert.equal(BigInt(replacement.epoch), BigInt(owner.epoch) + 1n);
        allowQuery.resolve(undefined);
        await stale;
        assert.equal(matched, 0);
        await withTransaction(second, (client) => replacement.lock(client, true));
      } finally {
        await replacement.release();
      }
      await assert.rejects(acquirePostgresOwnership(url, "different-host"));
    } finally {
      allowQuery.resolve(undefined);
      await stale.catch(() => undefined);
      await delayed.query("ROLLBACK");
      delayed.release();
      await old.query("ROLLBACK");
      old.release();
    }
  } finally {
    await owner.release();
  }
};

/** Run only against an explicitly supplied, migrated disposable PostgreSQL 17 database. */
export const runP0PostgresConformance = async (input: string): Promise<void> => {
  const url = new URL(input);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const admin = new Pool({ connectionString: url.href });
  try {
    const versions = await admin.query<{ version: string }>("SELECT version FROM public.schema_migrations ORDER BY version");
    assert.deepEqual(versions.rows.map((row) => row.version), migrations);
    const server = await admin.query<{ version: number }>("SELECT current_setting('server_version_num')::int / 10000 AS version");
    assert.equal(server.rows[0]?.version, 17);
    const schema = `p0_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set("options", `-c search_path=${schema} -c statement_timeout=10000`);
    const first = new Pool({ connectionString: url.href });
    const second = new Pool({ connectionString: url.href });
    try {
      const client = await first.connect();
      try {
        await client.query(await migration("0001_session_tool_baseline"));
        await client.query(await migration("0002_agent_work"));
        await client.query("INSERT INTO agent_registrations (principal_subject, agent_key) VALUES ('legacy', 'agent')");
        const script = await migration("0003_durable_session_resources");
        await assert.rejects(client.query(script), /requires empty legacy/);
        await client.query("ROLLBACK");
        assert.equal((await client.query("DELETE FROM agent_registrations WHERE principal_subject = 'legacy'")).rowCount, 1);
        await client.query(script);
      } finally {
        client.release();
      }
      await rootAndDataLocks(first);
      await ownership(url.href, first, second);
      const providerUrl = new URL(url);
      providerUrl.searchParams.set("options", `-c search_path=${schema}`);
      await parkedRegistration(providerUrl, first);
      await testDurableAdapter(url.href, first);
      await testPublicLifecycle(url.href, first);
      await assertDurableResourceConformance(createPostgresDurableStorage({ connectionString: url.href }), "p0-conformance");
      const provider = createPersistence(await createPostgresPersistenceProvider({ connectionString: url.href }));
      try {
        assert.ok(provider.durability);
        const host = await provider.durability.acquire("p0-conformance", () => {});
        try {
          const registration = await provider.registrations.register({ principalSubject: "conformance", agentKey: "worker" });
          assert.equal((await provider.registrations.getById(registration.id))?.id, registration.id);
        } finally {
          await host.release();
        }
        await assert.rejects(provider.registrations.register({ principalSubject: "conformance", agentKey: "late" }));
      } finally {
        await provider.dispose();
      }
    } finally {
      await Promise.all([first.end(), second.end()]);
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  } finally {
    await admin.end();
  }
};

if (process.argv[1]?.endsWith("p0Conformance.ts")) {
  const url = process.env.AHP_TEST_DATABASE_URL;
  assert.ok(url, "Set AHP_TEST_DATABASE_URL to a migrated, disposable loopback PostgreSQL 17 database.");
  await runP0PostgresConformance(url);
  process.stdout.write("PostgreSQL 17 migration 0003, ownership, takeover, root constraints and independent child writes passed.\n");
}

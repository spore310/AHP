import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";
import type { ResourceRef } from "@authorization";
import type { ResourceRecord, StoredSession } from "@persistence/helpers/durability/types";
import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";

const yes = (): boolean => true;

async function waitForBlockedWrites(sql: Pool, pid: number, count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await sql.query("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid]);
    if (waiting.rowCount === count) return;
    await setTimeout(10);
  }
  assert.fail("Durable writers did not reach their expected row lock.");
}

export async function testDurableAdapter(url: string, sql: Pool): Promise<void> {
  const provider = await createPostgresPersistenceProvider({ connectionString: url });
  assert.ok(provider.durability);
  const host = await provider.durability.acquire("p0-conformance", () => {});
  try {
    const stamp = new Date().toISOString();
    const session: ResourceRef<"session"> = { domainId: "domain", kind: "session", id: "ahp-session:/p0", instanceId: randomUUID() };
    const record: StoredSession = { ref: session, type: { id: randomUUID(), key: "p0", version: 1 }, providerId: "p0", owner: "owner",
      lifecycle: "creating", state: {}, stateRevision: "1", graphRevision: "1", lastServerSeq: 0, createdAt: stamp, modifiedAt: stamp };
    const root: ResourceRecord = { ref: session, session, driver: { key: "p0", version: 1 }, providerId: "p0", owner: "owner",
      lifecycle: "creating", operationId: randomUUID(), registration: {}, recoveryInput: {}, runtimeMetadata: {}, data: {},
      dataRevision: "1", resourceRevision: "1", createdAt: stamp, modifiedAt: stamp };
    // A sequence records attempted DML even after rollback in this isolated test schema.
    await sql.query("CREATE SEQUENCE attempted_mutation");
    await sql.query(`CREATE FUNCTION observe_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('attempted_mutation'); RETURN NEW; END $$`);
    for (const table of ["session_types", "sessions", "canonical_resources", "work_items"]) {
      await sql.query(`CREATE TRIGGER observe_mutation BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION observe_mutation()`);
    }
    const mutations = async () => (await sql.query<{ n: string }>(
      "SELECT (CASE WHEN is_called THEN last_value ELSE 0 END)::text AS n FROM attempted_mutation")).rows[0]?.n;
    const deniesBeforeWrite = async (operation: () => Promise<unknown>): Promise<void> => {
      const before = await mutations();
      await assert.rejects(operation());
      assert.equal(await mutations(), before, "denied admission reached a SQL mutation");
    };
    await deniesBeforeWrite(() => host.sessions.reserve(record, root, () => false));
    await deniesBeforeWrite(() => host.sessions.reserve(record, root, () => Promise.resolve(true)));
    await deniesBeforeWrite(() => host.sessions.reserve(record, root, () => Promise.reject(new Error("async admission"))));
    assert.equal(await host.sessions.get(session), undefined);
    let admissions = 0;
    function admitCreate(): boolean {
      admissions++;
      return true;
    }
    const create = await Promise.allSettled([host.sessions.reserve(record, root, admitCreate), host.sessions.reserve(record, root, admitCreate)]);
    assert.equal(create.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(admissions, 1);
    assert.deepEqual(await host.sessions.get(session), record);
    const activate = (r: ResourceRecord) => ({ ref: r.ref, session, expected: "creating" as const, next: "active" as const, operationId: r.operationId });
    await host.sessions.transition(activate(root), yes);
    await deniesBeforeWrite(() => host.sessions.transition({ ...activate(root), expected: "active" }, () => false));
    const child = async (name: string, grantParent?: ResourceRef): Promise<ResourceRef> => {
      const row = { ...root, ref: { ...session, kind: "chat", id: name, instanceId: name }, operationId: randomUUID(),
        parent: session, ...(grantParent ? { grantParent } : {}) };
      await host.resources.reserve(row, yes);
      await host.resources.activate(activate(row), yes);
      return row.ref;
    };
    const parent = await child("parent");
    await deniesBeforeWrite(() => host.resources.reserve({ ...root, ref: { ...parent, id: "no", instanceId: "denied" }, parent: session, operationId: randomUUID() }, () => false));
    await deniesBeforeWrite(() => host.resources.replaceData(session, parent, { expectedDataRevision: "1", data: { denied: true } }, () => false));
    await deniesBeforeWrite(() => host.sessions.commitState({ ref: session, expectedRevision: "1", state: {}, serverSeq: 1, modifiedAt: stamp }, () => false));
    await deniesBeforeWrite(() => host.resources.beginRetirement(session, parent, () => false));
    const other = await child("other");
    const nested = await child("grant-child", parent);
    const elsewhere = { ...session, id: "ahp-session:/other", instanceId: randomUUID() };
    await host.sessions.reserve({ ...record, ref: elsewhere }, { ...root, ref: elsewhere, session: elsewhere, operationId: randomUUID() }, yes);
    const fresh = { ...root, ref: { ...parent, id: "new", instanceId: "new-instance" }, operationId: randomUUID() };
    await assert.rejects(host.resources.reserve({ ...fresh, parent: fresh.ref }, yes));
    await assert.rejects(host.resources.reserve({ ...fresh, parent: elsewhere }, yes));
    await assert.rejects(host.resources.reserve({ ...fresh, parent: session, grantParent: elsewhere }, yes));
    await assert.rejects(host.resources.reserve({ ...fresh, ref: parent, parent: nested }, yes));
    assert.deepEqual((await host.resources.get(parent))?.parent, session);
    for (const column of ["parent_resource_pk", "grant_parent_resource_pk"]) {
      for (const foreign of [elsewhere.domainId, "example"]) {
        await assert.rejects(sql.query(`UPDATE canonical_resources SET ${column}=(SELECT resource_pk FROM canonical_resources
          WHERE kind='session' AND session_instance_id<>$1 AND domain_id=$2 LIMIT 1)
          WHERE session_instance_id=$1 AND instance_id=$3`, [session.instanceId, foreign, parent.instanceId]),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "23503");
      }
    }
    const data = { items: ["雪", {}] };
    const initial = host.resources.replaceData(session, parent, { expectedDataRevision: "1", data }, yes);
    data.items.length = 0;
    assert.equal((await initial).status, "updated");
    assert.deepEqual((await host.resources.get(parent))?.data, { items: ["雪", {}] });
    const replace = () => host.resources.replaceData(session, parent, { expectedDataRevision: "2", data: {} }, yes);
    assert.deepEqual((await Promise.all([replace(), replace()])).map((result) => result.status).sort(), ["conflict", "updated"]);
    assert.equal((await host.resources.get(parent))?.dataRevision, "3");
    const lock = await sql.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT 1 FROM canonical_resources WHERE session_instance_id=$1 AND instance_id=ANY($2::text[]) FOR UPDATE",
        [session.instanceId, [parent.instanceId, other.instanceId]]);
      const pid = (await lock.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      assert.ok(pid);
      let admissionsAfterLock = 0;
      const admitWriter = (): boolean => {
        admissionsAfterLock++;
        return true;
      };
      const writers = Promise.all([
        host.resources.replaceData(session, parent, { data: {}, expectedDataRevision: "3" }, admitWriter),
        host.resources.replaceData(session, other, { data: {}, expectedDataRevision: "1" }, admitWriter),
      ]);
      try {
        await waitForBlockedWrites(sql, pid, 2);
        assert.equal(admissionsAfterLock, 0);
      } finally {
        await lock.query("ROLLBACK");
      }
      assert.deepEqual((await writers).map((r) => r.status), ["updated", "updated"]);
      assert.equal(admissionsAfterLock, 2);
      await lock.query("BEGIN");
      await lock.query("SELECT 1 FROM canonical_resources WHERE session_instance_id=$1 AND instance_id=$2 FOR UPDATE", [session.instanceId, other.instanceId]);
      const transition = host.resources.activate({ ref: other, session, expected: "active", next: "active", operationId: (await host.resources.get(other))?.operationId ?? "" }, yes);
      try {
        await waitForBlockedWrites(sql, pid, 1);
        // The real lifecycle writer already owns the exclusive session lock while waiting on its child.
        await assert.rejects(sql.query("SELECT 1 FROM sessions WHERE session_instance_id=$1 FOR SHARE NOWAIT", [session.instanceId]),
          (error: unknown) => error instanceof Error && "code" in error && error.code === "55P03");
      } finally {
        await lock.query("ROLLBACK");
      }
      await transition;
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }

    const write = (title: string) => host.sessions.commitState({ ref: session, expectedRevision: "1", state: { title }, serverSeq: 1,
      modifiedAt: stamp }, yes);
    assert.equal((await Promise.allSettled([write("a"), write("b")])).filter((row) => row.status === "fulfilled").length, 1);
    assert.equal((await host.sessions.get(session))?.stateRevision, "2");

    const agent = randomUUID();
    await sql.query("INSERT INTO agent_registrations (id,principal_subject,agent_key) VALUES ($1,'work-owner','fixture')", [agent]);
    async function work(key: string, ref: ResourceRef, status: string, purpose = "scope", include = true): Promise<string> {
      const result = await sql.query<{ id: string }>(`INSERT INTO work_items
        (session_instance_id,domain_id,request_key,kind,input,status,lease_agent_id,lease_token,lease_expires_at,attempt_count)
        VALUES ($1,$2,$3,'fixture','{}',$4,CASE WHEN $4 = 'leased' THEN $5::uuid END,
          CASE WHEN $4 = 'leased' THEN gen_random_uuid() END,CASE WHEN $4 = 'leased' THEN now() END,
          CASE WHEN $4 = 'leased' THEN 1 ELSE 0 END) RETURNING id`, [session.instanceId, session.domainId, key, status, agent]);
      assert.ok(result.rows[0]);
      await sql.query(`INSERT INTO work_resource_selections (work_id,session_instance_id,domain_id,purpose,resource_pk,include,include_descendants)
        SELECT $1,session_instance_id,domain_id,$2,resource_pk,$3,true FROM canonical_resources WHERE session_instance_id=$4 AND instance_id=$5`,
      [result.rows[0].id, purpose, include, session.instanceId, ref.instanceId]);
      return result.rows[0].id;
    }
    await work("queued", nested, "queued");
    const workId = await work("leased", parent, "leased");
    const readWork = { workId, principalSubject: record.owner, domainId: session.domainId };
    const view = await provider.work.get(readWork);
    assert.equal(view?.sessionInstanceId, session.instanceId);
    assert.equal(view.status, "leased");
    assert.equal("leaseToken" in view, false);
    assert.equal(await provider.work.get({ ...readWork, domainId: "another-domain" }), null);
    assert.equal(await provider.work.get({ ...readWork, principalSubject: "another-owner" }), null);
    assert.equal(await provider.work.get({ workId, principalSubject: record.owner }), null);
    await work("terminal", nested, "completed");
    await work("dynamic", session, "queued");
    await work("announced", parent, "queued", "announce");
    await work("excluded", nested, "queued", "scope", false);
    assert.equal(await host.sessions.purge(session, "2100-01-01"), false);
    const closing = await host.resources.beginRetirement(session, parent, yes);
    assert.deepEqual(closing.map((r) => r.ref.id), [nested.id, parent.id]);
    const jobs = async () => (await sql.query<{ request_key: string; status: string }>(
      "SELECT request_key,status FROM work_items WHERE session_instance_id=$1 ORDER BY request_key", [session.instanceId])).rows;
    assert.deepEqual((await jobs()).map((r) => [r.request_key, r.status]), [
      ["announced", "queued"], ["dynamic", "queued"], ["excluded", "queued"], ["leased", "cancelled"], ["queued", "cancelled"], ["terminal", "completed"],
    ]);
    assert.equal((await sql.query("SELECT 1 FROM work_items WHERE request_key='leased' AND (lease_token IS NOT NULL OR lease_agent_id IS NOT NULL OR lease_expires_at IS NOT NULL)")).rowCount, 0);
    await assert.rejects(host.resources.finishRetirement(session, parent));
    const again = await host.resources.beginRetirement(session, parent, yes);
    for (const r of again) await host.resources.finishRetirement(session, r.ref);
    await assert.rejects(host.resources.replaceData(session, nested, { data: {}, expectedDataRevision: "1" }, yes));
    const rest = await host.sessions.beginRetirement(session, yes);
    for (const r of rest.filter((r) => r.ref.kind !== "session")) await host.resources.finishRetirement(session, r.ref);
    await host.sessions.finishRetirement(session);
    assert.equal((await jobs()).filter((r) => r.status === "cancelled").length, 5);
    assert.equal(await host.sessions.purge(session, "2000-01-01"), false);
    const next = { ...session, instanceId: randomUUID() };
    await host.sessions.reserve({ ...record, ref: next }, { ...root, ref: next, session: next, operationId: randomUUID() }, yes);
    assert.equal(await provider.work.get(readWork), null);
    await assert.rejects(host.sessions.transition(activate(root), yes));
    assert.equal((await host.resources.listSession(next)).length, 1);
    assert.equal((await host.sessions.get(next))?.lifecycle, "creating");
    assert.equal(await host.sessions.purge(session, "2100-01-01"), true);
    assert.equal(await host.sessions.get(session), undefined);
    assert.equal((await jobs()).length, 0);
  } finally {
    await host.release();
    await provider.dispose();
  }
}

import assert from "node:assert/strict";
import type { Pool } from "pg";
import { loseCommitAcknowledgement } from "./commitAcknowledgement";
import type { AhpClient } from "@microsoft/agent-host-protocol/client";
import { connectClient } from "@client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { createPostgresDurableStorage, createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";
import { mockProvider } from "@sessions/mock";
import { ACTION_TYPE_SESSION_TITLE_CHANGED } from "@sessions/constants";
import { channel, createReviewHost } from "../../../../../examples/advanced/host";

/** Runs in the conformance suite's owned, migrated schema. */
export async function testPublicLifecycle(connectionString: string, db: Pool): Promise<void> {
  const persistence = await createPostgresPersistenceProvider({ connectionString });
  assert.ok(persistence.durability);
  let starts = 0;
  const demo = createReviewHost("direct", { durability: { storage: persistence.durability, hostId: "p0-conformance" }, persistence,
    provider: { ...mockProvider, startSession(input) {
      starts++;
      return mockProvider.startSession(input);
    } },
    restoration: { prepare: () => Promise.resolve({ bindings: [], isCurrent: () => true }) } });
  let client: AhpClient | undefined;
  try {
    const address = await demo.host.start();
    const events: string[] = [];
    demo.host.sessions.onSessionEnvelope((e) => {
      events.push(e.action.type);
    });
    demo.host.sessions.onCatalogueNotification((e) => {
      events.push(e.method);
    });
    await db.query("ALTER TABLE sessions ADD CONSTRAINT test_fail_reserve CHECK (session_uri <> 'ahp-session:/review')");
    await assert.rejects(demo.provision());
    assert.equal(starts, 0);
    assert.equal(demo.host.sessions.authorization?.getResource(channel), undefined);
    assert.equal(events.length, 0);
    assert.equal((await db.query("SELECT 1 FROM sessions WHERE session_uri=$1", [channel])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM canonical_resources WHERE resource_id=$1", [channel])).rowCount, 0);
    await db.query("ALTER TABLE sessions DROP CONSTRAINT test_fail_reserve");
    const pair = await Promise.allSettled([demo.provision(), demo.provision()]);
    assert.equal(pair.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(starts, 1);
    const ref = demo.origin();
    await demo.host.sessions.durability?.publishWorkReady(() => undefined);
    const saved = await db.query("SELECT state_revision,last_server_seq,durable_state FROM sessions WHERE session_instance_id=$1", [ref.instanceId]);
    const previous = demo.host.sessions.getSessionSnapshot(channel);
    const count = events.length;
    // Make the stored write succeed and the COMMIT itself return the configured SQLSTATE.
    await db.query(`CREATE FUNCTION test_commit_response() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.durable_state->>'title' = 'test-rollback' THEN
          RAISE EXCEPTION 'conformance rollback' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END $$`);
    await db.query(`CREATE CONSTRAINT TRIGGER test_commit_response AFTER UPDATE ON sessions
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_commit_response()`);
    await assert.rejects(demo.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "test-rollback" } }));
    assert.deepEqual(demo.host.sessions.getSessionSnapshot(channel), previous);
    assert.equal(events.length, count);
    assert.deepEqual((await db.query("SELECT state_revision,last_server_seq,durable_state FROM sessions WHERE session_instance_id=$1", [ref.instanceId])).rows, saved.rows);
    const work = await db.query<{ id: string }>(`WITH added AS (INSERT INTO work_items(session_instance_id,domain_id,request_key,kind,input,submitted_by_kind,submitted_by_subject)
      VALUES ($1,$2,'public-read','code.review','{}','user','senior') RETURNING id)
      INSERT INTO work_resource_selections(work_id,session_instance_id,domain_id,purpose,resource_pk,include)
      SELECT added.id,$1,$2,'scope',r.resource_pk,true FROM added,canonical_resources r WHERE r.session_instance_id=$1 AND r.kind='session'
      RETURNING work_id AS id`, [ref.instanceId, ref.domainId]);
    const workId = work.rows[0]?.id;
    assert.ok(workId);
    const socket = await WebSocketTransport.connect("ws://127.0.0.1:" + String(address.port), { protocols: "demo-senior" });
    const { protocol, rpc } = await connectClient({ transport: socket, ownership: "owned" }, { clientId: "public-sql", protocolVersions: ["1.0.0"] });
    client = protocol;
    const view: unknown = await rpc.request("x-ahp/work/get", { version: 1, workId });
    assert.ok(view && typeof view === "object" && "work" in view && view.work && typeof view.work === "object" && "id" in view.work && view.work.id === workId);
    assert.equal("leaseToken" in view.work, false);
    assert.ok(await demo.host.sessions.authorization?.disposeSession(ref));
    assert.deepEqual(await rpc.request("x-ahp/work/get", { version: 1, workId }), { version: 1, work: null });
    assert.ok(await demo.host.sessions.durability?.purge(ref, "2100-01-01"));
  } finally {
    await client?.shutdown();
    await demo.stop();
  }
  await testCommittedAcknowledgementLoss(connectionString, db);
}

async function testCommittedAcknowledgementLoss(connectionString: string, db: Pool): Promise<void> {
  const storage = createPostgresDurableStorage({ connectionString });
  const open = () => createReviewHost("direct", { durability: { storage, hostId: "p0-conformance" }, provider: mockProvider,
    restoration: { prepare: () => Promise.resolve({ bindings: [], isCurrent: () => true }) } });
  const first = open();
  const restarted = open();
  const title = "committed title after lost acknowledgement";
  try {
    await first.host.start();
    await first.provision();
    await first.host.sessions.durability?.publishWorkReady(() => undefined);
    const ref = first.origin();
    const titles: string[] = [];
    first.host.sessions.onSessionEnvelope(({ action }) => {
      if (action.type === ACTION_TYPE_SESSION_TITLE_CHANGED) titles.push(action.title);
    });

    await loseCommitAcknowledgement("UPDATE sessions SET state_revision=", ref.instanceId,
      () => first.host.sessions.dispatchAction({ channel, clientId: "lost-ack", clientSeq: 1,
        action: { type: "session/titleChanged", title } }));
    const stored = await db.query<{ title: string }>("SELECT durable_state->>'title' AS title FROM sessions WHERE session_instance_id=$1", [ref.instanceId]);
    assert.deepEqual(stored.rows, [{ title }]);
    assert.equal(first.host.sessions.getSessionSnapshot(channel), undefined);
    assert.equal(first.host.sessions.authorization?.isReady(ref), false);
    assert.deepEqual(titles, []);
    await first.stop();
    await restarted.host.start();
    assert.deepEqual(restarted.host.sessions.authorization?.getResource(channel), ref);
    assert.equal(restarted.host.sessions.getSessionSnapshot(channel)?.state.title, title);
    assert.equal(restarted.host.sessions.authorization.isReady(ref), true);
  } finally {
    await first.stop();
    await restarted.stop();
  }
}

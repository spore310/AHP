/**
 * Live acceptance driver for the multi-host topologies in docker-compose.yaml.
 *
 * It talks to independent host processes through their public endpoints and
 * the load balancer, reads authoritative facts from PostgreSQL, and kills,
 * pauses and stops containers to prove takeover, fencing and recovery.
 *
 *   docker compose -f examples/host/docker-compose.yaml up --build -d
 *   pnpm exec vite-node examples/host/acceptance.ts [--json <file>]
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { reviewWorkerKey } from "../advanced/host";
import { ExamplePeer, sessionUri } from "./support";

const composeFile = fileURLToPath(new URL("./docker-compose.yaml", import.meta.url));
const docker = (...args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile("docker", args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`docker ${args.slice(0, 4).join(" ")} failed: ${stderr.trim().split("\n").at(-1) ?? ""}`));
    else resolve(stdout);
  });
});
const compose = (...args: string[]): Promise<string> => docker("compose", "-f", composeFile, ...args);
const containerOf = async (service: string): Promise<string> => (await compose("ps", "-a", "-q", service)).trim();

interface Service { readonly hostId: string; readonly publicPort: number; readonly controlPort: number }
const services = {
  "single": { hostId: "support-single", publicPort: 18111, controlPort: 19111 },
  "app-1": { hostId: "support-app", publicPort: 18091, controlPort: 19091 },
  "app-2": { hostId: "support-app", publicPort: 18092, controlPort: 19092 },
  "production": { hostId: "support-production", publicPort: 18101, controlPort: 19101 },
  "staging": { hostId: "support-staging", publicPort: 18102, controlPort: 19102 },
  "tools-a": { hostId: "support-tools-a", publicPort: 18081, controlPort: 19081 },
  "tools-b": { hostId: "support-tools-b", publicPort: 18082, controlPort: 19082 },
  "tools-c": { hostId: "support-tools-c", publicPort: 18083, controlPort: 19083 },
} satisfies Record<string, Service>;
type ServiceName = keyof typeof services;
const tools: readonly ServiceName[] = ["tools-a", "tools-b", "tools-c"];
const toolsLb = "ws://127.0.0.1:18080/";
const appLb = "ws://127.0.0.1:18090/";
const wsOf = (service: ServiceName): string => `ws://127.0.0.1:${String(services[service].publicPort)}/`;
const serviceOfHost = (hostId: string): ServiceName => tools.find((name) => services[name].hostId === hostId) ?? (() => {
  throw new Error(`No service for ${hostId}`);
})();

interface Status {
  mode: string; phase: string; ready: boolean; hostId?: string; namespaceId?: string; instanceId?: string; generation?: string; epoch?: string;
  sessions: { uri: string; title?: string }[]; routing: { connections: number; links: number; pending: number; held: number };
  members: { hostId: string; instanceId: string; role: string }[];
  authorityRevision?: number;
}
const status = async (service: ServiceName): Promise<Status | undefined> => {
  try {
    const response = await fetch(`http://127.0.0.1:${String(services[service].controlPort)}/status`, { signal: AbortSignal.timeout(1_500) });
    return response.ok ? await response.json() as Status : undefined;
  } catch {
    return undefined;
  }
};
const controlPost = async (service: ServiceName, path: string): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
  const response = await fetch(`http://127.0.0.1:${String(services[service].controlPort)}${path}`, { method: "POST", signal: AbortSignal.timeout(20_000) });
  return { ok: response.ok, body: await response.json() as Record<string, unknown> };
};
const probe = async (service: ServiceName, path: string): Promise<number> => {
  try {
    return (await fetch(`http://127.0.0.1:${String(services[service].publicPort)}${path}`, { signal: AbortSignal.timeout(1_500) })).status;
  } catch {
    return 0;
  }
};
const until = async <T>(read: () => Promise<T | undefined | false> | T | undefined | false, label: string, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await delay(100);
  }
};
const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0) * 100) / 100;
};

const database = new Pool({ connectionString: "postgresql://ahp_example:ahp_example_local@127.0.0.1:15432/ahp_example", max: 4 });
const sql = async <T extends Record<string, unknown>>(schema: string, text: string, values: unknown[] = []): Promise<T[]> => {
  const client = await database.connect();
  try {
    await client.query(`SET search_path = ${schema}`);
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.query("RESET search_path").catch(() => undefined);
    client.release();
  }
};
const SHARED = "ahp_support__shared";
const APP = "ahp_support_happ__default";
const owners = async (): Promise<Map<string, { owner: string; epoch: string; lifecycle: string }>> => new Map((await sql<{ uri: string; owner: string; epoch: string; lifecycle: string }>(SHARED,
  "SELECT session_uri AS uri, owner_host_id AS owner, ownership_epoch::text AS epoch, lifecycle_status AS lifecycle FROM sessions WHERE lifecycle_status <> 'retired'")).map((row) => [row.uri, row]));

const peers: ExamplePeer[] = [];
const peer = async (url: string, subject: string, clientId: string, subscriptions: readonly string[] = []) => {
  const connected = await until(() => ExamplePeer.connect(url, subject).catch(() => undefined), `connection to ${url}`, 20_000);
  peers.push(connected);
  const initialized = await connected.initialize(clientId, subscriptions);
  return Object.assign(connected, { initialized });
};
const title = (uri: string, value: string, clientSeq: number) => ({ channel: uri, clientSeq, action: { type: "session/titleChanged", title: value } });
const retitle = async (target: ExamplePeer, uri: string, value: string, clientSeq: number): Promise<number> => {
  const started = performance.now();
  target.notify("dispatchAction", title(uri, value, clientSeq));
  await target.wait(() => target.actions(uri).find((envelope) => envelope.action.title === value), 10_000, `title ${value}`);
  return performance.now() - started;
};

interface Result { readonly ids: string; readonly name: string; readonly status: "PASS" | "FAIL"; readonly detail: string }
const results: Result[] = [];
const check = async (ids: string, name: string, run: () => Promise<string | undefined>): Promise<void> => {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ ids, name, status: "PASS", detail: detail ?? "" });
    process.stdout.write(`PASS  ${ids.padEnd(34)} ${name} (${String(Date.now() - started)} ms)${detail ? `\n      ${detail}` : ""}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : "failed";
    results.push({ ids, name, status: "FAIL", detail });
    process.stdout.write(`FAIL  ${ids.padEnd(34)} ${name}\n      ${detail}\n`);
  }
};

// ─── Scenario A: one host, one derived namespace, no distributed service ─────
async function scenarioA(): Promise<void> {
  await check("H9-01 H1-01 H3-01 H9-07", "A: single host serves native traffic with no database or membership", async () => {
    const state = await until(() => status("single").then((value) => value?.ready ? value : undefined), "single host ready");
    assert.deepEqual([state.mode, state.namespaceId, state.hostId], ["single", "ahp-namespace:support-single/default", "support-single"]);
    assert.equal(await probe("single", "/readyz"), 200);
    const environment = await docker("inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", await containerOf("single"));
    assert.ok(!/DATABASE|MEMBERSHIP|ROUTING/u.test(environment), "the single host is configured without distributed dependencies");
    const client = await peer(wsOf("single"), "senior", "a-senior");
    const uri = sessionUri(`single-${String(Date.now())}`);
    await client.call("createSession", { channel: uri });
    await client.call("subscribe", { channel: uri });
    await retitle(client, uri, "Single host", 1);
    assert.deepEqual((await status("single"))?.routing, { connections: 0, links: 0, pending: 0, held: 0 });
    return `namespace ${String(state.namespaceId)}, phase ${state.phase}`;
  });
}

// ─── Scenario B: active-passive replicas of one logical host ─────────────────
async function scenarioB(): Promise<void> {
  const replicas: readonly ServiceName[] = ["app-1", "app-2"];
  const roles = async (): Promise<{ active: ServiceName; standby: ServiceName; activeStatus: Status } | undefined> => {
    const states = await Promise.all(replicas.map(status));
    const active = replicas.find((_, index) => states[index]?.ready === true);
    const standby = replicas.find((_, index) => states[index]?.phase === "standby");
    const activeStatus = states[replicas.indexOf(active ?? "app-1")];
    return active !== undefined && standby !== undefined && active !== standby && activeStatus ? { active, standby, activeStatus } : undefined;
  };
  const review = sessionUri(`replicated-${String(Date.now())}`);
  let before = await until(roles, "one active and one standby replica");
  await check("H9-02 H3-02 H3-06 H1-07 H2-01", "B: one active replica and one healthy standby", async () => {
    assert.deepEqual([await probe(before.active, "/livez"), await probe(before.active, "/readyz")], [200, 200]);
    assert.deepEqual([await probe(before.standby, "/livez"), await probe(before.standby, "/startupz"), await probe(before.standby, "/readyz")], [200, 200, 503]);
    await assert.rejects(ExamplePeer.connect(wsOf(before.standby), "senior"), /503/u);
    const standby = await status(before.standby);
    assert.equal(standby?.hostId, before.activeStatus.hostId);
    assert.notEqual(standby?.instanceId, before.activeStatus.instanceId);
    const live = await sql<{ instance_id: string; role: string }>(APP, "SELECT instance_id, role FROM host_members WHERE lease_expires_at > clock_timestamp() ORDER BY role");
    assert.deepEqual(live.map((row) => row.role), ["active", "standby"]);
    const writer = await peer(appLb, "senior", "b-writer");
    await writer.call("createSession", { channel: review });
    await writer.call("subscribe", { channel: review });
    await retitle(writer, review, "Before takeover", 1);
    return `active ${before.active} (epoch ${String(before.activeStatus.epoch)}), standby ${before.standby} answers /livez 200 and /readyz 503`;
  });

  await check("H9-02 H3-03 H2-03 H7-07", "B: the standby takes over after the active process is killed", async () => {
    const identity = await sql<{ id: string }>(APP, "SELECT session_instance_id::text AS id FROM sessions WHERE session_uri = $1", [review]);
    const started = performance.now();
    await docker("kill", await containerOf(before.active));
    const promoted = await until(() => status(before.standby).then((value) => value?.ready ? value : undefined), "standby promoted");
    const takeoverMs = Math.round(performance.now() - started);
    assert.equal(BigInt(promoted.epoch ?? "0"), BigInt(before.activeStatus.epoch ?? "0") + 1n);
    assert.equal(await probe(before.standby, "/readyz"), 200);
    const reader = await peer(appLb, "senior", "b-reader");
    const snapshot = await reader.call<{ snapshot: { state: { title: string; lifecycle: string } } }>("subscribe", { channel: review });
    assert.deepEqual([snapshot.snapshot.state.title, snapshot.snapshot.state.lifecycle], ["Before takeover", "ready"]);
    assert.deepEqual(await sql(APP, "SELECT session_instance_id::text AS id FROM sessions WHERE session_uri = $1", [review]), identity);
    await compose("start", before.active);
    await until(() => status(before.active).then((value) => value?.phase === "standby" ? value : undefined), "restarted replica is a standby");
    return `takeover in ${String(takeoverMs)} ms, epoch ${String(before.activeStatus.epoch)} -> ${String(promoted.epoch)}, restarted replica rejoined as standby`;
  });

  await check("H9-02 H3-04 H2-02 H2-07", "B: a paused owner cannot be doubled, and fences itself when it resumes", async () => {
    before = await until(roles, "one active and one standby replica");
    const container = await containerOf(before.active);
    await docker("pause", container);
    try {
      // Longer than the membership lease: the frozen process still holds its database session.
      await delay(5_000);
      const standby = await status(before.standby);
      assert.equal(standby?.ready, false, "the standby did not become a second owner");
      const active = await sql<{ instance_id: string }>(APP, "SELECT instance_id FROM host_members WHERE role = 'active' AND lease_expires_at > clock_timestamp()");
      assert.equal(active.length, 0, "the paused owner's membership expired by the database clock");
    } finally {
      await docker("unpause", container);
    }
    // On resume the old owner sees its expired lease, closes admission and exits. Only then does the standby take over.
    const promoted = await until(() => status(before.standby).then((value) => value?.ready ? value : undefined), "standby promoted after the owner fenced itself");
    assert.equal(BigInt(promoted.epoch ?? "0"), BigInt(before.activeStatus.epoch ?? "0") + 1n);
    // The fenced process exits non-zero, its supervisor starts a fresh instance, and that instance joins as the standby.
    const rejoined = await until(() => status(before.active).then((value) => value?.phase === "standby" && value.generation !== before.activeStatus.generation ? value : undefined), "old owner rejoined as a standby");
    assert.equal(rejoined.ready, false);
    await until(roles, "replicas settled");
    return `no second owner during a 5 s pause; epoch ${String(before.activeStatus.epoch)} -> ${String(promoted.epoch)} after resume`;
  });

  await check("H9-02 H3-05 H3-07 H7-08", "B: a rolling drain hands over without retiring durable sessions", async () => {
    before = await until(roles, "one active and one standby replica");
    const sessionsBefore = await sql(APP, "SELECT session_instance_id::text AS id, lifecycle_status FROM sessions ORDER BY 1");
    const started = performance.now();
    await compose("stop", before.active);
    const drainMs = Math.round(performance.now() - started);
    const promoted = await until(() => status(before.standby).then((value) => value?.ready ? value : undefined), "standby promoted after drain");
    assert.deepEqual(await sql(APP, "SELECT session_instance_id::text AS id, lifecycle_status FROM sessions ORDER BY 1"), sessionsBefore);
    assert.ok(sessionsBefore.every((row) => row.lifecycle_status === "active"));
    const exitCode = (await docker("inspect", "--format", "{{.State.ExitCode}}", await containerOf(before.active))).trim();
    assert.equal(exitCode, "0", "the drained replica exited cleanly");
    const reader = await peer(appLb, "senior", "b-after-drain");
    assert.equal((await reader.call<{ snapshot: { state: { title: string } } }>("subscribe", { channel: review })).snapshot.state.title, "Before takeover");
    await compose("start", before.active);
    await until(roles, "replicas settled");
    return `SIGTERM drain completed in ${String(drainMs)} ms; ${String(sessionsBefore.length)} session(s) stayed active; new epoch ${String(promoted.epoch)}`;
  });
}

// ─── Scenario C: application namespaces with identical identifiers ───────────
async function scenarioC(): Promise<void> {
  const review = sessionUri("review");
  await check("H9-03 H4-01 H4-04 H1-02 H1-03", "C: two application namespaces hold the same identifiers independently", async () => {
    const states = await Promise.all((["production", "staging"] as const).map((name) => until(() => status(name).then((value) => value?.ready ? value : undefined), `${name} ready`)));
    assert.deepEqual(states.map((state) => state.namespaceId), ["ahp-namespace:support/production", "ahp-namespace:support/staging"]);
    for (const [name, value] of [["production", "Production"], ["staging", "Staging"]] as const) {
      const client = await peer(wsOf(name), "senior", `c-${name}`);
      if (!(await status(name))?.sessions.some((session) => session.uri === review)) await client.call("createSession", { channel: review });
      await client.call("subscribe", { channel: review });
      await retitle(client, review, `${value} only`, Date.now() % 1_000_000);
    }
    const rows = await Promise.all(["ahp_support__production", "ahp_support__staging"].map((schema) => sql<{ id: string; title: string; owner: string; namespace: string }>(schema,
      "SELECT s.session_instance_id::text AS id, s.durable_state->>'title' AS title, s.owner_host_id AS owner, (SELECT namespace_id FROM host_namespaces) AS namespace FROM sessions s WHERE s.session_uri = $1 AND s.lifecycle_status <> 'retired'", [review])));
    assert.deepEqual(rows.map((list) => list.length), [1, 1]);
    assert.notEqual(rows[0]?.[0]?.id, rows[1]?.[0]?.id);
    assert.deepEqual(rows.map((list) => [list[0]?.title, list[0]?.owner, list[0]?.namespace]), [["Production only", "support-production", "ahp-namespace:support/production"],
      ["Staging only", "support-staging", "ahp-namespace:support/staging"]]);
    assert.equal((await status("staging"))?.sessions.find((session) => session.uri === review)?.title, "Staging only");
    return "same session URI, different incarnations, titles and owners in two schemas";
  });

  await check("H9-03 H4-02 H4-07 H1-10", "C: a host configured for one namespace cannot attach to another namespace's store", async () => {
    const before = await sql("ahp_support__production", "SELECT (SELECT count(*)::int FROM host_state) AS hosts, (SELECT namespace_id FROM host_namespaces) AS namespace, (SELECT count(*)::int FROM sessions) AS sessions");
    const outcome = await compose("--profile", "negative", "run", "--rm", "intruder").then(() => "started", () => "refused");
    assert.equal(outcome, "refused");
    assert.deepEqual(await sql("ahp_support__production", "SELECT (SELECT count(*)::int FROM host_state) AS hosts, (SELECT namespace_id FROM host_namespaces) AS namespace, (SELECT count(*)::int FROM sessions) AS sessions"), before);
    assert.equal((await status("production"))?.ready, true);
    return "the staging-configured host exited without joining; the production store is unchanged";
  });
}

// ─── Scenario D: several active hosts in one shared namespace ────────────────
async function scenarioD(): Promise<void> {
  const run = String(Date.now());
  const names = Array.from({ length: 6 }, (_, index) => sessionUri(`shared-${run}-${String(index)}`));
  await until(async () => (await Promise.all(tools.map(status))).every((value) => value?.ready === true), "three distributed hosts ready");

  await check("H9-04 H7-02 H1-03 H4-03", "D: sessions created through the load balancer are owned by different hosts", async () => {
    const members = (await status("tools-a"))?.members ?? [];
    assert.deepEqual(members.map((member) => [member.hostId, member.role]), tools.map((name) => [services[name].hostId, "active"]));
    assert.deepEqual(await sql(SHARED, "SELECT namespace_id, store_mode FROM host_namespaces"), [{ namespace_id: "ahp-namespace:support/shared", store_mode: "shared" }]);
    for (const [index, uri] of names.entries()) {
      // Each connection is balanced independently, so creators land on different hosts.
      const creator = await peer(toolsLb, "senior", `d-creator-${String(index)}`);
      await creator.call("createSession", { channel: uri });
      await creator.close();
    }
    const placed = await owners();
    const distinct = new Set(names.map((uri) => placed.get(uri)?.owner));
    assert.ok(distinct.size >= 2, "at least two hosts own sessions");
    for (const name of tools) {
      const local = (await status(name))?.sessions.map((session) => session.uri).filter((uri) => names.includes(uri)).sort();
      assert.deepEqual(local, names.filter((uri) => placed.get(uri)?.owner === services[name].hostId).sort());
    }
    return `owners: ${[...distinct].join(", ")}`;
  });

  const ownerOf = async (uri: string): Promise<ServiceName> => serviceOfHost((await owners()).get(uri)?.owner ?? "");
  const nonOwnerOf = async (uri: string): Promise<ServiceName> => {
    const owner = await ownerOf(uri);
    return tools.find((name) => name !== owner) ?? owner;
  };

  await check("H9-04 H5-01 H5-08", "D: a request arriving at a non-owner reaches the owner and returns on the same connection", async () => {
    const uri = names[0] ?? "";
    const owner = await ownerOf(uri);
    const ingress = await nonOwnerOf(uri);
    const client = await peer(wsOf(ingress), "senior", "d-routed");
    const snapshot = await client.call<{ snapshot: { resource: string; fromSeq: number } }>("subscribe", { channel: uri });
    const elapsed = await retitle(client, uri, "Routed", 1);
    assert.ok((client.actions(uri).at(-1)?.serverSeq ?? 0) > snapshot.snapshot.fromSeq);
    assert.equal((await status(owner))?.sessions.find((session) => session.uri === uri)?.title, "Routed");
    assert.equal((await status(ingress))?.sessions.some((session) => session.uri === uri), false);
    assert.ok(((await status(ingress))?.routing.links ?? 0) >= 1);
    assert.equal((await client.request("x-ahp-host/sync", { version: 1 })).error?.code, -32601);
    // An observer has no write permission on either host.
    const observer = await peer(wsOf(ingress), "observer", "d-observer");
    await observer.call("subscribe", { channel: uri });
    observer.notify("dispatchAction", title(uri, "Forbidden", 1));
    await delay(500);
    assert.equal((await status(owner))?.sessions.find((session) => session.uri === uri)?.title, "Routed");
    return `ingress ${ingress} -> owner ${owner}, round trip ${String(Math.round(elapsed))} ms`;
  });

  await check("H9-04 H6-05 H6-08 H6-07", "D: one connection sees every owner's actions in ascending namespace order", async () => {
    const watcher = await peer(wsOf("tools-c"), "observer", "d-watcher", ["ahp-root://", ...names]);
    assert.equal(watcher.initialized.snapshots.length, names.length + 1);
    assert.equal(watcher.initialized.snapshots.find((snapshot) => snapshot.resource === "ahp-root://")?.state.activeSessions, (await owners()).size);
    const writers = await Promise.all(tools.map((name) => peer(wsOf(name), "senior", `d-writer-${name}`)));
    const rounds = 8;
    for (let round = 1; round <= rounds; round += 1) {
      for (const [index, uri] of names.entries()) writers[index % writers.length]?.notify("dispatchAction", title(uri, `round ${String(round)}`, 1_000 + round));
    }
    await watcher.wait(() => names.every((uri) => watcher.actions(uri).some((envelope) => envelope.action.title === `round ${String(rounds)}`)) ? true : undefined, 30_000, "every final title");
    const sequence = watcher.actions().map((envelope) => envelope.serverSeq);
    for (let index = 1; index < sequence.length; index += 1) assert.ok((sequence[index] ?? 0) > (sequence[index - 1] ?? 0), `descending at ${String(index)}`);
    for (const snapshot of watcher.initialized.snapshots) for (const envelope of watcher.actions(snapshot.resource)) assert.ok(envelope.serverSeq > snapshot.fromSeq);
    for (const uri of names) assert.deepEqual(watcher.actions(uri).filter((envelope) => typeof envelope.action.title === "string").map((envelope) => envelope.action.title).slice(-rounds),
      Array.from({ length: rounds }, (_, index) => `round ${String(index + 1)}`));
    const listed = await (await peer(toolsLb, "senior", "d-list")).call<{ items: { resource: string }[] }>("listSessions", { channel: "ahp-root://" });
    assert.deepEqual(listed.items.map((item) => item.resource).filter((uri) => names.includes(uri)).sort(), [...names].sort());
    return `${String(sequence.length)} actions from ${String(new Set([...(await owners()).values()].map((row) => row.owner)).size)} owners, strictly ascending; merged catalogue lists all ${String(names.length)} sessions`;
  });

  await check("H9-04 H8-01 H8-02 H8-04 H8-08", "D: a worker on one host claims work owned by others, within one registration-wide cap", async () => {
    const placed = await owners();
    const [first, second] = [names.find((uri) => placed.get(uri)?.owner !== services["tools-c"].hostId) ?? "", names.find((uri) => placed.get(uri)?.owner !== placed.get(names[0] ?? "")?.owner) ?? ""];
    const targets = [...new Set([first, second, names[0] ?? ""])].slice(0, 2);
    assert.equal(new Set(targets.map((uri) => placed.get(uri)?.owner)).size, 2, "the two work sessions have different owners");
    const worker = await peer(wsOf("tools-c"), "junior", "d-worker");
    const { agentId } = await worker.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    const manager = await peer(toolsLb, "pm", "d-manager");
    const submitted: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const uri = targets[index % 2] ?? "";
      submitted.push((await manager.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: `cap-${run}-${String(index)}`, kind: "code.review", input: {}, targetAgentId: agentId,
        scope: [{ resource: { kind: "session", id: uri }, include: true }] })).workId);
    }
    assert.equal(new Set(submitted).size, 10);
    const held = (await sql<{ leases: number }>(SHARED, "SELECT count(*)::int AS leases FROM work_items WHERE lease_agent_id = $1 AND status = 'leased' AND lease_expires_at > clock_timestamp()", [agentId]))[0]?.leases ?? 0;
    // Ten concurrent claims, routed to two different owning processes.
    const claims = await Promise.all(Array.from({ length: 10 }, (_, index) => worker.request("x-ahp/work/claim", { version: 1, session: { kind: "session", id: targets[index % 2] ?? "" } }, 20_000)));
    const outcomes = claims.map((reply) => (reply.result as { status?: string } | undefined)?.status ?? "error");
    // The cap is registration-wide and durable: leases this agent still holds from an earlier run count against it.
    assert.equal(outcomes.filter((outcome) => outcome === "claimed").length, 3 - held);
    const leased = await sql<{ owner: string; leases: number }>(SHARED, `SELECT s.owner_host_id AS owner, count(*)::int AS leases FROM work_items w JOIN sessions s USING (session_instance_id)
      WHERE w.lease_agent_id = $1 AND w.status = 'leased' AND w.lease_expires_at > clock_timestamp() GROUP BY 1 ORDER BY 1`, [agentId]);
    assert.equal(leased.reduce((sum, row) => sum + row.leases, 0), 3, "exactly three unexpired leases in authoritative storage");
    const claimed = claims.find((reply) => (reply.result as { status?: string } | undefined)?.status === "claimed")?.result as { lease: { workId: string; attempt: number; leaseToken: string } } | undefined;
    if (claimed === undefined) return `the agent already held ${String(held)} unexpired lease(s) from an earlier run; all ten new claims were refused and storage still shows exactly three`;
    const lease = claimed.lease;
    const execution = { workId: lease.workId, attempt: lease.attempt, leaseToken: lease.leaseToken };
    assert.ok((await manager.request("x-ahp/work/complete", { version: 1, ...execution, result: { stolen: true } })).error, "a copied lease confers nothing");
    assert.equal(await worker.call("x-ahp/work/complete", { version: 1, ...execution, result: { reviewed: true } }), null);
    assert.deepEqual(await sql(SHARED, "SELECT status FROM work_items WHERE id = $1", [lease.workId]), [{ status: "completed" }]);
    assert.ok(!JSON.stringify(await sql(SHARED, "SELECT * FROM host_events WHERE topic = 'work' ORDER BY seq DESC LIMIT 50")).includes(lease.leaseToken), "no lease token in durable events");
    return `outcomes: ${String(outcomes.filter((outcome) => outcome === "claimed").length)} claimed, ${String(outcomes.filter((outcome) => outcome !== "claimed").length)} refused; leases by owner ${JSON.stringify(leased)}`;
  });

  await check("H9-08", "D: measured round trips for local and routed writes", async () => {
    const uri = names[1] ?? "";
    const owner = await ownerOf(uri);
    const ingress = await nonOwnerOf(uri);
    const sample = async (service: ServiceName, label: string): Promise<number[]> => {
      const client = await peer(wsOf(service), "senior", `d-perf-${label}`);
      await client.call("subscribe", { channel: uri });
      const times: number[] = [];
      for (let index = 0; index < 40; index += 1) times.push(await retitle(client, uri, `${label} ${String(index)}`, 5_000 + index));
      await client.close();
      return times;
    };
    const local = await sample(owner, "local");
    const routed = await sample(ingress, "routed");
    const pools = await database.query<{ connections: number }>("SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'AgentHostingProtocol%' OR usename = 'ahp_example'");
    const stats = await Promise.all(tools.map(status));
    return `40 durable title writes each: local p50 ${String(percentile(local, 0.5))} ms p95 ${String(percentile(local, 0.95))} ms; routed p50 ${String(percentile(routed, 0.5))} ms p95 ${String(percentile(routed, 0.95))} ms; `
      + `${String(pools.rows[0]?.connections)} database connections for 7 hosts; held notifications ${JSON.stringify(stats.map((value) => value?.routing.held))}`;
  });

  await check("H9-05 H2-04 H2-05", "D: a namespace-wide revocation ends cached authority on every host", async () => {
    const uri = names[2] ?? "";
    const clients = await Promise.all(tools.map((name) => peer(wsOf(name), "senior", `d-revoke-${name}`)));
    for (const client of clients) await client.call("subscribe", { channel: uri });
    const before = await sql<{ revision: string }>(SHARED, "SELECT authority_revision::text AS revision FROM host_namespaces");
    const revoked = await controlPost("tools-b", "/revoke");
    assert.equal(revoked.ok, true);
    await until(() => clients.every((client) => client.closed) ? true : undefined, "every earlier connection closed", 15_000);
    assert.equal(Number((await sql<{ revision: string }>(SHARED, "SELECT authority_revision::text AS revision FROM host_namespaces"))[0]?.revision), Number(before[0]?.revision) + 1);
    // Each host observes the durable revision itself; none depends on a notification from the revoker.
    await until(async () => (await Promise.all(tools.map(status))).every((value) => value?.authorityRevision === Number(revoked.body.revision)), "every host observed the revocation", 10_000);
    const fresh = await peer(toolsLb, "senior", "d-after-revoke");
    await fresh.call("subscribe", { channel: uri });
    await retitle(fresh, uri, "After revocation", 9_001);
    return `authority revision ${String(before[0]?.revision)} -> ${String(revoked.body.revision)}; ${String(clients.length)} connections on three hosts closed; fresh callers proceed`;
  });

  await check("H9-04 H7-04 H7-07 H5-04", "D: a session transfer fences the old owner and keeps identity, state and sequence", async () => {
    const uri = names[3] ?? "";
    const from = await ownerOf(uri);
    const to = tools.find((name) => name !== from) ?? from;
    const before = await sql<{ id: string; epoch: string; revision: string; seq: string }>(SHARED,
      "SELECT session_instance_id::text AS id, ownership_epoch::text AS epoch, state_revision::text AS revision, last_server_seq::text AS seq FROM sessions WHERE session_uri = $1", [uri]);
    const moved = await controlPost(from, `/transfer?session=${encodeURIComponent(uri)}&to=${services[to].hostId}`);
    assert.equal(moved.ok, true, `transfer refused: ${JSON.stringify(moved.body)}`);
    await until(() => status(to).then((value) => value?.sessions.some((session) => session.uri === uri)), "session restored on the new owner");
    const after = await sql<{ id: string; epoch: string; revision: string; owner: string }>(SHARED,
      "SELECT session_instance_id::text AS id, ownership_epoch::text AS epoch, state_revision::text AS revision, owner_host_id AS owner FROM sessions WHERE session_uri = $1", [uri]);
    assert.deepEqual([after[0]?.id, after[0]?.revision, after[0]?.owner, after[0]?.epoch], [before[0]?.id, before[0]?.revision, services[to].hostId, String(Number(before[0]?.epoch) + 1)]);
    assert.equal((await status(from))?.sessions.some((session) => session.uri === uri), false);
    // The former owner is now only an ingress for this session.
    const client = await peer(wsOf(from), "senior", "d-after-transfer");
    await client.call("subscribe", { channel: uri });
    await retitle(client, uri, "After transfer", 9_100);
    assert.ok((client.actions(uri).at(-1)?.serverSeq ?? 0) > Number(before[0]?.seq));
    assert.equal((await controlPost(from, `/transfer?session=${encodeURIComponent(uri)}&to=${services[to].hostId}`)).ok, false, "a host that is no longer the owner cannot move the session");
    return `${from} -> ${to}, ownership epoch ${String(before[0]?.epoch)} -> ${String(after[0]?.epoch)}, same incarnation and state revision`;
  });

  await check("H9-04 H7-01 H7-03 H3-04 H5-05", "D: a killed owner's sessions are adopted once, and it restarts owning nothing", async () => {
    const before = await owners();
    const victim = serviceOfHost([...before.values()].map((row) => row.owner).sort((a, b) => [...before.values()].filter((row) => row.owner === b).length - [...before.values()].filter((row) => row.owner === a).length)[0] ?? "");
    const orphaned = [...before.entries()].filter(([, row]) => row.owner === services[victim].hostId).map(([uri]) => uri);
    assert.ok(orphaned.length > 0);
    const survivor = tools.find((name) => name !== victim) ?? victim;
    const subscribed = await peer(wsOf(survivor), "senior", "d-subscribed");
    await subscribed.call("subscribe", { channel: orphaned[0] ?? "" });
    // While its owner is live nobody may take a session.
    assert.equal((await controlPost(survivor, `/adopt?from=${services[victim].hostId}`)).ok, false);
    const started = performance.now();
    await docker("kill", await containerOf(victim));
    // The routed subscription ends instead of silently going stale.
    await until(() => subscribed.closed ? true : undefined, "routed subscription closed", 15_000);
    await until(async () => [...(await owners()).values()].every((row) => row.owner !== services[victim].hostId), "every orphaned session adopted", 40_000);
    const adoptedMs = Math.round(performance.now() - started);
    const after = await owners();
    for (const uri of orphaned) {
      assert.equal(after.get(uri)?.epoch, String(Number(before.get(uri)?.epoch) + 1));
      assert.equal(after.get(uri)?.lifecycle, "active");
    }
    assert.equal(after.size, before.size, "no session was lost or retired");
    const reader = await peer(toolsLb, "senior", "d-after-adoption");
    const snapshot = await reader.call<{ snapshot: { state: { lifecycle: string } } }>("subscribe", { channel: orphaned[0] ?? "" });
    assert.equal(snapshot.snapshot.state.lifecycle, "ready");
    await compose("start", victim);
    const restarted = await until(() => status(victim).then((value) => value?.ready ? value : undefined), "killed host restarted");
    assert.deepEqual(restarted.sessions.filter((session) => orphaned.includes(session.uri)), []);
    const viaRestarted = await peer(wsOf(victim), "senior", "d-via-restarted");
    await viaRestarted.call("subscribe", { channel: orphaned[0] ?? "" });
    return `${victim} killed owning ${String(orphaned.length)} session(s); all adopted in ${String(adoptedMs)} ms with ownership epoch +1; restarted host owns none and routes to the new owner`;
  });

  await check("H9-05 H6-01 H6-04", "D: durable events reach every host without a broker", async () => {
    const rows = await sql<{ topic: string; kinds: string }>(SHARED, "SELECT topic, string_agg(DISTINCT kind, ',' ORDER BY kind) AS kinds FROM host_events GROUP BY topic ORDER BY topic");
    const topics = new Map(rows.map((row) => [row.topic, row.kinds]));
    assert.ok(topics.get("ownership")?.includes("adopted") && topics.get("ownership")?.includes("transferred"));
    assert.ok(topics.get("authority")?.includes("revoked"));
    assert.ok(topics.get("work")?.includes("submitted"));
    const logs = await Promise.all(tools.map((name) => compose("logs", "--no-log-prefix", name)));
    for (const [index, output] of logs.entries()) assert.ok(/"event":"host-event","topic":"(ownership|authority)"/u.test(output), `${tools[index] ?? ""} observed ownership or authority events`);
    for (const output of logs) assert.ok(!/secret|leaseToken|BEGIN PRIVATE/iu.test(output), "no credential material in host logs");
    return [...topics].map(([topic, kinds]) => `${topic}: ${kinds}`).join("; ");
  });
}

try {
  await database.query("SELECT 1");
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();
} finally {
  for (const connected of peers) await connected.close().catch(() => undefined);
  await database.end();
}
const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`\n${String(results.length - failed.length)} of ${String(results.length)} live checks passed.\n`);
const output = process.argv.indexOf("--json");
if (output !== -1 && process.argv[output + 1] !== undefined) writeFileSync(process.argv[output + 1] ?? "", JSON.stringify({ at: new Date().toISOString(), results }, undefined, 2));
process.exit(failed.length === 0 ? 0 : 1);

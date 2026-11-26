/**
 * Live acceptance driver for the Kubernetes manifests in this directory.
 *
 * It applies the manifests to the cluster `kubectl` points at, waits for the
 * pods, and then proves through real pods what the manifests claim: probe and
 * readiness behaviour, the pod-name and pod-UID identity mapping, routing
 * between pods, pod replacement, failover of a replicated host and a rolling
 * restart. It needs `kubectl`, a cluster that can run the example image
 * (`ahp-multi-host-example:local`) and nothing else.
 *
 *   docker compose -f examples/host/docker-compose.yaml build tools-a
 *   minikube image load ahp-multi-host-example:local postgres:17.12-bookworm
 *   pnpm exec vite-node examples/host/kubernetes/acceptance.ts [--keep] [--json <file>]
 *
 * Set AHP_KUBE_CONTEXT to use a context other than the current one. Everything
 * is created in the Kubernetes Namespace `ahp-example` and deleted at the end
 * unless `--keep` is given.
 */
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { HOST_HEALTH_LIVE_PATH, HOST_HEALTH_READY_PATH, HOST_HEALTH_STARTUP_PATH } from "@host";
import { parseUnknownJson } from "@jsonrpc";
import { createExampleMembership, ExamplePeer, sessionUri } from "../support";

const namespace = "ahp-example";
const manifest = (name: string): string => fileURLToPath(new URL(`./${name}`, import.meta.url));
const context = process.env.AHP_KUBE_CONTEXT;
const scope = [...(context === undefined || context === "" ? [] : ["--context", context]), "-n", namespace];
const kubectl = (...args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile("kubectl", [...scope, ...args], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`kubectl ${args.slice(0, 4).join(" ")} failed: ${stderr.trim().split("\n").at(-1) ?? ""}`));
    else resolve(stdout);
  });
});
const read = async <T>(...args: string[]): Promise<T> => parseUnknownJson(await kubectl(...args, "-o", "json")) as T;
const until = async <T>(probe: () => Promise<T | undefined | false>, label: string, timeoutMs = 120_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await delay(500);
  }
};

interface Pod { readonly name: string; readonly uid: string; readonly ip?: string; readonly ready: boolean; readonly started: boolean; readonly restarts: number; readonly phase: string; readonly terminating: boolean }
interface RawPod {
  metadata: { name: string; uid: string; deletionTimestamp?: string };
  status: { phase: string; podIP?: string; conditions?: { type: string; status: string }[]; containerStatuses?: { restartCount: number; started?: boolean }[] };
}
const pods = async (app: string): Promise<Pod[]> => (await read<{ items: RawPod[] }>("get", "pods", "-l", `app=${app}`)).items.map((pod) => ({
  name: pod.metadata.name, uid: pod.metadata.uid, phase: pod.status.phase, terminating: pod.metadata.deletionTimestamp !== undefined,
  ...(pod.status.podIP === undefined ? {} : { ip: pod.status.podIP }),
  ready: pod.status.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True") === true,
  started: pod.status.containerStatuses?.[0]?.started === true, restarts: pod.status.containerStatuses?.[0]?.restartCount ?? 0,
})).sort((left, right) => left.name.localeCompare(right.name));
/** Pod addresses a Service currently sends new connections to. */
const serviceAddresses = async (service: string): Promise<string[]> => (await read<{ items: { endpoints?: { addresses: string[]; conditions?: { ready?: boolean } }[] }[] }>(
  "get", "endpointslices", "-l", `kubernetes.io/service-name=${service}`)).items.flatMap((slice) => slice.endpoints ?? [])
  .filter((endpoint) => endpoint.conditions?.ready === true).flatMap((endpoint) => endpoint.addresses).sort();

const forwards = new Set<ChildProcess>();
/** `kubectl port-forward` to one pod or Service, on a free local port. */
const forward = (target: string, remotePort: number): Promise<{ readonly port: number; close(): void }> => new Promise((resolve, reject) => {
  const child = spawn("kubectl", [...scope, "port-forward", target, `:${String(remotePort)}`], { stdio: ["ignore", "pipe", "pipe"] });
  forwards.add(child);
  let output = "";
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`Port-forward to ${target} did not start.`));
  }, 20_000);
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    const match = /Forwarding from 127\.0\.0\.1:(\d+)/u.exec(output);
    if (match === null) return;
    clearTimeout(timer);
    resolve({ port: Number(match[1]), close: () => {
      forwards.delete(child);
      child.kill();
    } });
  });
  child.on("exit", () => {
    clearTimeout(timer);
    forwards.delete(child);
    reject(new Error(`Port-forward to ${target} ended.`));
  });
});
const through = async <T>(target: string, remotePort: number, use: (port: number) => Promise<T>): Promise<T> => {
  const tunnel = await forward(target, remotePort);
  try {
    return await use(tunnel.port);
  } finally {
    tunnel.close();
  }
};

interface Status {
  mode: string; phase: string; ready: boolean; hostId?: string; namespaceId?: string; instanceId?: string; epoch?: string;
  sessions: { uri: string; title?: string }[]; routing: { connections: number; links: number };
  members: { hostId: string; instanceId: string; role: string; endpoint?: string }[];
}
/** The example's control listener is bound to the pod's loopback, so only a port-forward reaches it. */
const status = (pod: string): Promise<Status> => through(`pod/${pod}`, 9090, async (port) => {
  const response = await fetch(`http://127.0.0.1:${String(port)}/status`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
  return await response.json() as Status;
});
const probe = (pod: string, path: string): Promise<{ status: number; body: unknown }> => through(`pod/${pod}`, 8080, async (port) => {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { signal: AbortSignal.timeout(5_000) });
  return { status: response.status, body: await response.json().catch(() => undefined) };
});
/** One protocol client connected to a pod or a Service for the duration of `use`. */
const client = <T>(target: string, remotePort: number, subject: string, clientId: string, use: (peer: ExamplePeer) => Promise<T>): Promise<T> => through(target, remotePort, async (port) => {
  const peer = await ExamplePeer.connect(`ws://127.0.0.1:${String(port)}/`, subject);
  try {
    await peer.initialize(clientId);
    return await use(peer);
  } finally {
    await peer.close();
  }
});
const owners = async (app: string, uri: string): Promise<{ pod: string; title?: string }[]> => {
  const found: { pod: string; title?: string }[] = [];
  for (const pod of (await pods(app)).filter((candidate) => candidate.ready && !candidate.terminating)) {
    const session = (await status(pod.name)).sessions.find((entry) => entry.uri === uri);
    if (session !== undefined) found.push({ pod: pod.name, ...(session.title === undefined ? {} : { title: session.title }) });
  }
  return found;
};

const tools = ["support-tools-0", "support-tools-1", "support-tools-2"] as const;
const toolsEndpoint = (hostId: string): string => `ws://${hostId}.support-tools-internal:7000/`;

/** Creates the membership Secrets once. Regenerating them would create a second, conflicting root of trust. */
const ensureMembership = async (name: string, namespaceId: string, hosts: Parameters<typeof createExampleMembership>[1]): Promise<void> => {
  const exists = await kubectl("get", "secret", `${name}-policy`).then(() => true, () => false);
  if (exists) return;
  const directory = mkdtempSync(join(tmpdir(), "ahp-membership-"));
  try {
    const membership = createExampleMembership(namespaceId, hosts);
    writeFileSync(join(directory, "policy.json"), JSON.stringify(membership.policy));
    const files: string[] = [];
    for (const [hostId, credential] of membership.credentials) {
      writeFileSync(join(directory, `${hostId}.json`), JSON.stringify(credential), { mode: 0o600 });
      files.push(`--from-file=${hostId}.json=${join(directory, `${hostId}.json`)}`);
    }
    await kubectl("create", "secret", "generic", `${name}-policy`, `--from-file=policy.json=${join(directory, "policy.json")}`);
    // One Secret holds every member's credential. Each pod mounts only its own key from it.
    await kubectl("create", "secret", "generic", `${name}-credentials`, ...files);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const results: { id: string; title: string; ok: boolean; detail?: string; ms: number }[] = [];
const check = async (id: string, title: string, run: () => Promise<void>): Promise<void> => {
  const started = Date.now();
  try {
    await run();
    results.push({ id, title, ok: true, ms: Date.now() - started });
    process.stdout.write(`PASS ${id} ${title}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ id, title, ok: false, detail, ms: Date.now() - started });
    process.stdout.write(`FAIL ${id} ${title}\n     ${detail}\n`);
  }
};

const keep = process.argv.includes("--keep");
const jsonAt = process.argv.indexOf("--json");
// Session names are unique per run, so the driver can run again against a kept namespace.
const run = Date.now().toString(36);
const appSession = sessionUri(`k8s-app-${run}`);
const alpha = sessionUri(`k8s-alpha-${run}`);
const beta = sessionUri(`k8s-beta-${run}`);
const files = ["postgres.yaml", "setup.yaml", "single.yaml", "replicated.yaml", "distributed.yaml"];

try {
  await kubectl("apply", "-f", manifest("namespace.yaml"));
  await check("K1", "the API server accepts every manifest under strict schema validation (server-side dry run)", async () => {
    // Strict validation rejects unknown and duplicate fields against the cluster's own API schema.
    for (const file of files) await kubectl("apply", "--dry-run=server", "--validate=strict", "-f", manifest(file));
  });
  await kubectl("apply", "-f", manifest("postgres.yaml"));
  await kubectl("rollout", "status", "deployment/postgres", "--timeout=240s");
  await ensureMembership("support-tools", "ahp-namespace:support/shared", tools.map((hostId) => ({ hostId, endpoint: toolsEndpoint(hostId) })));
  await ensureMembership("support-app", "ahp-namespace:support-app/default", [{ hostId: "support-app", maxInstances: 5 }]);
  await kubectl("apply", "-f", manifest("setup.yaml"));
  await kubectl("wait", "--for=condition=complete", "job/ahp-example-migrate", "--timeout=300s");
  for (const file of ["single.yaml", "replicated.yaml", "distributed.yaml"]) await kubectl("apply", "-f", manifest(file));

  await check("K2", "three distinct logical hosts become ready, and each pod name and pod UID is the SDK host and instance identity", async () => {
    await kubectl("rollout", "status", "statefulset/support-tools", "--timeout=300s");
    const running = await until(async () => {
      const current = await pods("support-tools");
      return current.length === 3 && current.every((pod) => pod.ready) ? current : undefined;
    }, "three ready hosts");
    assert.deepEqual(running.map((pod) => pod.name), [...tools]);
    for (const pod of running) {
      const reported = await status(pod.name);
      assert.equal(reported.hostId, pod.name);
      assert.equal(reported.instanceId, pod.uid);
      assert.equal(reported.namespaceId, "ahp-namespace:support/shared");
      assert.deepEqual([reported.mode, reported.phase, reported.ready], ["distributed", "active", true]);
      // The store lists every member with the internal endpoint trusted policy names for it.
      assert.deepEqual(reported.members.map((member) => [member.hostId, member.role, member.endpoint]), tools.map((hostId) => [hostId, "active", toolsEndpoint(hostId)]));
      assert.equal(pod.restarts, 0);
    }
    assert.equal((await serviceAddresses("support-tools")).length, 3);
  });

  await check("K3", "a replicated host runs one ready pod and one healthy standby that the Service never selects", async () => {
    const [active, standby] = await until(async () => {
      const current = await pods("support-app");
      const ready = current.filter((pod) => pod.ready);
      const waiting = current.filter((pod) => !pod.ready && pod.started);
      return current.length === 2 && ready.length === 1 && waiting.length === 1 && ready[0] !== undefined && waiting[0] !== undefined ? [ready[0], waiting[0]] as const : undefined;
    }, "one active and one standby replica");
    // The probes map onto the documented phases: a standby is alive and started, and not ready.
    assert.deepEqual(await probe(standby.name, HOST_HEALTH_LIVE_PATH), { status: 200, body: { status: "ok", phase: "standby" } });
    assert.equal((await probe(standby.name, HOST_HEALTH_STARTUP_PATH)).status, 200);
    assert.deepEqual(await probe(standby.name, HOST_HEALTH_READY_PATH), { status: 503, body: { status: "unavailable", phase: "standby" } });
    assert.equal((await probe(active.name, HOST_HEALTH_READY_PATH)).status, 200);
    // It is not restarting and not crash looping: Kubernetes simply keeps it out of the Service.
    assert.equal(standby.restarts, 0);
    assert.equal(standby.phase, "Running");
    assert.deepEqual(await serviceAddresses("support-app"), [active.ip]);
    const [activeStatus, standbyStatus] = [await status(active.name), await status(standby.name)];
    assert.deepEqual([activeStatus.hostId, standbyStatus.hostId], ["support-app", "support-app"]);
    assert.deepEqual([activeStatus.instanceId, standbyStatus.instanceId], [active.uid, standby.uid]);
    assert.deepEqual([activeStatus.phase, standbyStatus.phase], ["active", "standby"]);
  });

  await check("K4", "a client on one pod reaches a session owned by another pod over the headless Service", async () => {
    await client("pod/support-tools-0", 8080, "senior", "k8s-owner", async (peer) => {
      await peer.call("createSession", { channel: alpha });
    });
    await client("pod/support-tools-1", 8080, "senior", "k8s-ingress", async (peer) => {
      const subscribed = await peer.call<{ snapshot: { fromSeq: number; state: { lifecycle: string } } }>("subscribe", { channel: alpha });
      assert.equal(subscribed.snapshot.state.lifecycle, "ready");
      peer.notify("dispatchAction", { channel: alpha, clientSeq: 1, action: { type: "session/titleChanged", title: "Routed between pods" } });
      const action = await peer.wait(() => peer.actions(alpha).find((envelope) => envelope.action.title === "Routed between pods"), 10_000, "routed action");
      assert.ok(action.serverSeq > subscribed.snapshot.fromSeq);
      assert.ok((await status("support-tools-1")).routing.links >= 1);
    });
    assert.deepEqual(await owners("support-tools", alpha), [{ pod: "support-tools-0", title: "Routed between pods" }]);
  });

  await check("K5", "the public Service shows one merged catalogue whichever pod answers", async () => {
    await client("pod/support-tools-2", 8080, "senior", "k8s-second-owner", async (peer) => {
      await peer.call("createSession", { channel: beta });
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await client("service/support-tools", 80, "senior", `k8s-catalogue-${String(attempt)}`, async (peer) => {
        const listed = await peer.call<{ items: { resource: string }[] }>("listSessions", { channel: "ahp-root://" });
        const resources = listed.items.map((item) => item.resource);
        assert.ok(resources.includes(alpha) && resources.includes(beta));
        assert.equal(new Set(resources).size, resources.length);
      });
    }
  });

  await check("K6", "a replaced pod keeps its host name, gets a new instance identity, and its session stays with exactly one owner", async () => {
    const before = (await pods("support-tools")).find((pod) => pod.name === "support-tools-0");
    assert.ok(before);
    // A graceful delete: SIGTERM, drain within the termination grace period, then the StatefulSet recreates the pod.
    await kubectl("delete", "pod", "support-tools-0", "--wait=true", "--timeout=120s");
    const after = await until(async () => {
      const pod = (await pods("support-tools")).find((candidate) => candidate.name === "support-tools-0");
      return pod !== undefined && pod.ready && pod.uid !== before.uid ? pod : undefined;
    }, "replacement pod ready");
    const reported = await status(after.name);
    assert.equal(reported.hostId, "support-tools-0");
    assert.equal(reported.instanceId, after.uid);
    assert.notEqual(reported.instanceId, before.uid);
    // Nothing durable was retired by the drain. One member serves the session, with its committed state.
    const serving = await until(async () => {
      const found = await owners("support-tools", alpha);
      return found.length === 1 ? found : undefined;
    }, "exactly one owner after the replacement");
    assert.equal(serving[0]?.title, "Routed between pods");
    await client("pod/support-tools-0", 8080, "observer", "k8s-after-replacement", async (peer) => {
      const subscribed = await peer.call<{ snapshot: { state: { title: string; lifecycle: string } } }>("subscribe", { channel: alpha });
      assert.deepEqual([subscribed.snapshot.state.title, subscribed.snapshot.state.lifecycle], ["Routed between pods", "ready"]);
    });
    assert.deepEqual((await status("support-tools-1")).members.map((member) => member.hostId), [...tools]);
  });

  await check("K7", "deleting the active replica makes the standby ready, with the session restored and the ownership epoch advanced", async () => {
    const current = await pods("support-app");
    const active = current.find((pod) => pod.ready);
    const standby = current.find((pod) => !pod.ready);
    assert.ok(active && standby);
    const uri = appSession;
    await client(`pod/${active.name}`, 8080, "senior", "k8s-app-writer", async (peer) => {
      await peer.call("createSession", { channel: uri });
      await peer.call("subscribe", { channel: uri });
      peer.notify("dispatchAction", { channel: uri, clientSeq: 1, action: { type: "session/titleChanged", title: "Before failover" } });
      await peer.wait(() => peer.actions(uri).find((envelope) => envelope.action.title === "Before failover"), 10_000, "title");
    });
    const epoch = BigInt((await status(active.name)).epoch ?? "0");
    await kubectl("delete", "pod", active.name, "--wait=false");
    await until(async () => (await pods("support-app")).find((pod) => pod.name === standby.name)?.ready === true, "standby promoted", 90_000);
    const promoted = await status(standby.name);
    assert.deepEqual([promoted.phase, promoted.ready, promoted.instanceId], ["active", true, standby.uid]);
    assert.ok(BigInt(promoted.epoch ?? "0") > epoch);
    assert.deepEqual(promoted.sessions.filter((session) => session.uri === uri), [{ uri, title: "Before failover" }]);
    // The Service follows readiness: new connections now reach the promoted pod only.
    await until(async () => JSON.stringify(await serviceAddresses("support-app")) === JSON.stringify([standby.ip]), "Service moved to the promoted pod");
    await client("service/support-app", 80, "observer", "k8s-app-reader", async (peer) => {
      const subscribed = await peer.call<{ snapshot: { state: { title: string } } }>("subscribe", { channel: uri });
      assert.equal(subscribed.snapshot.state.title, "Before failover");
    });
    // The Deployment's replacement pod joins as the new standby.
    await until(async () => {
      const replicas = (await pods("support-app")).filter((pod) => !pod.terminating);
      return replicas.length === 2 && replicas.filter((pod) => pod.ready).length === 1 && replicas.some((pod) => !pod.ready && pod.started);
    }, "replacement standby", 120_000);
  });

  await check("K8", "a rolling restart of every host completes and leaves each session with one owner and its state", async () => {
    const before = new Set((await pods("support-tools")).map((pod) => pod.uid));
    await kubectl("rollout", "restart", "statefulset/support-tools");
    await kubectl("rollout", "status", "statefulset/support-tools", "--timeout=420s");
    const after = await until(async () => {
      const current = await pods("support-tools");
      return current.length === 3 && current.every((pod) => pod.ready && !pod.terminating && !before.has(pod.uid)) ? current : undefined;
    }, "three replaced, ready pods", 180_000);
    assert.deepEqual(after.map((pod) => pod.name), [...tools]);
    for (const uri of [alpha, beta]) {
      const serving = await until(async () => {
        const found = await owners("support-tools", uri);
        return found.length === 1 ? found : undefined;
      }, `exactly one owner of ${uri}`);
      if (uri === alpha) assert.equal(serving[0]?.title, "Routed between pods");
    }
    await client("service/support-tools", 80, "senior", "k8s-after-rollout", async (peer) => {
      const subscribed = await peer.call<{ snapshot: { fromSeq: number; state: { title: string } } }>("subscribe", { channel: alpha });
      assert.equal(subscribed.snapshot.state.title, "Routed between pods");
      peer.notify("dispatchAction", { channel: alpha, clientSeq: 1, action: { type: "session/titleChanged", title: "After the rollout" } });
      const action = await peer.wait(() => peer.actions(alpha).find((envelope) => envelope.action.title === "After the rollout"), 10_000, "write after the rollout");
      assert.ok(action.serverSeq > subscribed.snapshot.fromSeq);
    });
  });

  await check("K10", "a rolling update of the replicated host replaces every replica and ends with one active pod and the session intact", async () => {
    const before = (await pods("support-app")).filter((pod) => !pod.terminating);
    const previous = new Set(before.map((pod) => pod.uid));
    const active = before.find((pod) => pod.ready);
    assert.ok(active);
    const epoch = BigInt((await status(active.name)).epoch ?? "0");
    await kubectl("rollout", "restart", "deployment/support-app");
    // `kubectl rollout status` never completes for this workload, because a standby is never ready.
    // The update is complete when every pod is new, one is active and the other waits as a standby.
    const [promoted, standby] = await until(async () => {
      const current = (await pods("support-app")).filter((pod) => !pod.terminating);
      const ready = current.filter((pod) => pod.ready);
      const waiting = current.filter((pod) => !pod.ready && pod.started);
      // The Deployment's own record agrees: every replica is from the new template and none is left over.
      const deployment = await read<{ status: { replicas?: number; updatedReplicas?: number; readyReplicas?: number } }>("get", "deployment", "support-app");
      return current.length === 2 && current.every((pod) => !previous.has(pod.uid)) && ready[0] !== undefined && waiting[0] !== undefined
        && deployment.status.replicas === 2 && deployment.status.updatedReplicas === 2 && deployment.status.readyReplicas === 1
        ? [ready[0], waiting[0]] as const
        : undefined;
    }, "two new replicas, one active and one standby", 300_000);
    const reported = await status(promoted.name);
    assert.deepEqual([reported.phase, reported.ready, reported.instanceId], ["active", true, promoted.uid]);
    assert.ok(BigInt(reported.epoch ?? "0") > epoch);
    assert.deepEqual(reported.sessions.filter((session) => session.uri === appSession), [{ uri: appSession, title: "Before failover" }]);
    assert.equal((await status(standby.name)).phase, "standby");
    assert.equal(standby.restarts, 0);
    await until(async () => JSON.stringify(await serviceAddresses("support-app")) === JSON.stringify([promoted.ip]), "Service follows the new active pod");
    await client("service/support-app", 80, "observer", "k8s-app-after-update", async (peer) => {
      const subscribed = await peer.call<{ snapshot: { state: { title: string } } }>("subscribe", { channel: appSession });
      assert.equal(subscribed.snapshot.state.title, "Before failover");
    });
  });

  await check("K9", "the single-host manifest runs one ready host with its derived namespace", async () => {
    await kubectl("rollout", "status", "deployment/support-single", "--timeout=180s");
    const [pod] = await pods("support-single");
    assert.ok(pod?.ready);
    const reported = await status(pod.name);
    assert.deepEqual([reported.mode, reported.phase, reported.hostId, reported.namespaceId, reported.instanceId],
      ["single", "active", "support-single", "ahp-namespace:support-single/default", pod.uid]);
    await client("service/support-single", 80, "senior", "k8s-single", async (peer) => {
      await peer.call("createSession", { channel: sessionUri(`k8s-single-${run}`) });
      const subscribed = await peer.call<{ snapshot: { state: { lifecycle: string } } }>("subscribe", { channel: sessionUri(`k8s-single-${run}`) });
      assert.equal(subscribed.snapshot.state.lifecycle, "ready");
    });
  });
} finally {
  for (const child of forwards) child.kill();
  if (!keep) await kubectl("delete", "namespace", namespace, "--wait=false").catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
process.stdout.write(`\n${String(results.length - failed.length)} of ${String(results.length)} Kubernetes checks passed.\n`);
if (jsonAt !== -1) writeFileSync(process.argv[jsonAt + 1] ?? "kubernetes-acceptance.json", JSON.stringify({ at: new Date().toISOString(), results }, undefined, 2));
process.exitCode = failed.length === 0 && results.length === 10 ? 0 : 1;

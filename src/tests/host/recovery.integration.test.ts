import { describe, expect, it } from "vitest";
import type { HostEventDelivery } from "@persistence";
import type { SessionBackend, SessionProvider } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { reviewWorkerKey } from "../../../examples/advanced/host";
import { sessionUri, type ExamplePeer } from "../../../examples/host/support";
import { createCluster, eventually, onCleanup, type Cluster } from "./cluster";
import { createGates, instrumentStorage } from "./instrument";

const title = (uri: string, value: string, clientSeq = 1) => ({ channel: uri, clientSeq, action: { type: "session/titleChanged", title: value } });
const sawTitle = (peer: ExamplePeer, uri: string, value: string) => peer.wait(() => peer.actions(uri).find((envelope) => envelope.action.title === value), 5_000, `title ${value}`);
interface Claimed { status: string; lease: { workId: string; attempt: number; leaseToken: string } }
const execution = ({ workId, attempt, leaseToken }: Claimed["lease"]) => ({ workId, attempt, leaseToken });
const domainId = "demo";
const isReady = (cluster: Cluster, hostId: string, uri: string): boolean => String(cluster.node(hostId).host.sessions.getSessionSnapshot(uri)?.state.lifecycle) === "ready";
/** Gates are released before the hosts stop, so a held operation can never block a shutdown. */
const gatesFor = () => {
  const gates = createGates();
  return { gates, armed: () => {
    onCleanup(() => {
      gates.releaseAll();
      return Promise.resolve();
    });
  } };
};
/** Waits for whatever restoration a host has started, and one more pass, to finish. */
const reconciled = async (cluster: Cluster, ...hostIds: string[]): Promise<void> => {
  for (const hostId of hostIds) await cluster.node(hostId).host.sessions.durability?.recoverOwned().catch(() => undefined);
};
describe("namespace events", () => {
  it("H6-03 duplicate, reordered and stale ownership events converge on the store without restoring a session twice", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    const restored: string[] = [];
    const counting: SessionProvider = { ...mockProvider, restoreSession: (input) => {
      restored.push(input.sessionUri);
      return Promise.resolve({ dispose: () => undefined });
    } };
    const a = await cluster.start("review-a");
    let b = await cluster.start("review-b", { storage: instrumented.storage, provider: counting });
    armed();
    const [alpha, beta] = [sessionUri("alpha"), sessionUri("beta")];
    const senior = await cluster.peer("review-a", "senior");
    for (const uri of [alpha, beta]) {
      await senior.call("createSession", { channel: uri });
      await senior.call("subscribe", { channel: uri });
      senior.notify("dispatchAction", title(uri, `${uri} v1`));
      await sawTitle(senior, uri, `${uri} v1`);
    }
    const control = instrumented.control;
    const ownership = (uri: string): HostEventDelivery[] => control.buffered.filter((delivery) => delivery.type === "event" && delivery.event.topic === "ownership"
      && delivery.event.session?.id === uri);

    // review-b is cut off from the event stream while two sessions are moved to it.
    control.captureEvents = true;
    await a.host.transferSession(alpha, "review-b");
    await a.host.transferSession(beta, "review-b");
    expect(b.host.sessions.listSessionSnapshots()).toHaveLength(0);
    const [movedAlpha] = ownership(alpha);
    const [movedBeta] = ownership(beta);
    if (movedAlpha?.type !== "event" || movedBeta?.type !== "event") throw new Error("expected one ownership event per move");
    expect(movedAlpha.event.eventId).not.toBe(movedBeta.event.eventId);
    // The events arrive in the opposite order, each of them twice.
    for (const delivery of [movedBeta, movedBeta, movedAlpha, movedAlpha]) control.deliver(delivery);
    await eventually(() => b.host.sessions.getSessionSnapshot(alpha) && b.host.sessions.getSessionSnapshot(beta) ? true : undefined, "both sessions restored");
    for (let repeat = 0; repeat < 3; repeat += 1) for (const delivery of [movedAlpha, movedBeta]) control.deliver(delivery);
    await reconciled(cluster, "review-b");
    expect([...restored].sort()).toEqual([alpha, beta].sort());
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe(`${alpha} v1`);

    // alpha moves back to review-a and changes there. review-b then receives the older event again.
    await b.host.transferSession(alpha, "review-a");
    await eventually(() => a.host.sessions.getSessionSnapshot(alpha), "alpha back on review-a");
    const writer = await cluster.peer("review-a", "senior", "writer-2");
    await writer.call("subscribe", { channel: alpha });
    writer.notify("dispatchAction", title(alpha, `${alpha} v2`));
    await sawTitle(writer, alpha, `${alpha} v2`);
    for (const delivery of [movedAlpha, movedAlpha, { type: "reset" } as const, movedAlpha]) control.deliver(delivery);
    await reconciled(cluster, "review-b");
    // The older "review-b owns alpha" is not applied over the newer state: the store decides, not the event.
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(a.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe(`${alpha} v2`);
    expect(restored.filter((uri) => uri === alpha)).toHaveLength(1);
    expect(b.host.sessions.getSessionSnapshot(beta)?.state.lifecycle).toBe("ready");

    // Across a restart of the consumer the same event identifiers are delivered once more.
    const replay = [...control.buffered];
    await b.stop();
    const again = instrumentStorage(cluster.storage, gates);
    again.control.captureEvents = true;
    restored.length = 0;
    b = await cluster.start("review-b", { storage: again.storage, provider: counting });
    // The restart restored what the store says this host owns: beta, once.
    expect(restored).toEqual([beta]);
    for (const delivery of [...replay].reverse()) again.control.deliver(delivery);
    for (const delivery of replay) again.control.deliver(delivery);
    await reconciled(cluster, "review-b");
    expect(restored).toEqual([beta]);
    expect(b.host.sessions.listSessionSnapshots().map((snapshot) => snapshot.resource)).toEqual([beta]);
    expect(a.host.sessions.listSessionSnapshots().map((snapshot) => snapshot.resource)).toEqual([alpha]);
    expect(a.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe(`${alpha} v2`);
  });
});

describe("reconciliation", () => {
  it("H7-03 H6-10 a reconciliation pass that fails for one session still restores and announces the others, and the next pass finishes", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    const a = await cluster.start("review-a");
    const b = await cluster.start("review-b", { storage: instrumented.storage });
    armed();
    const added: string[] = [];
    b.host.sessions.onCatalogueNotification((notification) => {
      if (notification.method === "root/sessionAdded") added.push(notification.params.summary.resource);
    });
    const [alpha, beta] = [sessionUri("alpha"), sessionUri("beta")];
    const senior = await cluster.peer("review-a", "senior");
    for (const uri of [alpha, beta]) await senior.call("createSession", { channel: uri });
    // review-b is not told about the moves, so nothing is restored until this test asks for a pass.
    instrumented.control.captureEvents = true;
    await a.host.transferSession(alpha, "review-b");
    await a.host.transferSession(beta, "review-b");
    expect(b.host.sessions.listSessionSnapshots()).toHaveLength(0);
    // The store fails once, while one of the two sessions is being made active.
    instrumented.control.outages.set("transition", 1);
    await expect(b.host.sessions.durability?.recoverOwned()).rejects.toThrow();
    const live = (): string[] => b.host.sessions.listSessionSnapshots().map((snapshot) => snapshot.resource).sort();
    // The other session was restored in the same pass, and it was announced although the pass failed.
    expect(live()).toHaveLength(1);
    expect(added).toEqual(live());
    // The next pass restores the remaining one. Each session is announced exactly once.
    await b.host.sessions.durability?.recoverOwned();
    expect(live()).toEqual([alpha, beta].sort());
    expect([...added].sort()).toEqual([alpha, beta].sort());
    expect(isReady(cluster, "review-b", alpha) && isReady(cluster, "review-b", beta)).toBe(true);
  });

  it("H7-09 H6-10 a restoration interrupted by a storage failure after its record was built is retried, not skipped", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    const a = await cluster.start("review-a");
    const b = await cluster.start("review-b", { storage: instrumented.storage });
    armed();
    const added: string[] = [];
    b.host.sessions.onCatalogueNotification((notification) => {
      if (notification.method === "root/sessionAdded") added.push(notification.params.summary.resource);
    });
    const alpha = sessionUri("alpha");
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    await senior.call("subscribe", { channel: alpha });
    senior.notify("dispatchAction", title(alpha, "Kept"));
    await sawTitle(senior, alpha, "Kept");
    instrumented.control.captureEvents = true;
    await a.host.transferSession(alpha, "review-b");
    // The store fails while the session's resources are being read, after the restoration built its record.
    instrumented.control.outages.set("listSession", 1);
    await expect(b.host.sessions.durability?.recoverOwned()).rejects.toThrow();
    expect(instrumented.control.outages.get("listSession")).toBe(0);
    // Nothing half restored is left behind: not served, not announced, not registered.
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(b.host.sessions.authorization?.getResource(alpha)).toBeUndefined();
    expect(added).toEqual([]);
    // The next pass restores it. A leftover record would have made every later pass skip it.
    expect(await b.host.sessions.durability?.recoverOwned()).toEqual([alpha]);
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state).toMatchObject({ title: "Kept", lifecycle: "ready" });
    expect(added).toEqual([alpha]);
    // A further pass has nothing to do.
    expect(await b.host.sessions.durability?.recoverOwned()).toEqual([]);
    expect(added).toEqual([alpha]);
  });

  it("H7-09 H3-08 a failed transfer whose immediate restoration also fails is restored by the host's reconciliation", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    const a = await cluster.start("review-a", { storage: instrumented.storage });
    const b = await cluster.start("review-b");
    armed();
    const alpha = sessionUri("alpha");
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    // The durable move is not committed, and the store is unreachable for the two restoration attempts that follow.
    instrumented.control.faults.set("transfer", "refused");
    instrumented.control.outages.set("listRecoverable", 2);
    await expect(a.host.transferSession(alpha, "review-b")).rejects.toThrow();
    expect(instrumented.control.outages.get("listRecoverable")).toBe(0);
    // Owned here and, for the moment, served nowhere.
    expect(a.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(await instrumented.control.lease?.coordination?.locate({ sessionUri: alpha })).toMatchObject({ hostId: "review-a", ownershipEpoch: "1" });
    // Nobody asks again. The host's own reconciliation restores it.
    await eventually(() => isReady(cluster, "review-a", alpha) ? true : undefined, "session restored by the reconciliation timer", 10_000);
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    const writer = await cluster.peer("review-b", "senior", "writer");
    await writer.call("subscribe", { channel: alpha });
    writer.notify("dispatchAction", title(alpha, "Recovered"));
    await sawTitle(writer, alpha, "Recovered");
  });
});

describe("provisioning and recovery", () => {
  it("H7-05 a host that stops between external provisioning and its durable acknowledgement leaves exactly one backing resource after adoption", async () => {
    // The provider's external system: one backing resource per operation key, created at most once per key.
    const backing = new Set<string>();
    const calls: { hostId: string; operationId: string }[] = [];
    const provisioning = (hostId: string, acknowledges: boolean): SessionProvider => ({ ...mockProvider, startSession: (input): Promise<SessionBackend> => {
      const operationId = input.operationId ?? "";
      calls.push({ hostId, operationId });
      backing.add(operationId);
      if (acknowledges) return Promise.resolve({ dispose: () => undefined });
      // Provisioned externally. The process never gets as far as acknowledging it durably.
      return new Promise((_, reject) => {
        input.signal?.addEventListener("abort", () => {
          reject(new Error("stopped"));
        }, { once: true });
      });
    } });
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const a = await cluster.start("review-a", { provider: provisioning("review-a", false) });
    const observed = instrumentStorage(cluster.storage, createGates());
    const b = await cluster.start("review-b", { storage: observed.storage, provider: provisioning("review-b", true) });
    const alpha = sessionUri("alpha");
    const senior = await cluster.peer("review-a", "senior");
    const creating = senior.request("createSession", { channel: alpha }, 10_000);
    await eventually(() => calls.length === 1 ? true : undefined, "external provisioning started");
    const where = () => observed.control.lease?.coordination?.locate({ sessionUri: alpha });
    // The session is durably reserved, still being created, and owned by the host that is about to stop.
    const reserved = (await where())?.session;
    expect(await where()).toMatchObject({ hostId: "review-a", lifecycle: "creating" });
    if (reserved === undefined) throw new Error("the session was not reserved");
    await a.stop();
    expect((await creating).result).toBeUndefined();
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();

    // The surviving host takes the session over and provisions it again under the same operation key.
    expect(await b.host.adoptSessions("review-a")).toEqual([alpha]);
    expect(calls.map((call) => call.hostId)).toEqual(["review-a", "review-b"]);
    expect(calls[1]?.operationId).toBe(calls[0]?.operationId);
    expect(calls[0]?.operationId).not.toBe("");
    expect(backing.size).toBe(1);
    // It is the same durable incarnation, now ready, and nothing was provisioned a third time.
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state.lifecycle).toBe("ready");
    expect(b.host.sessions.authorization?.getResource(alpha)).toEqual(reserved);
    expect(await where()).toMatchObject({ hostId: "review-b", lifecycle: "active", session: reserved });
    const viaB = await cluster.peer("review-b", "senior", "after-adoption");
    expect((await viaB.call<{ snapshot: { state: { lifecycle: string } } }>("subscribe", { channel: alpha })).snapshot.state.lifecycle).toBe("ready");
    await reconciled(cluster, "review-b");
    expect(calls).toHaveLength(2);
    expect(backing.size).toBe(1);
  });

  it("H7-09 a lost acknowledgement of a transfer never reports success and leaves exactly one live owner", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    const a = await cluster.start("review-a", { storage: instrumented.storage });
    const b = await cluster.start("review-b");
    armed();
    const [applied, refused] = [sessionUri("applied"), sessionUri("refused")];
    const senior = await cluster.peer("review-a", "senior");
    for (const uri of [applied, refused]) await senior.call("createSession", { channel: uri });
    const owners = async (uri: string): Promise<string[]> => {
      await reconciled(cluster, "review-a", "review-b");
      return ["review-a", "review-b"].filter((hostId) => isReady(cluster, hostId, uri));
    };
    const location = (uri: string) => instrumented.control.lease?.coordination?.locate({ sessionUri: uri });

    // The store committed the move. The acknowledgement never reached the previous owner.
    instrumented.control.faults.set("transfer", "applied");
    await expect(a.host.transferSession(applied, "review-b")).rejects.toThrow();
    await eventually(() => b.host.sessions.getSessionSnapshot(applied), "the committed move is honoured by the new owner");
    expect(await owners(applied)).toEqual(["review-b"]);
    expect(await location(applied)).toMatchObject({ hostId: "review-b", ownershipEpoch: "2", lifecycle: "active" });
    // The previous owner did not keep serving on the strength of an acknowledgement it never got.
    await expect(a.host.sessions.dispatchAction({ ...title(applied, "stale"), clientId: "old-owner" })).rejects.toThrow();
    expect(b.host.sessions.getSessionSnapshot(applied)?.state.title).not.toBe("stale");

    // The store did not commit the move. The acknowledgement is equally missing.
    instrumented.control.faults.set("transfer", "refused");
    await expect(a.host.transferSession(refused, "review-b")).rejects.toThrow();
    expect(await owners(refused)).toEqual(["review-a"]);
    expect(await location(refused)).toMatchObject({ hostId: "review-a", ownershipEpoch: "1", lifecycle: "active" });
    // The session is usable again on the owner the store names, and only there.
    const writer = await cluster.peer("review-b", "senior", "writer");
    await writer.call("subscribe", { channel: refused });
    writer.notify("dispatchAction", title(refused, "Still here"));
    await sawTitle(writer, refused, "Still here");
    expect(a.host.sessions.getSessionSnapshot(refused)?.state.title).toBe("Still here");
  });

  it("H7-09 a restore callback that never settles is bounded, suspends the session and never publishes it ready late", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const hung = Promise.withResolvers<SessionBackend>();
    let disposedLate = 0;
    let restores = 0;
    const hanging: SessionProvider = { ...mockProvider, restoreSession: () => {
      restores += 1;
      // Only the first attempt hangs. A later, separate attempt finds a working provider.
      return restores === 1 ? hung.promise : Promise.resolve({ dispose: () => undefined });
    } };
    const a = await cluster.start("review-a");
    const b = await cluster.start("review-b", { provider: hanging, callbackDeadlineMs: 150 });
    const added: string[] = [];
    b.host.sessions.onCatalogueNotification((notification) => {
      if (notification.method === "root/sessionAdded") added.push(notification.params.summary.resource);
    });
    const [alpha, beta] = [sessionUri("alpha"), sessionUri("beta")];
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    await senior.call("subscribe", { channel: alpha });
    senior.notify("dispatchAction", title(alpha, "Kept"));
    await sawTitle(senior, alpha, "Kept");

    await a.host.transferSession(alpha, "review-b");
    await eventually(() => restores === 1 ? true : undefined, "restore callback started");
    const probe = await cluster.peer("review-a", "senior", "probe");
    // Within the callback deadline the session is suspended in the store instead of waiting forever.
    await eventually(async () => {
      const reply = await probe.request("subscribe", { channel: alpha });
      return reply.error !== undefined && b.host.sessions.getSessionSnapshot(alpha) === undefined && restores === 1 ? true : undefined;
    }, "session unavailable while its restore hangs");
    await eventually(() => b.host.sessions.durability?.inspect().some((entry) => entry.session.id === alpha) === true ? true : undefined, "restoration failure diagnosed");
    // Neither host serves it and neither announced it. The previous owner stays fenced.
    expect(a.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(added).toEqual([]);
    await expect(a.host.sessions.dispatchAction({ ...title(alpha, "stale"), clientId: "old-owner" })).rejects.toThrow();
    // The host itself is unaffected: it is ready and serves other sessions.
    expect(b.host.status().ready).toBe(true);
    const onB = await cluster.peer("review-b", "senior", "on-b");
    await onB.call("createSession", { channel: beta });
    expect(b.host.sessions.getSessionSnapshot(beta)?.state.lifecycle).toBe("ready");

    // The callback settles long after its deadline. Its backend is disposed and nothing becomes ready.
    hung.resolve({ dispose: () => {
      disposedLate += 1;
    } });
    await eventually(() => disposedLate === 1 ? true : undefined, "late backend disposed");
    expect(restores).toBe(1);
    expect(b.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(added).toEqual([beta]);
    expect((await probe.request("subscribe", { channel: alpha })).error).toBeDefined();

    // A new, separate restoration attempt against a working provider restores the committed state.
    await reconciled(cluster, "review-b");
    expect(restores).toBe(2);
    expect(disposedLate).toBe(1);
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state).toMatchObject({ title: "Kept", lifecycle: "ready" });
    expect(added).toEqual([beta, alpha]);
    expect(a.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
  });
});

describe("retirement, transfer and settlement", () => {
  /** A session owned by review-a with one work item leased to a worker connected through review-b. */
  const arrange = async (cluster: Cluster, name: string, peers: { senior: ExamplePeer; manager: ExamplePeer; worker: ExamplePeer; agentId: string }) => {
    const uri = sessionUri(name);
    await peers.senior.call("createSession", { channel: uri });
    const resource = cluster.node("review-a").host.sessions.authorization?.getResource(uri);
    if (resource === undefined) throw new Error("fixture");
    const job = await peers.manager.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: `review-${name}`, kind: "code.review", input: {},
      targetAgentId: peers.agentId, scope: [{ resource: { kind: "session", id: uri }, include: true }] });
    const claimed = await peers.worker.call<Claimed>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: uri } });
    expect(claimed.lease.workId).toBe(job.workId);
    return { uri, resource, workId: job.workId, lease: claimed.lease };
  };
  const scenario = async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    const a = await cluster.start("review-a", { storage: instrumented.storage });
    const b = await cluster.start("review-b");
    armed();
    const senior = await cluster.peer("review-a", "senior");
    const manager = await cluster.peer("review-a", "pm");
    const worker = await cluster.peer("review-b", "junior", "worker");
    const { agentId } = await worker.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    const work = async (workId: string) => instrumented.control.lease?.work.get(domainId, workId);
    const location = (uri: string) => instrumented.control.lease?.coordination?.locate({ sessionUri: uri });
    const serving = async (uri: string): Promise<string[]> => {
      await reconciled(cluster, "review-a", "review-b");
      return ["review-a", "review-b"].filter((hostId) => cluster.node(hostId).host.sessions.getSessionSnapshot(uri) !== undefined);
    };
    return { cluster, gates, instrumented, a, b, peers: { senior, manager, worker, agentId }, work, location, serving };
  };
  const retire = (node: { host: { sessions: { authorization?: { disposeSession(resource: never): Promise<boolean> } } } }, resource: unknown): Promise<boolean> =>
    Promise.resolve().then(() => node.host.sessions.authorization?.disposeSession(resource as never) ?? false).catch(() => false);

  it("H7-08 a retirement and a settlement attempted while a transfer is in flight change nothing the transfer does not", async () => {
    const { cluster, gates, a, b, peers, work, location, serving } = await scenario();
    const { uri, resource, workId, lease } = await arrange(cluster, "moving", peers);
    // The previous owner has withdrawn the session locally. The durable move has not happened yet.
    const hold = gates.hold("transfer:before");
    const moving = a.host.transferSession(uri, "review-b");
    await hold.reached;
    expect(await retire(a, resource)).toBe(false);
    expect(await retire(b, resource)).toBe(false);
    const during = await peers.worker.request("x-ahp/work/complete", { version: 1, ...execution(lease), result: { reviewed: true } });
    expect((await location(uri))?.lifecycle).toBe("active");
    hold.release();
    await moving;
    // Exactly one owner, nothing retired, nothing cancelled.
    await eventually(() => isReady(cluster, "review-b", uri) ? true : undefined, "session ready on its new owner");
    expect(await serving(uri)).toEqual(["review-b"]);
    expect(await location(uri)).toMatchObject({ hostId: "review-b", lifecycle: "active" });
    // The settlement happened exactly once: either during the move or now, never both and never neither.
    const after = await peers.worker.request("x-ahp/work/complete", { version: 1, ...execution(lease), result: { reviewed: true } });
    expect([during.error === undefined, after.error === undefined].filter(Boolean)).toHaveLength(1);
    expect(await work(workId)).toMatchObject({ status: "completed", attemptCount: 1 });
    // Retirement is still the current owner's explicit act, and it is final.
    const moved = b.host.sessions.authorization?.getResource(uri);
    expect(moved).toEqual(resource);
    expect(await retire(a, resource)).toBe(false);
    expect(await retire(b, moved)).toBe(true);
    expect(await serving(uri)).toEqual([]);
    expect(await location(uri)).toBeUndefined();
    expect(await work(workId)).toMatchObject({ status: "completed", attemptCount: 1 });
  });

  it("H7-08 a transfer that arrives while a retirement is committing is refused before anything is torn down", async () => {
    const { cluster, gates, instrumented, a, b, peers, work, location, serving } = await scenario();
    const { uri, resource, workId } = await arrange(cluster, "committing", peers);
    // The retirement has started and nothing durable has changed yet: the session is live, active and owned here.
    const hold = gates.hold("beginRetirement:before");
    const retiring = retire(a, resource);
    await hold.reached;
    expect(isReady(cluster, "review-a", uri)).toBe(true);
    expect(await location(uri)).toMatchObject({ hostId: "review-a", ownershipEpoch: "1", lifecycle: "active" });
    await expect(a.host.transferSession(uri, "review-b")).rejects.toThrow();
    // The refused transfer withdrew nothing and moved nothing: the store was never asked.
    expect(instrumented.control.calls.get("transfer") ?? 0).toBe(0);
    expect(isReady(cluster, "review-a", uri)).toBe(true);
    expect(a.host.sessions.authorization?.getResource(uri)).toEqual(resource);
    expect(await location(uri)).toMatchObject({ hostId: "review-a", ownershipEpoch: "1", lifecycle: "active" });
    expect(await work(workId)).toMatchObject({ status: "leased" });
    hold.release();
    // The retirement completes for its caller, with its handles intact.
    expect(await retiring).toBe(true);
    expect(await location(uri)).toBeUndefined();
    expect(await serving(uri)).toEqual([]);
    expect(b.host.sessions.getSessionSnapshot(uri)).toBeUndefined();
    expect(await work(workId)).toMatchObject({ status: "cancelled", attemptCount: 1 });
  });

  it("H7-08 a transfer, an adoption and a settlement attempted while a retirement is in flight cannot undo it", async () => {
    const { cluster, gates, instrumented, a, b, peers, work, location, serving } = await scenario();
    const { uri, resource, workId, lease } = await arrange(cluster, "retiring", peers);
    // The retirement is durable and its work is cancelled. Its last step is still to come.
    const hold = gates.hold("finishRetirement:before");
    const retiring = retire(a, resource);
    await hold.reached;
    expect(await work(workId)).toMatchObject({ status: "cancelled" });
    await expect(a.host.transferSession(uri, "review-b")).rejects.toThrow();
    await expect(b.host.adoptSessions("review-a")).rejects.toThrow();
    expect((await peers.worker.request("x-ahp/work/complete", { version: 1, ...execution(lease), result: { late: true } })).error).toBeDefined();
    expect(await serving(uri)).toEqual([]);
    hold.release();
    expect(await retiring).toBe(true);
    expect(await location(uri)).toBeUndefined();
    // Nothing brings it back: not a reconciliation, not a restart of its former owner, not another member.
    expect(await serving(uri)).toEqual([]);
    await a.stop();
    const restarted = await cluster.start("review-a", { storage: instrumented.storage });
    expect(restarted.host.sessions.getSessionSnapshot(uri)).toBeUndefined();
    expect(b.host.sessions.getSessionSnapshot(uri)).toBeUndefined();
    expect(await location(uri)).toBeUndefined();
    const fresh = await cluster.peer("review-b", "senior", "after-retirement");
    expect((await fresh.request("subscribe", { channel: uri })).error).toBeDefined();
    // The terminal work history survives the retirement and the restart.
    expect(await work(workId)).toMatchObject({ id: workId, status: "cancelled", attemptCount: 1 });
    expect((await peers.worker.request("x-ahp/work/complete", { version: 1, ...execution(lease), result: { late: true } })).error).toBeDefined();
  });

  it("H7-08 racing a retirement, a transfer and a settlement ends in one consistent outcome, whichever of them wins", async () => {
    const { cluster, a, peers, work, location, serving } = await scenario();
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;
    const outcomes: { staggered: boolean; first: number; outcome: "retired" | "moved" }[] = [];
    // Started in the same turn, and started one event-loop turn apart.
    for (const staggered of [false, true]) {
      for (const [round, order] of orders.entries()) {
        const { uri, resource, workId, lease } = await arrange(cluster, `race-${staggered ? "apart" : "together"}-${String(round)}`, peers);
        const settle = () => peers.worker.request("x-ahp/work/complete", { version: 1, ...execution(lease), result: { round } });
        const results: { retired?: boolean; moved?: boolean; settled?: boolean } = {};
        const start = [
          () => retire(a, resource).then((value) => {
            results.retired = value;
          }),
          () => a.host.transferSession(uri, "review-b").then(() => {
            results.moved = true;
          }, () => {
            results.moved = false;
          }),
          () => settle().then((reply) => {
            results.settled = reply.error === undefined;
          }),
        ];
        const running: Promise<void>[] = [];
        for (const index of order) {
          running.push((start[index] ?? (() => Promise.resolve()))());
          if (staggered) await new Promise((resolve) => setImmediate(resolve));
        }
        await Promise.all(running);
        const where = await location(uri);
        const live = await serving(uri);
        const job = await work(workId);
        // Exactly one of retirement and transfer took effect.
        expect([results.retired, results.moved].filter(Boolean)).toHaveLength(1);
        if (results.retired === true) {
          expect(where).toBeUndefined();
          expect(live).toEqual([]);
          expect(job?.status).toBe(results.settled === true ? "completed" : "cancelled");
          expect((await settle()).error).toBeDefined();
        } else {
          expect(where).toMatchObject({ hostId: "review-b", lifecycle: "active" });
          await eventually(() => isReady(cluster, "review-b", uri) ? true : undefined, "moved session ready");
          expect(await serving(uri)).toEqual(["review-b"]);
          // A settlement that lost the race is simply repeated against the new owner; none is applied twice.
          const again = await settle();
          expect([results.settled === true, again.error === undefined].filter(Boolean)).toHaveLength(1);
          expect((await work(workId))?.status).toBe("completed");
        }
        expect((await work(workId))?.attemptCount).toBe(1);
        expect(a.host.sessions.getSessionSnapshot(uri)).toBeUndefined();
        outcomes.push({ staggered, first: order[0], outcome: results.retired === true ? "retired" : "moved" });
      }
    }
    expect(outcomes).toHaveLength(2 * orders.length);
    // Both winners occurred, so both branches above were really exercised.
    expect(new Set(outcomes.map((entry) => entry.outcome))).toEqual(new Set(["retired", "moved"]));
    // A retirement that starts first always wins, in either mode.
    expect(outcomes.filter((entry) => entry.first === 0).every((entry) => entry.outcome === "retired")).toBe(true);
  });
});

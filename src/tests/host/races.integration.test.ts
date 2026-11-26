import { describe, expect, it } from "vitest";
import type { HostRoutingOptions } from "@host";
import type { InitialAuthoritySource } from "@websocket/helpers/security";
import { channel, reviewWorkerKey } from "../../../examples/advanced/host";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, sessionUri, sharePersistence } from "../../../examples/host/support";
import { createCluster, eventually, onCleanup, type Cluster } from "./cluster";
import { createGates, gatedLinks, instrumentStorage } from "./instrument";

const title = (uri: string, value: string, clientSeq = 1) => ({ channel: uri, clientSeq, action: { type: "session/titleChanged", title: value } });
const routingFor = (cluster: Cluster, hostId: string, extra: Partial<HostRoutingOptions> = {}): HostRoutingOptions => {
  const endpoint = cluster.endpoints.get(hostId) ?? "";
  return { host: "127.0.0.1", port: Number(new URL(endpoint).port), endpoint, ...extra };
};
const titled = (peer: ExamplePeer, uri: string, value: string) => peer.actions(uri).find((envelope) => envelope.action.title === value);
const sawTitle = (peer: ExamplePeer, uri: string, value: string): Promise<{ serverSeq: number }> => peer.wait(() => titled(peer, uri, value), 5_000, `title ${value}`);
interface Snapshot { snapshot: { fromSeq: number; state: { title?: string; lifecycle: string } } }
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

describe("ownership loss", () => {
  it.each(["before", "after"] as const)("H3-04 fences new work and a write held %s its commit when ownership is lost", async (point) => {
    const namespaceId = "ahp-namespace:review-app/production";
    const membership = createExampleMembership(namespaceId, [{ hostId: "review-app", maxInstances: 2 }]);
    const { provider } = createExamplePersistence();
    const storage = provider.durability;
    if (!storage) throw new Error("fixture");
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(storage, gates);
    const replica = (instanceId: string, store = storage) => {
      const node = createExampleNode({ hostId: "review-app", mode: "replicated", namespaceId, membership, storage: store, persistence: sharePersistence(provider), instanceId, standbyRetryMs: 20 });
      onCleanup(() => node.stop());
      return node;
    };
    const active = replica("pod-1", instrumented.storage);
    const standby = replica("pod-2");
    const address = await active.host.start();
    await eventually(() => active.host.status().ready ? true : undefined, "first replica active");
    await standby.host.start();
    await eventually(() => standby.host.status().phase === "standby" ? true : undefined, "standby");
    armed();
    const url = `ws://127.0.0.1:${String(address.port)}/`;
    const alpha = sessionUri("alpha");
    const writer = await ExamplePeer.connect(url, "senior");
    onCleanup(() => writer.close());
    await writer.initialize("writer");
    await writer.call("createSession", { channel: alpha });
    await writer.call("subscribe", { channel: alpha });
    const subscriber = await ExamplePeer.connect(url, "observer");
    onCleanup(() => subscriber.close());
    await subscriber.initialize("subscriber", [alpha]);
    writer.notify("dispatchAction", title(alpha, "Before loss"));
    await sawTitle(subscriber, alpha, "Before loss");

    // One admitted write is in flight, held at its durable commit, with a live subscriber waiting for it.
    const hold = gates.hold(`commitState:${point}`);
    writer.notify("dispatchAction", title(alpha, "Delayed", 2));
    await hold.reached;
    // The store stops naming this instance as the holder, then the adapter reports the loss.
    await instrumented.control.lease?.release();
    instrumented.control.lost?.();
    // Synchronously: unready, stopped, and closed to new work. No await separates the loss from these checks.
    expect(active.host.status()).toMatchObject({ phase: "stopped", ready: false });
    const lateWork = active.host.sessions.dispatchAction({ ...title(alpha, "New work", 3), clientId: "late" });
    const lateSession = active.host.sessions.createSession({ channel: sessionUri("late") });
    await expect(lateWork).rejects.toThrow();
    await expect(lateSession).rejects.toThrow();
    await expect(ExamplePeer.connect(url, "senior")).rejects.toThrow();

    // The standby becomes the only owner while the old instance still has its write in hand.
    await eventually(() => standby.host.status().ready ? true : undefined, "takeover");
    hold.release();
    await eventually(() => subscriber.closed && writer.closed ? true : undefined, "connections of the fenced instance closed");
    // The delayed send never reaches a subscriber of the fenced instance, whether or not the store had committed it.
    expect(titled(subscriber, alpha, "Delayed")).toBeUndefined();
    expect(titled(writer, alpha, "Delayed")).toBeUndefined();
    expect(titled(subscriber, alpha, "New work")).toBeUndefined();
    expect(active.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    // The fenced instance has finished everything it had in hand, including the released write.
    await active.stop();
    // The store holds exactly what was committed before the loss: a write refused by the fence is absent,
    // a write committed before the loss is present. A third instance reads it from the store, not from memory.
    const expected = point === "before" ? "Before loss" : "Delayed";
    expect(standby.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe(expected);
    await standby.stop();
    const witness = replica("pod-3");
    await witness.host.start();
    await eventually(() => witness.host.status().ready ? true : undefined, "witness active");
    expect(witness.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe(expected);
    expect(witness.host.sessions.getSessionSnapshot(sessionUri("late"))).toBeUndefined();
  });
});

describe("routing races", () => {
  it("H5-04 follows a location that went stale during the lookup exactly once and applies one write on the new owner", async () => {
    const cluster = await createCluster(["review-a", "review-b", "review-c"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    await cluster.start("review-a");
    await cluster.start("review-b", { storage: instrumented.storage });
    await cluster.start("review-c");
    armed();
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    const onB = await cluster.peer("review-b", "senior");
    // The ingress has read "review-a owns it" from the store and is paused before using that answer.
    const hold = gates.hold("locate:after");
    const before = instrumented.control.calls.get("locate") ?? 0;
    const pending = onB.request("subscribe", { channel: alpha });
    await hold.reached;
    await cluster.node("review-a").host.transferSession(alpha, "review-c");
    await eventually(() => cluster.node("review-c").host.sessions.getSessionSnapshot(alpha), "session restored on its new owner");
    hold.release();
    const reply = await pending;
    expect(reply.error).toBeUndefined();
    expect((reply.result as Snapshot).snapshot.state.lifecycle).toBe("ready");
    // One stale answer, one fresh answer. The request was forwarded to at most two owners and never looped.
    expect((instrumented.control.calls.get("locate") ?? 0) - before).toBe(2);
    onB.notify("dispatchAction", title(alpha, "After the move"));
    await sawTitle(onB, alpha, "After the move");
    expect(cluster.node("review-c").host.sessions.getSessionSnapshot(alpha)?.state.title).toBe("After the move");
    // The former owner applied nothing and serves nothing.
    expect(cluster.node("review-a").host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(cluster.node("review-b").host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    expect(onB.actions(alpha).filter((envelope) => envelope.action.title === "After the move")).toHaveLength(1);
    // A second caller that hits the same stale cache entry is also served by the current owner.
    const again = await cluster.peer("review-b", "observer", "second");
    const second = await again.call<Snapshot>("subscribe", { channel: alpha });
    expect(second.snapshot.state.title).toBe("After the move");
  });

  it("H5-05 reports an unknown outcome when the owner's reply is lost after its commit, and an idempotent retry does not repeat it", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const lose = new Set<string>();
    await cluster.start("review-a");
    await cluster.start("review-b", { routing: routingFor(cluster, "review-b", { connect: gatedLinks(gates, lose) }) });
    armed();
    const alpha = sessionUri("alpha");
    const scope = [{ resource: { kind: "session", id: alpha }, include: true }];
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    const worker = await cluster.peer("review-a", "junior", "worker");
    const registered = await worker.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    const submit = { version: 1, requestKey: "lost-reply", kind: "code.review", input: { topic: "release" }, targetAgentId: registered.agentId, scope };
    const manager = await cluster.peer("review-b", "pm", "manager");
    lose.add("x-ahp/work/submit");
    const lost = await manager.request("x-ahp/work/submit", submit);
    // The caller is told the truth: the request left, and its outcome is not known. No success is invented.
    expect(lost.error?.message).toBe("Routed request outcome unknown");
    expect(lost.result).toBeUndefined();
    // The ingress did not send it a second time on its own.
    const listed = async (): Promise<{ id: string }[]> => (await senior.call<{ items: { id: string }[] }>("x-ahp/work/list", { version: 1, session: { kind: "session", id: alpha } })).items;
    expect(await listed()).toHaveLength(1);
    // The caller reconciles with the same immutable intent, through either ingress, and gets the one work item.
    const retried = await manager.call<{ workId: string }>("x-ahp/work/submit", submit);
    const direct = await (await cluster.peer("review-a", "pm", "manager-a")).call<{ workId: string }>("x-ahp/work/submit", submit);
    expect(retried.workId).toBe(direct.workId);
    expect((await listed()).map((item) => item.id)).toEqual([retried.workId]);
    await eventually(() => cluster.node("review-b").host.routingStats().pending === 0 ? true : undefined, "no pending routed request");
  });

  it.each(["forward", "reply"] as const)("H5-06 a namespace revocation while a routed request waits at its %s is never answered from earlier authority", async (point) => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    await cluster.start("review-a");
    await cluster.start("review-b", { routing: routingFor(cluster, "review-b", { connect: gatedLinks(gates) }) });
    armed();
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    const onB = await cluster.peer("review-b", "observer");
    // "forward": the ingress admitted the request and has not sent it. "reply": the owner admitted and answered it.
    const hold = gates.hold(`${point}:subscribe`);
    const pending = onB.request("subscribe", { channel: alpha });
    await hold.reached;
    const revision = await cluster.node("review-a").host.revokeNamespaceAuthority();
    await eventually(() => onB.closed && onA.closed ? true : undefined, "connections under the earlier authority closed");
    await eventually(() => cluster.node("review-b").host.status().authorityRevision === revision ? true : undefined, "ingress observed the revocation");
    hold.release();
    const reply = await pending;
    // Nothing prepared under the revoked authority is delivered: no snapshot, no sequence, no action.
    expect(reply.result).toBeUndefined();
    expect(onB.actions()).toHaveLength(0);
    expect(JSON.stringify(onB.frames)).not.toContain("fromSeq");
    await eventually(() => {
      const stats = cluster.node("review-b").host.routingStats();
      return stats.connections === 0 && stats.links === 0 && stats.pending === 0 && stats.held === 0 ? true : undefined;
    }, "routing resources released");
    // A freshly authenticated caller proceeds against intact state.
    const fresh = await cluster.peer("review-b", "observer", "after-revocation");
    expect((await fresh.call<Snapshot>("subscribe", { channel: alpha })).snapshot.state.lifecycle).toBe("ready");
  });

  it.each(["forward", "reply"] as const)("H5-06 with the revocation hint dropped at the ingress, a request held at its %s is still not answered from earlier authority", async (point) => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const instrumented = instrumentStorage(cluster.storage, gates);
    instrumented.control.dropAuthorityHints = true;
    await cluster.start("review-a");
    await cluster.start("review-b", { storage: instrumented.storage, routing: routingFor(cluster, "review-b", { connect: gatedLinks(gates) }) });
    armed();
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    await onA.call("subscribe", { channel: alpha });
    onA.notify("dispatchAction", title(alpha, "Before revocation"));
    await sawTitle(onA, alpha, "Before revocation");
    const onB = await cluster.peer("review-b", "observer");
    const hold = gates.hold(`${point}:subscribe`);
    const pending = onB.request("subscribe", { channel: alpha });
    await hold.reached;
    await cluster.node("review-a").host.revokeNamespaceAuthority();
    // The owner dropped every connection it had, including the relayed one. The ingress was told nothing.
    await eventually(() => onA.closed && cluster.node("review-b").host.routingStats().links === 0 ? true : undefined, "owner side of the link closed");
    expect(onB.closed).toBe(false);
    hold.release();
    const reply = await pending;
    // Whether the owner had not seen the request or had already answered it, nothing reaches the caller.
    expect(reply.result).toBeUndefined();
    expect(reply.error).toBeDefined();
    expect(onB.actions()).toHaveLength(0);
    expect(JSON.stringify(onB.frames)).not.toContain("fromSeq");
    expect(JSON.stringify(onB.frames)).not.toContain("Before revocation");
    if (point === "forward") {
      // The request never left the ingress: the caller's connection is intact and reports a generic failure.
      expect(reply.error?.message).toBe("Routed request unavailable");
      expect(onB.closed).toBe(false);
    } else {
      // The owner's subscription died with its link, so the caller is disconnected rather than left subscribed to nothing.
      await eventually(() => onB.closed ? true : undefined, "caller disconnected");
    }
    await eventually(() => {
      const stats = cluster.node("review-b").host.routingStats();
      return stats.links === 0 && stats.pending === 0 && stats.held === 0 ? true : undefined;
    }, "routing resources released");
    // A new request is authenticated by the owner under its current authority.
    const fresh = await cluster.peer("review-b", "observer", "after-revocation");
    expect((await fresh.call<Snapshot>("subscribe", { channel: alpha })).snapshot.state.title).toBe("Before revocation");
  });

  it("H5-06 the owner denies a routed claim whose grant it revoked after the ingress admitted the request, with no hint to the ingress", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const owner = await cluster.start("review-a");
    await cluster.start("review-b", { routing: routingFor(cluster, "review-b", { connect: gatedLinks(gates) }) });
    armed();
    await owner.provision();
    const scope = [{ resource: { kind: "session", id: channel }, include: true }];
    const worker = await cluster.peer("review-b", "junior", "worker");
    const registered = await worker.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    const claim = { version: 1, session: { kind: "session", id: channel } };
    // The control: what this worker is told when there is simply nothing for it to claim.
    const nothing = await worker.request("x-ahp/work/claim", claim);
    expect(nothing.result).toEqual({ version: 1, status: "empty" });
    const manager = await cluster.peer("review-a", "pm", "manager");
    const job = await manager.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: "revoked-claim", kind: "code.review", input: {}, targetAgentId: registered.agentId, scope });

    const hold = gates.hold("forward:x-ahp/work/claim");
    const pending = worker.request("x-ahp/work/claim", claim);
    await hold.reached;
    // Revoked on the owner only. The ingress receives no invalidation and holds nothing it could consult.
    expect(owner.revokeJuniorWork()).toBe(true);
    hold.release();
    const reply = await pending;
    // No lease is issued, and the answer is indistinguishable from "nothing to claim": it does not
    // say that work exists, that a grant existed, or that one was withdrawn.
    expect(reply.error).toBeUndefined();
    expect(reply.result).toEqual(nothing.result);
    const senior = await cluster.peer("review-a", "senior");
    const detail = await senior.call<{ work: { status: string; attempt?: number } | null }>("x-ahp/work/get", { version: 1, workId: job.workId });
    expect(detail.work?.status).toBe("queued");
    expect(cluster.node("review-b").host.routingStats().pending).toBe(0);
  });
});

describe("delivery races", () => {
  /** Lets a test withdraw one subject's connection authority on one host, or withhold its sequence consent. */
  const authority = (settings: { readonly withoutSequence?: ReadonlySet<string> } = {}) => {
    const revoked = new Set<string>();
    const source: InitialAuthoritySource = { prepare: (input) => {
      const subject = input.context.actor.principal.subject;
      return Promise.resolve({ scopes: [], allowGlobalSequence: settings.withoutSequence?.has(subject) !== true, validUntil: Date.now() + 60_000, signal: input.signal,
        isCurrent: () => !revoked.has(subject), release: () => undefined });
    } };
    return { revoked, source };
  };

  it("H5-06 H6-09 an action held before the final send is not delivered to a recipient revoked in the meantime", async () => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    const ingress = authority();
    const owner = await cluster.start("review-a");
    await cluster.start("review-b", { initialAuthority: ingress.source, routing: routingFor(cluster, "review-b", { connect: gatedLinks(gates) }) });
    armed();
    await owner.provision();
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("subscribe", { channel });
    const observer = await cluster.peer("review-b", "observer");
    const control = await cluster.peer("review-b", "pm");
    await observer.call("subscribe", { channel });
    await control.call("subscribe", { channel });
    senior.notify("dispatchAction", title(channel, "Before"));
    await sawTitle(observer, channel, "Before");
    await sawTitle(control, channel, "Before");

    // The owner admitted both recipients and sent the action. It waits just before the ingress hands it over.
    const hold = gates.hold("notify:review-a");
    senior.notify("dispatchAction", title(channel, "Held", 2));
    await sawTitle(senior, channel, "Held");
    await hold.reached;
    ingress.revoked.add("observer");
    hold.release();
    // The still-authorized recipient gets it. The revoked one gets nothing further, then or later.
    await sawTitle(control, channel, "Held");
    senior.notify("dispatchAction", title(channel, "Later", 3));
    await sawTitle(control, channel, "Later");
    expect(titled(observer, channel, "Held")).toBeUndefined();
    expect(titled(observer, channel, "Later")).toBeUndefined();
    expect(observer.actions(channel).map((envelope) => envelope.action.title)).toEqual(["Before"]);
  });

  it("H6-09 a recipient the owner revoked between two actions receives no further payload through another host", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const owner = cluster.node("review-a");
    await owner.provision();
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("subscribe", { channel });
    const observer = await cluster.peer("review-b", "observer");
    const control = await cluster.peer("review-b", "pm");
    await observer.call("subscribe", { channel });
    await control.call("subscribe", { channel });
    senior.notify("dispatchAction", title(channel, "Before"));
    await sawTitle(observer, channel, "Before");
    // Only the owner knows. The ingress is told nothing and keeps forwarding whatever the owner sends.
    expect(owner.registry.removeBinding({ bindingId: "demo-observer", scope: owner.origin(), revision: 1 })).toBe(true);
    for (const [index, value] of ["One", "Two", "Three"].entries()) senior.notify("dispatchAction", title(channel, value, index + 2));
    await sawTitle(control, channel, "Three");
    expect(observer.actions(channel).map((envelope) => envelope.action.title)).toEqual(["Before"]);
    // No later request by the revoked recipient discloses state either.
    const again = await observer.request("subscribe", { channel });
    expect(again.result === undefined || observer.closed).toBe(true);
    const fresh = await cluster.peer("review-b", "observer", "revoked-again");
    expect((await fresh.request("subscribe", { channel })).result).toBeUndefined();
    expect(fresh.actions()).toHaveLength(0);
  });

  it.each([["every host", ["review-a", "review-b"]], ["the owner only", ["review-a"]]] as const)("H6-09 a subject without sequence consent on %s receives no sequence, snapshot or cursor through an ingress", async (_label, restricted) => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const withoutSequence = new Set(["observer"]);
    for (const hostId of ["review-a", "review-b"]) {
      await cluster.start(hostId, (restricted as readonly string[]).includes(hostId) ? { initialAuthority: authority({ withoutSequence }).source } : {});
    }
    const alpha = sessionUri("alpha");
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    await senior.call("subscribe", { channel: alpha });
    senior.notify("dispatchAction", title(alpha, "Sequenced"));
    await sawTitle(senior, alpha, "Sequenced");

    const peer = await ExamplePeer.connect(cluster.url("review-b"), "observer");
    onCleanup(() => peer.close());
    const initialized = await peer.request("initialize", { channel: "ahp-root://", clientId: "no-consent", protocolVersions: ["1.0.0"], initialSubscriptions: [alpha] });
    const subscribed = await peer.request("subscribe", { channel: alpha });
    const listed = await peer.request("listSessions", { channel: "ahp-root://", limit: 1 });
    // Where the ingress itself withholds consent nothing native is answered at all. Where only the
    // owner withholds it, the ingress answers for itself and the owner discloses nothing of the session.
    if ((restricted as readonly string[]).includes("review-b")) expect(initialized.result).toBeUndefined();
    expect(subscribed.result).toBeUndefined();
    const disclosed = JSON.stringify(peer.frames);
    expect(disclosed).not.toContain("Sequenced");
    expect(disclosed).not.toContain("fromSeq");
    expect(disclosed).not.toContain("nextCursor");
    expect(peer.actions()).toHaveLength(0);
    if (listed.result !== undefined) expect((listed.result as { items: unknown[] }).items).toEqual([]);
    senior.notify("dispatchAction", title(alpha, "Still private", 2));
    await sawTitle(senior, alpha, "Still private");
    expect(JSON.stringify(peer.frames)).not.toContain("Still private");
    // A consenting subject on the same ingress is unaffected.
    const consenting = await cluster.peer("review-b", "pm", "consenting");
    expect((await consenting.call<Snapshot>("subscribe", { channel: alpha })).snapshot.state.title).toBe("Still private");
  });

  it.each(["reply", "forward"] as const)("H6-07 a commit that races a routed snapshot held at its %s is never missed", async (point) => {
    const cluster = await createCluster(["review-a", "review-b"], {}, false);
    const { gates, armed } = gatesFor();
    await cluster.start("review-a");
    await cluster.start("review-b", { routing: routingFor(cluster, "review-b", { connect: gatedLinks(gates) }) });
    armed();
    const alpha = sessionUri("alpha");
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    await senior.call("subscribe", { channel: alpha });
    senior.notify("dispatchAction", title(alpha, "Before"));
    await sawTitle(senior, alpha, "Before");
    const watcher = await cluster.peer("review-b", "observer");
    // "reply": the owner took the snapshot and subscribed the caller; the answer is paused on its way back.
    // "forward": the request is paused before the owner has seen it.
    const hold = gates.hold(`${point}:subscribe`);
    const pending = watcher.request("subscribe", { channel: alpha });
    await hold.reached;
    senior.notify("dispatchAction", title(alpha, "During", 2));
    const committed = await sawTitle(senior, alpha, "During");
    hold.release();
    const reply = await pending;
    const snapshot = (reply.result as Snapshot).snapshot;
    if (point === "reply") {
      // The snapshot predates the commit, so the commit must follow it as an action above the watermark.
      expect(snapshot.state.title).toBe("Before");
      const action = await sawTitle(watcher, alpha, "During");
      expect(action.serverSeq).toBe(committed.serverSeq);
      expect(action.serverSeq).toBeGreaterThan(snapshot.fromSeq);
      // The caller saw its snapshot first: the action was held until the reply had been enqueued.
      const replyAt = watcher.frames.findIndex((frame) => frame.id === reply.id && frame.method === undefined);
      const actionAt = watcher.frames.findIndex((frame) => frame.method === "action" && frame.params?.serverSeq === action.serverSeq);
      expect(replyAt).toBeGreaterThanOrEqual(0);
      expect(actionAt).toBeGreaterThan(replyAt);
    } else {
      // The snapshot already contains the commit, at or above its sequence. It is not delivered a second time.
      expect(snapshot.state.title).toBe("During");
      expect(snapshot.fromSeq).toBeGreaterThanOrEqual(committed.serverSeq);
    }
    senior.notify("dispatchAction", title(alpha, "After", 3));
    const after = await sawTitle(watcher, alpha, "After");
    expect(after.serverSeq).toBeGreaterThan(snapshot.fromSeq);
    for (const envelope of watcher.actions(alpha)) expect(envelope.serverSeq).toBeGreaterThan(snapshot.fromSeq);
    expect(watcher.actions(alpha).filter((envelope) => envelope.action.title === "During")).toHaveLength(point === "reply" ? 1 : 0);
    expect(cluster.node("review-b").host.routingStats().held).toBe(0);
  });
});

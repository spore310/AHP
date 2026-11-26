import { describe, expect, it } from "vitest";
import { createHostAdmission } from "@host";
import { sessionUri } from "../../../examples/host/support";
import { createCluster, eventually, onCleanup, sharedNamespace } from "./cluster";

const title = (uri: string, value: string, clientSeq = 1) => ({ channel: uri, clientSeq, action: { type: "session/titleChanged", title: value } });

describe("session ownership in a shared namespace", () => {
  it("H7-04 H7-07 H5-04 transfers one session without changing its identity and fences the old owner", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const a = cluster.node("review-a");
    const b = cluster.node("review-b");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    await onA.call("subscribe", { channel: alpha });
    onA.notify("dispatchAction", title(alpha, "Before transfer"));
    await onA.wait(() => onA.actions(alpha).find((envelope) => envelope.action.title === "Before transfer"), 5_000, "title");
    const identity = a.host.sessions.authorization?.getResource(alpha);
    expect(identity).toBeDefined();
    const lastSeq = Math.max(...onA.actions(alpha).map((envelope) => envelope.serverSeq));

    await a.host.transferSession(alpha, "review-b");
    // The old owner withdrew local authority before the durable change and cannot serve it again.
    expect(a.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    await expect(a.host.sessions.dispatchAction({ ...title(alpha, "stale"), clientId: "old-owner" })).rejects.toThrow();
    // The new owner restores it from durable facts under the same exact resource identity.
    await eventually(() => b.host.sessions.getSessionSnapshot(alpha), "restored session");
    expect(b.host.sessions.authorization?.getResource(alpha)).toEqual(identity);
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe("Before transfer");

    // A request through the previous owner's ingress now follows the session to its new owner.
    const again = await cluster.peer("review-a", "senior", "after-transfer");
    const snapshot = await again.call<{ snapshot: { fromSeq: number; state: { title: string } } }>("subscribe", { channel: alpha });
    expect(snapshot.snapshot.state.title).toBe("Before transfer");
    again.notify("dispatchAction", title(alpha, "After transfer"));
    const moved = await again.wait(() => again.actions(alpha).find((envelope) => envelope.action.title === "After transfer"), 5_000, "routed title");
    // The channel's sequence keeps ascending across the change of owner.
    expect(moved.serverSeq).toBeGreaterThan(lastSeq);
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state.title).toBe("After transfer");
    expect(a.host.sessions.getSessionSnapshot(alpha)).toBeUndefined();
    // Placement is authoritative: an unknown or self target is refused and nothing moves.
    await expect(b.host.transferSession(alpha, "review-missing")).rejects.toThrow();
    await eventually(() => b.host.sessions.getSessionSnapshot(alpha) ?? undefined, "session restored after a refused transfer");
  });

  it("H7-01 H7-03 H7-08 adopts a stopped member's sessions exactly once and never from a live member", async () => {
    const cluster = await createCluster(["review-a", "review-b", "review-c"]);
    const names = ["alpha", "gamma", "delta"].map(sessionUri);
    const onA = await cluster.peer("review-a", "senior");
    for (const uri of names) await onA.call("createSession", { channel: uri });
    const onB = await cluster.peer("review-b", "senior");
    await onB.call("createSession", { channel: sessionUri("beta") });
    const b = cluster.node("review-b");
    const c = cluster.node("review-c");
    // While its owner is live a session cannot be taken.
    await expect(b.host.adoptSessions("review-a")).rejects.toThrow();
    expect(cluster.node("review-a").host.sessions.listSessionSnapshots()).toHaveLength(3);

    await cluster.node("review-a").stop();
    const [first, second] = await Promise.allSettled([b.host.adoptSessions("review-a"), c.host.adoptSessions("review-a")]);
    const adopted = [first, second].flatMap((result) => result.status === "fulfilled" ? [...result.value] : []);
    // Every session has exactly one new owner.
    expect(adopted.sort()).toEqual([...names].sort());
    const live = [...b.host.sessions.listSessionSnapshots(), ...c.host.sessions.listSessionSnapshots()].map((snapshot) => snapshot.resource);
    expect(live.sort()).toEqual([...names, sessionUri("beta")].sort());

    // The restarted member restores only what it still owns: nothing.
    const restarted = await cluster.start("review-a");
    expect(restarted.host.sessions.listSessionSnapshots()).toHaveLength(0);
    const viaA = await cluster.peer("review-a", "senior", "after-adoption");
    const snapshot = await viaA.call<{ snapshot: { resource: string; state: { lifecycle: string } } }>("subscribe", { channel: names[0] ?? "" });
    expect(snapshot.snapshot.state.lifecycle).toBe("ready");
    // Retirement stays an explicit, authoritative act of the current owner.
    const ownerOfAlpha = b.host.sessions.getSessionSnapshot(names[0] ?? "") ? b : c;
    const resource = ownerOfAlpha.host.sessions.authorization?.getResource(names[0] ?? "");
    expect(resource).toBeDefined();
    if (resource) expect(await ownerOfAlpha.host.sessions.authorization?.disposeSession(resource)).toBe(true);
    await expect(restarted.host.adoptSessions("review-b")).rejects.toThrow();
  });

  it("H7-06 H3-08 H4-06 never places a session on a member that cannot restore its provider", async () => {
    const cluster = await createCluster(["review-a", "review-b", "review-c"], {}, false);
    await cluster.start("review-a");
    await cluster.start("review-b");
    // review-c is a current, active member whose process declares a different provider.
    const credential = cluster.membership.credentials.get("review-c");
    if (!credential) throw new Error("fixture");
    const admission = createHostAdmission({ hostId: "review-c", policy: cluster.membership.policy, credential });
    const incapable = await cluster.storage.acquire("review-c", () => undefined, { namespaceId: sharedNamespace, instanceId: "c-1", shared: true, policy: admission.policy,
      capabilities: { providers: ["other-provider"] } });
    onCleanup(() => incapable.release());
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    const a = cluster.node("review-a");
    expect((await a.host.members()).map((member) => [member.hostId, member.role])).toEqual([["review-a", "active"], ["review-b", "active"], ["review-c", "active"]]);
    await expect(a.host.transferSession(alpha, "review-c")).rejects.toThrow();
    // The refused move left the session live and ready on its owner, with its ownership epoch unchanged.
    await eventually(() => a.host.sessions.getSessionSnapshot(alpha), "session still served by its owner");
    expect(await incapable.coordination?.locate({ sessionUri: alpha })).toMatchObject({ hostId: "review-a", ownershipEpoch: "1" });
    await a.stop();
    // Adoption by the incapable member takes nothing. A capable member restores the session.
    expect(await incapable.coordination?.adopt("review-a")).toEqual([]);
    expect(await cluster.node("review-b").host.adoptSessions("review-a")).toEqual([alpha]);
    expect(cluster.node("review-b").host.sessions.getSessionSnapshot(alpha)?.state.lifecycle).toBe("ready");
  });

  it("H3-07 drains a host by handing its sessions to another member without retiring them", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    const identity = cluster.node("review-a").host.sessions.authorization?.getResource(alpha);
    await cluster.node("review-a").host.drain({ transferTo: "review-b" });
    expect(cluster.node("review-a").host.status().phase).toBe("stopped");
    const b = cluster.node("review-b");
    await eventually(() => b.host.sessions.getSessionSnapshot(alpha), "handed-over session");
    expect(b.host.sessions.authorization?.getResource(alpha)).toEqual(identity);
    expect(b.host.sessions.getSessionSnapshot(alpha)?.state.lifecycle).toBe("ready");
    expect((await b.host.members()).map((member) => member.hostId)).toEqual(["review-b"]);
  });

  it("H2-04 H2-05 revokes cached authority on every member of the namespace", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const onA = await cluster.peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    const onB = await cluster.peer("review-b", "senior");
    await onB.call("subscribe", { channel: alpha });
    const events: string[] = [];
    cluster.node("review-b").host.onHostEvent((delivery) => {
      if (delivery.type === "event") events.push(`${delivery.event.topic}:${delivery.event.kind}`);
    });
    const revision = await cluster.node("review-a").host.revokeNamespaceAuthority();
    expect(revision).toBe(1);
    // Every connection established under the earlier authority ends, on the revoking host and elsewhere.
    await eventually(() => onA.closed && onB.closed ? true : undefined, "connections closed");
    expect(events).toContain("authority:revoked");
    // The committed session is intact and freshly authenticated callers proceed.
    const fresh = await cluster.peer("review-b", "senior", "after-revocation");
    const snapshot = await fresh.call<{ snapshot: { state: { lifecycle: string } } }>("subscribe", { channel: alpha });
    expect(snapshot.snapshot.state.lifecycle).toBe("ready");
    fresh.notify("dispatchAction", title(alpha, "After revocation"));
    await fresh.wait(() => fresh.actions(alpha).find((envelope) => envelope.action.title === "After revocation"), 5_000, "write after revocation");
  });
});

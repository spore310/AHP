import { describe, expect, it } from "vitest";
import { sessionUri } from "../../../examples/host/support";
import { createCluster } from "./cluster";

const cluster = async (hostIds: readonly string[]) => {
  const created = await createCluster(hostIds);
  return { peer: created.peer.bind(created), node: created.node.bind(created) };
};

describe("distributed namespace routing", () => {
  it("H5-01 reaches the owning host through a non-owner ingress and returns through the original connection", async () => {
    const { peer, node } = await cluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const onA = await peer("review-a", "senior");
    await onA.call("createSession", { channel: alpha });
    expect(node("review-a").host.sessions.getSessionSnapshot(alpha)).toBeDefined();
    expect(node("review-b").host.sessions.getSessionSnapshot(alpha)).toBeUndefined();

    const onB = await peer("review-b", "senior");
    const subscribed = await onB.call<{ snapshot: { resource: string; fromSeq: number; state: { lifecycle: string } } }>("subscribe", { channel: alpha });
    expect(subscribed.snapshot.resource).toBe(alpha);
    onB.notify("dispatchAction", { channel: alpha, clientSeq: 1, action: { type: "session/titleChanged", title: "Routed title" } });
    const action = await onB.wait(() => onB.actions(alpha).find((envelope) => envelope.action.type === "session/titleChanged"), 5_000, "routed action");
    expect(action.action.title).toBe("Routed title");
    expect(action.serverSeq).toBeGreaterThan(subscribed.snapshot.fromSeq);
    // The owner executed it: only its canonical state changed.
    expect(node("review-a").host.sessions.getSessionSnapshot(alpha)?.state.title).toBe("Routed title");
    expect(node("review-b").host.routingStats().links).toBe(1);
  });

  it("H6-05 H7-02 delivers actions from two owners on one connection in ascending namespace order", async () => {
    const { peer, node } = await cluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const beta = sessionUri("beta");
    const onA = await peer("review-a", "senior");
    const onB = await peer("review-b", "senior");
    await onA.call("createSession", { channel: alpha });
    await onB.call("createSession", { channel: beta });
    expect(node("review-a").host.sessions.getSessionSnapshot(beta)).toBeUndefined();
    expect(node("review-b").host.sessions.getSessionSnapshot(beta)).toBeDefined();
    const watcher = await peer("review-b", "observer", "watcher", ["ahp-root://", alpha, beta]);
    expect(watcher.initialized.snapshots.map((snapshot) => snapshot.resource).sort()).toEqual(["ahp-root://", alpha, beta].sort());
    const root = watcher.initialized.snapshots.find((snapshot) => snapshot.resource === "ahp-root://");
    // H6-08: the count covers authorized sessions on every owner, not only the ingress.
    expect(root?.state.activeSessions).toBe(2);
    const rounds = 12;
    for (let round = 1; round <= rounds; round += 1) {
      onA.notify("dispatchAction", { channel: alpha, clientSeq: round, action: { type: "session/titleChanged", title: `alpha ${String(round)}` } });
      onB.notify("dispatchAction", { channel: beta, clientSeq: round, action: { type: "session/titleChanged", title: `beta ${String(round)}` } });
    }
    const titles = (channel: string) => watcher.actions(channel).filter((envelope) => envelope.action.type === "session/titleChanged");
    await watcher.wait(() => titles(alpha).length === rounds && titles(beta).length === rounds ? true : undefined, 10_000, "all routed actions");
    const sequence = watcher.actions().map((envelope) => envelope.serverSeq);
    expect(sequence.length).toBeGreaterThanOrEqual(2 * rounds);
    // Never descending and never repeated, across both owners, without renumbering.
    for (let index = 1; index < sequence.length; index += 1) expect(sequence[index]).toBeGreaterThan(sequence[index - 1] ?? 0);
    for (const snapshot of watcher.initialized.snapshots) {
      for (const envelope of watcher.actions(snapshot.resource)) expect(envelope.serverSeq).toBeGreaterThan(snapshot.fromSeq);
    }
    expect(titles(alpha).map((envelope) => envelope.action.title)).toEqual(Array.from({ length: rounds }, (_, index) => `alpha ${String(index + 1)}`));
    expect(node("review-b").host.routingStats().held).toBe(0);

    // H6-08: one merged, authorization-filtered catalogue through either ingress, with stable pagination.
    const listed = await onA.call<{ items: { resource: string }[]; nextCursor?: string }>("listSessions", { channel: "ahp-root://" });
    expect(listed.items.map((item) => item.resource).sort()).toEqual([alpha, beta]);
    const first = await onB.call<{ items: { resource: string }[]; nextCursor?: string }>("listSessions", { channel: "ahp-root://", limit: 1 });
    expect(first.items).toHaveLength(1);
    const second = await onB.call<{ items: { resource: string }[]; nextCursor?: string }>("listSessions", { channel: "ahp-root://", limit: 1, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((item) => item.resource).sort()).toEqual([alpha, beta]);
    expect(second.nextCursor).toBeUndefined();
    // A cursor is bound to the connection it was issued to.
    expect((await onA.request("listSessions", { channel: "ahp-root://", limit: 1, cursor: first.nextCursor })).error).toBeDefined();
  });

  it("H5-08 keeps host-internal methods off the public endpoint", async () => {
    const { peer } = await cluster(["review-a", "review-b"]);
    const onA = await peer("review-a", "senior");
    for (const [method, params] of [["x-ahp-host/sync", { version: 1 }], ["x-ahp-host/agents/attach", { version: 1, agentKey: "review-worker-v1", executionEpoch: "1" }]] as const) {
      const reply = await onA.request(method, params);
      expect(reply.error?.code).toBe(-32601);
    }
  });
});

import { describe, expect, it } from "vitest";
import { reviewWorkerKey } from "../../../examples/advanced/host";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, sessionUri } from "../../../examples/host/support";
import { onCleanup } from "./cluster";

interface Listed { items: { resource: string; title: string }[]; nextCursor?: string }
interface WorkPage { items: { id: string; status: string }[]; nextCursor?: string; subscriptionId?: string; streamEpoch?: string }
const names = ["review", "alpha", "beta"] as const;
const title = (uri: string, value: string, clientSeq = 1) => ({ channel: uri, clientSeq, action: { type: "session/titleChanged", title: value } });

/** One application namespace: its own host, endpoint, store and security composition. */
const startNamespace = async (name: string) => {
  const hostId = `support-${name}`;
  const namespaceId = `ahp-namespace:support/${name}`;
  const { provider } = createExamplePersistence();
  const storage = provider.durability;
  if (!storage) throw new Error("fixture");
  const node = createExampleNode({ hostId, mode: "partitioned", namespaceId, membership: createExampleMembership(namespaceId, [{ hostId }]), storage, persistence: provider });
  onCleanup(() => node.stop());
  const address = await node.host.start();
  const connect = async (subject: string, clientId = `${subject}@${name}`): Promise<ExamplePeer> => {
    const peer = await ExamplePeer.connect(`ws://127.0.0.1:${String(address.port)}/`, subject);
    onCleanup(() => peer.close());
    await peer.initialize(clientId);
    return peer;
  };
  const senior = await connect("senior");
  const manager = await connect("pm");
  const worker = await connect("junior");
  const { agentId } = await worker.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
  const work = new Map<string, string>();
  for (const [index, session] of names.entries()) {
    const uri = sessionUri(session);
    await senior.call("createSession", { channel: uri });
    await senior.call("subscribe", { channel: uri });
    senior.notify("dispatchAction", title(uri, `${name} ${session}`, index + 1));
    await senior.wait(() => senior.actions(uri).find((envelope) => envelope.action.title === `${name} ${session}`), 5_000, "title");
    const submitted = await manager.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: `${name}-${session}`, kind: "code.review", input: { namespace: name },
      targetAgentId: agentId, scope: [{ resource: { kind: "session", id: uri }, include: true }] });
    work.set(uri, submitted.workId);
  }
  const resource = (uri: string) => node.host.sessions.authorization?.getResource(uri);
  const listWork = (uri: string, extra: Record<string, unknown> = {}) => senior.request("x-ahp/work/list", { version: 1, session: { kind: "session", id: uri }, ...extra });
  return { name, node, senior, manager, worker, agentId, work, resource, listWork, connect };
};

describe("namespace isolation of cursors, tokens and retirement", () => {
  it("H4-05 H6-09 a cursor, a work token and a resource reference issued in one namespace disclose and change nothing in another", async () => {
    const production = await startNamespace("production");
    const staging = await startNamespace("staging");
    const review = sessionUri("review");
    const stagingTitles = names.map((session) => `staging ${session}`).sort();
    const everything = async (peer: ExamplePeer): Promise<string[]> => (await peer.call<Listed>("listSessions", { channel: "ahp-root://" })).items.map((item) => item.title).sort();
    expect(await everything(staging.senior)).toEqual(stagingTitles);

    // A catalogue cursor issued by production, presented to staging.
    const first = await production.senior.call<Listed>("listSessions", { channel: "ahp-root://", limit: 1 });
    expect(first.items[0]?.title.startsWith("production ")).toBe(true);
    expect(first.nextCursor).toBeDefined();
    const replayed = await staging.senior.request("listSessions", { channel: "ahp-root://", limit: 1, cursor: first.nextCursor });
    // A cursor carries no namespace data: whatever staging answers is drawn from staging's own catalogue only.
    const own = await staging.senior.call<Listed>("listSessions", { channel: "ahp-root://", limit: 1 });
    const ownNext = await staging.senior.call<Listed>("listSessions", { channel: "ahp-root://", limit: 1, cursor: own.nextCursor });
    if (replayed.error === undefined) expect(replayed.result).toEqual(ownNext);
    expect(JSON.stringify(staging.senior.frames)).not.toContain("production ");
    // A cursor that points past staging's catalogue, or that no host issued, is refused.
    for (const cursor of [Buffer.from(JSON.stringify({ v: 1, o: 99 })).toString("base64url"), "not-a-cursor", ""]) {
      expect((await staging.senior.request("listSessions", { channel: "ahp-root://", limit: 1, cursor })).error).toBeDefined();
    }

    // Work identifiers and paging tokens issued by production, presented to staging.
    const productionWork = production.work.get(review) ?? "";
    const stagingWork = staging.work.get(review) ?? "";
    expect(productionWork).not.toBe(stagingWork);
    expect((await staging.senior.call<{ work: unknown }>("x-ahp/work/get", { version: 1, workId: productionWork })).work).toBeNull();
    const foreignCursor = await staging.listWork(review, { limit: 1, cursor: productionWork });
    expect(foreignCursor.result === undefined || (foreignCursor.result as WorkPage).items.every((item) => [...staging.work.values()].includes(item.id))).toBe(true);
    const ownPage = (await staging.listWork(review)).result as WorkPage;
    expect(ownPage.items.map((item) => item.id)).toEqual([stagingWork]);

    // A lease issued by production confers nothing in staging, for the same agent identity and session name.
    const lease = (await production.worker.call<{ lease: { workId: string; attempt: number; leaseToken: string } }>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: review } })).lease;
    expect(lease.workId).toBe(productionWork);
    const stolen = await staging.worker.request("x-ahp/work/complete", { version: 1, workId: lease.workId, attempt: lease.attempt, leaseToken: lease.leaseToken, result: { crossed: true } });
    expect(stolen.error).toBeDefined();
    const swapped = await staging.worker.request("x-ahp/work/complete", { version: 1, workId: stagingWork, attempt: lease.attempt, leaseToken: lease.leaseToken, result: { crossed: true } });
    expect(swapped.error).toBeDefined();
    expect((await staging.senior.call<{ work: { status: string } }>("x-ahp/work/get", { version: 1, workId: stagingWork })).work.status).toBe("queued");

    // The exact resource identity of production's session, presented to staging.
    const foreign = production.resource(review);
    const local = staging.resource(review);
    expect(foreign?.id).toBe(local?.id);
    expect(foreign?.instanceId).not.toBe(local?.instanceId);
    const crossed = await staging.manager.request("x-ahp/work/submit", { version: 1, requestKey: "crossed", kind: "code.review", input: {}, targetAgentId: staging.agentId,
      scope: [{ resource: { kind: "session", id: review, instanceId: foreign?.instanceId }, include: true }] });
    expect(crossed.error).toBeDefined();
    if (foreign !== undefined) expect(await staging.node.host.sessions.authorization?.disposeSession(foreign)).toBe(false);
    expect(staging.node.host.sessions.getSessionSnapshot(review)?.state.title).toBe("staging review");
    // Production's agent registration is not staging's, although subject and key are identical.
    const foreignAgent = await staging.manager.request("x-ahp/work/submit", { version: 1, requestKey: "foreign-agent", kind: "code.review", input: {}, targetAgentId: "00000000-0000-4000-8000-00000000ffff",
      scope: [{ resource: { kind: "session", id: review }, include: true }] });
    expect(foreignAgent.error).toBeDefined();
    expect(((await staging.listWork(review)).result as WorkPage).items.map((item) => item.id)).toEqual([stagingWork]);
  });

  it("H4-05 retiring and recreating a session name in one namespace leaves the other untouched and rejects every stale reference", async () => {
    const production = await startNamespace("production");
    const staging = await startNamespace("staging");
    const review = sessionUri("review");
    const watcher = await staging.connect("observer", "staging-watcher");
    await watcher.call("subscribe", { channel: review });
    const framesBefore = watcher.frames.length;
    const stagingSeq = staging.node.host.sessions.getCurrentServerSeq();
    const old = production.resource(review);
    const oldWork = production.work.get(review) ?? "";
    const lease = (await production.worker.call<{ lease: { workId: string; attempt: number; leaseToken: string } }>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: review } })).lease;
    if (old === undefined) throw new Error("fixture");

    // Retirement in production.
    expect(await production.node.host.sessions.authorization?.disposeSession(old)).toBe(true);
    expect(production.node.host.sessions.getSessionSnapshot(review)).toBeUndefined();
    // Staging saw nothing: no reset, no removal, no sequence movement, and its session and work are intact.
    expect(staging.node.host.sessions.getSessionSnapshot(review)?.state).toMatchObject({ title: "staging review", lifecycle: "ready" });
    expect(staging.node.host.sessions.getCurrentServerSeq()).toBe(stagingSeq);
    expect(watcher.frames.length).toBe(framesBefore);
    expect((await staging.senior.call<{ work: { status: string } }>("x-ahp/work/get", { version: 1, workId: staging.work.get(review) ?? "" })).work.status).toBe("queued");
    expect(staging.resource(review)).toBeDefined();

    // Connections that were bound to the retired session are gone. Callers come back freshly authenticated.
    const senior = production.senior.closed ? await production.connect("senior", "senior-again") : production.senior;
    const manager = production.manager.closed ? await production.connect("pm", "pm-again") : production.manager;
    // The same name is created again in production: a new incarnation.
    await senior.call("createSession", { channel: review });
    const fresh = production.resource(review);
    expect(fresh?.id).toBe(old.id);
    expect(fresh?.instanceId).not.toBe(old.instanceId);
    // Stale references to the retired incarnation are refused and never act on the new one.
    expect(await production.node.host.sessions.authorization?.disposeSession(old)).toBe(false);
    expect(production.node.host.sessions.getSessionSnapshot(review)?.state.lifecycle).toBe("ready");
    const staleScope = await manager.request("x-ahp/work/submit", { version: 1, requestKey: "stale-scope", kind: "code.review", input: {}, targetAgentId: production.agentId,
      scope: [{ resource: { kind: "session", id: review, instanceId: old.instanceId }, include: true }] });
    expect(staleScope.error).toBeDefined();
    const staleLease = await production.worker.request("x-ahp/work/complete", { version: 1, workId: lease.workId, attempt: lease.attempt, leaseToken: lease.leaseToken, result: { late: true } });
    expect(staleLease.error).toBeDefined();
    // The new incarnation starts with no work of the old one, and the old work is not readable through it.
    expect((await senior.call<WorkPage>("x-ahp/work/list", { version: 1, session: { kind: "session", id: review } })).items).toEqual([]);
    expect((await senior.call<{ work: unknown }>("x-ahp/work/get", { version: 1, workId: oldWork })).work).toBeNull();
    const worker = production.worker.closed ? await production.connect("junior", "junior-again") : production.worker;
    if (worker !== production.worker) await worker.call("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    expect((await worker.call<{ status: string }>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: review } })).status).toBe("empty");
    expect((await worker.request("x-ahp/work/complete", { version: 1, workId: lease.workId, attempt: lease.attempt, leaseToken: lease.leaseToken, result: { late: true } })).error).toBeDefined();
    // Still nothing reached staging.
    expect(watcher.frames.length).toBe(framesBefore);
    expect(staging.resource(review)?.instanceId).not.toBe(fresh?.instanceId);
  });
});

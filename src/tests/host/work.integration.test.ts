import { describe, expect, it } from "vitest";
import { reviewWorkerKey } from "../../../examples/advanced/host";
import { sessionUri } from "../../../examples/host/support";
import { createCluster } from "./cluster";

interface Claimed { status: string; lease: { workId: string; attempt: number; leaseToken: string } }
const execution = ({ workId, attempt, leaseToken }: Claimed["lease"]) => ({ workId, attempt, leaseToken });

describe("agents and work across hosts", () => {
  it("H8-01 H8-04 H8-08 H5-01 lets a worker connected to one host claim and settle work owned by another", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const scope = [{ resource: { kind: "session", id: alpha }, include: true }];
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });

    // The worker's only socket is on review-b. The session, its work and its policy live on review-a.
    const worker = await cluster.peer("review-b", "junior", "worker");
    const registered = await worker.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    const manager = await cluster.peer("review-b", "pm", "manager");
    const job = await manager.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: "cross-host-review", kind: "code.review", input: { topic: "release" },
      targetAgentId: registered.agentId, scope });
    // The same immutable intent is idempotent through a different ingress.
    const managerOnA = await cluster.peer("review-a", "pm", "manager-a");
    const replay = await managerOnA.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: "cross-host-review", kind: "code.review", input: { topic: "release" },
      targetAgentId: registered.agentId, scope });
    expect(replay.workId).toBe(job.workId);
    // A worker has no submit permission wherever it connects.
    expect((await worker.request("x-ahp/work/submit", { version: 1, requestKey: "worker-submit", kind: "code.review", input: {}, scope })).error).toBeDefined();

    const claimed = await worker.call<Claimed>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: alpha } });
    expect(claimed.status).toBe("claimed");
    expect(claimed.lease.workId).toBe(job.workId);
    // The remote live worker is present on the owner through its relayed connection, not "disconnected".
    expect(cluster.node("review-a").host.work).toBeDefined();
    // A copied lease confers nothing on another caller, on either host.
    for (const thief of [manager, managerOnA]) {
      expect((await thief.request("x-ahp/work/complete", { version: 1, ...execution(claimed.lease), result: { stolen: true } })).error).toBeDefined();
    }
    expect((await worker.request("x-ahp/work/complete", { version: 1, ...execution(claimed.lease), leaseToken: "00000000-0000-4000-8000-000000000000", result: {} })).error).toBeDefined();
    expect(await worker.call("x-ahp/work/complete", { version: 1, ...execution(claimed.lease), result: { reviewed: true } })).toBeNull();
    const detail = await senior.call<{ work: { status: string; id: string } | null }>("x-ahp/work/get", { version: 1, workId: job.workId });
    expect(detail.work?.status).toBe("completed");
    // The submitter cannot read the owner's work detail through any ingress.
    expect((await manager.call<{ work: unknown }>("x-ahp/work/get", { version: 1, workId: job.workId })).work).toBeNull();
    // A settled attempt cannot settle again.
    expect((await worker.request("x-ahp/work/complete", { version: 1, ...execution(claimed.lease), result: { again: true } })).error).toBeDefined();
  });

  it("H8-01 H8-03 fences an agent's earlier execution generation when it binds on another host", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const alpha = sessionUri("alpha");
    const scope = [{ resource: { kind: "session", id: alpha }, include: true }];
    const senior = await cluster.peer("review-a", "senior");
    await senior.call("createSession", { channel: alpha });
    const manager = await cluster.peer("review-a", "pm");
    const first = await cluster.peer("review-b", "junior", "worker-1");
    const registered = await first.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    for (const requestKey of ["one", "two"]) {
      await manager.call("x-ahp/work/submit", { version: 1, requestKey, kind: "code.review", input: {}, targetAgentId: registered.agentId, scope });
    }
    const lease = (await first.call<Claimed>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: alpha } })).lease;
    // The same agent identity binds again, this time directly on the owning host.
    await first.close();
    const second = await cluster.peer("review-a", "junior", "worker-2");
    const rebound = await second.call<{ agentId: string }>("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey });
    expect(rebound.agentId).toBe(registered.agentId);
    // The earlier generation's lease can no longer be settled, even with its exact token.
    expect((await second.request("x-ahp/work/complete", { version: 1, ...execution(lease), result: {} })).error).toBeDefined();
    const next = await second.call<Claimed>("x-ahp/work/claim", { version: 1, session: { kind: "session", id: alpha } });
    expect(next.status).toBe("claimed");
    expect(next.lease.workId).not.toBe(lease.workId);
    expect(await second.call("x-ahp/work/complete", { version: 1, ...execution(next.lease), result: { done: true } })).toBeNull();
  });
});

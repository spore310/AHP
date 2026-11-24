import { expect, it, vi } from "vitest";
import type { WorkAgentContext, WorkApproval } from "@work";
import { workFixture } from "./commandsFixture";

it("claims the highest allowed priority and withholds a retained lease after cancellation", async () => {
  const f = await workFixture({ prepare: () => Promise.resolve({ isCurrent: () => true, fence: () => true, release() {} }), scheduling: { allowedKinds: ["review"],
    admission: (caller) => caller.signal, configuration: { resolve: () => ({ revision: "1", maxActiveClaims: 1 }) } } });
  const receipts: WorkApproval[] = [];
  try {
    const agent = { principal: f.caller.context.actor.principal, agentKey: "worker", registrationId: crypto.randomUUID(), actorAgentId: "agent" };
    const worker: WorkAgentContext = { ...f.caller, context: { ...f.caller.context, actor: { kind: "agent", principal: agent.principal, agentId: "agent" } },
      agent, executionEpoch: "1", fence: () => true, retainReply(receipt) { receipts.push(receipt); } };
    f.agents.set(agent.registrationId, { domainId: f.ref.domainId, principalSubject: agent.principal.subject, agentKey: agent.agentKey,
      id: agent.registrationId, executionEpoch: "1", createdAt: f.session.createdAt, enabled: true });
    await f.service.submit(f.caller, f.request);
    const urgent = await f.service.submit(f.caller, { ...f.request, requestKey: "urgent", priority: 2147483647 });
    const result = await f.service.claim(worker, { id: f.ref.id, kind: "session" });
    expect(result).toMatchObject({ status: "claimed", lease: { workId: urgent.id, attempt: 1, priority: 2147483647, revision: "2" } });
    expect(receipts[0]?.isCurrent()).toBe(true);
    expect(await f.service.claim(worker, { id: f.ref.id, kind: "session" })).toEqual({ status: "capacity" });
    await f.service.cancel(f.caller, urgent.id);
    expect(receipts[0]?.isCurrent()).toBe(false);
  } finally {
    for (const receipt of receipts) receipt.release();
    f.service.close();
    await f.host.release();
  }
});

it.each(["claim", "renew"] as const)("withholds the %s reply if the only selected child is suspended just after commit", async (operation) => {
  const f = await workFixture({ prepare: () => Promise.resolve({ isCurrent: () => true, fence: () => true, release() {} }),
    scheduling: { allowedKinds: ["review"], admission: (caller) => caller.signal, configuration: { resolve: () => ({ revision: "1", maxActiveClaims: 3 }) } } });
  try {
    const seed = await f.service.submit(f.caller, f.request);
    const { worker } = f.lease(seed.id);
    await f.service.cancel(f.caller, seed.id);
    const child = { ...f.root, ref: { ...f.ref, kind: "chat", id: "chat:/scope", instanceId: crypto.randomUUID() },
      parent: f.ref, operationId: crypto.randomUUID() };
    await f.host.resources.reserve(child, () => true);
    const target = { ref: child.ref, session: f.ref, operationId: child.operationId };
    await f.host.resources.activate({ ...target, expected: "creating", next: "active" }, () => true);
    const { id } = await f.service.submit(f.caller, { ...f.request, requestKey: "child", scope: [{ resource: { id: child.ref.id, kind: child.ref.kind }, include: true }] });
    const session = { kind: f.ref.kind, id: f.ref.id };
    const caller = { ...worker, fence: () => true };
    const first = operation === "renew" ? await f.service.claim(caller, session) : undefined;
    const repo = f.host.work;
    const suspend = () => f.host.resources.activate({ ...target, expected: "active", next: "suspended" }, () => true);
    const retainReply = vi.fn();
    if (first?.status === "claimed") {
      const original = repo.renewPrepared.bind(repo);
      vi.spyOn(repo, "renewPrepared").mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        await suspend();
        return result;
      });
      const { workId, attempt, leaseToken } = first.lease;
      await expect(f.service.renew({ ...caller, retainReply }, { workId, attempt, leaseToken })).rejects.toMatchObject({ code: "stale" });
    } else {
      expect(operation).toBe("claim");
      const original = repo.claimPrepared.bind(repo);
      vi.spyOn(repo, "claimPrepared").mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        await suspend();
        return result;
      });
      await expect(f.service.claim({ ...caller, retainReply }, session)).rejects.toMatchObject({ code: "stale" });
    }
    expect(retainReply).not.toHaveBeenCalled();
    expect(f.rows.get(id)?.status).toBe("leased");
  } finally { await f.host.release(); }
});

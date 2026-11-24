import { expect, it, vi } from "vitest";
import type { WorkServiceHooks } from "@work/helpers/authorityLoss/types";
import { workFixture } from "./commandsFixture";

async function setup(hook: NonNullable<WorkServiceHooks["onLeaseAuthorityLost"]>, deadlineMs = 5000) {
  let lost = false;
  const identity = { principal: { domainId: "test", subject: "worker" }, registrationId: "test", actorAgentId: "worker", agentKey: "worker" };
  const fixture = await workFixture({ authorityLoss: { hooks: { onLeaseAuthorityLost: hook }, deadlineMs, maxPending: 1,
    assess: () => Promise.resolve(lost ? { reason: "policy-changed", executor: identity } : undefined) } });
  const { id } = await fixture.service.submit(fixture.caller, fixture.request);
  const active = fixture.lease(id);
  return { ...fixture, ...active, id, lose() {
    lost = true;
  },
  async recheck() {
    fixture.service.authorityChanged();
    await fixture.service.authorityIdle();
  } };
}

it("rechecks before notifying, supplies immutable facts, and applies the decision only to the exact live attempt", async () => {
  const hook = vi.fn<NonNullable<WorkServiceHooks["onLeaseAuthorityLost"]>>(() => ({ action: "requeue" }));
  const f = await setup(hook);
  try {
    await f.recheck();
    expect(hook).not.toHaveBeenCalled();
    f.lose();
    await f.recheck();
    expect(hook).toHaveBeenCalledOnce();
    const facts = hook.mock.calls[0]?.[0];
    expect(facts?.attempt).toBe(1);
    expect(Object.isFrozen(facts?.work.data)).toBe(true);
    expect(JSON.stringify(facts)).not.toContain(f.execution.leaseToken);
    expect(f.rows.get(f.id)).toMatchObject({ status: "queued", attemptCount: 1 });
  } finally {
    f.service.close();
    await f.host.release();
  }
});

it("retains the callback slot after timeout and ignores a late decision", async () => {
  const answer = Promise.withResolvers<{ action: "cancel" }>();
  const entered = Promise.withResolvers<undefined>();
  const hook = vi.fn(() => {
    entered.resolve(undefined);
    return answer.promise;
  });
  const f = await setup(hook, 25);
  try {
    f.lose();
    const first = f.recheck();
    await entered.promise;
    await first;
    await f.recheck();
    expect(hook).toHaveBeenCalledOnce();
    expect(f.rows.get(f.id)?.status).toBe("leased");
    answer.resolve({ action: "cancel" });
    await answer.promise;
    expect(f.rows.get(f.id)?.status).toBe("leased");
  } finally {
    f.service.close();
    await f.host.release();
  }
});

it("discards a stale disposition after a data or attempt change and fails exhausted work", async () => {
  const answer = Promise.withResolvers<{ action: "cancel" }>();
  const entered = Promise.withResolvers<undefined>();
  const f = await setup(() => {
    entered.resolve(undefined);
    return answer.promise;
  });
  try {
    f.lose();
    const first = f.recheck();
    await entered.promise;
    await f.service.updateData(f.caller, f.id, { expectedDataRevision: "1", data: { keep: true } });
    answer.resolve({ action: "cancel" });
    await first;
    const row = f.rows.get(f.id);
    expect(row?.status).toBe("leased");
    if (!row?.lease) throw new Error("Missing seeded lease");
    f.rows.set(f.id, { ...row, maxAttempts: 1 });
    const value = await f.host.work.disposition({ session: row.session, id: row.id, revision: row.revision, execution: row.lease }, "requeue", () => true);
    expect(value.status).toBe("failed");
  } finally {
    f.service.close();
    await f.host.release();
  }
});

import { expect, it, vi } from "vitest";
import { workFixture } from "./commandsFixture";
import type { WorkServiceHooks } from "@work";
import { RepositoryError } from "@persistence";
import { mapWorkError } from "@websocket/helpers/ahp/agentWork";

it("correlates the storage diagnostic with the sanitized uncertain response", async () => {
  const report = vi.fn();
  const f = await workFixture({ onDiagnostic: report });
  const failure = new RepositoryError("outcome_unknown", "private driver detail");
  try {
    vi.spyOn(f.host.work, "submit").mockRejectedValueOnce(failure);
    await expect(f.service.submit(f.caller, f.request)).rejects.toBe(failure);
    expect(report).toHaveBeenCalledExactlyOnceWith("storageOutcomeUnknown", failure.correlationId);
    expect(() => mapWorkError(failure)).toThrow(expect.objectContaining({
      message: "Internal error", data: { version: 1, kind: "outcome_unknown", correlationId: failure.correlationId },
    }));
  } finally { await f.host.release(); }
});

it("retains formatter capacity after a timeout and stores only approved failure fields", async () => {
  const parked = Promise.withResolvers<{ code: string; summary: string }>();
  const format = vi.fn<NonNullable<WorkServiceHooks["formatFailure"]>>().mockImplementationOnce(() => parked.promise)
    .mockReturnValueOnce({ code: "approved", summary: "Review timed out." })
    .mockReturnValueOnce({ code: "bad", summary: "first\nsecret" });
  const events: string[] = [];
  const f = await workFixture({ onDiagnostic(event) {
    events.push(event);
    throw new Error("sink unavailable");
  }, authorityLoss: { deadlineMs: 10, maxPending: 1, hooks: { formatFailure: format }, assess: () => Promise.resolve(undefined) } });
  async function fail(key: string) {
    const { id } = await f.service.submit(f.caller, { ...f.request, requestKey: key });
    const { worker, execution } = f.lease(id);
    await f.service.fail(worker, execution, { retryable: false, code: "privateCode", message: "private worker message" });
    return f.rows.get(id)?.failure;
  }
  try {
    expect(await fail("first")).toMatchObject({ code: "execution_failed", summary: "Work execution failed." });
    expect(await fail("second")).toMatchObject({ code: "execution_failed" });
    expect(format).toHaveBeenCalledTimes(1);
    parked.resolve({ code: "late", summary: "Too late." });
    await parked.promise;
    expect(await fail("approved")).toMatchObject({ code: "approved", summary: "Review timed out." });
    expect(await fail("invalid")).toMatchObject({ code: "execution_failed", summary: "Work execution failed." });
    expect(events).toEqual(["submitted", "submitted", "submitted", "submitted"]);
    expect(JSON.stringify([...f.rows.values()])).not.toMatch(/privateCode|private worker message|first\\nsecret/);
  } finally {
    f.service.close();
    await f.host.release();
  }
});

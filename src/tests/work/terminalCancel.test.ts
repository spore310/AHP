import { expect, it, vi } from "vitest";
import type { WorkApproval } from "@work/helpers/commands/types";
import { workFixture } from "./commandsFixture";

it.each(["preparation", "delivery"] as const)("withdraws a terminal cancellation confirmation when the row changes during %s", async (phase) => {
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const release = vi.fn();
  const receipts: WorkApproval[] = [];
  const f = await workFixture({ prepare: async (_caller, op, _intent, row) => {
    if (op !== "cancel" || row?.status !== "cancelled") return { isCurrent: () => true, release() {} };
    const canConfirm = row.data.hidden !== true;
    entered.resolve(undefined);
    if (phase === "preparation") await resume.promise;
    return { isCurrent: () => canConfirm, release };
  } });
  try {
    const { id } = await f.service.submit(f.caller, f.request);
    await f.service.cancel(f.caller, id);
    const caller = { ...f.caller, retainReply(receipt: WorkApproval) {
      receipts.push(receipt);
    } };
    const confirmation = f.service.cancel(caller, id);
    await entered.promise;
    if (phase === "delivery") {
      await confirmation;
      expect(receipts[0]?.isCurrent()).toBe(true);
    }
    // Bypass the command service's local generation. The storage observer must see this write.
    await f.host.work.replaceData({ session: f.ref, id, revision: "2" }, { expectedDataRevision: "1", data: { hidden: true } }, () => true);
    resume.resolve(undefined);
    if (phase === "preparation") {
      await expect(confirmation).rejects.toMatchObject({ code: "unauthorized" });
      expect(receipts).toHaveLength(0);
    } else {
      expect(receipts[0]?.isCurrent()).toBe(false);
      receipts[0]?.release();
    }
    expect(release).toHaveBeenCalledTimes(1);
    expect(await f.host.work.get(f.ref.domainId, id)).toMatchObject({ status: "cancelled", revision: "3", dataRevision: "2", data: { hidden: true } });
  } finally {
    resume.resolve(undefined);
    await f.host.release();
  }
});

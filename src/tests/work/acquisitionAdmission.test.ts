import { expect, it, vi } from "vitest";
import { workFixture } from "./commandsFixture";

it.each(["claim", "renew"] as const)("admits a minimal %s caller without running application callbacks under the lock", async (operation) => {
  let locked = false;
  const outside = () => {
    expect(locked).toBe(false);
    return true;
  };
  const policy = new AbortController();
  const f = await workFixture({ scheduling: { allowedKinds: ["review"],
    configuration: { resolve() {
      outside();
      return { revision: "1", maxActiveClaims: 3 };
    } },
    admission() {
      outside();
      return policy.signal;
    },
  }, prepare: () => Promise.resolve({ isCurrent: outside, release() {} }) });
  try {
    const job = await f.service.submit(f.caller, f.request);
    const seeded = f.lease(job.id);
    const caller = { ...seeded.worker, isCurrent: outside };
    const runLocked = (check: () => void) => {
      locked = true;
      try {
        check();
      } finally { locked = false; }
    };
    if (operation === "claim") {
      await f.service.cancel(f.caller, job.id);
      const next = await f.service.submit(f.caller, { ...f.request, requestKey: "next" });
      const original = f.host.work.claimPrepared.bind(f.host.work);
      vi.spyOn(f.host.work, "claimPrepared").mockImplementation((command, admit) => original(command, (row) => {
        runLocked(() => {
          admit(row);
        });
        return undefined;
      }));
      expect(await f.service.claim(caller, { kind: "session", id: f.ref.id })).toMatchObject({ status: "claimed", lease: { workId: next.id } });
    } else {
      const original = f.host.work.renewPrepared.bind(f.host.work);
      vi.spyOn(f.host.work, "renewPrepared").mockImplementation((command, admit) => original(command, (row) => {
        runLocked(() => {
          admit(row);
        });
        return undefined;
      }));
      expect(await f.service.renew(caller, seeded.execution)).toMatchObject({ revision: "3" });
    }
  } finally { await f.host.release(); }
});

it("checks an external approval deadline at locked admission even before a timer runs", async () => {
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  const f = await workFixture({ scheduling: { allowedKinds: ["review"], configuration: { resolve: () => ({ revision: "1", maxActiveClaims: 3 }) },
    admission: (caller) => ({ signal: caller.signal, validUntil: start + 1000 }) } });
  try {
    const job = await f.service.submit(f.caller, f.request);
    const { worker } = f.lease(job.id);
    await f.service.cancel(f.caller, job.id);
    const next = await f.service.submit(f.caller, { ...f.request, requestKey: "next" });
    const original = f.host.work.claimPrepared.bind(f.host.work);
    vi.spyOn(f.host.work, "claimPrepared").mockImplementationOnce((...args) => {
      now.mockReturnValue(start + 1000);
      return original(...args);
    });
    expect(await f.service.claim(worker, { kind: "session", id: f.ref.id })).toMatchObject({ status: "deferred" });
    expect(f.rows.get(next.id)).toMatchObject({ status: "queued", attemptCount: 0 });
  } finally {
    now.mockRestore();
    await f.host.release();
  }
});

it.each(["claim", "renew"] as const)("leaves the durable row unchanged when %s approval is withdrawn during a lock wait", async (operation) => {
  const controller = new AbortController();
  const f = await workFixture({ scheduling: { allowedKinds: ["review"], configuration: { resolve: () => ({ revision: "1", maxActiveClaims: 3 }) },
    admission: () => controller.signal } });
  try {
    const seed = await f.service.submit(f.caller, f.request);
    const { worker, execution } = f.lease(seed.id);
    const entered = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    let id = seed.id;
    let outcome;
    if (operation === "claim") {
      await f.service.cancel(f.caller, seed.id);
      id = (await f.service.submit(f.caller, { ...f.request, requestKey: "next" })).id;
      const original = f.host.work.claimPrepared.bind(f.host.work);
      vi.spyOn(f.host.work, "claimPrepared").mockImplementation(async (...args) => {
        entered.resolve(undefined);
        await resume.promise;
        return original(...args);
      });
      outcome = f.service.claim(worker, { kind: "session", id: f.ref.id });
    } else {
      const original = f.host.work.renewPrepared.bind(f.host.work);
      vi.spyOn(f.host.work, "renewPrepared").mockImplementation(async (...args) => {
        entered.resolve(undefined);
        await resume.promise;
        return original(...args);
      });
      outcome = f.service.renew(worker, execution);
    }
    const before = structuredClone(f.rows.get(id));
    await Promise.race([entered.promise, outcome.then(() => {
      throw new Error("Skipped locked admission");
    })]);
    controller.abort();
    resume.resolve(undefined);
    if (operation === "renew") await expect(outcome).rejects.toMatchObject({ code: "stale" });
    else await expect(outcome).resolves.toMatchObject({ status: "deferred" });
    expect(f.rows.get(id)).toEqual(before);
  } finally { await f.host.release(); }
});

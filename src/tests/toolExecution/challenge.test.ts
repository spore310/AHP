import { afterEach, expect, it, vi } from "vitest";
import { createToolDispatcher } from "@toolExecution/helpers/dispatcher";
import { ToolAction } from "@toolExecution";
import type { ChallengeAdapter, ToolActionContext } from "@toolExecution";
import { ports, registration } from "./fixtures";
import { createToolChallenges } from "@toolExecution/helpers/challenge";
import type { ToolChallengeOptions } from "@toolExecution/helpers/challenge";
import { facts } from "./fixtures";
import type { Input, Output } from "./fixtures";

afterEach(() => vi.useRealTimers());

function fixture(adapter?: ChallengeAdapter) {
  const prepare = vi.fn();
  const execute = vi.fn((input: Input) => ({ value: input.path }));
  const cleanup = vi.fn();
  class Action extends ToolAction<Input, Output> {
    override prepare = prepare;
    override execute = execute;
    override cleanup = cleanup;
  }
  const authority = ports();
  authority.authorize = vi.fn((context: ToolActionContext) => ({ decision: { effect: "allow" as const, reveal: true, challengeRequired: true }, authority: context.authority }));
  const dispatcher = createToolDispatcher({ limits: { shutdownWaitMs: 5 }, ...(adapter === undefined ? {} : { challenge: { adapter } }) });
  const input = { path: "canonical-canary" };
  const handle = dispatcher.dispatch({ callId: "call-1", input, registration: registration(() => new Action()), ports: authority });
  return { dispatcher, handle, input, prepare, execute, cleanup, authority };
}
function adapter() {
  return { begin: vi.fn<ChallengeAdapter["begin"]>(() => ({ continuationId: "private-adapter-id", expiresAt: new Date(Date.now() + 20000).toISOString(), presentation: { kind: "wait" as const } })),
    verify: vi.fn<ChallengeAdapter["verify"]>(() => ({ status: "verified" as const, continuationId: "private-adapter-id" })) };
}

it("C02 suspends before preparation and resumes the one frozen canonical invocation", async () => {
  const verifier = adapter();
  const f = fixture(verifier);
  try {
    const receipt = await f.handle.admission;
    expect(receipt).toMatchObject({ status: "challenge-required", presentation: { kind: "wait" } });
    if (receipt.status !== "challenge-required") throw new Error("Missing challenge");
    expect(receipt.continuationId).not.toBe("private-adapter-id");
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    f.input.path = "mutated-canary";
    expect(await f.handle.resume("proof-1")).toBe(true);
    await expect(f.handle.settled).resolves.toMatchObject({ status: "succeeded", output: { value: "canonical-canary" } });
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.cleanup).toHaveBeenCalledOnce();
    expect(verifier.verify).toHaveBeenCalledWith({ continuationId: "private-adapter-id", proofRef: "proof-1" });
    expect(verifier.begin.mock.calls[0]?.[0].inputDigest).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await f.dispatcher.shutdown();
  }
});

it.each(["missing", "false", "wrong-id"])("C01 required challenge rejects %s verifier without effects", async (mode) => {
  const verifier = adapter();
  if (mode === "false") verifier.verify.mockImplementation(() => ({ status: "denied", code: "private-denial-canary" }));
  if (mode === "wrong-id") verifier.verify.mockImplementation(() => ({ status: "verified", continuationId: "other" }));
  const f = fixture(mode === "missing" ? undefined : verifier);
  try {
    const receipt = await f.handle.admission;
    if (mode === "missing") expect(receipt.status).toBe("denied");
    else {
      expect(receipt.status).toBe("challenge-required");
      expect(await f.handle.resume("mfaPassed")).toBe(false);
    }
    await expect(f.handle.settled).resolves.toMatchObject({ status: "failed", effectPossible: false });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  } finally {
    await f.dispatcher.shutdown();
  }
});

it("C04 consumes before awaiting verify and permits one execution under concurrent resume", async () => {
  const verifier = adapter();
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  verifier.verify.mockImplementation(async () => {
    entered.resolve(undefined);
    await release.promise;
    return { status: "verified", continuationId: "private-adapter-id" };
  });
  const f = fixture(verifier);
  try {
    expect((await f.handle.admission).status).toBe("challenge-required");
    const first = f.handle.resume("proof-1");
    await entered.promise;
    expect(await f.handle.resume("proof-2")).toBe(false);
    expect(f.execute).not.toHaveBeenCalled();
    release.resolve(undefined);
    expect(await first).toBe(true);
    await f.handle.settled;
    expect(await f.handle.resume("proof-1")).toBe(false);
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
  } finally {
    release.resolve(undefined);
    await f.dispatcher.shutdown();
  }
});

it.each(["actor", "target", "origin", "auth", "policy", "grant", "executor", "permission"])("C03 rejects changed %s after trusted verification", async (change) => {
  const f = fixture(adapter());
  try {
    expect((await f.handle.admission).status).toBe("challenge-required");
    if (change === "permission") vi.spyOn(f.authority, "authorize").mockImplementation((context) => ({ decision: { effect: "deny", code: "human-consent-required" }, authority: context.authority }));
    else vi.spyOn(f.authority, "resolve").mockImplementation(() => {
      const original = facts();
      if (change === "actor") return facts("call-1", "other-actor");
      if (change === "target") return facts("call-1", "caller", "different-target");
      if (change === "policy") return { ...original, authority: { ...original.authority, policyRevisions: [{ id: "policy-1", revision: 2 }] } };
      if (change === "grant") return { ...original, authority: { ...original.authority, grantRevision: 2 } };
      if (change === "auth") return { ...original, caller: { ...original.caller, authRevision: "auth-2" }, authority: { ...original.authority, authRevision: "auth-2" } };
      if (change === "origin") {
        const resources = { ...original.resources, origin: { ...original.resources.origin, instanceId: "new-instance" } };
        return { ...original, resources, authority: { ...original.authority, route: resources } };
      }
      const executor = { ...original.executor, generation: 2 };
      return { ...original, executor, authority: { ...original.authority, executor } };
    });
    expect(await f.handle.resume("proof")).toBe(false);
    await expect(f.handle.settled).resolves.toMatchObject({ status: "failed", effectPossible: false });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  } finally {
    await f.dispatcher.shutdown();
  }
});

it("C05 cancels a verifying job without releasing its adapter or cleanup ownership", async () => {
  const verifier = adapter(), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  verifier.verify.mockImplementation(async () => {
    entered.resolve(undefined);
    await release.promise;
    return { status: "verified", continuationId: "private-adapter-id" };
  });
  const f = fixture(verifier);
  try {
    await f.handle.admission;
    const resumed = f.handle.resume("proof");
    await entered.promise;
    f.handle.cancel();
    expect(await resumed).toBe(false);
    await expect(f.handle.result).resolves.toMatchObject({ status: "failed", code: "cancelled" });
    expect(f.dispatcher.stats()).toMatchObject({ active: 1, draining: 1 });
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    release.resolve(undefined);
    await f.handle.settled;
    expect(f.cleanup).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.dispatcher.stats().active).toBe(0);
  } finally {
    release.resolve(undefined);
    await f.dispatcher.shutdown();
  }
});

function coordinator(options: Partial<ToolChallengeOptions> = {}) {
  let time = 1000;
  const verifier = adapter();
  verifier.begin.mockImplementation(() => ({ continuationId: "adapter-id", expiresAt: new Date(2000).toISOString(), presentation: { kind: "wait" } }));
  verifier.verify.mockImplementation(() => ({ status: "verified", continuationId: "adapter-id" }));
  const service = createToolChallenges({ adapter: verifier, ...options }, () => time, () => time);
  const open = (subject = "caller", current = () => true) => service.open({ context: { ...facts("call-1", subject), signal: new AbortController().signal, inputDigest: "0".repeat(64) }, deadline: 3000, current });
  return { service, open, verifier, advance: (next: number) => {
    time = next;
  } };
}

it("C05 expires on access and quarantines clock rollback and restart", async () => {
  const f = coordinator();
  const pending = f.open();
  if (pending === undefined) throw new Error("Missing challenge");
  await pending.ready;
  f.advance(2000);
  expect(await pending.resume("proof")).toBe(false);
  await pending.settled;
  f.advance(1999);
  expect(() => f.open()).toThrow("clock");
  f.service.dispose();
  const next = coordinator(), record = next.open();
  if (record === undefined) throw new Error("Missing challenge");
  await record.ready;
  next.service.dispose();
  expect(await record.resume("proof")).toBe(false);
  await record.settled;
});

it("C07 retains bounded capacity through a timed-out begin and late cancellation", async () => {
  vi.useFakeTimers();
  const beginResult = Promise.withResolvers<Awaited<ReturnType<ChallengeAdapter["begin"]>>>();
  const cancelResult = Promise.withResolvers<undefined>();
  const cancel = vi.fn(() => cancelResult.promise);
  const verifier: ChallengeAdapter = { begin: () => beginResult.promise, verify: vi.fn(), cancel };
  const f = coordinator({ adapter: verifier, limits: { maxPending: 1, maxPerActor: 1, hookTimeoutMs: 10 } });
  const record = f.open();
  if (record === undefined) throw new Error("Missing record");
  expect(f.open("other")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(10);
  expect(await record.ready).toBeUndefined();
  expect(f.service.stats().pending).toBe(1);
  expect(f.open("other")).toBeUndefined();
  beginResult.resolve({ continuationId: "late-id", expiresAt: new Date(2000).toISOString(), presentation: { kind: "wait" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledWith("late-id");
  expect(f.service.stats().pending).toBe(1);
  cancelResult.resolve(undefined);
  await record.settled;
  expect(f.service.stats().pending).toBe(0);
  f.service.dispose();
});

it.each(["redirect", "message", "secret", "oversized", "credentials"])("C07 refuses unapproved or malformed %s presentation", async (mode) => {
  const verifier = adapter();
  const presentation = mode === "redirect"
    ? { kind: "redirect", url: "https://example.invalid/approve" }
    : mode === "credentials"
      ? { kind: "redirect", url: "https://secret:token@example.invalid" }
      : mode === "message"
        ? { kind: "wait", message: "PRIVATE-MESSAGE" }
        : mode === "secret"
          ? { kind: "wait", secret: "PRIVATE-SECRET" }
          : { kind: "wait", message: "x".repeat(20000) };
  verifier.begin.mockImplementation(() => ({ continuationId: "id", expiresAt: new Date(2000).toISOString(), presentation }) as Awaited<ReturnType<ChallengeAdapter["begin"]>>);
  const f = coordinator({ adapter: verifier, ...(mode === "credentials" ? { approvePresentation: () => true } : {}) });
  const record = f.open();
  if (record === undefined) throw new Error("Missing record");
  expect(await record.ready).toBeUndefined();
  expect(await record.verified).toBe(false);
  await record.settled;
  f.service.dispose();
});

it("C07 enforces actor limits and proof bytes before verification", async () => {
  const f = coordinator({ limits: { maxPerActor: 1, maxPending: 2, maxProofBytes: 4 } });
  const first = f.open(), second = f.open("other");
  if (first === undefined || second === undefined) throw new Error("Missing records");
  expect(f.open()).toBeUndefined();
  expect(f.open("third")).toBeUndefined();
  await first.ready;
  expect(await first.resume(String.fromCodePoint(0x1f4a5).repeat(2))).toBe(false);
  await first.settled;
  await second.ready;
  f.service.dispose();
  await second.settled;
  expect(f.service.stats().pending).toBe(0);
});

it.each([true, false])("C05 fences expiry after callback-bearing first-effect guards (prepare=%s)", async (withPrepare) => {
  let time = 1000, authorizations = 0, finalGuards = 0;
  const prepare = vi.fn(), execute = vi.fn(() => ({ value: "forbidden" }));
  class Action extends ToolAction<Input, Output> { override execute = execute; }
  class PreparedAction extends Action { override prepare = prepare; }
  const authority = ports();
  authority.authorize = (context) => {
    authorizations += 1;
    return { decision: { effect: "allow", reveal: true, challengeRequired: true }, authority: context.authority };
  };
  authority.current = () => {
    if (authorizations === 2 && ++finalGuards === 2) time = 1500;
    return true;
  };
  const verifier = adapter();
  verifier.begin.mockImplementation(() => ({ continuationId: "private-adapter-id", expiresAt: new Date(1500).toISOString(), presentation: { kind: "wait" } }));
  const dispatcher = createToolDispatcher({ now: () => time, fenceNow: () => time, challenge: { adapter: verifier } });
  const handle = dispatcher.dispatch({ callId: "call-1", input: { path: "x" }, registration: registration(() => withPrepare ? new PreparedAction() : new Action()), ports: authority });
  try {
    expect((await handle.admission).status).toBe("challenge-required");
    expect(await handle.resume("proof")).toBe(false);
    await expect(handle.settled).resolves.toMatchObject({ status: "failed", code: "stale" });
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await dispatcher.shutdown();
  }
});

it("C07 timed-out verifier retains capacity and cannot revive a consumed attempt", async () => {
  vi.useFakeTimers();
  const release = Promise.withResolvers<Awaited<ReturnType<ChallengeAdapter["verify"]>>>();
  const verifier = adapter();
  verifier.begin.mockImplementation(() => ({ continuationId: "adapter-id", expiresAt: new Date(2000).toISOString(), presentation: { kind: "wait" } }));
  verifier.verify.mockImplementation(() => release.promise);
  const f = coordinator({ adapter: verifier, limits: { maxPending: 1, hookTimeoutMs: 10 } });
  const record = f.open();
  if (record === undefined) throw new Error("Missing record");
  await record.ready;
  const resumed = record.resume("proof");
  await vi.advanceTimersByTimeAsync(10);
  expect(await resumed).toBe(false);
  expect(f.service.stats().pending).toBe(1);
  expect(f.open("other")).toBeUndefined();
  release.resolve({ status: "verified", continuationId: "adapter-id" });
  await record.settled;
  expect(record.fence()).toBe(false);
  expect(await record.resume("proof")).toBe(false);
  expect(f.service.stats().pending).toBe(0);
  f.service.dispose();
});

it("C07 approved safe presentation is captured and a trailing expiry callback cannot publish it", async () => {
  const verifier = adapter();
  verifier.begin.mockImplementation(() => ({ continuationId: "adapter-id", expiresAt: new Date(2000).toISOString(), presentation: { kind: "redirect", url: "https://example.invalid/approve", message: "Approve action" } }));
  const f = coordinator({ adapter: verifier, approvePresentation: () => true });
  const record = f.open();
  if (record === undefined) throw new Error("Missing record");
  expect(await record.ready).toMatchObject({ presentation: { kind: "redirect", url: "https://example.invalid/approve" } });
  f.service.dispose();
  await record.settled;
  const late = coordinator({ adapter: verifier, approvePresentation: () => {
    late.advance(2000);
    return true;
  } });
  const expired = late.open();
  if (expired === undefined) throw new Error("Missing record");
  expect(await expired.ready).toBeUndefined();
  await expired.settled;
  late.service.dispose();
});

import { afterEach, expect, it, vi } from "vitest";
import { toolDispatchRequestSchema, toolCapabilitiesRequestSchema, toolStatusReplySchema, parseToolWire } from "@toolExecution/helpers/client/helpers/protocol";
import { createPrivateToolCalls } from "@toolExecution/helpers/calls";
import type { PrivateToolCallHandle } from "@toolExecution/helpers/calls";
import type { ToolDispatchOutcome } from "@toolExecution/helpers/dispatcher";
import { createClientToolDispatcher } from "@toolExecution/helpers/client/helpers/broker";
import { clientPolicyFixture } from "./clientPolicyFixture";

afterEach(() => vi.useRealTimers());
const contract = { id: "11111111-1111-4111-8111-111111111111", key: "test.echo", version: 1 };
const succeeded = (output: unknown): ToolDispatchOutcome<unknown> => ({ status: "succeeded", output, cleanupFailures: 0 });

it("final retention fences catch expiry after authority callbacks without invoking callback-bearing clocks", async () => {
  let time = 0;
  const sample = vi.fn(() => time);
  const store = createPrivateToolCalls({ now: sample, fenceNow: () => time, limits: { ttlMs: 100 } });
  const work = pending(), owner = {};
  const receipt = store.start(owner, () => work.handle);
  if (receipt === undefined) throw new Error("Missing record");
  work.admitted.resolve(true);
  await receipt.admitted;
  work.result.resolve(succeeded("retained canary"));
  work.settled.resolve(succeeded("retained canary"));
  await work.settled.promise;
  time = 99;
  const read = store.read(receipt.callId, owner);
  expect(read?.current()).toBe(true);
  const samples = sample.mock.calls.length;
  time = 100;
  expect(read?.fence()).toBe(false);
  expect(sample.mock.calls.length).toBe(samples);
  time = 99;
  expect(read?.fence()).toBe(false);
  store.dispose();
});
function pending() {
  const admitted = Promise.withResolvers<boolean>();
  const result = Promise.withResolvers<ToolDispatchOutcome<unknown>>();
  const settled = Promise.withResolvers<ToolDispatchOutcome<unknown>>();
  const cancel = vi.fn();
  const handle: PrivateToolCallHandle = { admitted: admitted.promise, result: result.promise, settled: settled.promise, cancel };
  return { admitted, result, settled, cancel, handle };
}

it.each(["expired", "invalid", "disposed"] as const)("does not publish delayed admission after a %s logical clock", async (condition) => {
  let time = 0;
  let onClock = () => undefined;
  const store = createPrivateToolCalls({ now: () => {
    onClock();
    return time;
  }, fenceNow: () => time, limits: { ttlMs: 100 } });
  const work = pending();
  const owner = {};
  const record = store.start(owner, () => work.handle);
  if (record === undefined) throw new Error("Missing record");
  if (condition === "disposed") onClock = () => {
    store.dispose();
    return undefined;
  };
  else time = condition === "invalid" ? Number.NaN : 100;
  work.admitted.resolve(true);
  expect(await record.admitted).toBe(false);
  expect(work.cancel).toHaveBeenCalledOnce();
  work.result.resolve(succeeded("late"));
  work.settled.resolve(succeeded("late"));
  await work.settled.promise;
  store.dispose();
});

it("v2 selectors reject unknown versions, caller authority and absent JSON input", () => {
  expect(parseToolWire(toolCapabilitiesRequestSchema, { version: 2 })).toEqual({ version: 2 });
  for (const version of [undefined, 1, 3, "2"]) expect(() => parseToolWire(toolCapabilitiesRequestSchema, { version })).toThrow();
  const request = { version: 2, channel: "ahp-session:/one", contract, input: { path: "canary" } };
  expect(parseToolWire(toolDispatchRequestSchema, request)).toEqual(request);
  for (const extra of ["actor", "roles", "provider", "owner", "grants", "executor", "decision"]) {
    expect(() => parseToolWire(toolDispatchRequestSchema, { ...request, [extra]: "forged" })).toThrow();
  }
  expect(() => parseToolWire(toolDispatchRequestSchema, { ...request, input: undefined })).toThrow();
  expect(() => parseToolWire(toolStatusReplySchema, { version: 2, status: "completed", callId: contract.id })).toThrow();
});

it("wire capture rejects getters, cycles, oversized and overdeep input before parsing", () => {
  const getter = vi.fn(() => 2);
  expect(() => parseToolWire(toolCapabilitiesRequestSchema, { get version() {
    return getter();
  } })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => parseToolWire(toolDispatchRequestSchema, cycle)).toThrow();
  expect(() => parseToolWire(toolDispatchRequestSchema, { version: 2, channel: "ahp-session:/one", contract, input: "x".repeat(2 * 1024 * 1024) })).toThrow();
  let deep: unknown = null;
  for (let index = 0; index < 70; index += 1) deep = { child: deep };
  expect(() => parseToolWire(toolDispatchRequestSchema, { version: 2, channel: "ahp-session:/one", contract, input: deep })).toThrow();
});

it("receipts wait for admission but not remote completion and records belong to the exact caller lease", async () => {
  vi.useFakeTimers();
  const store = createPrivateToolCalls();
  const caller = {}, foreign = {};
  const work = pending();
  const record = store.start(caller, () => work.handle);
  if (record === undefined) throw new Error("No call record");
  expect(store.read(record.callId, foreign)).toBeUndefined();
  expect(store.read(record.callId, caller)?.status).toEqual({ version: 2, callId: record.callId, status: "waiting" });
  work.admitted.resolve(true);
  expect(await record.admitted).toBe(true);
  expect(store.read(record.callId, caller)?.status.status).toBe("running");
  expect(store.cancel(record.callId, foreign)).toBe(false);
  expect(work.cancel).not.toHaveBeenCalled();
  expect(store.cancel(record.callId, caller)).toBe(true);
  expect(work.cancel).toHaveBeenCalledTimes(1);
  expect(store.read(record.callId, caller)?.status.status).toBe("draining");
  work.result.resolve({ status: "failed", code: "cancelled", phase: "execute", effectPossible: true, cleanupFailures: 0 });
  work.settled.resolve(succeeded("late output must not replace cancellation"));
  await work.settled.promise;
  expect(store.read(record.callId, caller)?.status.status).toBe("cancelled");
  store.dispose();
});

it("captures bounded output, enforces aggregate bytes and invalidates old read proofs on TTL", async () => {
  vi.useFakeTimers();
  const store = createPrivateToolCalls({ limits: { maxOutputBytes: 64, maxRetainedBytes: 20, ttlMs: 100 } });
  const caller = {};
  const first = pending(), second = pending();
  const one = store.start(caller, () => first.handle), two = store.start(caller, () => second.handle);
  if (one === undefined || two === undefined) throw new Error("No call records");
  first.admitted.resolve(true);
  second.admitted.resolve(true);
  const output = { value: "secret" };
  first.result.resolve(succeeded(output));
  first.settled.resolve(succeeded(output));
  await first.settled.promise;
  output.value = "mutated";
  const proof = store.read(one.callId, caller);
  expect(proof?.status).toEqual({ version: 2, callId: one.callId, status: "completed", output: { value: "secret" } });
  expect(proof?.current()).toBe(true);
  second.result.resolve(succeeded({ value: "other" }));
  second.settled.resolve(succeeded({ value: "other" }));
  await second.settled.promise;
  expect(store.read(two.callId, caller)?.status.status).toBe("failed");
  expect(store.stats().retainedBytes).toBe(18);
  await vi.advanceTimersByTimeAsync(100);
  expect(proof?.current()).toBe(false);
  expect(store.read(one.callId, caller)).toBeUndefined();
  expect(store.stats()).toEqual({ records: 0, retainedBytes: 0 });
  store.dispose();
});

it("count admission and reentrant startup are bounded; expiry cancels but cannot settle remote work", async () => {
  vi.useFakeTimers();
  const store = createPrivateToolCalls({ limits: { maxRecords: 1, ttlMs: 100 } });
  const caller = {};
  const work = pending();
  const other = vi.fn(() => pending().handle);
  const record = store.start(caller, () => {
    expect(store.start(caller, other)).toBeUndefined();
    return work.handle;
  });
  if (record === undefined) throw new Error("No call record");
  expect(other).not.toHaveBeenCalled();
  let settled = false;
  void work.settled.promise.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(store.read(record.callId, caller)).toBeUndefined();
  expect(work.cancel).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  expect(await record.admitted).toBe(false);
  work.admitted.resolve(true);
  work.result.resolve(succeeded("late"));
  work.settled.resolve(succeeded("late"));
  await work.settled.promise;
  expect(store.stats()).toEqual({ records: 0, retainedBytes: 0 });
  store.dispose();
});

it("disposal during startup cancels the late handle and does not resurrect a record", async () => {
  vi.useFakeTimers();
  const store = createPrivateToolCalls();
  const work = pending();
  const record = store.start({}, () => {
    store.dispose();
    return work.handle;
  });
  if (record === undefined) throw new Error("Reserved record should retain its denied receipt");
  expect(await record.admitted).toBe(false);
  expect(work.cancel).toHaveBeenCalledTimes(1);
  work.admitted.resolve(true);
  work.result.resolve(succeeded("late"));
  work.settled.resolve(succeeded("late"));
  await work.settled.promise;
  expect(store.stats()).toEqual({ records: 0, retainedBytes: 0 });
});

it("expired disclosure cannot free the real dispatcher's draining execution slot", async () => {
  vi.useFakeTimers();
  const f = clientPolicyFixture();
  const dispatcher = createClientToolDispatcher({ ...f.brokerOptions, dispatcher: { limits: { maxInFlight: 1 } } });
  const registration = dispatcher.policy.registrations[0];
  if (registration === undefined) throw new Error("Missing registration");
  const store = createPrivateToolCalls({ limits: { maxRecords: 1, ttlMs: 100 } });
  const remote = Promise.withResolvers<unknown>();
  const send = vi.fn(() => remote.promise);
  const launch = (callId: string) => dispatcher.dispatch({ ...f.request, registration, callId,
    executor: f.executor, executorContext: f.executorContext, current: () => true, fence: () => true, send });
  let first: ReturnType<typeof launch> | undefined;
  const record = store.start(f.caller, (callId) => {
    first = launch(callId);
    return first;
  });
  if (record === undefined) throw new Error("Missing call");
  expect(await record.admitted).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(store.stats().records).toBe(0);
  expect(dispatcher.stats()).toMatchObject({ active: 1, draining: 1 });
  const next = store.start(f.caller, launch);
  expect(await next?.admitted).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  remote.resolve({ value: "late canary" });
  await first?.settled;
  expect(dispatcher.stats().active).toBe(0);
  expect(store.read(record.callId, f.caller)).toBeUndefined();
  store.dispose();
  await dispatcher.shutdown();
});

it("invalid or reentrant clocks close retention and cannot recreate expired records", async () => {
  let time = 0;
  let onClock = () => undefined;
  const store = createPrivateToolCalls({ now: () => {
    onClock();
    return time;
  }, fenceNow: () => time });
  const work = pending();
  const owner = {};
  const record = store.start(owner, () => work.handle);
  if (record === undefined) throw new Error("Missing record");
  time = 1;
  const proof = store.read(record.callId, owner);
  onClock = () => {
    store.dispose();
    return undefined;
  };
  expect(proof?.current()).toBe(false);
  expect(store.start(owner, () => pending().handle)).toBeUndefined();
  expect(work.cancel).toHaveBeenCalledOnce();
  expect(await record.admitted).toBe(false);
  onClock = () => undefined;
  time = Number.NaN;
  expect(() => store.stats()).toThrow("Invalid private call clock");
  for (const limits of [{ maxRecords: 0 }, { ttlMs: 120_001 }, { maxRetainedBytes: 0 }, { maxOutputBytes: 1.5 }]) {
    expect(() => createPrivateToolCalls({ limits })).toThrow("Invalid private call limit");
  }
});

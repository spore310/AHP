import { describe, expect, it, vi } from "vitest";
import { createOrderGate } from "@host";

const deferred = (): { promise: Promise<void>; resolve(): void; reject(): void } => {
  const { promise, resolve, reject } = Promise.withResolvers<undefined>();
  return { promise, resolve: () => {
    resolve(undefined);
  }, reject: () => {
    reject(new Error("unconfirmed"));
  } };
};
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

describe("order gate", () => {
  it("H6-05 releases actions from several owners in ascending order and never ahead of an unconfirmed lower value", async () => {
    const sent: (number | string)[] = [];
    const stalled = vi.fn();
    const gate = createOrderGate({ timeoutMs: 1_000, onStalled: stalled });
    const push = (source: string, seq: number, confirmations: Promise<void>[]): void => {
      gate.push(source, seq, () => sent.push(seq), confirmations);
    };
    // Owner B's 11 arrives first and is confirmed, but owner A still holds 10: a stalled commit on A.
    const aConfirmsFor11 = deferred();
    push("b", 11, [aConfirmsFor11.promise]);
    await settle();
    expect(sent).toEqual([]);
    // A's 10 arrives. Its own confirmation from B is still outstanding.
    const bConfirmsFor10 = deferred();
    push("a", 10, [bConfirmsFor10.promise]);
    aConfirmsFor11.resolve();
    await settle();
    // 11 is confirmed, yet 10 is lower and not released: nothing may pass it.
    expect(sent).toEqual([]);
    bConfirmsFor10.resolve();
    await settle();
    expect(sent).toEqual([10, 11]);
    expect(gate.idle()).toBe(true);
    // An unsequenced notification keeps its place inside its own owner's stream.
    const later = deferred();
    push("a", 12, [later.promise]);
    gate.push("a", undefined, () => sent.push("a-plain"), []);
    gate.push("b", undefined, () => sent.push("b-plain"), []);
    await settle();
    expect(sent).toEqual([10, 11, "b-plain"]);
    later.resolve();
    await settle();
    expect(sent).toEqual([10, 11, "b-plain", 12, "a-plain"]);
    expect(stalled).not.toHaveBeenCalled();
  });

  it("H6-10 ends the connection instead of guessing when an owner cannot confirm, times out or the hold limit is reached", async () => {
    vi.useFakeTimers();
    try {
      for (const scenario of ["rejected", "timeout", "limit"] as const) {
        const sent: number[] = [];
        const stalled = vi.fn();
        const gate = createOrderGate({ timeoutMs: 200, maxHeld: 3, onStalled: stalled });
        const pending = deferred();
        gate.push("a", 5, () => sent.push(5), [pending.promise]);
        if (scenario === "rejected") pending.reject();
        if (scenario === "timeout") await vi.advanceTimersByTimeAsync(250);
        if (scenario === "limit") for (const seq of [6, 7, 8]) gate.push("a", seq, () => sent.push(seq), [new Promise<void>(() => undefined)]);
        await vi.advanceTimersByTimeAsync(0);
        expect(stalled, scenario).toHaveBeenCalledTimes(1);
        // Nothing held is delivered after the stall, and nothing more is accepted.
        gate.push("a", 9, () => sent.push(9), []);
        // A confirmation that fails after the stall is absorbed, not left as an unhandled rejection.
        gate.push("b", 10, () => sent.push(10), [Promise.reject(new Error("link closed"))]);
        pending.resolve();
        await vi.advanceTimersByTimeAsync(300);
        expect(sent, scenario).toEqual([]);
        expect(gate.size(), scenario).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

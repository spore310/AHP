import { idleSessionStatus } from "@sessions/constants";
import { describe, expect, it } from "vitest";
import { captureData } from "@persistence/helpers/durability/helpers";
import { createActionSequence } from "@sessions/helpers/sequence";
import { encodeState, restoreState } from "@sessions/helpers/durability/helpers";
import { createInitialSessionState } from "@sessions/helpers/state";

describe("P0 durable values", () => {
  it("P0-10 captures nested JSON and inert own keys without running accessors", () => {
    const input = { items: ["雪", {}], ["__proto__"]: { owner: "data" } };
    const captured = captureData(input);
    input.items.length = 0;
    expect(captured).toEqual({ items: ["雪", {}], ["__proto__"]: { owner: "data" } });
    let invoked = false;
    const accessor = { get value() {
      invoked = true;
      return 1;
    } };
    for (const invalid of [accessor, { value: "\u0000" }, { ["\ud800"]: 1 }, { value: NaN }, { value: undefined }, { value: new Date() }, { value: "x".repeat(65536) }]) {
      expect(() => captureData(invalid)).toThrow();
    }
    expect(invoked).toBe(false);
  });
  it("P0-20 fails before sequence overflow", () => {
    const sequence = createActionSequence(Number.MAX_SAFE_INTEGER);
    expect(sequence.next()).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => sequence.next()).toThrow();
    expect(sequence.current()).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("P0-24 round trips stable status bits and omits live activity", () => {
    const base = createInitialSessionState({ providerId: "mock", title: "修正", workingDirectories: ["file:///approved"] });
    const persisted = encodeState({ ...base, status: idleSessionStatus(true, true) });
    expect(persisted).toEqual({ version: 1, title: "修正", isRead: true, isArchived: true, workingDirectories: ["file:///approved"] });
    expect(restoreState("mock", persisted)).toEqual({ ...base, status: 1 | 32 | 64 });
  });
});

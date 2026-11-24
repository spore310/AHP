import type { ActionSequence } from "./types";

/**
 * Creates a shared action-sequence port.
 *
 * The host owns one instance for the connection-wide action stream and may
 * inject it through {@link SessionsFactoryOptions.sequence}. A factory creates
 * its own port when none is supplied. `current()` never allocates.
 *
 * @param start First value returned by `next()`. Defaults to `1`.
 */
export function createActionSequence(start = 1): ActionSequence {
  if (!Number.isSafeInteger(start) || start < 1) throw new Error("Invalid initial server sequence.");
  let next = start;
  let current = start - 1;

  return {
    seed(checkpoint) {
      if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) throw new Error("Invalid durable sequence checkpoint.");
      if (checkpoint > current) {
        current = checkpoint;
        next = checkpoint + 1;
      }
    },
    next: (): number => {
      if (!Number.isSafeInteger(next)) throw new Error("Server sequence exhausted.");
      const value = next;
      next += 1;
      current = value;
      return value;
    },
    current: (): number => current,
  };
}

/**
 * Creates a monotonic sequence allocator.
 *
 * Compatibility wrapper over {@link createActionSequence}: each call allocates
 * the next value. Prefer injecting {@link ActionSequence} when the caller also
 * needs a non-allocating cursor.
 *
 * @param start First value returned. Defaults to `1`.
 */
export function createSequenceAllocator(start = 1): () => number {
  const sequence = createActionSequence(start);
  return (): number => sequence.next();
}

/**
 * Adapts a legacy `nextServerSeq` callback into an {@link ActionSequence}.
 *
 * `current()` reports only values this adapter has observed. It cannot see
 * allocations made by other producers that call the same function directly.
 */
export function adaptSequenceAllocator(nextServerSeq: () => number): ActionSequence {
  let current = 0;

  return {
    next: (): number => {
      const value = nextServerSeq();
      if (!Number.isSafeInteger(value) || value <= current) throw new Error("Invalid server sequence.");
      current = value;
      return value;
    },
    current: (): number => current,
  };
}

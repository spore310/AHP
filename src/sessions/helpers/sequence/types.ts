/**
 * Shared monotonic action-sequence port.
 *
 * `next()` allocates the next server sequence number. `current()` reports the
 * last allocated value without allocating; it is `start - 1` before the first
 * `next()` call.
 */
export interface ActionSequence {
  seed?(checkpoint: number): void;
  /**
   * Obtains up to `count` values for the next ordered write when allocation is
   * owned by shared storage. Later `next()` calls return them synchronously.
   */
  reserve?(count: number): Promise<void>;
  next(): number;
  current(): number;
}

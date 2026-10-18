/**
 * Shared monotonic action-sequence port.
 *
 * `next()` allocates the next server sequence number. `current()` reports the
 * last allocated value without allocating; it is `start - 1` before the first
 * `next()` call.
 */
export interface ActionSequence {
  next(): number;
  current(): number;
}

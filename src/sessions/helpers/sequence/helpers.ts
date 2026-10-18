/**
 * Creates a monotonic sequence allocator.
 *
 * The host owns one allocator for the connection-wide action stream and injects
 * it through {@link SessionsFactoryOptions.nextServerSeq}. A factory uses its
 * own allocator by default; a host that publishes several channels shares one.
 *
 * @param start First value returned. Defaults to `1`.
 */
export function createSequenceAllocator(start = 1): () => number {
  let next = start;

  return (): number => {
    const value = next;
    next += 1;
    return value;
  };
}

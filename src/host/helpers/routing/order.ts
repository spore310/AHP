/**
 * Merges notifications from several authoritative owners onto one public connection.
 *
 * Every owner allocates native sequence values from one namespace-wide
 * allocator, and each owner's own stream arrives in order. A sequenced item is
 * released only when every other source has confirmed that it already sent
 * everything it committed before that confirmation, and no other source holds
 * a lower value. A client therefore never observes a descending `serverSeq`,
 * and no notification is renumbered.
 */
export interface OrderGate {
  /** `seq` is undefined for notifications that only need to keep their place in their own source's stream. */
  push(source: string, seq: number | undefined, deliver: () => unknown, confirmations: readonly Promise<void>[]): void;
  idle(): boolean;
  size(): number;
  close(): void;
}

interface Item { readonly seq: number | undefined; readonly deliver: () => unknown; ready: boolean }

export const createOrderGate = (options: { readonly timeoutMs: number; readonly maxHeld?: number; onStalled(): void }): OrderGate => {
  const queues = new Map<string, Item[]>();
  const maxHeld = options.maxHeld ?? 1_024;
  let held = 0;
  let closed = false;
  let flushing = false;
  const stall = (): void => {
    if (closed) return;
    closed = true;
    queues.clear();
    held = 0;
    options.onStalled();
  };
  const take = (source: string, queue: Item[]): void => {
    const item = queue.shift();
    if (queue.length === 0) queues.delete(source);
    if (item === undefined) return;
    held--;
    try {
      item.deliver();
    } catch { /* A failed send is the connection's concern, not the order's. */ }
  };
  const flush = (): void => {
    if (flushing) return;
    flushing = true;
    try {
      for (let progress = true; progress && !closed;) {
        progress = false;
        let lowest: { source: string; queue: Item[]; item: Item & { seq: number } } | undefined;
        for (const [source, queue] of [...queues]) {
          const head = queue[0];
          if (head === undefined) continue;
          if (head.seq === undefined) {
            take(source, queue);
            progress = true;
          } else if (lowest === undefined || head.seq < lowest.item.seq) {
            lowest = { source, queue, item: head as Item & { seq: number } };
          }
        }
        if (!progress && lowest?.item.ready === true) {
          take(lowest.source, lowest.queue);
          progress = true;
        }
      }
    } finally {
      flushing = false;
    }
  };
  return {
    push(source, seq, deliver, confirmations) {
      // A confirmation can fail after this gate stopped listening, for example when its link closes.
      for (const confirmation of confirmations) confirmation.catch(() => undefined);
      if (closed) return;
      if (held >= maxHeld) {
        stall();
        return;
      }
      const item: Item = { seq, deliver, ready: seq === undefined || confirmations.length === 0 };
      const queue = queues.get(source) ?? [];
      queues.set(source, queue);
      queue.push(item);
      held++;
      if (!item.ready) {
        const timer = setTimeout(stall, options.timeoutMs);
        Promise.all(confirmations).then(() => {
          clearTimeout(timer);
          item.ready = true;
          flush();
        }, () => {
          clearTimeout(timer);
          // An owner that cannot confirm may still hold an older value. The connection ends instead of guessing.
          stall();
        });
      }
      flush();
    },
    idle: () => held === 0,
    size: () => held,
    close() {
      closed = true;
      queues.clear();
      held = 0;
    },
  };
};

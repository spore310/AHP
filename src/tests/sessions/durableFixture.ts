import { createMemoryDurableStorage, type DurableHost, type DurableStorage } from "@persistence";
import { mockProvider } from "@sessions/mock";
import { createReviewHost } from "../../../examples/advanced/host";

export const approveRestore = { prepare: () => Promise.resolve({ bindings: [], isCurrent: () => true }) };
export function observableStorage(transform: (store: DurableHost) => DurableHost = (store) => store) {
  const underlying = createMemoryDurableStorage();
  let lease: DurableHost;
  const storage: DurableStorage = { async acquire(id, lost) {
    lease = await underlying.acquire(id, lost);
    return transform(lease);
  } };
  return { storage, current: () => lease };
}
export function sessionHost(storage: DurableStorage, provider = mockProvider, more: { maxCallbacks?: number; callbackDeadlineMs?: number } = {}) {
  return createReviewHost("direct", { durability: { storage, hostId: "test", ...more }, provider, restoration: approveRestore });
}

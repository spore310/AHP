import type { DurableHost, DurableStorage } from "../durability/types";
import type { PersistenceProvider } from "../../types";
import { createAgentRegistrationFacade } from "../agentRegistrations";
import { createPersistenceOperationScope } from "../lifecycle";
import { createDurableSessionFacade } from "../sessions";
import { createWorkFacade } from "../workItems";

export const createPersistence = (provider: PersistenceProvider): PersistenceProvider => {
  const active = new Set<DurableHost>();
  const scope = createPersistenceOperationScope(async () => {
    const released = await Promise.allSettled([...active].map((host) => host.release()));
    await provider.dispose();
    if (released.some((result) => result.status === "rejected")) throw new Error("Durable host release failed.");
  });
  const source = provider.durability;
  const durability: DurableStorage | undefined = source && {
    acquire: (id, lost, claim) => scope.run(async () => {
      const lease = await source.acquire(id, lost, claim);
      const owned: DurableHost = {
        get epoch() { return lease.epoch; },
        get serverSeq() { return lease.serverSeq; },
        get sessions() { return lease.sessions; },
        get work() { return lease.work; },
        get resources() { return lease.resources; },
        get coordination() { return lease.coordination; },
        isOpen: () => lease.isOpen(),
        async release() {
          await lease.release();
          active.delete(owned);
        },
      };
      active.add(owned);
      return owned;
    }),
  };
  return {
    ...(durability ? { durability } : {}),
    registrations: createAgentRegistrationFacade(provider.registrations, scope),
    sessions: createDurableSessionFacade(provider.sessions, scope),
    work: createWorkFacade(provider.work, scope),
    dispose: () => scope.dispose(),
  };
};

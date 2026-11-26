import { openHostLink, type HostLinkFactory } from "@host";
import { routeOutcomeUnknown } from "@host/helpers/routing/link";
import { RepositoryError, type DurableHost, type DurableStorage, type HostEventDelivery } from "@persistence";

/** One controlled wait. `reached` resolves when the instrumented code arrives at it. */
export interface Hold {
  readonly reached: Promise<void>;
  release(): void;
}
export interface Gates {
  /** Everything that passes `name` from now on waits until the hold is released. */
  hold(name: string): Hold;
  isHeld(name: string): boolean;
  pass(name: string): Promise<void>;
  releaseAll(): void;
}

/** Named barriers that put a test in control of an interleaving. Nothing here sleeps. */
export const createGates = (): Gates => {
  const held = new Map<string, { readonly reached: PromiseWithResolvers<undefined>; readonly opened: PromiseWithResolvers<undefined> }>();
  const gates: Gates = {
    hold(name) {
      const gate = { reached: Promise.withResolvers<undefined>(), opened: Promise.withResolvers<undefined>() };
      held.set(name, gate);
      return { reached: gate.reached.promise, release: () => {
        if (held.get(name) === gate) held.delete(name);
        gate.opened.resolve(undefined);
      } };
    },
    isHeld: (name) => held.has(name),
    pass(name) {
      const gate = held.get(name);
      if (gate === undefined) return Promise.resolve();
      gate.reached.resolve(undefined);
      return gate.opened.promise;
    },
    releaseAll() {
      for (const gate of held.values()) gate.opened.resolve(undefined);
      held.clear();
    },
  };
  return gates;
};

/** The error shape a storage adapter reports when a commit was sent and its acknowledgement never arrived. */
export const commitUncertain = (): Error => Object.assign(new Error("Durable commit outcome unknown."), { name: "DurableCommitUncertain" });

export type StorageStep = "commitState" | "beginRetirement" | "finishRetirement" | "transition" | "transfer" | "adopt" | "locate" | "listRecoverable" | "listSession";
export interface StorageControl {
  /** The real lease this host holds. Releasing it is what a lost database session does to the store. */
  lease?: DurableHost;
  /** The loss signal the adapter gives the host. */
  lost?: () => void;
  /** `applied`: the store commits, then the acknowledgement is lost. `refused`: nothing is committed. */
  readonly faults: Map<StorageStep, "applied" | "refused">;
  /** The next N calls of a step fail before reaching the store, as a lost database connection would. */
  readonly outages: Map<StorageStep, number>;
  /** While true, this host is never told about a namespace revocation. The store still fences it. */
  dropAuthorityHints: boolean;
  /** While true, namespace events are withheld from the host and collected in `buffered`. */
  captureEvents: boolean;
  readonly buffered: HostEventDelivery[];
  /** Hands one event to the host exactly as the store would. */
  deliver(delivery: HostEventDelivery): void;
  readonly calls: Map<StorageStep, number>;
}

/**
 * Wraps a real store. Every operation still runs against the real store: the
 * wrapper only adds named waits (`<step>:before`, `<step>:after`), lost
 * acknowledgements and control over when namespace events are handed over.
 */
export const instrumentStorage = (storage: DurableStorage, gates: Gates): { readonly storage: DurableStorage; readonly control: StorageControl } => {
  let listener: ((delivery: HostEventDelivery) => void) | undefined;
  const control: StorageControl = { faults: new Map(), outages: new Map(), dropAuthorityHints: false, captureEvents: false, buffered: [], calls: new Map(),
    deliver: (delivery) => {
      listener?.(delivery);
    } };
  const step = async <T>(name: StorageStep, run: () => Promise<T>): Promise<T> => {
    control.calls.set(name, (control.calls.get(name) ?? 0) + 1);
    await gates.pass(`${name}:before`);
    const outage = control.outages.get(name) ?? 0;
    if (outage > 0) {
      control.outages.set(name, outage - 1);
      throw new RepositoryError("database", "Storage is unavailable.");
    }
    const fault = control.faults.get(name);
    if (fault === "refused") {
      control.faults.delete(name);
      throw commitUncertain();
    }
    const value = await run();
    await gates.pass(`${name}:after`);
    if (fault === "applied") {
      control.faults.delete(name);
      throw commitUncertain();
    }
    return value;
  };
  return { control, storage: { async acquire(hostId, onLost, claim) {
    const real = await storage.acquire(hostId, onLost, claim === undefined
      ? undefined
      : { ...claim, onAuthorityRevoked: (revision) => {
          if (!control.dropAuthorityHints) claim.onAuthorityRevoked?.(revision);
        } });
    control.lease = real;
    control.lost = onLost;
    const coordination = real.coordination;
    const coordinated = coordination === undefined
      ? {}
      : { coordination: {
          ...coordination,
          transfer: (session: Parameters<typeof coordination.transfer>[0], toHostId: string) => step("transfer", () => coordination.transfer(session, toHostId)),
          adopt: (fromHostId: string, limit?: number) => step("adopt", () => coordination.adopt(fromHostId, limit)),
          locate: (target: Parameters<typeof coordination.locate>[0]) => step("locate", () => coordination.locate(target)),
          subscribeEvents(next: (delivery: HostEventDelivery) => void) {
            listener = next;
            return coordination.subscribeEvents((delivery) => {
              if (control.captureEvents) control.buffered.push(delivery);
              else next(delivery);
            });
          },
        } };
    return {
      ...real,
      ...coordinated,
      resources: {
        ...real.resources,
        listSession: (session) => step("listSession", () => real.resources.listSession(session)),
      },
      sessions: {
        ...real.sessions,
        listRecoverable: (after) => step("listRecoverable", () => real.sessions.listRecoverable(after)),
        commitState: (input, admission) => step("commitState", () => real.sessions.commitState(input, admission)),
        transition: (input, admission) => step("transition", () => real.sessions.transition(input, admission)),
        beginRetirement: (session, admission, onCancelled) => step("beginRetirement", () => real.sessions.beginRetirement(session, admission, onCancelled)),
        finishRetirement: (session) => step("finishRetirement", () => real.sessions.finishRetirement(session)),
      },
    };
  } } };
};

/**
 * The real WebSocket link between hosts with named waits around it:
 * `forward:<method>` before a request leaves the ingress, `reply:<method>`
 * after the owner answered and before the ingress sees the answer, and
 * `notify:<owner>` before a notification from that owner is handed over.
 * `lose` drops the owner's answer for one method after the owner applied it.
 */
export const gatedLinks = (gates: Gates, lose = new Set<string>()): HostLinkFactory => async (options) => {
  let backlog: Promise<void> | undefined;
  const link = await openHostLink({ ...options, onNotification: (message) => {
    const name = `notify:${options.hostId}`;
    // Untouched traffic stays synchronous so the link's own ordering is unchanged.
    if (backlog === undefined && !gates.isHeld(name)) {
      options.onNotification(message);
      return;
    }
    const next = (backlog ?? Promise.resolve()).then(() => gates.pass(name)).then(() => {
      options.onNotification(message);
    });
    backlog = next;
    void next.finally(() => {
      if (backlog === next) backlog = undefined;
    });
  } });
  return {
    hostId: link.hostId,
    isOpen: () => link.isOpen(),
    pending: () => link.pending(),
    notify: (method, params) => link.notify(method, params),
    onClose: (handler) => {
      link.onClose(handler);
    },
    close: () => {
      link.close();
    },
    request(method, params, after, ordered) {
      const before = `forward:${method}`;
      const done = `reply:${method}`;
      const sent = gates.isHeld(before) ? gates.pass(before).then(() => link.request(method, params, after, ordered)) : link.request(method, params, after, ordered);
      return sent.then(async (result) => {
        if (gates.isHeld(done)) await gates.pass(done);
        if (lose.delete(method)) {
          // The owner answered. The answer never reaches the ingress: the link is gone.
          link.close();
          throw routeOutcomeUnknown();
        }
        return result;
      });
    },
  };
};

import type { DurableHost } from "./types";

/** All writes on an acquired host invalidate affected synchronous readers before touching the store. */
export function fenceHostWork(host: DurableHost): DurableHost {
  interface State { readers: number; writers: number; revision: number }
  const states = new Map<string, State>();
  const key = (scope: string, id: string) => scope + "/" + id;
  function state(k: string) {
    const value = states.get(k) ?? { readers: 0, writers: 0, revision: 0 };
    states.set(k, value);
    return value;
  }
  function cleanup(k: string, value: State) {
    if (value.readers === 0 && value.writers === 0) states.delete(k);
  }
  async function write<T>(k: string, run: () => Promise<T>) {
    const value = state(k);
    value.writers++;
    value.revision++;
    try {
      return await run();
    } finally {
      value.writers--;
      cleanup(k, value);
    }
  }
  const work = host.work;
  const sessions = host.sessions;
  const resources = host.resources;
  return { ...host,
    work: { ...work,
      observe(session, id) {
        const watched = [key("session", session.instanceId), key("work", id)].map((k) => {
          const value = state(k);
          value.readers++;
          return { k, value, revision: value.revision, ready: value.writers === 0 };
        });
        let open = true;
        return { current: () => open && host.isOpen() && watched.every(({ value, revision, ready }) => ready && value.revision === revision),
          release() {
            if (!open) return;
            open = false;
            for (const { k, value } of watched) {
              value.readers--;
              cleanup(k, value);
            }
          } };
      },
      disposition: (fence, ...args) => write(key("work", fence.id), () => work.disposition(fence, ...args)),
      settle: (fence, ...args) => write(key("work", fence.id), () => work.settle(fence, ...args)),
      replaceData: (fence, ...args) => write(key("work", fence.id), () => work.replaceData(fence, ...args)),
    },
    sessions: { ...sessions,
      transition: (change, check) => write(key("session", change.session.instanceId), () => sessions.transition(change, check)),
      beginRetirement: (ref, check) => write(key("session", ref.instanceId), () => sessions.beginRetirement(ref, check)),
    },
    resources: { ...resources,
      reserve: (row, check) => write(key("session", row.session.instanceId), () => resources.reserve(row, check)),
      activate: (change, check) => write(key("session", change.session.instanceId), () => resources.activate(change, check)),
      beginRetirement: (session, ref, check) => write(key("session", session.instanceId), () => resources.beginRetirement(session, ref, check)),
    },
  };
}

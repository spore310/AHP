import type { DurableHost } from "./types";
import { synchronousAdmission } from "./scheduling";

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
  function begin(k: string) {
    const value = state(k);
    value.writers++;
    value.revision++;
    return () => {
      value.writers--;
      cleanup(k, value);
    };
  }
  async function write<T>(k: string, run: () => Promise<T>) {
    const end = begin(k);
    try {
      return await run();
    } finally {
      end();
    }
  }
  async function selectedWrite<T>(run: (mark: (ids: readonly string[]) => void) => Promise<T>) {
    const ends: Array<() => void> = [];
    try {
      return await run((ids) => {
        for (const id of ids) ends.push(begin(key("work", id)));
      });
    } finally {
      for (const end of ends) end();
    }
  }
  const work = host.work;
  const sessions = host.sessions;
  const resources = host.resources;
  return { ...host,
    work: { ...work,
      claimPrepared: (input, admit) => selectedWrite((mark) => work.claimPrepared(input, (locked) => {
        const id = locked.row.id;
        synchronousAdmission(admit, locked);
        mark([id]);
        return undefined;
      })),
      renewPrepared: (input, admit) => selectedWrite((mark) => work.renewPrepared(input, (locked) => {
        const id = locked.row.id;
        synchronousAdmission(admit, locked);
        mark([id]);
        return undefined;
      })),
      expireExhausted: (session, limit, beforeWrite) => selectedWrite((mark) => work.expireExhausted(session, limit, (ids) => {
        if (beforeWrite) synchronousAdmission(beforeWrite, [...ids]);
        mark(ids);
        return undefined;
      })),
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

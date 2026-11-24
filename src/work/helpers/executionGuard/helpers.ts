import { RepositoryError } from "@persistence";
import { WorkError } from "../errors";

function unavailable(): never {
  throw new WorkError("stale", "Work authority changed.");
}

interface Generation { settling: boolean; users: number }

/** A proof owns its generation. Replacing a map entry permanently fences all earlier holders. */
export function createWorkFences() {
  const heads = new Map<string, Generation>();
  let closed = false;
  function drop(id: string, head: Generation) {
    if (!head.settling && head.users === 0 && heads.get(id) === head) heads.delete(id);
  }
  return {
    capture(id: string) {
      const head = heads.get(id) ?? { settling: false, users: 0 };
      if (closed || head.settling) return unavailable();
      heads.set(id, head);
      head.users++;
      let live = true;
      return {
        current: () => live && !closed && heads.get(id) === head && !head.settling,
        release() {
          if (!live) return;
          live = false;
          head.users--;
          drop(id, head);
        },
      };
    },
    async mutate<T>(id: string, run: () => Promise<T>): Promise<T> {
      if (closed || heads.get(id)?.settling) return unavailable();
      const head = { settling: true, users: 0 };
      heads.set(id, head);
      try {
        return await run();
      } catch (error) {
        // Every new proof takes a locked snapshot. The old generation stays permanently invalid
        // even if PostgreSQL finished a transaction whose acknowledgement was lost.
        if (error instanceof RepositoryError && error.code === "outcome_unknown") heads.delete(id);
        throw error;
      } finally {
        head.settling = false;
        drop(id, head);
      }
    },
    close() {
      closed = true;
      heads.clear();
    },
  };
}

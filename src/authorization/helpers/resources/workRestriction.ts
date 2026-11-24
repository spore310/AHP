import { executionSchema } from "@work/helpers/protocol/execution";
import type { ResourceRef, ResourceRoute, TrustedRequestContext } from "../../types";
import { sameResource, sameRoute } from "../context";
import type { WorkOperationGuard, WorkOperationRestriction } from "./types";

const deny = (): never => {
  throw new Error("Work operation unavailable.");
};
const allowed = (verdict: unknown): boolean => {
  if (verdict !== true) void Promise.resolve(verdict).catch(() => undefined);
  return verdict === true;
};

/** Own the private work proof across normalization, final admission and retained disclosure. */
export function captureWorkRestriction(source: WorkOperationRestriction, caller: TrustedRequestContext) {
  const raw = source.work;
  const work = raw === undefined ? undefined : Object.freeze(executionSchema.parse(raw));
  const prepare = source.prepareWork?.bind(source);
  let active: { route: ResourceRoute; input: unknown; guard: WorkOperationGuard } | undefined;
  let closed = false;
  const unavailable = (signal: AbortSignal): boolean => closed || signal.aborted;
  const release = (): void => {
    const retiring = active;
    active = undefined;
    if (retiring !== undefined) {
      try {
        retiring.guard.release();
      } catch { /* Retire the guard even if the host cleanup throws. */ }
    }
  };
  return {
    async prepare(route: ResourceRoute, input: unknown, signal: AbortSignal, refresh = false): Promise<void> {
      if (work === undefined) return;
      if (!prepare || unavailable(signal)) return deny();
      // Both inputs are bounded immutable JSON captured by the operation owner.
      if (active && sameRoute(active.route, route) && (active.input === input || JSON.stringify(active.input) === JSON.stringify(input))) return;
      if (refresh) deny();
      const guard = await prepare(caller, work, route, input, signal);
      if (unavailable(signal)) {
        guard.release();
        deny();
      }
      release();
      active = { route, input, guard };
    },
    current: () => work === undefined || (!closed && allowed(active?.guard.current())),
    fence: () => work === undefined || (!closed && allowed(active?.guard.fence())),
    admitsTarget(target?: ResourceRef): boolean {
      if (work === undefined) return true;
      const route = active?.route;
      return target !== undefined && route !== undefined
        && (route.targets.length ? route.targets : [route.origin]).some((ref) => sameResource(ref, target));
    },
    release: (): void => {
      closed = true;
      release();
    },
  };
}

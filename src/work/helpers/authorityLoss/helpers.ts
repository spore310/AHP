import type { WorkInspection } from "@persistence/helpers/durability/workTypes";
import type { WorkAuthorityLossContext, WorkAuthorityLossDecision, WorkAuthorityLossOptions } from "./types";
import { confirmedWorkDenial } from "../authorization/helpers";
import type { WorkApproval } from "../commands/types";

/** A failed recheck can veto execution without proving that the consumer should dispose of its lease. */
export async function lostWorkPolicy(prepare: () => Promise<WorkApproval>): Promise<boolean> {
  try {
    const approval = await prepare();
    approval.release();
    return false;
  } catch (error) { return confirmedWorkDenial(error); }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createAuthorityLossMonitor(options: WorkAuthorityLossOptions) {
  const callback = options.hooks.onLeaseAuthorityLost?.bind(options.hooks);
  const max = options.maxPending ?? 8;
  const deadline = options.deadlineMs ?? 5000;
  if (!Number.isInteger(max) || max < 1 || max > 128 || !Number.isInteger(deadline) || deadline < 1 || deadline > 60000) {
    throw new RangeError("Invalid work hook limits.");
  }
  const pending = new Set<AbortController>();
  let closed = false;
  let generation = 0;
  let scanning: Promise<void> | undefined;
  let requested = false;
  const isClosed = () => closed;
  const rescan = () => requested;

  async function visit(inspection: WorkInspection) {
    const { row } = inspection;
    const lease = row.lease;
    if (!callback || !lease || row.status !== "leased" || isClosed() || pending.size >= max) return;
    const version = generation;
    const loss = await options.assess(inspection);
    if (!loss || isClosed() || generation !== version) return;
    options.onLoss?.();
    const { id, session, kind, submitter, owner, input, data, status, revision, scope, announce } = row;
    const facts = freeze(structuredClone({ work: { id, session, kind, submitter, owner, input, data, status, revision, scope, announce },
      executor: loss.executor, attempt: lease.attempt, reason: loss.reason }));
    const controller = new AbortController();
    pending.add(controller);
    const context: WorkAuthorityLossContext = Object.freeze({ ...facts, signal: controller.signal });
    const waiting = Promise.withResolvers<WorkAuthorityLossDecision | undefined>();
    const abort = () => {
      waiting.resolve(undefined);
    };
    controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      controller.abort();
    }, deadline);
    void Promise.resolve().then(() => callback(context)).then(waiting.resolve, abort).finally(() => pending.delete(controller));
    let decision: WorkAuthorityLossDecision | undefined;
    try {
      decision = await waiting.promise;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
    }
    if (isClosed() || generation !== version || controller.signal.aborted || !decision) return;
    const action = decision.action;
    if (action !== "cancel" && action !== "fail" && action !== "requeue") return;
    const store = options.repository();
    const latest = await store.inspect(row.session.domainId, id);
    if (!latest || latest.row.revision !== revision || latest.row.lease?.leaseToken !== lease.leaseToken
      || (await options.assess(latest))?.reason !== loss.reason) return;
    if (isClosed() || generation !== version) return;
    await options.mutate(id, () => store.disposition({ id, revision, session, execution: lease }, action, () => !closed && generation === version));
  }
  async function scan() {
    while (requested && !closed) {
      requested = false;
      let after: string | undefined;
      while (!isClosed() && pending.size < max) {
        const store = options.repository();
        const page = await store.leased(after, 32);
        for (const target of page) {
          if (isClosed() || rescan() || pending.size >= max) break;
          const value = await store.inspect(target.domainId, target.id);
          if (value) await visit(value).catch(() => undefined);
        }
        if (rescan() || page.length < 32) break;
        after = page.at(-1)?.id;
      }
    }
  }
  return {
    pending: () => pending.size,
    signal(): void {
      if (closed || !callback) return;
      generation++;
      requested = true;
      scanning ??= Promise.resolve().then(scan).catch(() => undefined).finally(() => {
        scanning = undefined;
      });
    },
    async idle() { await scanning; },
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
    },
  };
}

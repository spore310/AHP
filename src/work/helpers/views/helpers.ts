import { randomUUID } from "node:crypto";
import { sameResource } from "@authorization/helpers/context";
import type { WorkPageKey } from "@persistence/helpers/durability/workTypes";
import { durableSelectionLimits } from "@persistence/helpers/durability/workIntent";
import { confirmedWorkDenial } from "../authorization/helpers";
import { immutableFacts } from "../commands/facts";
import type { WorkApproval, WorkListSummary, WorkRequestContext } from "../commands/types";
import { workSummary } from "../commands/views";
import { WorkError } from "../errors";
import { createWorkSelectionGraph } from "../selections";
import type { WorkSelectionGraph } from "../selections/types";
import { workListSchema, workViewStatuses } from "./schemas";
import type { WorkListRequest, WorkViewOptions, WorkViews, WorkViewTarget } from "./types";

const stale = (): never => {
  throw new WorkError("stale", "Work view changed. Restart the request.");
};
const invalid = (): never => {
  throw new WorkError("invalid", "Invalid work view request.");
};
const denied = (): never => {
  throw new WorkError("unauthorized", "Work authorization unavailable.");
};
const unavailable = (): never => {
  throw new WorkError("exhausted", "Work view is incomplete. Retry the request.");
};
const keyOf = (caller: WorkRequestContext) => JSON.stringify([caller.context.connectionId, caller.context.actor, caller.context.authRevision, caller.context.agentGeneration]);
const sameKey = (a: WorkPageKey, b: WorkPageKey) => a.id === b.id && a.createdAt === b.createdAt;
function check(test: () => unknown): boolean {
  try {
    const answer = test();
    if (answer === true) return true;
    void Promise.resolve(answer).catch(() => undefined);
  } catch { /* Unavailable authority cannot admit a view. */ }
  return false;
}
function drop(proof: WorkApproval) {
  try {
    proof.release();
  } catch { /* Continue releasing the other owned receipts. */ }
}
interface TargetState {
  connection: string; owner: string; graph: WorkSelectionGraph; revision: string; binding: string;
  authority: () => boolean; opened: number; remaining: number; defaultKinds: readonly string[];
}
interface Cursor {
  connection: string; subscription?: string; owner: string; binding: string;
  after: WorkPageKey; upper: WorkPageKey; current(): boolean; recordUse(): void; release(): void;
  predecessor?: string; successor?: string; offers: number;
}
interface Pending { connection: string; subscription?: string; stop: AbortController }
interface RowApproval extends WorkApproval { observed(): boolean }

export function createWorkViews(options: WorkViewOptions): WorkViews {
  const allowed = new Set(options.allowedKinds);
  const targets = new Map<WorkViewTarget, TargetState>();
  const cursors = new Map<string, Cursor>();
  const pending = new Set<Pending>();
  let closed = false;
  function forget(id: string) {
    const value = cursors.get(id);
    if (!value) return;
    cursors.delete(id);
    value.release();
  }
  function discardOffer(owner: string, id: string) {
    const cursor = cursors.get(id);
    if (cursor?.owner === owner && --cursor.offers === 0) forget(id);
  }
  function request(raw: WorkListRequest) {
    const result = workListSchema.safeParse(raw);
    if (!result.success || result.data.filter?.kinds?.some((k) => !allowed.has(k))) return invalid();
    return result.data;
  }
  async function limited<T>(caller: WorkRequestContext, subscription: string | undefined,
    task: (scoped: WorkRequestContext, alive: () => boolean) => Promise<T>, start = performance.now()) {
    if (closed || caller.signal.aborted || !check(() => caller.isCurrent())) return stale();
    if (pending.size >= 64) return unavailable();
    const slot = { connection: caller.context.connectionId, subscription, stop: new AbortController() };
    const signal = AbortSignal.any([caller.signal, slot.stop.signal]);
    const until = start + 5000;
    const alive = () => !closed && !signal.aborted && performance.now() < until;
    if (!alive()) return unavailable();
    pending.add(slot);
    const abort = Promise.withResolvers<never>();
    const stopped = () => {
      abort.reject(new WorkError("exhausted", "Work view is incomplete. Retry the request."));
    };
    signal.addEventListener("abort", stopped, { once: true });
    const timer = setTimeout(() => {
      slot.stop.abort();
    }, until - performance.now());
    try {
      return await Promise.race([abort.promise, task({ ...caller, signal }, alive).finally(() => pending.delete(slot))]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stopped);
    }
  }
  function createCursor(target: WorkViewTarget, state: TargetState, after: WorkPageKey,
    upper: WorkPageKey, subscription?: string, predecessor?: string) {
    if (cursors.size >= 1024) return unavailable();
    const observation = options.repository().observe?.(target.session) ?? stale();
    const id = randomUUID();
    const idleMs = 60000;
    let until = performance.now() + idleMs;
    const timer = setTimeout(() => {
      forget(id);
    }, idleMs);
    timer.unref();
    cursors.set(id, { after, upper, binding: state.binding, connection: state.connection, subscription,
      owner: state.owner, predecessor, offers: 1,
      current: () => !closed && performance.now() < until && check(state.authority) && observation.current(),
      recordUse() {
        until = performance.now() + idleMs;
        timer.refresh();
      },
      release() {
        clearTimeout(timer);
        observation.release();
      } });
    return id;
  }
  async function read(caller: WorkRequestContext, target: WorkViewTarget, state: TargetState, id: string,
    alive: () => boolean, revision?: string) {
    const store = options.repository();
    const observed = store.observe?.(target.session, id) ?? stale();
    const abort = () => {
      observed.release();
    };
    caller.signal.addEventListener("abort", abort, { once: true });
    let approval: WorkApproval | undefined;
    let held = false;
    try {
      const row = await store.get(target.session.domainId, id);
      if (!alive() || !target.isCurrent() || !observed.current()) return stale();
      if (!row || !sameResource(row.session, target.session) || (revision !== undefined && row.revision !== revision)
        || !target.kinds.includes(row.kind) || !target.statuses.includes(row.status)
        || (target.announceTo && !state.graph.selected(target.announceTo, row.announce, state.revision))) return undefined;
      const facts = immutableFacts(row);
      try {
        approval = await options.prepare(caller, "read", facts, facts);
      } catch (error) {
        if (confirmedWorkDenial(error) && alive() && target.isCurrent() && observed.current()) return undefined;
        return unavailable();
      }
      if (!alive() || !check(() => approval?.isCurrent()) || !observed.current() || !target.isCurrent()) return stale();
      const inspected = await store.inspect(target.session.domainId, row.id);
      if (!alive() || !inspected || !sameResource(inspected.session.ref, target.session) || inspected.row.revision !== row.revision
        || inspected.session.graphRevision !== state.revision || !observed.current() || !target.isCurrent()) return stale();
      const proof = approval;
      held = true;
      return { item: workSummary(row), proof: {
        isCurrent: () => check(() => proof.isCurrent()) && observed.current(),
        fence: () => !proof.fence || check(() => proof.fence?.()),
        observed: () => observed.current(),
        release() {
          drop(proof);
          observed.release();
        } } };
    } finally {
      caller.signal.removeEventListener("abort", abort);
      if (!held) {
        if (approval) drop(approval);
        observed.release();
      }
    }
  }
  function bound(caller: WorkRequestContext, target: WorkViewTarget, visibility: WorkApproval) {
    const state = targets.get(target);
    if (!state || state.owner !== keyOf(caller) || !check(() => visibility.isCurrent()) || !target.isCurrent()) return stale();
    return state;
  }
  function projecting(caller: WorkRequestContext, target: WorkViewTarget, visibility: WorkApproval, proofs: readonly RowApproval[]) {
    let open = true;
    const fence = () => open && !closed && !caller.signal.aborted && (!visibility.fence || check(() => visibility.fence?.()))
      && proofs.every((p) => check(() => p.fence?.())) && target.isCurrent() && proofs.every((p) => p.observed()) && !caller.signal.aborted;
    const current = () => check(() => caller.isCurrent()) && check(() => visibility.isCurrent())
      && proofs.every((p) => check(() => p.isCurrent())) && fence();
    return { isCurrent: current, fence, release() {
      if (!open) return;
      open = false;
      for (const p of proofs) drop(p);
    } };
  }
  return {
    async resolve(caller, raw) {
      const started = performance.now();
      const parsed = request(raw);
      const cursor = parsed.cursor && cursors.get(parsed.cursor);
      if (parsed.cursor && (!cursor || cursor.owner !== keyOf(caller) || !cursor.current())) return stale();
      const anchor = parsed.announceTo ?? parsed.session ?? invalid();
      return limited(caller, parsed.subscriptionId, async (_scoped, alive) => {
        if (targets.size >= 1024) return unavailable();
        const authority = options.captureAuthority(caller);
        const domain = caller.context.actor.principal.domainId;
        const store = options.repository();
        const initial = await store.graph(domain, anchor);
        if (!alive()) return unavailable();
        if (!initial) return parsed.cursor ? stale() : denied();
        const session = initial.session.ref;
        const observed = store.observe?.(session) ?? stale();
        let kept = false;
        try {
          const snapshot = await store.graph(domain, session);
          if (!snapshot || snapshot.session.graphRevision !== initial.session.graphRevision) return stale();
          const graph = createWorkSelectionGraph(domain, snapshot.session, snapshot.resources, { ...options.selectionLimits, ...durableSelectionLimits });
          let normalized;
          try {
            normalized = graph.normalize({ ...(parsed.session && { session: parsed.session }), scope: [{ resource: anchor, include: true }] });
          } catch (error) {
            if (error instanceof WorkError && error.code === "invalid") return parsed.cursor ? stale() : denied();
            throw error;
          }
          const resource = normalized.scope[0]?.resource ?? stale();
          const type = options.resolveType(snapshot.session.type);
          const kinds = (snapshot.session.type.workManifest ?? []).map((r) => r.kind).filter((k) => allowed.has(k) && type.work?.some((entry) => entry.kind === k));
          if (parsed.filter?.kinds?.some((k) => !kinds.includes(k))) return invalid();
          const activeKinds = Object.freeze([...(parsed.filter?.kinds ?? kinds)].sort());
          const statuses = Object.freeze([...(parsed.filter?.statuses ?? workViewStatuses)].sort());
          const limit = parsed.limit ?? 50;
          const target: WorkViewTarget = Object.freeze({ session: Object.freeze(session), record: Object.freeze({ resource: Object.freeze(resource), providerId: snapshot.session.providerId,
            sessionType: Object.freeze({ key: snapshot.session.type.key, version: snapshot.session.type.version }) }),
          ...(parsed.announceTo && { announceTo: resource }), kinds: activeKinds, statuses, limit,
          isCurrent: () => !closed && !caller.signal.aborted && targets.has(target) && check(authority) && observed.current(),
          release() {
            targets.delete(target);
            observed.release();
          } });
          if (!alive() || !check(authority) || !observed.current() || targets.size >= 1024) return stale();
          const binding = JSON.stringify([session, normalized.graphRevision, target.announceTo, activeKinds, statuses, limit]);
          if (cursor && cursor.binding !== binding) return stale();
          targets.set(target, { owner: keyOf(caller), connection: caller.context.connectionId, authority, opened: started, graph, revision: snapshot.session.graphRevision,
            binding, remaining: 128, defaultKinds: kinds.sort() });
          kept = true;
          return target;
        } finally { if (!kept) observed.release(); }
      }, started);
    },
    async list(caller, raw, target, visibility, subscription) {
      const parsed = request(raw);
      if (parsed.subscriptionId && parsed.subscriptionId !== subscription) return denied();
      const state = bound(caller, target, visibility);
      const matches = (ref: WorkViewTarget["session"] | NonNullable<WorkViewTarget["announceTo"]>, locator: NonNullable<WorkListRequest["announceTo"]>) =>
        ref.kind === locator.kind && ref.id === locator.id && (locator.instanceId === undefined || locator.instanceId === ref.instanceId);
      if ((parsed.session && !matches(target.session, parsed.session)) || !!parsed.announceTo !== !!target.announceTo
        || (target.announceTo && parsed.announceTo && !matches(target.announceTo, parsed.announceTo))
        || (parsed.limit ?? 50) !== target.limit
        || JSON.stringify([...(parsed.filter?.kinds ?? state.defaultKinds)].sort()) !== JSON.stringify(target.kinds)
        || JSON.stringify([...(parsed.filter?.statuses ?? workViewStatuses)].sort()) !== JSON.stringify(target.statuses)) return stale();
      const cursor = parsed.cursor ? cursors.get(parsed.cursor) : undefined;
      if (parsed.cursor && (!cursor || cursor.binding !== state.binding || cursor.owner !== state.owner
        || (subscription !== undefined && cursor.subscription !== subscription) || !cursor.current())) return stale();
      const owner = cursor?.subscription ?? subscription;
      if (!state.remaining) return unavailable();
      return limited(caller, owner, async (scoped, alive) => {
        const proofs: RowApproval[] = [], items: WorkListSummary[] = [];
        const receipt = projecting(caller, target, visibility, proofs);
        const abort = () => {
          receipt.release();
        };
        scoped.signal.addEventListener("abort", abort, { once: true });
        let transferred = false, nextCursor: string | undefined;
        try {
          let after = cursor?.after, upper = cursor?.upper, bytes = 256, more = true, reachedEnd = false;
          while (more && state.remaining > 0 && items.length < target.limit && target.kinds.length && target.statuses.length) {
            if (!alive() || !target.isCurrent()) return stale();
            const size = Math.min(16, state.remaining);
            const page = await options.repository().pageKeys(target.session, size, after, upper);
            upper = page.upper;
            if (!page.rows.length || !upper) {
              reachedEnd = true;
              break;
            }
            for (const key of page.rows) {
              if (!alive()) return unavailable();
              if (!state.remaining) return unavailable();
              state.remaining--;
              const value = await read(scoped, target, state, key.id, alive);
              if (value) {
                const added = Buffer.byteLength(JSON.stringify(value.item)) + 1;
                if (bytes + added > 256 * 1024) {
                  drop(value.proof);
                  more = false;
                  break;
                }
                bytes += added;
                proofs.push(value.proof);
                items.push(value.item);
              }
              after = key;
              if (items.length >= target.limit) break;
            }
            const last = page.rows.at(-1);
            if (after && (sameKey(after, upper) || (last && page.rows.length < size && sameKey(after, last)))) {
              reachedEnd = true;
              break;
            }
          }
          if (!alive() || !receipt.isCurrent() || (parsed.cursor && (cursors.get(parsed.cursor) !== cursor || !cursor?.current()))) return stale();
          if (!caller.retainReply) return stale();
          // Presenting this position acknowledges its predecessor. Keep this
          // position retryable even when the page ends or its reply is lost.
          if (cursor?.predecessor) forget(cursor.predecessor);
          if (!reachedEnd && after && upper && !sameKey(after, upper)) {
            const next = cursor?.successor && cursors.get(cursor.successor);
            if (next && sameKey(next.after, after) && next.current()) {
              next.offers++;
              nextCursor = cursor.successor;
            } else {
              if (cursor?.successor) forget(cursor.successor);
              nextCursor = createCursor(target, state, after, upper, owner, parsed.cursor);
              if (cursor) cursor.successor = nextCursor;
            }
          }
          const token = nextCursor;
          const position = parsed.cursor;
          const fence = () => receipt.fence() && (!position || cursors.get(position)?.current() === true)
            && (!token || cursors.get(token)?.current() === true);
          caller.retainReply({ isCurrent: () => receipt.isCurrent() && fence(), fence, release() {
            receipt.release();
          } });
          if (!fence()) return stale();
          cursor?.recordUse();
          if (token) cursors.get(token)?.recordUse();
          transferred = true;
          return { version: 1 as const, items, ...(nextCursor && { nextCursor }) };
        } finally {
          scoped.signal.removeEventListener("abort", abort);
          if (!transferred) {
            receipt.release();
            if (nextCursor) discardOffer(state.owner, nextCursor);
          }
        }
      }, state.opened);
    },
    async hint(caller, target, event, visibility) {
      const state = bound(caller, target, visibility);
      if (!target.announceTo || !sameResource(target.session, event.session)) return undefined;
      return limited(caller, undefined, async (scoped, alive) => {
        const item = await read(scoped, target, state, event.workId, alive, event.revision);
        if (!item) return undefined;
        const receipt = projecting(caller, target, visibility, [item.proof]);
        if (alive() && receipt.isCurrent()) return receipt;
        receipt.release();
        return stale();
      });
    },
    discardCursor(caller, id) {
      discardOffer(keyOf(caller), id);
    },
    releaseSubscription(connection, subscription) {
      for (const [id, c] of cursors) if (c.connection === connection && c.subscription === subscription) forget(id);
      for (const p of pending) if (p.connection === connection && p.subscription === subscription) p.stop.abort();
    },
    releaseConnection(connection) {
      for (const p of pending) if (p.connection === connection) p.stop.abort();
      for (const [t, s] of targets) if (s.connection === connection) t.release();
      for (const [id, c] of cursors) if (c.connection === connection) forget(id);
    },
    close() {
      closed = true;
      for (const p of pending) p.stop.abort();
      for (const t of targets.keys()) t.release();
      for (const id of cursors.keys()) forget(id);
    },
  };
}

import { randomUUID } from "node:crypto";
import { sameResource } from "@authorization/helpers/context";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { RpcError } from "@jsonrpc";
import type { ResourceRef } from "@authorization";
import type { SessionsFactory } from "@sessions";
import type { WorkApproval, WorkEvent, WorkRequestContext } from "@work";
import { WorkError } from "@work";
import { workListSchema, workSubscribeSchema, workUnsubscribeSchema } from "@work/helpers/views";
import type { WorkListRequest, WorkViewTarget } from "@work/helpers/views/types";
import type { JsonRpcHandler, JsonRpcInvocation, WebSocketConnectionContext } from "@websocket/types";
import type { ProtectedWorkBinding } from "../../agentWork";
import { mapWorkError } from "../../agentWork";
import { WORK_GET_METHOD } from "../../constants";
import { workConnection } from "../../workContext";
import type { AHPPeer } from "../../types";
import type { createProtectedViewDelivery } from "./helpers";

type Delivery = ReturnType<typeof createProtectedViewDelivery>;
interface Subscription {
  readonly peer: AHPPeer;
  readonly id: string;
  readonly epoch: string;
  readonly target: WorkViewTarget;
  readonly controller: AbortController;
  readonly initial: Map<string, string>;
  phase: "pending" | "active" | "resetting";
}
function unavailable(): never {
  throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected work view unavailable");
}
function valid(proofs: readonly WorkApproval[], owned: () => boolean) {
  try {
    return owned() && proofs.every((p) => p.isCurrent()) && proofs.every((p) => !p.fence || p.fence()) && owned();
  } catch {
    return false;
  }
}
export function createWorkViewHandlers(binding: ProtectedWorkBinding, factory: SessionsFactory, delivery: Delivery | undefined,
  peerFor: (context: WebSocketConnectionContext) => AHPPeer, fail: (peer: AHPPeer) => void, diagnostic: () => void) {
  const projections = binding.projections ?? unavailable();
  const { views } = projections;
  const peers = new Map<AHPPeer, Map<string, Subscription>>();
  // The native initialize result contains a mandatory global cursor. A cursor-restricted
  // peer can use the protected V1 view methods directly while native methods stay gated.
  const ready = (peer: AHPPeer) => peer.phase === "ready" || (peer.phase === "new" && !!delivery
    && peer.context.security?.allowGlobalSequence === false);
  const active = (s: Subscription) => peers.get(s.peer)?.get(s.id) === s && !s.controller.signal.aborted
    && ready(s.peer) && s.peer.context.isOpen?.() === true;
  function remove(s: Subscription) {
    const slots = peers.get(s.peer);
    if (slots?.get(s.id) !== s) return;
    slots.delete(s.id);
    if (!slots.size) peers.delete(s.peer);
    s.controller.abort();
    delivery?.removeWork(s.peer, s.id);
    views.releaseSubscription(s.peer.context.connectionId, s.id);
    s.target.release();
  }
  function reset(s: Subscription) {
    if (!active(s) || s.phase === "resetting") return;
    if (s.phase === "pending" || !delivery) {
      remove(s);
      return;
    }
    s.phase = "resetting";
    delivery.removeWork(s.peer, s.id);
    delivery.enqueueWork(s.peer, s.id, 256, () => {
      try {
        if (active(s) && !s.peer.context.send({
          jsonrpc: "2.0", method: "x-ahp/work/reset",
          params: { version: 1, subscriptionId: s.id, streamEpoch: s.epoch },
        },
        () => s.peer.context.isSecurityCurrent?.() === true && active(s))) fail(s.peer);
      } finally {
        remove(s);
      }
      return Promise.resolve();
    });
  }
  async function notify(s: Subscription, event: WorkEvent, seq: number) {
    if (!active(s) || s.phase !== "active" || !delivery) return;
    const caller = workConnection(s.peer.context);
    const current = () => active(s) && s.phase === "active" && projections.streamEpoch() === s.epoch;
    const proofs: WorkApproval[] = [];
    try {
      const visible = await delivery.authorizeWork(s.peer, s.target);
      proofs.push(visible);
      const read = await views.hint({ ...caller, signal: s.controller.signal }, s.target, event, visible);
      if (!read) return;
      proofs.push(read);
      const check = () => valid([s.target, ...proofs], current);
      if (!check()) {
        reset(s);
        return;
      }
      const global = s.peer.context.security?.allowGlobalSequence === true;
      const message = {
        jsonrpc: "2.0" as const, method: "x-ahp/work/changed", params: {
          version: 1, subscriptionId: s.id, streamEpoch: s.epoch,
          workId: event.workId, revision: event.revision, change: event.type, ...(global && { serverSeq: seq }),
        },
      };
      if (!s.peer.context.send(message, check)) {
        if (current()) reset(s);
        return;
      }
      const chat = s.target.announceTo;
      if (chat?.kind === "chat" && projections.chatProjection && check()) {
        const work = await binding.get({
          ...caller, signal: s.controller.signal, retainReply(p) {
            proofs.push(p);
          },
        }, event.workId);
        if (work?.revision === event.revision && proofs.length === 3 && check()) {
          await projections.chatProjection.present({
            chat: chat as ResourceRef<"chat">, event, work,
            recipient: caller.context, signal: s.controller.signal,
          }, check);
        }
      }
    } catch {
      if (current()) reset(s);
    } finally {
      for (const proof of proofs) proof.release();
    }
  }
  const stop = projections.events.subscribe((event) => {
    if (!delivery || !peers.size || !factory.durability) return;
    void factory.durability.publishWorkReady((seq) => {
      for (const slots of peers.values()) for (const s of slots.values()) {
        if (s.phase === "resetting" || !sameResource(event.session, s.target.session)) continue;
        const buffered = s.phase === "pending";
        delivery.enqueueWork(s.peer, s.id, 256 + Buffer.byteLength(JSON.stringify(event)), () => {
          const seen = buffered && s.initial.get(event.workId);
          return seen && BigInt(seen) >= BigInt(event.revision) ? Promise.resolve() : notify(s, event, seq);
        });
      }
    }).catch(diagnostic);
  });
  async function snapshot(peer: AHPPeer, invocation: JsonRpcInvocation, caller: WorkRequestContext, req: WorkListRequest,
    target: WorkViewTarget, visible: WorkApproval, s?: Subscription, owner?: Subscription) {
    const proofs = [target, visible];
    let cursor: string | undefined;
    let settled = false;
    const cleanup = (success: boolean) => {
      if (settled) return;
      settled = true;
      if (!success && cursor) views.discardCursor(caller, cursor);
      for (const p of proofs.slice(1)) p.release();
      if (!s) target.release();
      else if (!success || !active(s)) remove(s);
      else {
        s.phase = "active";
        delivery?.activateWork(peer, s.id);
      }
    };
    const check = () => caller.isCurrent() && valid(proofs, () => !settled && ready(peer) && (!s || active(s)) && (!owner || active(owner)));
    try {
      const read = () => views.list({
        ...caller, retainReply(p) {
          proofs.push(p);
        },
      }, req, target, visible, s?.id ?? owner?.id);
      const page = await read().catch((error: unknown) => {
        // A newer item revision can invalidate the first read while its hint is buffered.
        // Keep the pending slot and the original target's deadline and scan budget.
        if (s && error instanceof WorkError && error.code === "stale" && proofs.length === 2 && check()) return read();
        throw error;
      });
      cursor = page.nextCursor;
      if (proofs.length !== 3 || !check() || !invocation.guardReply) return unavailable();
      if (s) for (const item of page.items) s.initial.set(item.id, item.revision);
      invocation.guardReply(check);
      invocation.onReplySettled((r) => {
        cleanup(r.outcome === "success" && r.responseSent && (!s || active(s)));
      });
      return s ? { ...page, subscriptionId: s.id, streamEpoch: s.epoch } : page;
    } catch (error) {
      cleanup(false);
      throw error;
    }
  }
  async function page(peer: AHPPeer, invocation: JsonRpcInvocation, request: WorkListRequest, subscribe: boolean) {
    const deadline = performance.now() + 5000;
    const owner = request.subscriptionId && peers.get(peer)?.get(request.subscriptionId);
    if (request.subscriptionId && (!owner || !active(owner) || owner.phase !== "active")) return unavailable();
    const connection = workConnection(peer.context);
    const caller = owner ? { ...connection, signal: owner.controller.signal } : connection;
    const target = await views.resolve(caller, request);
    let s: Subscription | undefined;
    let visible: WorkApproval | undefined;
    try {
      if (!caller.isCurrent() || !ready(peer)) return unavailable();
      if (owner && (!active(owner) || !owner.target.isCurrent() || !target.announceTo || !owner.target.announceTo
        || !sameResource(target.announceTo, owner.target.announceTo) || !sameResource(target.session, owner.target.session)
        || target.limit !== owner.target.limit || JSON.stringify(target.kinds) !== JSON.stringify(owner.target.kinds)
        || JSON.stringify(target.statuses) !== JSON.stringify(owner.target.statuses))) return unavailable();
      if (!target.announceTo && !subscribe) visible = { isCurrent: caller.isCurrent.bind(caller), release() { } };
      else if (delivery) visible = await delivery.authorizeWork(peer, target, deadline);
      else return unavailable();
      if (!valid([target, visible], () => ready(peer) && caller.isCurrent())) return unavailable();
      if (subscribe) {
        const epoch = projections.streamEpoch();
        const slots = peers.get(peer) ?? new Map<string, Subscription>();
        if (!delivery || slots.size >= 128) return unavailable();
        s = { peer, epoch, id: randomUUID(), controller: new AbortController(), phase: "pending", initial: new Map(), target };
        slots.set(s.id, s);
        peers.set(peer, slots);
        delivery.workPending(peer, s.id);
      }
    } catch (error) {
      visible?.release();
      if (s) remove(s);
      else target.release();
      throw error;
    }
    return snapshot(peer, invocation, s ? { ...caller, signal: s.controller.signal } : caller, request, target, visible, s, owner || undefined);
  }
  const handler = (fn: JsonRpcHandler): JsonRpcHandler => async (params, context, invocation) => {
    if (invocation.kind !== "request" || !invocation.guardReply || !ready(peerFor(context))) return unavailable();
    try {
      return await fn(params, context, invocation);
    } catch (error) {
      return mapWorkError(error);
    }
  };
  const handlers: Record<string, JsonRpcHandler> = {
    "x-ahp/work/list": handler((params, context, inv) => page(peerFor(context), inv, workListSchema.parse(params), false)),
  };
  if (delivery) {
    handlers["x-ahp/work/subscribe"] = handler((params, context, inv) => {
      const { resource, ...rest } = workSubscribeSchema.parse(params);
      return page(peerFor(context), inv, { ...rest, announceTo: resource }, true);
    });
    handlers["x-ahp/work/unsubscribe"] = handler((params, context) => {
      const { subscriptionId } = workUnsubscribeSchema.parse(params);
      const s = peers.get(peerFor(context))?.get(subscriptionId);
      if (s) remove(s);
      return null;
    });
  }
  return {
    handlers, supportsRestricted(peer: AHPPeer, method: string) {
      return (method === WORK_GET_METHOD || Object.hasOwn(handlers, method)) && ready(peer);
    },
    invalidate() {
      for (const slots of [...peers.values()]) for (const s of [...slots.values()]) reset(s);
    },
    retire(uri: string) {
      for (const slots of peers.values()) for (const s of slots.values()) if (s.target.session.id === uri) reset(s);
    },
    remove(peer: AHPPeer) {
      for (const s of peers.get(peer)?.values() ?? []) remove(s);
      views.releaseConnection(peer.context.connectionId);
    },
    dispose() {
      stop();
      for (const slots of peers.values()) for (const s of slots.values()) remove(s);
    },
  };
}

import { ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED } from "@sessions/constants";
import type { ActionEnvelope, SessionAction, Snapshot } from "@microsoft/agent-host-protocol";
import type { JsonRpcMessage } from "@jsonrpc";
import type { SessionsFactory } from "@sessions";
import type { ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import { createResourceViews, projectSessionViewAction, ResourceViewDenied, type ResourceViewOptions, type ResourceViewProof, type ResourceViewSource } from "@sessions/views";
import { WorkError } from "@work";
import type { AHPPeer } from "@websocket/helpers/ahp/types";
import type { PeerViewState, ViewDeliveryIntent } from "./types";
import type { WorkViewTarget } from "@work/helpers/views/types";

const root = "ahp-root://";
const unavailable = (): never => {
  throw new Error("Protected view unavailable");
};

/** Transport adapter: bounded ordered intents, one neutral canonical projection service. */
export function createProtectedViewDelivery(factory: SessionsFactory, options: ResourceViewOptions, fail: (peer: AHPPeer) => void) {
  if (factory.authorization?.usesRegistry(options.registry) !== true) throw new TypeError("Resource views require canonical session authority");
  const getResource = factory.authorization.getResource.bind(factory.authorization);
  const getSnapshot = factory.getSessionSnapshot.bind(factory);
  const manifest = factory.getSessionToolManifest.bind(factory);
  const list = factory.listSessions.bind(factory);
  const getSeq = factory.getCurrentServerSeq.bind(factory);
  let catalogueRevision = 0;
  let disposed = false;
  const states = new Map<AHPPeer, PeerViewState>();
  const intents = new WeakMap<JsonRpcMessage, ViewDeliveryIntent>();
  const additions = new Map<string, ResourceRef>();
  const source: ResourceViewSource = {
    record: (uri) => {
      const resource = getResource(uri);
      const snapshot = getSnapshot(uri);
      const type = manifest(uri)?.sessionType;
      return resource === undefined || snapshot === undefined || type === undefined ? undefined : { resource, sessionType: type, providerId: snapshot.state.provider };
    },
    snapshot: getSnapshot,
    captureResourceFence: (resource) => () => !disposed && getResource(resource.id) === resource,
    catalogue: () => {
      const revision = catalogueRevision;
      const summaries = list({ channel: root }).items;
      if (summaries.length > 128) return unavailable();
      const rows = summaries.map((summary) => {
        const record = source.record(summary.resource);
        if (record === undefined) return unavailable();
        return { ...record, summary };
      });
      return { rows, fromSeq: getSeq(), current: () => !disposed && revision === catalogueRevision };
    },
  };
  const views = createResourceViews(options, source);
  const stateFor = (peer: AHPPeer, native = true): PeerViewState => {
    if (native && peer.context.security?.allowGlobalSequence !== true) return unavailable();
    const existing = states.get(peer);
    if (existing !== undefined) return existing;
    const setup = peer.context.security;
    const generation = peer.context.connectionGeneration;
    if (setup === undefined || generation === undefined
      || setup.fence.connectionId !== peer.context.connectionId || setup.context.connectionId !== peer.context.connectionId
      || setup.fence.connectionGeneration !== generation) return unavailable();
    const controller = new AbortController();
    const state: PeerViewState = { controller, queue: [], workPending: new Map(), fromSeq: new Map(), generations: new Map(), known: new Set(), proofs: new Map(), bytes: 0, running: false, refresh: false,
      recipient: { actor: setup.context, signal: controller.signal,
        current: () => peer.context.security === setup && peer.context.isSecurityCurrent?.() === true,
        fence: () => !disposed && states.get(peer) === state && !controller.signal.aborted
          && peer.phase !== "closed" && peer.phase !== "closing" && peer.context.isOpen?.() === true } };
    states.set(peer, state);
    return state;
  };
  const remember = (state: PeerViewState, proof: ResourceViewProof<unknown>): void => {
    for (const stamp of proof.stamps) state.known.add(stamp.authority.route.origin.id);
    if (state.known.size > 128) return unavailable();
  };
  const close = (peer: AHPPeer, state: PeerViewState): void => {
    state.controller.abort();
    state.workPending.clear();
    state.queue.length = 0;
    state.bytes = 0;
    state.proofs.clear();
    views.forget(state.recipient);
    fail(peer);
  };
  const send = (peer: AHPPeer, state: PeerViewState, message: JsonRpcMessage, proof: ResourceViewProof<unknown>, owned: () => boolean): boolean => {
    if (!owned()) return false;
    if (!peer.context.send(message, () => views.current(state.recipient, [proof]) && owned())) {
      if (owned()) close(peer, state);
      return false;
    }
    remember(state, proof);
    return true;
  };
  const deliver = async (peer: AHPPeer, state: PeerViewState, intent: ViewDeliveryIntent): Promise<void> => {
    if (!peer.subscriptions.has(intent.channel)) return;
    const message = intent.message;
    if (!("method" in message) || message.params === undefined || Array.isArray(message.params)) return unavailable();
    const params = message.params;
    const generation = state.generations.get(intent.channel);
    const owned = (): boolean => peer.subscriptions.has(intent.channel) && !peer.pending.has(intent.channel)
      && state.generations.get(intent.channel) === generation;
    if (message.method === "root/sessionRemoved") {
      if (typeof params.session === "string" && state.known.has(params.session)) close(peer, state);
      return;
    }
    if (message.method === "action") {
      const envelope = params as unknown as ActionEnvelope;
      if (envelope.rejectionReason !== undefined) return unavailable();
      if (envelope.serverSeq <= (state.fromSeq.get(intent.channel) ?? -1)) return;
      const eventCurrent = (): boolean => owned() && envelope.serverSeq > (state.fromSeq.get(intent.channel) ?? -1);
      if (intent.channel === root) {
        if (envelope.action.type !== ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED || intent.catalogue === undefined) return unavailable();
        const proof = await views.catalogue(state.recipient, intent.catalogue);
        if (!send(peer, state, { ...message, params: { ...params, action: { type: envelope.action.type, activeSessions: proof.value.length } } }, proof, eventCurrent)) return;
        state.proofs.set(root, proof);
      } else {
        if (intent.record === undefined) return unavailable();
        const proof = await views.authorize(state.recipient, intent.record);
        const action = projectSessionViewAction(envelope.action as SessionAction);
        if (!send(peer, state, { ...message, params: { channel: envelope.channel, action, serverSeq: envelope.serverSeq, origin: envelope.origin } }, proof, eventCurrent)) return;
        state.proofs.set(intent.channel, proof);
      }
      state.fromSeq.set(intent.channel, envelope.serverSeq);
      return;
    }
    if ((message.method !== "root/sessionAdded" && message.method !== "root/sessionSummaryChanged") || intent.record === undefined) return;
    let proof: ResourceViewProof<unknown>;
    try {
      proof = await views.authorize(state.recipient, intent.record);
    } catch {
      if (state.known.has(intent.record.resource.id)) close(peer, state);
      return;
    }
    send(peer, state, message, proof, owned);
  };
  const pump = async (peer: AHPPeer, state: PeerViewState): Promise<void> => {
    if (state.running || state.controller.signal.aborted) return;
    state.running = true;
    try {
      while (state.recipient.fence()) {
        if (state.refresh) {
          state.refresh = false;
          for (const uri of peer.subscriptions) {
            const old = state.proofs.get(uri);
            const generation = state.generations.get(uri);
            const owns = (): boolean => peer.subscriptions.has(uri) && !peer.pending.has(uri) && state.generations.get(uri) === generation;
            let proof: ResourceViewProof<Snapshot>;
            try {
              proof = await views.snapshot(state.recipient, uri);
            } catch {
              if (owns()) close(peer, state);
              continue;
            }
            if (!owns()) continue;
            // Canonical additions have native catalogue/count events. Permission-only
            // membership transitions have no safe native representation.
            if (uri === root && old !== undefined) {
              const before = old.stamps.map((stamp) => stamp.authority.route.origin);
              const after = proof.stamps.map((stamp) => stamp.authority.route.origin);
              const lost = before.some((ref) => !after.some((next) => sameResource(ref, next)));
              const gainedWithoutEvent = after.some((ref) => {
                if (before.some((prior) => sameResource(ref, prior))) return false;
                const addition = additions.get(ref.id);
                return old.basis.some((prior) => sameResource(ref, prior)) || addition === undefined || !sameResource(addition, ref);
              });
              if (lost || gainedWithoutEvent) {
                close(peer, state);
                return;
              }
            }
            state.proofs.set(uri, proof);
          }
        }
        const next = state.queue.shift();
        if (next === undefined) break;
        try {
          if (next.type === "work") await next.deliver();
          else await deliver(peer, state, next);
        } finally {
          state.bytes = Math.max(0, state.bytes - next.bytes);
        }
      }
    } catch {
      close(peer, state);
    } finally {
      state.running = false;
    }
  };
  const unsubscribe = options.registry.onInvalidate(() => {
    for (const [peer, state] of states) {
      state.refresh = true;
      void pump(peer, state);
    }
  });
  function fits(peer: AHPPeer, state: PeerViewState, size: number) {
    let count = state.queue.length + (state.running ? 1 : 0);
    let bytes = state.bytes + size;
    for (const items of state.workPending.values()) count += items.length;
    for (const items of peer.pending.values()) for (const item of items) {
      count++;
      bytes += intents.get(item)?.bytes ?? 2 * 1024 * 1024 + 1;
    }
    if (count < 256 && bytes <= 2 * 1024 * 1024) return true;
    close(peer, state);
    return false;
  }
  return Object.freeze({
    authorizeWork: async (peer: AHPPeer, target: WorkViewTarget, deadline?: number) => {
      const state = stateFor(peer, false);
      const proof = await views.authorize(state.recipient, { ...target.record, session: target.session },
        target.fence?.bind(target) ?? target.isCurrent.bind(target), deadline).catch((error: unknown) => {
        if (error instanceof ResourceViewDenied) throw new WorkError("unauthorized", "Work view denied.");
        throw error;
      });
      return { isCurrent: () => views.current(state.recipient, [proof]), fence: proof.fence.bind(proof), release() {} };
    },
    /** Resolves after every delivery queued for this peer so far has been sent or dropped. */
    settle(peer: AHPPeer): Promise<void> {
      const state = states.get(peer);
      if (!state || state.controller.signal.aborted || (!state.running && state.queue.length === 0)) return Promise.resolve();
      return new Promise((resolve) => {
        const done = (): void => {
          state.controller.signal.removeEventListener("abort", done);
          resolve();
        };
        state.queue.push({ type: "work", channel: "", bytes: 0, deliver: () => {
          done();
          return Promise.resolve();
        } });
        state.controller.signal.addEventListener("abort", done, { once: true });
        void pump(peer, state);
      });
    },
    workPending(peer: AHPPeer, id: string) {
      stateFor(peer, false).workPending.set(id, []);
    },
    enqueueWork(peer: AHPPeer, id: string, bytes: number, deliver: () => Promise<void>) {
      const state = stateFor(peer, false);
      if (state.controller.signal.aborted || !fits(peer, state, bytes)) return;
      const intent = { type: "work" as const, channel: id, bytes, deliver };
      const pending = state.workPending.get(id);
      (pending ?? state.queue).push(intent);
      state.bytes += bytes;
      if (!pending) void pump(peer, state);
    },
    activateWork(peer: AHPPeer, id: string) {
      const state = states.get(peer);
      const pending = state?.workPending.get(id);
      if (!state || !pending) return;
      state.workPending.delete(id);
      state.queue.push(...pending);
      void pump(peer, state);
    },
    removeWork(peer: AHPPeer, id: string) {
      const state = states.get(peer);
      if (!state) return;
      for (const item of state.workPending.get(id) ?? []) state.bytes -= item.bytes;
      state.workPending.delete(id);
      for (let i = state.queue.length - 1; i >= 0; i--) {
        const item = state.queue[i];
        if (item?.type !== "work" || item.channel !== id) continue;
        state.bytes -= item.bytes;
        state.queue.splice(i, 1);
      }
    },
    changed: () => {
      catalogueRevision += 1;
    },
    capture: (channel: string, message: JsonRpcMessage): void => {
      if (intents.has(message)) return;
      if (!("method" in message)) return unavailable();
      const params = message.params as Record<string, unknown> | undefined;
      const summary = params?.summary as { resource?: string } | undefined;
      const uri = channel !== root ? channel : typeof params?.session === "string" ? params.session : summary?.resource;
      const record = uri === undefined ? undefined : source.record(uri);
      if (message.method === "root/sessionRemoved" && uri !== undefined) additions.delete(uri);
      if (message.method === "root/sessionAdded" && record !== undefined) {
        if (additions.size >= 128 && !additions.has(record.resource.id)) return unavailable();
        additions.set(record.resource.id, record.resource);
      }
      const raw = channel === root && message.method === "action" ? source.catalogue() : undefined;
      const catalogue = raw === undefined ? undefined : { ...raw, current: () => !disposed && raw.rows.every((row) => getResource(row.resource.id) === row.resource) };
      const bytes = Buffer.byteLength(JSON.stringify(message)) + (catalogue === undefined ? 0 : Buffer.byteLength(JSON.stringify(catalogue.rows)));
      if (bytes > 2 * 1024 * 1024) return unavailable();
      intents.set(message, { type: "native", channel, message, ...(record === undefined ? {} : { record }), ...(catalogue === undefined ? {} : { catalogue }), bytes });
    },
    enqueue: (peer: AHPPeer, message: JsonRpcMessage): void => {
      const state = stateFor(peer);
      const intent = intents.get(message);
      if (intent === undefined) {
        close(peer, state);
        return;
      }
      if (!fits(peer, state, intent.bytes)) return;
      state.queue.push(intent);
      state.bytes += intent.bytes;
      void pump(peer, state);
    },
    buffer: (peer: AHPPeer, message: JsonRpcMessage): boolean => {
      const state = stateFor(peer);
      return fits(peer, state, intents.get(message)?.bytes ?? 2 * 1024 * 1024 + 1);
    },
    snapshot: (peer: AHPPeer, uri: string) => views.snapshot(stateFor(peer).recipient, uri),
    list: (peer: AHPPeer, params: unknown) => views.list(stateFor(peer).recipient, params),
    current: (peer: AHPPeer, proofs: readonly ResourceViewProof<unknown>[]) => views.current(stateFor(peer).recipient, proofs),
    committed: (peer: AHPPeer, proofs: readonly ResourceViewProof<Snapshot>[]): void => {
      const state = stateFor(peer);
      for (const proof of proofs) {
        state.generations.set(proof.value.resource, {});
        state.fromSeq.set(proof.value.resource, proof.value.fromSeq);
        state.proofs.set(proof.value.resource, proof);
        remember(state, proof);
      }
    },
    unsubscribe: (peer: AHPPeer, uri: string): void => {
      const state = states.get(peer);
      if (state === undefined) return;
      state.generations.delete(uri);
      state.fromSeq.delete(uri);
      state.proofs.delete(uri);
      if (uri === root) {
        state.known.clear();
        for (const proof of state.proofs.values()) remember(state, proof);
      } else if (!peer.subscriptions.has(root)) state.known.delete(uri);
      for (let index = state.queue.length - 1; index >= 0; index -= 1) {
        const intent = state.queue[index];
        if (intent?.type === "native" && intent.channel === uri) {
          state.bytes = Math.max(0, state.bytes - intent.bytes);
          state.queue.splice(index, 1);
        }
      }
      if (peer.subscriptions.size === 0 && peer.pending.size === 0) views.forget(state.recipient);
    },
    remove: (peer: AHPPeer): void => {
      const state = states.get(peer);
      if (state === undefined) return;
      state.controller.abort();
      state.queue.length = 0;
      state.workPending.clear();
      state.bytes = 0;
      views.forget(state.recipient);
      states.delete(peer);
    },
    dispose: (): void => {
      disposed = true;
      unsubscribe();
      for (const state of states.values()) {
        state.controller.abort();
        state.workPending.clear();
        state.queue.length = 0;
      }
      states.clear();
      additions.clear();
      views.dispose();
    },
  });
}

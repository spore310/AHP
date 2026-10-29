import { randomUUID } from "node:crypto";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { RpcError, JSONRPC_VERSION, jsonRpcParamsSchema } from "@jsonrpc";
import { createPrivateToolCalls } from "@toolExecution/helpers/calls";
import type { PrivateToolCallHandle } from "@toolExecution/helpers/calls";
import {
  parseToolWire, toolCapabilitiesRequestSchema, toolAssignedRequestSchema, toolAssignedReplySchema,
  toolAdvertiseRequestSchema, toolAdvertiseReplySchema, toolDispatchRequestSchema, toolCallSelectorSchema,
  toolResumeRequestSchema,
} from "@toolExecution/helpers/client/helpers/protocol";
import type { JsonRpcInvocation, WebSocketConnectionContext } from "@websocket/types";
import type { PrivateProtocolCall, PrivateProtocolView, PrivateToolProtocol, PrivateToolProtocolPorts } from "./types";

const unavailable = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Tool operation unavailable");
};
const absent = Object.freeze({ version: 2, status: "unavailable" });

/** Socket-only protocol state. Policy and all execution remain in the sole broker. */
export function createPrivateToolProtocol(ports: PrivateToolProtocolPorts): PrivateToolProtocol {
  const ready = ports.ready.bind(ports), fence = ports.fence.bind(ports);
  const assignment = ports.assignment.bind(ports), dispatch = ports.dispatch.bind(ports);
  const peers = new Set<WebSocketConnectionContext>();
  const negotiating = new Set<WebSocketConnectionContext>();
  const views = new Map<WebSocketConnectionContext, Map<string, PrivateProtocolView>>();
  const calls = createPrivateToolCalls();
  const access = new WeakMap<PrivateToolCallHandle, Pick<PrivateProtocolCall, "current" | "refresh">>();
  const activeControllers = new Set<AbortController>();
  let closed = false;
  let workCount = 0;
  let viewCount = 0;
  let pendingViews = 0;
  let stagedViews = 0;
  const pendingByPeer = new Map<WebSocketConnectionContext, number>();
  const live = (context: WebSocketConnectionContext): boolean => !closed && peers.has(context) && ready(context);
  const owned = (context: WebSocketConnectionContext): boolean => !closed && peers.has(context) && fence(context);
  const requireLive = (context: WebSocketConnectionContext, invocation: JsonRpcInvocation): void => {
    if (invocation.kind !== "request" || invocation.guardReply === undefined || !live(context)) unavailable();
  };
  const drop = (view: PrivateProtocolView): void => {
    const ownedViews = views.get(view.context);
    if (ownedViews?.get(view.channel) !== view) return;
    ownedViews.delete(view.channel);
    viewCount -= 1;
    if (ownedViews.size === 0) views.delete(view.context);
    view.controller.abort();
  };
  const bounded = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    if (closed || workCount >= 64) return undefined;
    workCount += 1;
    const controller = new AbortController();
    activeControllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const running = Promise.resolve().then(() => work(controller.signal)).then((value) => controller.signal.aborted ? undefined : value, () => undefined)
      .finally(() => {
        workCount -= 1;
        activeControllers.delete(controller);
      });
    try {
      return await Promise.race([running, new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, 5000);
      })]);
    } finally {
      clearTimeout(timer);
    }
  };
  const unsubscribe = ports.onInvalidate(() => {
    for (const ownViews of [...views.values()]) for (const view of [...ownViews.values()]) {
      drop(view);
      if (!live(view.context)) continue;
      view.context.send({ jsonrpc: JSONRPC_VERSION, method: "x-ahp/tools/assignmentsChanged",
        params: { version: 2, channel: view.channel, viewRevision: randomUUID() } }, () => owned(view.context));
    }
  });
  return {
    handlers: {
      "x-ahp/tools/capabilities": (params, context, invocation) => {
        parseToolWire(toolCapabilitiesRequestSchema, params);
        if (closed || invocation.kind !== "request" || invocation.guardReply === undefined || !ready(context)
          || negotiating.has(context) || (!peers.has(context) && peers.size + negotiating.size >= 1024)) return unavailable();
        const existing = peers.has(context);
        if (!existing) negotiating.add(context);
        invocation.guardReply(() => !closed && ready(context) && (existing ? peers.has(context) : negotiating.has(context) && peers.size < 1024) && fence(context));
        invocation.onReplySettled((settlement) => {
          const reserved = existing || negotiating.delete(context);
          if (settlement.outcome === "success" && settlement.responseSent) {
            if (reserved && !closed && fence(context) && (peers.has(context) || peers.size < 1024)) peers.add(context);
            else context.close();
          }
        });
        return { version: 2, assignments: true, dispatch: true, continuation: false };
      },
      "x-ahp/tools/assigned": async (params, context, invocation) => {
        requireLive(context, invocation);
        const request = parseToolWire(toolAssignedRequestSchema, params);
        const replacing = views.get(context)?.has(request.channel) === true;
        if (stagedViews >= 64 || (!replacing && ((views.get(context)?.size ?? 0) + (pendingByPeer.get(context) ?? 0) >= 128
          || viewCount + pendingViews >= 1024))) return unavailable();
        stagedViews += 1;
        if (!replacing) {
          pendingViews += 1;
          pendingByPeer.set(context, (pendingByPeer.get(context) ?? 0) + 1);
        }
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          stagedViews -= 1;
          if (!replacing) {
            pendingViews -= 1;
            const remaining = (pendingByPeer.get(context) ?? 1) - 1;
            if (remaining === 0) pendingByPeer.delete(context);
            else pendingByPeer.set(context, remaining);
          }
        };
        const controller = new AbortController();
        try {
          const ticket = await bounded(async (signal) => {
            signal.addEventListener("abort", () => {
              controller.abort();
            }, { once: true });
            return assignment(context, request.channel, controller.signal);
          });
          if (ticket === undefined || !live(context) || !ticket.current()) {
            controller.abort();
            return unavailable();
          }
          const revision = randomUUID();
          const view: PrivateProtocolView = { context, channel: request.channel, revision, controller, ticket };
          const reply = parseToolWire(toolAssignedReplySchema, { version: 2, channel: request.channel, viewRevision: revision, ...ticket.value });
          const capacity = (): boolean => views.get(context)?.has(request.channel) === true
            || ((views.get(context)?.size ?? 0) < 128 && viewCount < 1024);
          invocation.guardReply?.(() => live(context) && ticket.current() && owned(context) && capacity() && ticket.fence());
          invocation.onReplySettled((settlement) => {
            release();
            if (settlement.outcome !== "success" || !settlement.responseSent || !owned(context) || !capacity() || !ticket.fence()) {
              controller.abort();
              return;
            }
            const previous = views.get(context)?.get(request.channel);
            const current = views.get(context) ?? new Map<string, PrivateProtocolView>();
            current.set(request.channel, view);
            views.set(context, current);
            if (previous === undefined) viewCount += 1;
            // Publish owned replacement before invoking previous resolver cleanup hooks.
            previous?.controller.abort();
          });
          return reply;
        } catch (error) {
          release();
          controller.abort();
          throw error;
        }
      },
      "x-ahp/tools/advertise": (params, context, invocation) => {
        requireLive(context, invocation);
        const request = parseToolWire(toolAdvertiseRequestSchema, params);
        const view = views.get(context)?.get(request.channel);
        if (view === undefined || view.revision !== request.viewRevision || !view.ticket.current()) return unavailable();
        const advertisementId = randomUUID();
        const ticket = view.ticket.advertise(request.contracts, advertisementId);
        const current = (): boolean => live(context) && views.get(context)?.get(request.channel) === view && ticket.current()
          && owned(context) && view.ticket.fence();
        try {
          const reply = parseToolWire(toolAdvertiseReplySchema, { version: 2, channel: request.channel, viewRevision: view.revision,
            ...view.ticket.value, advertisementId, tools: ticket.tools });
          invocation.guardReply?.(current);
          invocation.onReplySettled((settlement) => {
            try {
              if (settlement.outcome === "success" && settlement.responseSent) {
                const committed = owned(context) && views.get(context)?.get(request.channel) === view && view.ticket.fence() && ticket.commit();
                if (!committed) context.close();
              }
            } finally {
              ticket.release();
            }
          });
          return reply;
        } catch (error) {
          ticket.release();
          throw error;
        }
      },
      "x-ahp/tools/dispatch": async (params, context, invocation) => {
        requireLive(context, invocation);
        const request = parseToolWire(toolDispatchRequestSchema, params);
        const receipt = calls.start(context, (callId) => {
          const handle = dispatch(context, request, callId);
          access.set(handle, { current: handle.current.bind(handle), refresh: handle.refresh.bind(handle) });
          return handle;
        });
        if (receipt === undefined || !await receipt.admitted) return { version: 2, status: "denied", code: "unavailable" };
        const record = calls.read(receipt.callId, context);
        if (record === undefined) return { version: 2, status: "denied", code: "unavailable" };
        const admitted = access.get(record.handle);
        invocation.guardReply?.(() => {
          const current = calls.read(receipt.callId, context);
          return current !== undefined && current.handle === record.handle && live(context)
            && admitted?.current() === true && owned(context) && current.fence();
        });
        return { version: 2, status: "accepted", callId: receipt.callId };
      },
      "x-ahp/tools/status": async (params, context, invocation) => {
        requireLive(context, invocation);
        const request = parseToolWire(toolCallSelectorSchema, params);
        const record = calls.read(request.callId, context);
        const refresh = record === undefined ? undefined : access.get(record.handle)?.refresh;
        if (record === undefined || refresh === undefined) return absent;
        const authorized = await bounded(refresh);
        const current = calls.read(request.callId, context);
        if (authorized === undefined || current === undefined || current.handle !== record.handle || !authorized()) return absent;
        invocation.guardReply?.(() => current.current() && live(context) && authorized() && owned(context) && current.fence());
        return jsonRpcParamsSchema.parse(current.status);
      },
      "x-ahp/tools/cancel": async (params, context, invocation) => {
        requireLive(context, invocation);
        const request = parseToolWire(toolCallSelectorSchema, params);
        const record = calls.read(request.callId, context);
        const refresh = record === undefined ? undefined : access.get(record.handle)?.refresh;
        if (record === undefined || refresh === undefined) return absent;
        const authorized = await bounded(refresh);
        if (authorized === undefined || !record.current() || !live(context) || !authorized() || !owned(context) || !record.fence()) return absent;
        if (!calls.cancel(request.callId, context, () => live(context) && authorized() && owned(context) && record.fence())) return absent;
        const current = calls.read(request.callId, context);
        if (current === undefined) return absent;
        invocation.guardReply?.(() => current.current() && live(context) && authorized() && owned(context) && current.fence());
        return jsonRpcParamsSchema.parse(current.status);
      },
      "x-ahp/tools/resume": (params, context, invocation) => {
        requireLive(context, invocation);
        parseToolWire(toolResumeRequestSchema, params);
        return { version: 2, status: "denied", code: "unsupported" };
      },
    },
    negotiated: (context) => owned(context),
    forget(context, channel) {
      for (const view of [...(views.get(context)?.values() ?? [])]) if (channel === undefined || view.channel === channel) drop(view);
      if (channel === undefined) {
        peers.delete(context);
        negotiating.delete(context);
        calls.forget(context);
      }
    },
    removeSession(channel) {
      for (const ownViews of [...views.values()]) for (const view of [...ownViews.values()]) if (view.channel === channel) drop(view);
    },
    dispose() {
      if (closed) return;
      closed = true;
      unsubscribe();
      calls.dispose();
      for (const ownViews of [...views.values()]) for (const view of [...ownViews.values()]) drop(view);
      peers.clear();
      negotiating.clear();
      for (const controller of activeControllers) controller.abort();
    },
  };
}

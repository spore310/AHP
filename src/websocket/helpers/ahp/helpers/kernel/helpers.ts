import {
  AhpErrorCodes,
  JsonRpcErrorCodes,
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ActionEnvelope,
  type InitializeResult,
  type RootState,
  type Snapshot,
} from "@microsoft/agent-host-protocol";

import {
  JSONRPC_VERSION,
  jsonRpcParamsSchema,
  parseUnknownJson,
  RpcError,
  type JsonRpcMessage,
  type JsonRpcParams,
} from "@jsonrpc";
import type { SessionsFactory } from "@sessions/types";
import type { SessionOwnerRegistry } from "@work";
import type {
  JsonRpcHandler,
  JsonRpcHandlers,
  JsonRpcInvocation,
  WebSocketConnectionContext,
  WebSocketDispatchContext,
} from "@websocket/types";
import {
  AHP_NOTIFICATION_METHODS,
  AHP_REQUEST_METHODS,
  CLIENT_SESSION_ACTION_NAMES,
  PENDING_DELIVERY_LIMIT,
  ROOT_SCHEME,
  SESSION_SCHEME,
  TOOL_CALL_METHOD,
  TOOL_COMPLETE_METHOD,
} from "@websocket/helpers/ahp/constants";
import { createAgentWorkExtension, mapWorkError } from "@websocket/helpers/ahp/agentWork";
import { createToolInvocationBroker } from "@websocket/helpers/ahp/toolInvocation";
import { createProtectedViewDelivery } from "@websocket/helpers/ahp/helpers/views/helpers";
import type { ResourceViewProof } from "@toolExecution/helpers/views";
import { isSettlingSession } from "@websocket/helpers/settling";
import {
  channelParamsSchema,
  dispatchActionParamsSchema,
  initializeParamsSchema,
  type AHPBindingOptions,
  type AHPDiagnostic,
  type AHPPeer,
  type ChannelAdapter,
} from "@websocket/helpers/ahp/types";

const toParams = (value: unknown): JsonRpcParams => (
  jsonRpcParamsSchema.parse(parseUnknownJson(JSON.stringify(value)))
);

const actionNotification = (envelope: ActionEnvelope): JsonRpcMessage => ({
  jsonrpc: JSONRPC_VERSION,
  method: "action",
  params: toParams(envelope),
});

const catalogueNotification = (method: string, params: unknown): JsonRpcMessage => ({
  jsonrpc: JSONRPC_VERSION,
  method,
  params: toParams(params),
});

const uniqueUris = (uris: readonly string[]): string[] => [...new Set(uris)];
const isInitializing = (peer: AHPPeer): boolean => peer.phase === "initializing";

const assertBaselinePayload = (action: Record<string, unknown>): void => {
  if (action.type === "session/titleChanged" && typeof action.title !== "string") {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction params");
  }
  if (action.type === "session/isReadChanged" && typeof action.isRead !== "boolean") {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction params");
  }
  if (action.type === "session/isArchivedChanged" && typeof action.isArchived !== "boolean") {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction params");
  }
  if (!CLIENT_SESSION_ACTION_NAMES.has(String(action.type))) {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction params");
  }
};

export interface AHPBinding {
  readonly handlers: JsonRpcHandlers;
  isToolCompletion(params: unknown, context: WebSocketConnectionContext): boolean;
  onConnection(context: WebSocketConnectionContext): void;
  beforeDispatch(dispatch: WebSocketDispatchContext): void;
  dispose(): void;
  drainTools(): Promise<{ readonly draining: number }>;
  toolStats(): { readonly active: number; readonly draining: number; readonly retainedOutputBytes: number };
}

const NOOP_SESSION_OWNERS: SessionOwnerRegistry = {
  bind: (): void => undefined,
  owner: (): string | undefined => undefined,
  unbind: (): void => undefined,
  clear: (): void => undefined,
};

/** Internal canonical compatibility kernel; never exported by supported barrels. */
export const createAHPKernel = (
  factory: SessionsFactory,
  reportDiagnostic: (diagnostic: AHPDiagnostic) => void = () => undefined,
  options?: AHPBindingOptions,
): AHPBinding => {
  const peers = new Map<string, AHPPeer>();
  const adapters: ChannelAdapter[] = [];
  let disposed = false;

  const extension = options === undefined
    ? undefined
    : createAgentWorkExtension({
        agents: options.agents,
        work: options.work,
        sessionOwners: options.ownerLookup ?? options.sessionOwners ?? NOOP_SESSION_OWNERS,
      });

  const registerAdapter = (adapter: ChannelAdapter): void => {
    if (adapters.some((existing) => existing.scheme === adapter.scheme)) {
      throw new Error(`Duplicate channel scheme: ${adapter.scheme}`);
    }
    adapters.push(adapter);
  };

  const failPeer = (peer: AHPPeer): void => {
    if (peer.phase === "closed") {
      return;
    }
    peer.phase = "closing";
    peer.pending.clear();
    reportDiagnostic({ event: "publicationFailed", connectionId: peer.context.connectionId });
    peer.context.close();
  };

  const sendToPeer = (peer: AHPPeer, message: JsonRpcMessage): void => {
    if (peer.phase === "closed" || peer.phase === "closing") {
      return;
    }
    try {
      if (protectedDelivery !== undefined) {
        protectedDelivery.enqueue(peer, message);
        return;
      }
      if (!peer.context.send(message)) {
        failPeer(peer);
      }
    } catch {
      failPeer(peer);
    }
  };

  const publish = (
    channel: string,
    message: JsonRpcMessage,
    originClientId?: string,
  ): void => {
    try {
      protectedDelivery?.capture(channel, message);
    } catch {
      for (const peer of peers.values()) if (peer.subscriptions.has(channel) || peer.pending.has(channel)) failPeer(peer);
      return;
    }
    for (const peer of peers.values()) {
      if (originClientId !== undefined && peer.clientId !== originClientId) {
        continue;
      }
      const buffer = peer.pending.get(channel);
      if (buffer !== undefined) {
        if (protectedDelivery !== undefined && !protectedDelivery.buffer(peer, message)) continue;
        if (buffer.length >= PENDING_DELIVERY_LIMIT) {
          failPeer(peer);
          continue;
        }
        buffer.push(message);
        continue;
      }
      if (peer.subscriptions.has(channel)) {
        sendToPeer(peer, message);
      }
    }
  };

  const snapshotForUri = (uri: string): Snapshot => {
    const adapter = adapters.find((candidate) => candidate.matches(uri));
    if (adapter === undefined) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, `Invalid channel: ${uri}`);
    }
    return adapter.snapshot(uri);
  };

  const buildRootSnapshot = (): Snapshot => ({
    resource: ROOT_SCHEME,
    state: {
      agents: factory.listAgents(),
      activeSessions: factory.listSessionSnapshots().length,
    } satisfies RootState,
    fromSeq: factory.getCurrentServerSeq(),
  });

  registerAdapter({
    scheme: ROOT_SCHEME,
    matches: (uri: string): boolean => uri === ROOT_SCHEME,
    snapshot: (): Snapshot => buildRootSnapshot(),
  });
  registerAdapter({
    scheme: SESSION_SCHEME,
    matches: (uri: string): boolean => uri.startsWith(SESSION_SCHEME),
    snapshot: (uri: string): Snapshot => {
      const snapshot = factory.getSessionSnapshot(uri);
      if (snapshot === undefined) {
        throw new RpcError(AhpErrorCodes.SessionNotFound, `Session not found: ${uri}`);
      }
      return snapshot;
    },
  });

  const requirePeer = (context: WebSocketConnectionContext): AHPPeer => {
    const peer = peers.get(context.connectionId);
    if (peer === undefined || peer.phase === "closed") {
      throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection not initialized");
    }
    return peer;
  };

  const toolInvocations = createToolInvocationBroker(factory, peers, requirePeer, options?.toolExecution);
  const protectedDelivery = options?.protectedViews === undefined ? undefined : createProtectedViewDelivery(factory, options.protectedViews, failPeer);

  const beginPending = (peer: AHPPeer, uri: string): void => {
    if (!peer.pending.has(uri)) {
      peer.pending.set(uri, []);
    }
  };

  const discardPending = (peer: AHPPeer, uris: readonly string[]): void => {
    for (const uri of uris) {
      peer.pending.delete(uri);
    }
  };

  const commitPending = (peer: AHPPeer, uris: readonly string[]): void => {
    for (const uri of uris) {
      const buffered = peer.pending.get(uri) ?? [];
      peer.pending.delete(uri);
      peer.subscriptions.add(uri);
      for (const message of buffered) {
        sendToPeer(peer, message);
      }
    }
  };

  const unsubscribeCatalogue = factory.onCatalogueNotification((notification) => {
    protectedDelivery?.changed();
    const message = catalogueNotification(notification.method, notification.params);
    publish(ROOT_SCHEME, message);
    if (notification.method !== "root/sessionRemoved") {
      return;
    }
    const session = notification.params.session;
    toolInvocations.removeSession(session);
    for (const peer of peers.values()) {
      const subscribedToSession = peer.subscriptions.has(session) || peer.pending.has(session);
      if (protectedDelivery !== undefined && subscribedToSession) {
        failPeer(peer);
      }
      if (subscribedToSession && !peer.subscriptions.has(ROOT_SCHEME)) {
        sendToPeer(peer, message);
      }
      peer.subscriptions.delete(session);
      peer.pending.delete(session);
    }
  });
  const unsubscribeEnvelopes = factory.onSessionEnvelope((envelope: ActionEnvelope) => {
    if (envelope.rejectionReason !== undefined) {
      return;
    }
    protectedDelivery?.changed();
    toolInvocations.observeEnvelope(envelope);
    publish(envelope.channel, actionNotification(envelope));
  });

  const baselineHandlers: Record<string, JsonRpcHandler> = {
    initialize: (params: unknown, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): InitializeResult => {
      const peer = requirePeer(context);
      if (peer.phase !== "new") {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection already initialized");
      }
      peer.phase = "initializing";
      try {
        const parsed = initializeParamsSchema.parse(params);
        const negotiated = negotiateProtocolVersion(parsed.protocolVersions);
        if (negotiated === undefined) {
          peer.phase = "closing";
          invocation.onReplySettled((settlement) => {
            if (settlement.responseSent || peer.phase === "closing") {
              peer.context.close();
            }
          });
          throw new RpcError(
            AhpErrorCodes.UnsupportedProtocolVersion,
            "Unsupported protocol version",
            { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] },
          );
        }

        const uris = uniqueUris(parsed.initialSubscriptions ?? []);
        const snapshots: Snapshot[] = [];
        for (const uri of uris) {
          beginPending(peer, uri);
          try {
            snapshots.push(snapshotForUri(uri));
          } catch (error) {
            discardPending(peer, uris);
            peer.phase = "new";
            throw error;
          }
        }

        invocation.onReplySettled((settlement) => {
          const commit = settlement.outcome === "success"
            && settlement.responseSent
            && peer.phase === "initializing";
          if (commit) {
            peer.clientId = parsed.clientId;
            peer.protocolVersion = negotiated;
            peer.phase = "ready";
            commitPending(peer, uris);
            return;
          }
          discardPending(peer, uris);
          if (peer.phase === "initializing") {
            peer.phase = "new";
          }
        });

        return {
          protocolVersion: negotiated,
          serverSeq: factory.getCurrentServerSeq(),
          snapshots,
        };
      } catch (error) {
        if (peer.phase === "initializing") {
          peer.phase = "new";
        }
        throw error;
      }
    },

    ping: (params: unknown, context: WebSocketConnectionContext): null => {
      requirePeer(context);
      const parsed = channelParamsSchema.parse(params);
      if (parsed.channel !== ROOT_SCHEME) {
        throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid ping channel");
      }
      return null;
    },

    subscribe: (params: unknown, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): { snapshot: Snapshot } => {
      const peer = requirePeer(context);
      const parsed = channelParamsSchema.parse(params);
      if (peer.subscriptions.has(parsed.channel)) {
        return { snapshot: snapshotForUri(parsed.channel) };
      }
      beginPending(peer, parsed.channel);
      let snapshot: Snapshot;
      try {
        snapshot = snapshotForUri(parsed.channel);
      } catch (error) {
        discardPending(peer, [parsed.channel]);
        throw error;
      }
      invocation.onReplySettled((settlement) => {
        const commit = settlement.outcome === "success" && settlement.responseSent && peer.phase === "ready";
        if (commit) {
          commitPending(peer, [parsed.channel]);
          return;
        }
        discardPending(peer, [parsed.channel]);
      });
      return { snapshot };
    },

    unsubscribe: (params: unknown, context: WebSocketConnectionContext): null => {
      const peer = requirePeer(context);
      const parsed = channelParamsSchema.parse(params);
      peer.subscriptions.delete(parsed.channel);
      peer.pending.delete(parsed.channel);
      protectedDelivery?.unsubscribe(peer, parsed.channel);
      toolInvocations.unsubscribe(peer, parsed.channel);
      return null;
    },

    createSession: async (params: unknown, context: WebSocketConnectionContext): Promise<null> => {
      requirePeer(context);
      const parsed = channelParamsSchema.safeParse(params);
      const { principal } = context;
      // Fail closed before touching live state when another principal already
      // holds the owner binding. Creating first would leave the caller with a
      // live record its true owner can neither bind nor dispose.
      const sessionOwners = options?.sessionOwners;
      if (sessionOwners !== undefined && parsed.success) {
        const owner = sessionOwners.owner(parsed.data.channel);
        if (owner !== undefined
          && (principal === undefined
            || owner !== principal.subject
            || isSettlingSession(sessionOwners, factory, parsed.data.channel))) {
          throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Session not found");
        }
      }
      // The owner binding is acquired at the record-attach moment — while this
      // call still owns its record — instead of after the factory resolves: a
      // create whose record is removed while its backend is still starting
      // (its own dispose, or another connection of the same principal) must
      // never bind a late resolution onto the URI, or it would claim a foreign
      // successor or strand a binding no settle can release.
      const onRecordCreated = parsed.success && principal !== undefined && sessionOwners !== undefined
        ? (sessionUri: string): void => {
            try {
              sessionOwners.bind(sessionUri, principal.subject);
            } catch (error) {
              // Unreachable through the shipped probe: a cross-subject
              // incumbent at attach time contradicts the pre-check above.
              // Fail the create as a typed conflict instead of leaving an
              // unowned record behind.
              mapWorkError(error);
            }
          }
        : undefined;
      await factory.createSession(params, onRecordCreated);
      if (parsed.success && sessionOwners !== undefined) {
        // The creation is still the caller's to own only if the live record
        // survived and its binding is not another principal's; a late-detached
        // resolution (record gone while the backend was starting) or a URI now
        // owned by a foreign successor answers conflict rather than a success
        // the caller could then rely on. A same-principal successor attach
        // resolves success under one identity — the deferred same-owner
        // residual documented in `src/work/README.md`.
        const owner = sessionOwners.owner(parsed.data.channel);
        const ownedByCaller = principal === undefined
          ? owner === undefined
          : owner === principal.subject;
        if (!ownedByCaller
          || factory.getSessionSnapshot(parsed.data.channel) === undefined) {
          throw new RpcError(AhpErrorCodes.Conflict, "The created session is no longer available.");
        }
      }
      return null;
    },

    disposeSession: async (params: unknown, context: WebSocketConnectionContext): Promise<null> => {
      requirePeer(context);
      const parsed = channelParamsSchema.parse(params);
      try {
        const owner = options?.sessionOwners?.owner(parsed.channel);
        if (owner !== undefined
          && (context.principal === undefined || owner !== context.principal.subject)) {
          throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Session not found");
        }
        await options?.work?.assertSessionDisposable(parsed.channel);
      } catch (error) {
        mapWorkError(error);
      }
      try {
        await factory.disposeSession(params);
      } finally {
        // Removal from the sessions registry is the authoritative release
        // point for the owner binding: it must survive backend disposal
        // failures, which resolve after the record is already gone.
        options?.sessionOwners?.unbind(parsed.channel);
      }
      return null;
    },

    listSessions: (params: unknown, context: WebSocketConnectionContext) => {
      requirePeer(context);
      return factory.listSessions(params);
    },

    [TOOL_CALL_METHOD]: (params: unknown, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): Promise<unknown> => toolInvocations.call(params, context, invocation),

    [TOOL_COMPLETE_METHOD]: (params: unknown, context: WebSocketConnectionContext): null => toolInvocations.complete(params, context),

    dispatchAction: async (params: unknown, context: WebSocketConnectionContext): Promise<null> => {
      const peer = requirePeer(context);
      let parsed: ReturnType<typeof dispatchActionParamsSchema.parse>;
      try {
        parsed = dispatchActionParamsSchema.parse(params);
        assertBaselinePayload(parsed.action);
      } catch (error) {
        reportDiagnostic({ event: "malformedNotification", method: "dispatchAction" });
        throw error;
      }
      if (peer.clientId === undefined) {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection not initialized");
      }
      const advertisement = await toolInvocations.prepareAdvertisement(peer, parsed.channel, parsed.action);
      try {
        const envelope = factory.dispatchAction({
          channel: parsed.channel,
          clientSeq: parsed.clientSeq,
          action: parsed.action,
          clientId: peer.clientId,
          ...(advertisement === undefined ? {} : { admission: advertisement.current.bind(advertisement) }),
        });
        if (envelope.rejectionReason !== undefined) {
          sendToPeer(peer, actionNotification(envelope));
        } else {
          advertisement?.activate(envelope.serverSeq);
        }
        return null;
      } finally {
        advertisement?.release();
      }
    },
  };

  const handlers: Record<string, JsonRpcHandler> = { ...baselineHandlers };
  if (protectedDelivery !== undefined) {
    handlers.initialize = async (params, context, invocation): Promise<InitializeResult> => {
      const peer = requirePeer(context);
      if (peer.phase !== "new" || invocation.guardReply === undefined) throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      peer.phase = "initializing";
      const uris: string[] = [];
      try {
        const parsed = initializeParamsSchema.parse(params);
        const negotiated = negotiateProtocolVersion(parsed.protocolVersions);
        if (negotiated === undefined) throw new Error("Unsupported protocol");
        uris.push(...uniqueUris(parsed.initialSubscriptions ?? []));
        if (uris.length > 128) throw new Error("View subscription limit");
        for (const uri of uris) beginPending(peer, uri);
        const proofs: ResourceViewProof<Snapshot>[] = [];
        for (const uri of uris) proofs.push(await protectedDelivery.snapshot(peer, uri));
        invocation.guardReply(() => peer.phase === "initializing" && protectedDelivery.current(peer, proofs));
        invocation.onReplySettled((settlement) => {
          if (settlement.outcome === "success" && settlement.responseSent && peer.phase === "initializing") {
            peer.clientId = parsed.clientId;
            peer.protocolVersion = negotiated;
            peer.phase = "ready";
            protectedDelivery.committed(peer, proofs);
            commitPending(peer, uris);
          } else {
            discardPending(peer, uris);
            if (isInitializing(peer)) peer.phase = "new";
          }
        });
        return { protocolVersion: negotiated, serverSeq: factory.getCurrentServerSeq(), snapshots: proofs.map((proof) => proof.value) };
      } catch {
        discardPending(peer, uris);
        if (isInitializing(peer)) peer.phase = "new";
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      }
    };
    handlers.subscribe = async (params, context, invocation) => {
      const peer = requirePeer(context);
      const parsed = channelParamsSchema.parse(params);
      if (!peer.subscriptions.has(parsed.channel) && peer.subscriptions.size >= 128) throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      if (invocation.guardReply === undefined) throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      const replacing = peer.subscriptions.has(parsed.channel);
      beginPending(peer, parsed.channel);
      try {
        const proof = await protectedDelivery.snapshot(peer, parsed.channel);
        invocation.guardReply(() => peer.phase === "ready" && peer.pending.has(parsed.channel) && protectedDelivery.current(peer, [proof]));
        invocation.onReplySettled((settlement) => {
          if (settlement.outcome === "success" && settlement.responseSent && peer.phase === "ready") {
            protectedDelivery.committed(peer, [proof]);
            commitPending(peer, [parsed.channel]);
          } else {
            discardPending(peer, [parsed.channel]);
            if (replacing) failPeer(peer);
          }
        });
        return { snapshot: proof.value };
      } catch {
        discardPending(peer, [parsed.channel]);
        if (replacing) invocation.onReplySettled(() => {
          failPeer(peer);
        });
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      }
    };
    handlers.listSessions = async (params, context, invocation) => {
      const peer = requirePeer(context);
      if (invocation.guardReply === undefined) throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Protected view unavailable");
      const proof = await protectedDelivery.list(peer, params);
      invocation.guardReply(() => peer.phase === "ready" && protectedDelivery.current(peer, [proof]));
      return proof.value;
    };
  }
  for (const [method, handler] of Object.entries(extension?.handlers ?? {})) {
    // Baseline methods are authoritative and cannot be overridden by the
    // optional authenticated extension.
    if (!Object.hasOwn(handlers, method)) {
      handlers[method] = handler;
    }
  }

  return {
    handlers,
    drainTools: toolInvocations.drain,
    toolStats: toolInvocations.stats,
    isToolCompletion: (params: unknown, context: WebSocketConnectionContext): boolean => (
      toolInvocations.isCompletion(params, context)
    ),
    onConnection: (context: WebSocketConnectionContext): void => {
      if (disposed) {
        context.close();
        return;
      }
      const peer: AHPPeer = {
        phase: "new",
        subscriptions: new Set<string>(),
        pending: new Map<string, JsonRpcMessage[]>(),
        context,
        closeNotified: false,
      };
      peers.set(context.connectionId, peer);
      context.onClose(() => {
        if (peer.closeNotified) {
          return;
        }
        peer.closeNotified = true;
        peer.phase = "closed";
        protectedDelivery?.remove(peer);
        toolInvocations.removeConnection(context.connectionId);
        extension?.onConnectionClose(context.connectionId);
        peer.pending.clear();
        peer.subscriptions.clear();
        peers.delete(context.connectionId);
      });
    },
    beforeDispatch: (dispatch: WebSocketDispatchContext): void => {
      const peer = peers.get(dispatch.context.connectionId);
      if (peer === undefined || peer.phase === "closed" || peer.phase === "closing") {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection is closing");
      }
      if (peer.phase !== "ready" && dispatch.method !== "initialize") {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection not initialized");
      }
      if (AHP_REQUEST_METHODS.has(dispatch.method) && dispatch.kind !== "request") {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Invalid method kind");
      }
      if (AHP_NOTIFICATION_METHODS.has(dispatch.method) && dispatch.kind !== "notification") {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Invalid method kind");
      }
      if (dispatch.method === "initialize" && peer.phase !== "new") {
        throw new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection already initialized");
      }
    },
    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      try {
        unsubscribeCatalogue();
      } catch {
        // Continue releasing the other binding resources.

      }
      try {
        unsubscribeEnvelopes();
      } catch {
        // Continue releasing peers even if one unsubscribe fails.

      }
      toolInvocations.dispose();
      protectedDelivery?.dispose();
      for (const peer of [...peers.values()]) {
        extension?.onConnectionClose(peer.context.connectionId);
        peer.phase = "closed";
        peer.pending.clear();
        peer.subscriptions.clear();
      }
      extension?.dispose();
      peers.clear();
    },
  };
};

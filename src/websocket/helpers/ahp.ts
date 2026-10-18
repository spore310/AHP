import {
  AhpErrorCodes,
  JsonRpcErrorCodes,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  type ActionEnvelope,
  type InitializeResult,
  type RootState,
  type SessionAction,
  type Snapshot,
} from "@microsoft/agent-host-protocol";

import { RpcError, type JsonRpcParams } from "@jsonrpc";
import { ROOT_CHANNEL_URI } from "@sessions/constants";
import type { SessionsFactory } from "@sessions/types";
import type { JsonRpcHandler, JsonRpcHandlers, WebSocketConnectionContext } from "../types";

interface ConnectionState {
  subscriptions: Set<string>;
  clientId?: string;
  protocolVersion?: string;
  initialized: boolean;
}

const getConnectionState = (context: WebSocketConnectionContext): WebSocketConnectionContext & ConnectionState => {
  const state = context as WebSocketConnectionContext & Partial<ConnectionState>;
  if (state.subscriptions === undefined) {
    state.subscriptions = new Set<string>();
  }
  if (state.initialized === undefined) {
    state.initialized = false;
  }
  return state as WebSocketConnectionContext & ConnectionState;
};

const readString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, `Invalid ${field}`);
  }
  return value;
};

const CLIENT_DISPATCHABLE_ACTIONS = new Set<string>([
  "session/titleChanged",
  "session/activeClientSet",
  "session/activeClientRemoved",
  "session/workingDirectorySet",
  "session/workingDirectoryRemoved",
  "session/workingDirectoryReplaced",
  "session/customizationToggled",
  "session/mcpServerStartRequested",
  "session/mcpServerStopRequested",
  "session/mcpServerBackgroundRequested",
  "session/isReadChanged",
  "session/isArchivedChanged",
  "session/configChanged",
]);

const buildRootSnapshot = (factory: SessionsFactory): Snapshot => ({
  resource: ROOT_CHANNEL_URI,
  state: {
    agents: factory.listAgents(),
    activeSessions: factory.listSessionSnapshots().length,
  } satisfies RootState,
  fromSeq: factory.getCurrentServerSeq(),
});

const snapshotForUri = (factory: SessionsFactory, uri: string): Snapshot => {
  if (uri === ROOT_CHANNEL_URI) {
    return buildRootSnapshot(factory);
  }

  const snapshot = factory.getSessionSnapshot(uri);
  if (snapshot === undefined) {
    throw new RpcError(AhpErrorCodes.SessionNotFound, `Session not found: ${uri}`);
  }
  return snapshot;
};

const subscribeConnection = (factory: SessionsFactory, context: WebSocketConnectionContext, uri: string): Snapshot => {
  const state = getConnectionState(context);
  state.subscriptions.add(uri);
  return snapshotForUri(factory, uri);
};

const normalizeInitialSubscriptions = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid initialSubscriptions");
  }
  return value.map((uri) => readString(uri, "initialSubscriptions entry"));
};

const createRootHandlers = (factory: SessionsFactory): Record<string, JsonRpcHandler> => ({
  initialize: (params: unknown, context: WebSocketConnectionContext): InitializeResult => {
    const request = params as Record<string, unknown>;
    const requestedChannel = request.channel;
    if (requestedChannel !== ROOT_CHANNEL_URI) {
      const channelText = requestedChannel === undefined
        ? "undefined"
        : typeof requestedChannel === "string"
          ? requestedChannel
          : JSON.stringify(requestedChannel);
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, `Invalid channel: ${channelText}`);
    }

    const clientId = readString(request.clientId, "clientId");
    const protocolVersions = Array.isArray(request.protocolVersions)
      ? request.protocolVersions.map((version) => readString(version, "protocolVersions entry"))
      : [];

    const negotiatedVersion = negotiateProtocolVersion(protocolVersions);
    if (negotiatedVersion === undefined) {
      throw new RpcError(
        AhpErrorCodes.UnsupportedProtocolVersion,
        "Unsupported protocol version",
        { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] },
      );
    }

    const state = getConnectionState(context);
    state.clientId = clientId;
    state.protocolVersion = negotiatedVersion;
    state.initialized = true;
    state.subscriptions.clear();

    const initialSubscriptions = normalizeInitialSubscriptions(request.initialSubscriptions);
    const snapshots: Snapshot[] = [];
    for (const uri of initialSubscriptions) {
      snapshots.push(subscribeConnection(factory, context, uri));
    }

    return {
      protocolVersion: negotiatedVersion,
      serverSeq: factory.getCurrentServerSeq(),
      snapshots,
      serverInfo: {
        name: "AHP Host",
        version: PROTOCOL_VERSION,
      },
    };
  },

  ping: (params: unknown): null => {
    const request = params as Record<string, unknown>;
    if (request.channel !== ROOT_CHANNEL_URI) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid ping channel");
    }
    return null;
  },

  subscribe: (params: unknown, context: WebSocketConnectionContext): { snapshot?: Snapshot } => {
    const request = params as Record<string, unknown>;
    const uri = readString(request.channel, "channel");
    const snapshot = subscribeConnection(factory, context, uri);
    return { snapshot };
  },

  unsubscribe: (params: unknown, context: WebSocketConnectionContext): null => {
    const request = params as Record<string, unknown>;
    const uri = readString(request.channel, "channel");
    getConnectionState(context).subscriptions.delete(uri);
    return null;
  },

  createSession: async (params: unknown): Promise<null> => {
    await factory.createSession(params);
    return null;
  },

  dispatchAction: (params: unknown, context: WebSocketConnectionContext): null => {
    const request = params as Record<string, unknown>;
    const channel = readString(request.channel, "channel");
    const clientSeq = Number(request.clientSeq);
    const action = request.action;
    if (
      !Number.isInteger(clientSeq)
      || typeof action !== "object"
      || action === null
      || !("type" in action)
      || typeof action.type !== "string"
      || !CLIENT_DISPATCHABLE_ACTIONS.has(action.type)
    ) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction params");
    }

    const state = getConnectionState(context);
    const clientId = state.clientId ?? "unknown-client";
    const envelope = factory.dispatchAction({
      channel,
      clientSeq,
      action: action as SessionAction,
      clientId,
    });

    if (state.subscriptions.has(channel)) {
      context.send({
        jsonrpc: "2.0",
        method: "action",
        params: envelope,
      } as never);
    }
    return null;
  },
});

export const createAHPHandlers = (factory: SessionsFactory): JsonRpcHandlers => {
  const handlers = createRootHandlers(factory);
  const knownConnections = new Set<WebSocketConnectionContext & Partial<ConnectionState>>();

  const getKnownConnections = (): Array<WebSocketConnectionContext & Partial<ConnectionState>> => [...knownConnections];
  const capture = (context: WebSocketConnectionContext): void => {
    knownConnections.add(context);
  };
  const release = (context: WebSocketConnectionContext): void => {
    knownConnections.delete(context);
  };

  const unsubscribeCatalogue = factory.onCatalogueNotification((notification) => {
    for (const connection of getKnownConnections()) {
      if ((connection as Partial<ConnectionState>).subscriptions?.has(ROOT_CHANNEL_URI)) {
        connection.send({
          jsonrpc: "2.0",
          method: notification.method,
          params: notification.params,
        } as never);
      }
    }
  });

  const unsubscribeEnvelopes = factory.onSessionEnvelope((envelope: ActionEnvelope) => {
    for (const connection of getKnownConnections()) {
      if ((connection as Partial<ConnectionState>).subscriptions?.has(envelope.channel)) {
        connection.send({
          jsonrpc: "2.0",
          method: "action",
          params: envelope,
        } as never);
      }
    }
  });

  for (const method of Object.keys(handlers)) {
    const original = handlers[method];
    if (typeof original !== "function") {
      continue;
    }

    handlers[method] = (...args: [JsonRpcParams | undefined, WebSocketConnectionContext | undefined]): unknown => {
      const [params, context] = args;
      if (context !== undefined) {
        capture(context);
      }
      try {
        return original(params, context ?? ({
          connectionId: "",
          send: () => undefined,
        } satisfies WebSocketConnectionContext));
      } finally {
        if (context !== undefined) {
          release(context);
        }
      }
    };
  }

  return Object.assign(handlers, {
    __dispose: (): void => {
      unsubscribeCatalogue();
      unsubscribeEnvelopes();
    },
  });
};

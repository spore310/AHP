import { randomUUID } from "node:crypto";
import { z } from "zod";

import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import { jsonRpcParamsSchema, JSONRPC_VERSION, parseUnknownJson, RpcError, type JsonRpcMessage, type JsonRpcParams } from "@jsonrpc";
import type { SessionsFactory } from "@sessions/types";
import { TOOL_CONTRACT_META_KEY, createToolCatalogue, type ToolContractDefinition } from "@tools";
import type { WebSocketConnectionContext } from "../../types";
import { MAX_TOOL_PAYLOAD_BYTES, TOOL_INVOCATION_METHOD } from "./constants";
import type { AHPPeer } from "./types";

interface ExecutorAdvertisement {
  readonly clientId: string;
  readonly contracts: ReadonlySet<string>;
}

const toolCallParamsSchema = z.object({
  channel: z.string().min(1),
  key: z.string().min(1),
  version: z.number().int().positive(),
  input: z.unknown(),
}).strict();

const toolCompletionParamsSchema = z.object({
  callId: z.uuid(),
  channel: z.string().min(1),
  key: z.string().min(1),
  version: z.number().int().positive(),
  output: z.unknown().optional(),
  error: z.string().optional(),
}).strict().refine((value) => (value.output === undefined) !== (value.error === undefined));

function readAdvertisedContract(
  tool: { readonly _meta?: Readonly<Record<string, unknown>> },
): { readonly id: string; readonly key: string; readonly version: number } | undefined {
  const raw = tool._meta?.[TOOL_CONTRACT_META_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const meta = raw as Record<string, unknown>;
  if (typeof meta.id !== "string" || typeof meta.key !== "string"
    || typeof meta.version !== "number" || !Number.isSafeInteger(meta.version)) return undefined;
  return { id: meta.id, key: meta.key, version: meta.version };
}

function contractIdentity(id: string, key: string, version: number): string {
  return `${id}\\u0000${key}\\u0000${String(version)}`;
}

function toParams(value: unknown): JsonRpcParams {
  return jsonRpcParamsSchema.parse(parseUnknownJson(JSON.stringify(value)));
}

function assertBoundedPayload(value: unknown): void {
  if (value === undefined) throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool payload must be JSON");
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool payload must be JSON");
  }
  if (Buffer.byteLength(serialized) > MAX_TOOL_PAYLOAD_BYTES) {
    throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool payload exceeds the size limit");
  }
}

export function createToolInvocationBroker(
  factory: SessionsFactory,
  peers: ReadonlyMap<string, AHPPeer>,
  requirePeer: (context: WebSocketConnectionContext) => AHPPeer,
) {
  type Manifest = NonNullable<ReturnType<SessionsFactory["getSessionToolManifest"]>>;
  type Catalogue = ReturnType<typeof createToolCatalogue>;
  const advertisements = new Map<string, Map<string, ExecutorAdvertisement>>();
  const catalogueCache = new Map<string, Catalogue>();
  const pendingCalls = new Map<string, {
    readonly callerConnectionId: string;
    readonly executorConnectionId: string;
    readonly channel: string;
    readonly key: string;
    readonly version: number;
    readonly contract: Manifest["toolContracts"][number];
    readonly catalogue: Catalogue;
    readonly timer: ReturnType<typeof setTimeout>;
    reject(error: Error): void;
    resolve(value: unknown): void;
  }>();

  const catalogueForManifest = (manifest: Manifest): Catalogue => {
    const identity = contractIdentity(manifest.sessionType.id, manifest.sessionType.key, manifest.sessionType.version);
    const cached = catalogueCache.get(identity);
    if (cached !== undefined) return cached;
    const definitions: ToolContractDefinition[] = manifest.toolContracts.map((tool) => ({
      id: tool.id,
      key: tool.key,
      version: tool.version,
      schemaDialect: tool.schemaDialect,
      ...tool.definition,
    }));
    const catalogue = createToolCatalogue({ definitions });
    catalogueCache.set(identity, catalogue);
    return catalogue;
  };

  const rejectPending = (callId: string, message: string): void => {
    const pending = pendingCalls.get(callId);
    if (pending === undefined) return;
    pendingCalls.delete(callId);
    clearTimeout(pending.timer);
    pending.reject(new RpcError(JsonRpcErrorCodes.InternalError, message));
  };

  const call = async (params: unknown, context: WebSocketConnectionContext): Promise<unknown> => {
    const caller = requirePeer(context);
    const request = toolCallParamsSchema.parse(params);
    if (!caller.subscriptions.has(request.channel)) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool caller must subscribe to the session");
    }
    if (pendingCalls.size >= 64) throw new RpcError(JsonRpcErrorCodes.InternalError, "Tool invocation capacity reached");
    const manifest = factory.getSessionToolManifest(request.channel);
    if (manifest === undefined) throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool invocation requires a typed session");
    const contract = manifest.toolContracts.find((candidate) => candidate.key === request.key && candidate.version === request.version);
    if (contract === undefined) throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool is not allowed for this session");
    assertBoundedPayload(request.input);
    const contractRef = { key: request.key, version: request.version };
    const catalogue = catalogueForManifest(manifest);
    if (catalogue.validateInput(contractRef, request.input).status !== "valid") {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool input does not match its contract");
    }
    const snapshot = factory.getSessionSnapshot(request.channel);
    const activeClients = snapshot?.state.activeClients ?? [];
    const connectedIdCounts = new Map<string, number>();
    for (const peer of peers.values()) {
      if (peer.phase === "ready" && peer.clientId !== undefined) {
        connectedIdCounts.set(peer.clientId, (connectedIdCounts.get(peer.clientId) ?? 0) + 1);
      }
    }
    const identity = contractIdentity(contract.id, request.key, request.version);
    const candidates = [...peers.values()].filter((peer) => {
      if (peer.phase !== "ready" || peer.clientId === undefined || connectedIdCounts.get(peer.clientId) !== 1
        || !peer.subscriptions.has(request.channel)) return false;
      const owner = advertisements.get(peer.context.connectionId)?.get(request.channel);
      if (owner?.clientId !== peer.clientId || !owner.contracts.has(identity)) return false;
      return activeClients.some((active) => active.clientId === peer.clientId
        && active.tools.some((tool) => {
          const advertised = readAdvertisedContract(tool);
          return advertised?.id === contract.id && advertised.key === request.key && advertised.version === request.version;
        }));
    });
    const [executor] = candidates;
    if (executor === undefined || candidates.length !== 1) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, "No unique connected tool executor is available");
    }
    const callId = randomUUID();
    const message: JsonRpcMessage = {
      jsonrpc: JSONRPC_VERSION,
      method: TOOL_INVOCATION_METHOD,
      params: toParams({ callId, channel: request.channel, key: request.key, version: request.version, input: request.input }),
    };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        rejectPending(callId, "Tool invocation timed out");
      }, 30_000);
      pendingCalls.set(callId, {
        callerConnectionId: caller.context.connectionId,
        executorConnectionId: executor.context.connectionId,
        channel: request.channel,
        key: request.key,
        version: request.version,
        contract,
        catalogue,
        timer,
        resolve,
        reject,
      });
      if (!executor.context.send(message)) rejectPending(callId, "Tool executor disconnected");
    });
  };

  const complete = (params: unknown, context: WebSocketConnectionContext): null => {
    const peer = requirePeer(context);
    const completion = toolCompletionParamsSchema.parse(params);
    const pending = pendingCalls.get(completion.callId);
    if (pending === undefined) return null;
    if (pending.executorConnectionId !== context.connectionId || pending.channel !== completion.channel
      || pending.key !== completion.key || pending.version !== completion.version) {
      throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool completion does not match the pending invocation");
    }
    pendingCalls.delete(completion.callId);
    clearTimeout(pending.timer);
    if (completion.error !== undefined) {
      pending.reject(new RpcError(JsonRpcErrorCodes.InternalError, "Tool execution failed"));
      return null;
    }
    try {
      assertBoundedPayload(completion.output);
    } catch {
      pending.reject(new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool output exceeds the JSON payload limit"));
      return null;
    }
    const status = pending.catalogue.validateOutput(
      { key: pending.contract.key, version: pending.contract.version }, completion.output,
    ).status;
    if (status !== "valid" && status !== "schema-not-declared") {
      pending.reject(new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool output does not match its contract"));
      return null;
    }
    if (peer.clientId === undefined) {
      pending.reject(new RpcError(JsonRpcErrorCodes.InvalidRequest, "Connection not initialized"));
      return null;
    }
    pending.resolve(completion.output);
    return null;
  };

  const rememberAdvertisement = (peer: AHPPeer, channel: string, action: unknown): void => {
    if (factory.getSessionToolManifest(channel) === undefined || typeof action !== "object" || action === null) return;
    const candidate = action as Record<string, unknown>;
    if (candidate.type === "session/activeClientRemoved") {
      const clientId = candidate.clientId;
      for (const [connectionId, sessions] of advertisements) {
        if (sessions.get(channel)?.clientId === clientId) {
          sessions.delete(channel);
          if (sessions.size === 0) advertisements.delete(connectionId);
        }
      }
      return;
    }
    if (candidate.type !== "session/activeClientSet" || typeof candidate.activeClient !== "object"
      || candidate.activeClient === null || Array.isArray(candidate.activeClient)) return;
    const active = candidate.activeClient as Record<string, unknown>;
    if (typeof active.clientId !== "string" || active.clientId !== peer.clientId || !Array.isArray(active.tools)) return;
    const contracts = new Set<string>();
    for (const raw of active.tools) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
      const ref = readAdvertisedContract(raw as { readonly _meta?: Readonly<Record<string, unknown>> });
      if (ref !== undefined) contracts.add(contractIdentity(ref.id, ref.key, ref.version));
    }
    for (const [connectionId, sessions] of advertisements) {
      if (connectionId !== peer.context.connectionId && sessions.get(channel)?.clientId === peer.clientId) {
        sessions.delete(channel);
        if (sessions.size === 0) advertisements.delete(connectionId);
      }
    }
    const sessions = advertisements.get(peer.context.connectionId) ?? new Map<string, ExecutorAdvertisement>();
    sessions.set(channel, { clientId: active.clientId, contracts });
    advertisements.set(peer.context.connectionId, sessions);
  };

  const removeSession = (channel: string): void => {
    for (const [connectionId, sessions] of advertisements) {
      sessions.delete(channel);
      if (sessions.size === 0) advertisements.delete(connectionId);
    }
    for (const callId of pendingCalls.keys()) {
      if (pendingCalls.get(callId)?.channel === channel) rejectPending(callId, "Session ended during tool invocation");
    }
  };

  const removeConnection = (connectionId: string): void => {
    for (const [callId, pending] of pendingCalls) {
      if (pending.callerConnectionId === connectionId || pending.executorConnectionId === connectionId) {
        rejectPending(callId, "Tool invocation connection closed");
      }
    }
    advertisements.delete(connectionId);
  };

  return {
    call,
    complete,
    isCompletion(params: unknown, context: WebSocketConnectionContext): boolean {
      const peer = peers.get(context.connectionId);
      const parsed = toolCompletionParamsSchema.safeParse(params);
      if (peer?.phase !== "ready" || !parsed.success) return false;
      const pending = pendingCalls.get(parsed.data.callId);
      return pending !== undefined && pending.executorConnectionId === context.connectionId
        && pending.channel === parsed.data.channel && pending.key === parsed.data.key
        && pending.version === parsed.data.version;
    },
    rememberAdvertisement,
    unsubscribe(peer: AHPPeer, channel: string): void {
      const sessions = advertisements.get(peer.context.connectionId);
      sessions?.delete(channel);
      if (sessions?.size === 0) advertisements.delete(peer.context.connectionId);
    },
    removeSession,
    removeConnection,
    dispose(): void {
      for (const callId of pendingCalls.keys()) rejectPending(callId, "Tool invocation host shut down");
      advertisements.clear();
      catalogueCache.clear();
    },
  };
}

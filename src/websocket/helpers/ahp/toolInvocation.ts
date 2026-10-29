import { randomUUID } from "node:crypto";
import { z } from "zod";
import { JsonRpcErrorCodes, type ActionEnvelope, type ToolDefinition } from "@microsoft/agent-host-protocol";
import { jsonRpcParamsSchema, JSONRPC_VERSION, parseUnknownJson, RpcError, type JsonRpcMessage } from "@jsonrpc";
import type { SessionsFactory } from "@sessions/types";
import { ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET, ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED } from "@sessions/constants";
import { canonicalJsonEqual, toAhpToolDefinition, TOOL_CONTRACT_META_KEY } from "@tools";
import type { ExecutorRevision, ResourceRef } from "@authorization";
import { createClientToolDispatcher, type ClientToolBrokerOptions, type ClientToolProof, type ClientToolRegistration } from "@toolExecution/helpers/client/helpers/broker";
import type { ToolDispatchHandle } from "@toolExecution/helpers/dispatcher";
import type { ConnectionSecuritySnapshot } from "@websocket/helpers/security/types";
import type { JsonRpcInvocation, WebSocketConnectionContext } from "../../types";
import { TOOL_INVOCATION_METHOD } from "./constants";
import type { AHPPeer } from "./types";

const toolCallParamsSchema = z.strictObject({ channel: z.string().min(1).max(2048), key: z.string().min(1).max(256), version: z.int().positive(), input: z.unknown() });
const toolCompletionParamsSchema = z.strictObject({ callId: z.uuid(), channel: z.string().min(1).max(2048), key: z.string().min(1).max(256), version: z.int().positive(), output: z.unknown().optional(), error: z.string().max(4096).optional() })
  .refine((value) => (value.output === undefined) !== (value.error === undefined));
const unavailable = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool operation unavailable");
};

const sameDescriptor = (left: unknown, right: ToolDefinition): boolean => {
  if (typeof left !== "object" || left === null || Array.isArray(left) || Object.keys(left).length !== Object.keys(right).length) return false;
  return Object.entries(right).every(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(left, key);
    return descriptor !== undefined && "value" in descriptor && canonicalJsonEqual(descriptor.value, value);
  });
};
const sameTools = (left: readonly ToolDefinition[], right: readonly ToolDefinition[]): boolean => left.length === right.length
  && left.every((tool, index) => right[index] !== undefined && sameDescriptor(tool, right[index]));

interface Advertisement {
  readonly clientId: string;
  readonly origin: ResourceRef<"session">;
  readonly setup: ConnectionSecuritySnapshot;
  readonly entries: readonly { readonly registration: ClientToolRegistration; readonly executor: ExecutorRevision }[];
}
interface StagedAdvertisement {
  readonly channel: string;
  readonly clientId: string;
  readonly tools: readonly ToolDefinition[];
  sequence?: number;
  matches: boolean;
}

interface AdvertisementTicket {
  current(): boolean;
  activate(sequence: number): void;
  release(): void;
}

interface PendingCompletion {
  readonly context: WebSocketConnectionContext;
  readonly generation: number;
  readonly channel: string;
  readonly key: string;
  readonly version: number;
  resolve(output: unknown): void;
  reject(error: Error): void;
}

/** Sole transport correlation adapter. Missing canonical policy wiring fails closed. */
export function createToolInvocationBroker(factory: SessionsFactory, peers: ReadonlyMap<string, AHPPeer>,
  requirePeer: (context: WebSocketConnectionContext) => AHPPeer, options?: ClientToolBrokerOptions) {
  const authorization = factory.authorization;
  if (options !== undefined && (authorization === undefined || !authorization.usesRegistry(options.registry))) {
    throw new Error("Tool broker requires the canonical session registry.");
  }
  const dispatcher = options === undefined ? undefined : createClientToolDispatcher(options);
  const advertisements = new Map<string, Map<string, Advertisement>>();
  const sessionTokens = new Map<string, ResourceRef<"session">>();
  const stagedAdvertisements = new Set<StagedAdvertisement>();
  const pending = new Map<string, PendingCompletion>();
  const calls = new Map<string, { readonly caller: WebSocketConnectionContext; readonly executor: WebSocketConnectionContext;
    readonly channel: string; readonly handle: ToolDispatchHandle<unknown>; }>();
  let disposed = false;
  let admissions = 0;
  let advertisementsInFlight = 0;

  const ownedPeer = (peer: AHPPeer, setup: ConnectionSecuritySnapshot): boolean => !disposed && peer.phase === "ready"
    && peers.get(peer.context.connectionId) === peer && peer.context.security === setup
    && setup.context.connectionId === peer.context.connectionId && setup.fence.connectionId === peer.context.connectionId
    && setup.fence.connectionGeneration === peer.context.connectionGeneration && peer.context.isOpen?.() === true;

  const livePeer = (peer: AHPPeer, setup: ConnectionSecuritySnapshot): boolean => {
    try {
      const current: unknown = peer.context.isSecurityCurrent?.();
      return current === true && ownedPeer(peer, setup);
    } catch {
      return false;
    }
  };
  const session = (channel: string) => {
    const origin = authorization?.getResource(channel);
    const manifest = factory.getSessionToolManifest(channel);
    const providerId = factory.getSessionSnapshot(channel)?.state.provider;
    if (origin === undefined || manifest === undefined || typeof providerId !== "string" || authorization?.isReady(origin) !== true) return unavailable();
    sessionTokens.set(channel, origin);
    return { origin, manifest, providerId, sessionType: { key: manifest.sessionType.key, version: manifest.sessionType.version } };
  };
  const liveSession = (origin: ResourceRef<"session">): boolean => authorization?.isReady(origin) === true && authorization.getResource(origin.id) === origin;
  const ownAdvertisement = (peer: AHPPeer, channel: string, ad: Advertisement): boolean => livePeer(peer, ad.setup)
    && peer.clientId === ad.clientId && peer.subscriptions.has(channel) && liveSession(ad.origin)
    && advertisements.get(peer.context.connectionId)?.get(channel) === ad;
  const clearAdvertisement = (peer: AHPPeer, channel: string): void => {
    const entries = advertisements.get(peer.context.connectionId);
    entries?.delete(channel);
    if (entries?.size === 0) advertisements.delete(peer.context.connectionId);
  };

  const prepareAdvertisement = async (peer: AHPPeer, channel: string, action: Record<string, unknown>) => {
    if (action.type !== ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET && action.type !== ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED) return undefined;
    // Trusted raw-kernel metadata compatibility only; no executable advertisement is installed.
    if (authorization === undefined && factory.getSessionToolManifest(channel) === undefined) return undefined;
    const active = action.activeClient as { readonly clientId?: unknown; readonly tools?: unknown } | undefined;
    const tools = action.type === ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED ? [] : active?.tools;
    const claimed = action.type === ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED ? action.clientId : active?.clientId;
    const denied: AdvertisementTicket = { current: () => false, activate: () => undefined, release: () => undefined };
    if (!Array.isArray(tools) || tools.length > 128 || claimed !== peer.clientId) return denied;
    const ownsClientId = (): boolean => ![...advertisements.entries()].some(([connectionId, sessions]) =>
      connectionId !== peer.context.connectionId && sessions.get(channel)?.clientId === claimed);
    const setup = peer.context.security;
    if (setup === undefined || !livePeer(peer, setup) || !ownsClientId()) return denied;
    // Empty metadata/removal never makes a tool executable. Structural ownership still runs in the factory.
    if (tools.length === 0) return { current: () => livePeer(peer, setup) && ownsClientId() && ownedPeer(peer, setup),
      activate: () => {
        clearAdvertisement(peer, channel);
      }, release: () => undefined };
    if (dispatcher === undefined || advertisementsInFlight + stagedAdvertisements.size >= 64) return denied;
    advertisementsInFlight += 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      try {
        const facts = session(channel);
        const proofs: ClientToolProof[] = [];
        const entries: Advertisement["entries"][number][] = [];
        const seen = new Set<string>();
        for (const raw of tools) {
          if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return denied;
          const tool = raw as Record<string, unknown>;
          const meta = tool._meta as Record<string, unknown> | undefined;
          const identity = meta?.[TOOL_CONTRACT_META_KEY] as { readonly id?: unknown } | undefined;
          const contract = facts.manifest.toolContracts.find((entry) => entry.id === identity?.id);
          if (contract === undefined || seen.has(contract.id)) return denied;
          seen.add(contract.id);
          const allowed: Advertisement["entries"][number][] = [];
          for (const registration of dispatcher.policy.registrations.filter((entry) => entry.definition.id === contract.id)) {
            if (!sameDescriptor(tool, toAhpToolDefinition(registration.definition))) continue;
            const executor = { actor: setup.context.actor, connectionId: peer.context.connectionId,
              generation: setup.fence.connectionGeneration, registrationRevision: registration.revision };
            const base = { caller: setup.context, origin: facts.origin, sessionType: facts.sessionType,
              providerId: facts.providerId, registration, input: null, signal: controller.signal };
            try {
              const resolution = await dispatcher.policy.resolve(base);
              const advertise = await dispatcher.policy.authorize({ ...base, resolution, operation: "advertise" });
              const execute = await dispatcher.policy.authorize({ ...base, resolution, operation: "execute", executor, executorContext: setup.context });
              allowed.push({ registration, executor });
              proofs.push(advertise, execute);
            } catch {
              /* This exact implementation is not admitted. */ }
          }
          if (allowed.length !== 1 || allowed[0] === undefined) return denied;
          entries.push(allowed[0]);
        }
        const advertisement: Advertisement = { clientId: peer.clientId ?? "", origin: facts.origin, setup, entries };
        const staged: StagedAdvertisement = { channel, clientId: advertisement.clientId,
          tools: entries.map((entry) => toAhpToolDefinition(entry.registration.definition)), matches: false };
        if (controller.signal.aborted) return denied;
        stagedAdvertisements.add(staged);
        const current = (): boolean => !controller.signal.aborted && livePeer(peer, setup) && liveSession(facts.origin)
          && dispatcher.policy.current(proofs) && ownsClientId() && ownedPeer(peer, setup)
          && sessionTokens.get(channel) === facts.origin && stagedAdvertisements.has(staged);
        return { current, release: () => {
          stagedAdvertisements.delete(staged);
        }, activate: (sequence: number) => {
          if (!current() || !staged.matches || staged.sequence !== sequence) return;
          const sessions = advertisements.get(peer.context.connectionId) ?? new Map<string, Advertisement>();
          sessions.set(channel, advertisement);
          advertisements.set(peer.context.connectionId, sessions);
        } };
      } catch {
        return denied;
      } finally {
        advertisementsInFlight -= 1;
      }
    };
    try {
      return await Promise.race([work(), new Promise<typeof denied>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(denied);
        }, 5000);
      })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const call = async (params: unknown, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): Promise<unknown> => {
    const caller = requirePeer(context);
    const request = toolCallParamsSchema.parse(params);
    const setup = context.security;
    if (invocation.guardReply === undefined || dispatcher === undefined || setup === undefined || !livePeer(caller, setup) || !caller.subscriptions.has(request.channel)
      || admissions + dispatcher.stats().active >= 64) return unavailable();
    admissions += 1;
    let admitting = true;
    try {
      const facts = session(request.channel);
      const contract = facts.manifest.toolContracts.find((entry) => entry.key === request.key && entry.version === request.version);
      if (contract === undefined) return unavailable();
      const idCounts = new Map<string, number>();
      for (const peer of peers.values()) if (peer.phase === "ready" && peer.clientId !== undefined) idCounts.set(peer.clientId, (idCounts.get(peer.clientId) ?? 0) + 1);
      const candidates: { peer: AHPPeer; ad: Advertisement; registration: ClientToolRegistration; executor: ExecutorRevision }[] = [];
      for (const peer of peers.values()) {
        const ad = advertisements.get(peer.context.connectionId)?.get(request.channel);
        if (ad === undefined || !ownAdvertisement(peer, request.channel, ad) || idCounts.get(ad.clientId) !== 1) continue;
        for (const entry of ad.entries) if (entry.registration.definition.id === contract.id) candidates.push({ peer, ad, ...entry });
      }
      // Admission is checked again by the one dispatcher; ambiguity is never an implicit routing policy.
      const selected = candidates[0];
      if (selected === undefined || candidates.length !== 1) return unavailable();
      const callId = randomUUID();
      const controller = new AbortController();
      const current = (): boolean => livePeer(caller, setup) && caller.subscriptions.has(request.channel)
        && ownAdvertisement(selected.peer, request.channel, selected.ad) && liveSession(facts.origin);
      const fence = (): boolean => ownedPeer(caller, setup) && ownedPeer(selected.peer, selected.ad.setup)
        && caller.subscriptions.has(request.channel) && selected.peer.subscriptions.has(request.channel)
        && advertisements.get(selected.peer.context.connectionId)?.get(request.channel) === selected.ad
        && sessionTokens.get(request.channel) === facts.origin;
      const handle = dispatcher.dispatch({ caller: setup.context, origin: facts.origin, sessionType: facts.sessionType,
        providerId: facts.providerId, registration: selected.registration, input: request.input,
        signal: controller.signal, callId, executor: selected.executor, executorContext: selected.ad.setup.context, current, fence,
        send: (input) => new Promise<unknown>((resolve, reject) => {
          if (!current()) {
            reject(new Error("Unavailable"));
            return;
          }
          pending.set(callId, { context: selected.peer.context, generation: selected.executor.generation,
            channel: request.channel, key: request.key, version: request.version, resolve, reject });
          const message: JsonRpcMessage = { jsonrpc: JSONRPC_VERSION, method: TOOL_INVOCATION_METHOD,
            params: jsonRpcParamsSchema.parse(parseUnknownJson(JSON.stringify({ callId, channel: request.channel, key: request.key, version: request.version, input }))) };
          if (!selected.peer.context.send(message, handle.current)) {
            // A boolean enqueue failure is not a remote termination guarantee.
            handle.cancel();
          }
        }),
      });
      admissions -= 1;
      admitting = false;
      calls.set(callId, { caller: context, executor: selected.peer.context, channel: request.channel, handle });
      invocation.guardReply(handle.current);
      void handle.settled.then(() => {
        calls.delete(callId);
        pending.delete(callId);
      });
      const outcome = await handle.result;
      if (outcome.status !== "succeeded" || !handle.current()) return unavailable();
      return outcome.output;
    } finally {
      if (admitting) admissions -= 1;
    }
  };
  const matched = (params: unknown, context: WebSocketConnectionContext) => {
    const parsed = toolCompletionParamsSchema.safeParse(params);
    if (!parsed.success) return undefined;
    const entry = pending.get(parsed.data.callId);
    if (entry === undefined || entry.context !== context || entry.generation !== context.connectionGeneration
      || entry.channel !== parsed.data.channel || entry.key !== parsed.data.key || entry.version !== parsed.data.version) return undefined;
    return { entry, completion: parsed.data };
  };
  return {
    call, prepareAdvertisement,
    observeEnvelope(envelope: ActionEnvelope): void {
      const action = envelope.action;
      if (action.type !== ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET && action.type !== ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED) return;
      const clientId = action.type === ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET ? action.activeClient.clientId : action.clientId;
      for (const staged of stagedAdvertisements) {
        if (staged.channel !== envelope.channel || staged.clientId !== clientId) continue;
        staged.sequence = envelope.serverSeq;
        staged.matches = action.type === ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET && sameTools(action.activeClient.tools, staged.tools);
      }
      for (const [connectionId, sessions] of advertisements) {
        const advertisement = sessions.get(envelope.channel);
        if (advertisement?.clientId !== clientId) continue;
        const unchanged = action.type === ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET && sameTools(action.activeClient.tools,
          advertisement.entries.map((entry) => toAhpToolDefinition(entry.registration.definition)));
        if (unchanged) continue;
        sessions.delete(envelope.channel);
        if (sessions.size === 0) advertisements.delete(connectionId);
      }
    },
    complete(params: unknown, context: WebSocketConnectionContext): null {
      requirePeer(context);
      const match = matched(params, context);
      if (match === undefined) return null;
      pending.delete(match.completion.callId);
      if (match.completion.error !== undefined) match.entry.reject(new Error("Remote tool failed"));
      else match.entry.resolve(match.completion.output);
      return null;
    },
    isCompletion(params: unknown, context: WebSocketConnectionContext): boolean {
      return matched(params, context) !== undefined;
    },
    unsubscribe: clearAdvertisement,
    removeSession(channel: string): void {
      sessionTokens.delete(channel);
      for (const staged of stagedAdvertisements) if (staged.channel === channel) stagedAdvertisements.delete(staged);
      for (const sessions of advertisements.values()) sessions.delete(channel);
      for (const call of calls.values()) if (call.channel === channel) call.handle.cancel();
    },
    removeConnection(connectionId: string): void {
      advertisements.delete(connectionId);
      for (const call of calls.values()) if (call.caller.connectionId === connectionId || call.executor.connectionId === connectionId) call.handle.cancel();
    },
    dispose(): void {
      disposed = true;
      advertisements.clear();
      sessionTokens.clear();
      stagedAdvertisements.clear();
      for (const call of calls.values()) call.handle.cancel();
    },
    drain: () => dispatcher?.shutdown() ?? Promise.resolve({ draining: 0 }),
    stats: () => dispatcher?.stats() ?? { active: 0, draining: 0, retainedOutputBytes: 0 },
  };
}

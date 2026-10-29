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
import { parseToolWire, toolCorrelation, assignedToolSchema, toolAssignedReplySchema, toolInvokeSchema, toolCompleteSchema, toolExecutorCancelSchema } from "@toolExecution/helpers/client/helpers/protocol";
import type { AssignedTool, ToolInvoke } from "@toolExecution/helpers/client/helpers/protocol";
import { createPrivateToolProtocol, type PrivateAssignmentTicket } from "./helpers/toolProtocol";
import type { ConnectionSecuritySnapshot } from "@websocket/helpers/security/types";
import type { JsonRpcInvocation, WebSocketConnectionContext } from "../../types";
import { TOOL_INVOCATION_METHOD } from "./constants";
import type { AHPPeer } from "./types";

const toolCallParamsSchema = z.strictObject({ channel: z.string().min(1).max(2048), key: z.string().min(1).max(256), version: z.int().positive(), input: z.unknown() });
const toolCompletionParamsSchema = z.strictObject({ callId: z.uuid(), channel: z.string().min(1).max(2048), key: z.string().min(1).max(256), version: z.int().positive(), output: z.unknown().optional(), error: z.string().max(4096).optional() })
  .refine((value) => (value.output === undefined) !== (value.error === undefined));
const completionSchema = z.union([toolCompletionParamsSchema, toolCompleteSchema]);
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
  readonly advertisementId?: string;
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
  release(): void;
  readonly invocation?: ToolInvoke;
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
  const stagedPrivateAdvertisements = new Set<object>();
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

  const assignment = async (context: WebSocketConnectionContext, channel: string, signal: AbortSignal): Promise<PrivateAssignmentTicket> => {
    const peer = requirePeer(context);
    const setup = context.security;
    if (dispatcher === undefined || options === undefined || setup === undefined || !livePeer(peer, setup)
      || !peer.subscriptions.has(channel) || signal.aborted) return unavailable();
    const facts = session(channel);
    const epoch = options.registry.captureFence();
    const executor: ExecutorRevision = { actor: setup.context.actor, connectionId: context.connectionId,
      generation: setup.fence.connectionGeneration, registrationRevision: 1 };
    const tools: AssignedTool[] = [];
    const proofs: ClientToolProof[] = [];
    const entries: Array<{ readonly tool: AssignedTool; readonly registration: ClientToolRegistration; readonly executor: ExecutorRevision }> = [];
    for (const contract of facts.manifest.toolContracts) {
      const permitted: Array<{ readonly tool: AssignedTool; readonly registration: ClientToolRegistration;
        readonly executor: ExecutorRevision; readonly proofs: ClientToolProof[]; }> = [];
      for (const registration of dispatcher.policy.registrations.filter((candidate) => candidate.definition.id === contract.id)) {
        const selectedExecutor = { ...executor, registrationRevision: registration.revision };
        const base = { caller: setup.context, origin: facts.origin, sessionType: facts.sessionType, providerId: facts.providerId,
          registration, input: null, signal };
        try {
          const resolution = await dispatcher.policy.resolve(base);
          const discover = await dispatcher.policy.authorize({ ...base, resolution, operation: "discover" });
          const currentProofs = [discover];
          const purposes: AssignedTool["purposes"] = ["discover"];
          for (const operation of ["invoke", "advertise", "execute"] as const) {
            try {
              const proof = await dispatcher.policy.authorize({ ...base, resolution, operation,
                ...(operation === "execute" ? { executor: selectedExecutor, executorContext: setup.context } : {}) });
              purposes.push(operation);
              currentProofs.push(proof);
            } catch { /* An affordance cannot create its missing grant. */ }
          }
          const executable = purposes.includes("advertise") && purposes.includes("execute");
          const tool = parseToolWire(assignedToolSchema, { contract: { id: contract.id, key: contract.key, version: contract.version },
            descriptor: toAhpToolDefinition(registration.definition), purposes, conditions: [],
            ...(executable ? { execution: { binding: registration.implementation, registrationRevision: registration.revision, source: registration.source } } : {}) });
          permitted.push({ tool, registration, executor: selectedExecutor, proofs: currentProofs });
        } catch { /* Private descriptors require a complete discover/reveal path. */ }
      }
      // No implicit implementation selection when several exact candidates remain.
      const selected = permitted[0];
      if (permitted.length !== 1 || selected === undefined) continue;
      tools.push(selected.tool);
      entries.push(selected);
      proofs.push(...selected.proofs);
    }
    const value = parseToolWire(toolAssignedReplySchema.omit({ version: true, channel: true, viewRevision: true }), {
      resource: facts.origin, connection: { id: context.connectionId, generation: setup.fence.connectionGeneration }, tools });
    const fence = (): boolean => !signal.aborted && epoch() && ownedPeer(peer, setup)
      && peer.subscriptions.has(channel) && sessionTokens.get(channel) === facts.origin;
    const current = (): boolean => !signal.aborted && livePeer(peer, setup) && liveSession(facts.origin)
      && (proofs.length === 0 || dispatcher.policy.current(proofs)) && fence();
    if (!current()) return unavailable();
    return { value, current, fence,
      advertise(contracts, advertisementId) {
        if (!current() || stagedPrivateAdvertisements.size >= 64) return unavailable();
        const selected: typeof entries = [];
        const seen = new Set<string>();
        for (const contract of contracts) {
          const entry = entries.find((candidate) => candidate.tool.contract.id === contract.id
            && candidate.tool.contract.key === contract.key && candidate.tool.contract.version === contract.version);
          if (entry === undefined || entry.tool.execution === undefined || seen.has(contract.id)) return unavailable();
          seen.add(contract.id);
          selected.push(entry);
        }
        const previous = advertisements.get(context.connectionId)?.get(channel);
        const advertisement: Advertisement = { advertisementId, clientId: peer.clientId ?? "", origin: facts.origin, setup,
          entries: selected.map((entry) => ({ registration: entry.registration, executor: entry.executor })) };
        const token = {};
        stagedPrivateAdvertisements.add(token);
        const owns = (): boolean => fence() && stagedPrivateAdvertisements.has(token)
          && advertisements.get(context.connectionId)?.get(channel) === previous
          && ![...advertisements.entries()].some(([connectionId, values]) => connectionId !== context.connectionId && values.get(channel)?.clientId === advertisement.clientId);
        return { tools: selected.map((entry) => entry.tool), current: () => current() && owns(),
          commit: () => {
            if (!owns()) return false;
            if (selected.length === 0) clearAdvertisement(peer, channel);
            else {
              const registered = advertisements.get(context.connectionId) ?? new Map<string, Advertisement>();
              registered.set(channel, advertisement);
              advertisements.set(context.connectionId, registered);
            }
            stagedPrivateAdvertisements.delete(token);
            return true;
          },
          release: () => {
            stagedPrivateAdvertisements.delete(token);
          },
        };
      },
    };
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

  const startCall = (request: z.infer<typeof toolCallParamsSchema>, context: WebSocketConnectionContext, callId: string, expectedContractId?: string) => {
    const caller = requirePeer(context);
    const setup = context.security;
    if (dispatcher === undefined || setup === undefined || !livePeer(caller, setup) || !caller.subscriptions.has(request.channel)
      || admissions + dispatcher.stats().active >= 64) return unavailable();
    admissions += 1;
    let admitting = true;
    try {
      const facts = session(request.channel);
      const contract = facts.manifest.toolContracts.find((entry) => entry.key === request.key && entry.version === request.version);
      if (contract === undefined || (expectedContractId !== undefined && contract.id !== expectedContractId)) return unavailable();
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
      if (expectedContractId !== undefined && selected.ad.advertisementId === undefined) return unavailable();
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
        send: (input, actionContext) => new Promise<unknown>((resolve, reject) => {
          if (!current()) {
            reject(new Error("Unavailable"));
            return;
          }
          const privateInvocation = expectedContractId === undefined
            ? undefined
            : parseToolWire(toolInvokeSchema, {
                version: 2, callId, channel: request.channel, contract: { id: contract.id, key: contract.key, version: contract.version },
                route: actionContext.resources, execution: { binding: selected.registration.implementation,
                  registrationRevision: selected.registration.revision, source: selected.registration.source },
                connection: { id: selected.peer.context.connectionId, generation: selected.executor.generation },
                advertisementId: selected.ad.advertisementId, input,
              });
          let enqueued = false;
          let cancellationSent = false;
          const cancel = (): void => {
            if (!enqueued || cancellationSent || privateInvocation === undefined) return;
            cancellationSent = true;
            const correlation = toolCorrelation(privateInvocation);
            selected.peer.context.send({ jsonrpc: JSONRPC_VERSION, method: "x-ahp/tools/cancel",
              params: jsonRpcParamsSchema.parse(parseToolWire(toolExecutorCancelSchema, correlation)) },
            () => pending.get(callId) === entry && ownedPeer(selected.peer, selected.ad.setup));
          };
          const entry: PendingCompletion = { context: selected.peer.context, generation: selected.executor.generation,
            channel: request.channel, key: request.key, version: request.version, resolve, reject,
            release: () => {
              actionContext.signal.removeEventListener("abort", cancel);
            },
            ...(privateInvocation === undefined ? {} : { invocation: privateInvocation }) };
          pending.set(callId, entry);
          actionContext.signal.addEventListener("abort", cancel, { once: true });
          const message: JsonRpcMessage = { jsonrpc: JSONRPC_VERSION, method: TOOL_INVOCATION_METHOD,
            params: jsonRpcParamsSchema.parse(privateInvocation ?? parseUnknownJson(JSON.stringify({ callId, channel: request.channel, key: request.key, version: request.version, input }))) };
          enqueued = selected.peer.context.send(message, handle.current);
          if (!enqueued) {
            // A boolean enqueue failure is not a remote termination guarantee.
            handle.cancel();
          }
          if (actionContext.signal.aborted) cancel();
        }),
      });
      admissions -= 1;
      admitting = false;
      calls.set(callId, { caller: context, executor: selected.peer.context, channel: request.channel, handle });

      void handle.settled.then(() => {
        calls.delete(callId);
        pending.get(callId)?.release();
        pending.delete(callId);
      });
      return handle;
    } finally {
      if (admitting) admissions -= 1;
    }
  };
  const call = async (params: unknown, context: WebSocketConnectionContext, invocation: JsonRpcInvocation): Promise<unknown> => {
    if (invocation.guardReply === undefined) return unavailable();
    const handle = startCall(toolCallParamsSchema.parse(params), context, randomUUID());
    invocation.guardReply(handle.current);
    const outcome = await handle.result;
    if (outcome.status !== "succeeded" || !handle.current()) return unavailable();
    return outcome.output;
  };
  const matched = (params: unknown, context: WebSocketConnectionContext) => {
    let parsed: ReturnType<typeof completionSchema.safeParse>;
    try {
      parsed = { success: true, data: parseToolWire(completionSchema, params) };
    } catch {
      return undefined;
    }
    const entry = pending.get(parsed.data.callId);
    if (entry === undefined || entry.context !== context || entry.generation !== context.connectionGeneration
      || entry.channel !== parsed.data.channel) return undefined;
    if ("contract" in parsed.data) {
      const completion = parsed.data;
      if (entry.invocation === undefined || !privateProtocol?.negotiated(context)
        || !(["version", "callId", "channel", "contract", "route", "execution", "connection", "advertisementId"] as const)
          .every((key) => JSON.stringify(completion[key]) === JSON.stringify(entry.invocation?.[key]))) return undefined;
    } else if (entry.invocation !== undefined || entry.key !== parsed.data.key || entry.version !== parsed.data.version) return undefined;
    return { entry, completion: parsed.data };
  };
  const privateProtocol = options === undefined
    ? undefined
    : createPrivateToolProtocol({
        ready: (context) => {
          const peer = peers.get(context.connectionId), setup = context.security;
          return peer !== undefined && setup !== undefined && livePeer(peer, setup);
        },
        fence: (context) => {
          const peer = peers.get(context.connectionId), setup = context.security;
          return peer !== undefined && setup !== undefined && ownedPeer(peer, setup);
        },
        assignment,
        dispatch: (context, request, callId) => startCall({ channel: request.channel,
          key: request.contract.key, version: request.contract.version, input: request.input }, context, callId, request.contract.id),
        onInvalidate: (listener) => options.registry.onInvalidate(listener),
      });
  return {
    call, prepareAdvertisement,
    privateHandlers: privateProtocol?.handlers ?? {},
    negotiated: (context: WebSocketConnectionContext) => privateProtocol?.negotiated(context) === true,
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
      match.entry.release();
      pending.delete(match.completion.callId);
      if ("error" in match.completion && match.completion.error !== undefined) match.entry.reject(new Error("Remote tool failed"));
      else if ("output" in match.completion) match.entry.resolve(match.completion.output);
      return null;
    },
    isCompletion(params: unknown, context: WebSocketConnectionContext): boolean {
      return matched(params, context) !== undefined;
    },
    unsubscribe: (peer: AHPPeer, channel: string) => {
      clearAdvertisement(peer, channel);
      privateProtocol?.forget(peer.context, channel);
    },
    removeSession(channel: string): void {
      privateProtocol?.removeSession(channel);
      sessionTokens.delete(channel);
      for (const staged of stagedAdvertisements) if (staged.channel === channel) stagedAdvertisements.delete(staged);
      for (const sessions of advertisements.values()) sessions.delete(channel);
      for (const call of calls.values()) if (call.channel === channel) call.handle.cancel();
    },
    removeConnection(connectionId: string): void {
      const peer = peers.get(connectionId);
      if (peer !== undefined) privateProtocol?.forget(peer.context);
      advertisements.delete(connectionId);
      for (const call of calls.values()) if (call.caller.connectionId === connectionId || call.executor.connectionId === connectionId) call.handle.cancel();
    },
    dispose(): void {
      disposed = true;
      privateProtocol?.dispose();
      advertisements.clear();
      sessionTokens.clear();
      stagedAdvertisements.clear();
      stagedPrivateAdvertisements.clear();
      for (const call of calls.values()) call.handle.cancel();
    },
    drain: () => dispatcher?.shutdown() ?? Promise.resolve({ draining: 0 }),
    stats: () => dispatcher?.stats() ?? { active: 0, draining: 0, retainedOutputBytes: 0 },
  };
}

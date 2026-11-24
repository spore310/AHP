import { createServerToolDispatcher, type ServerToolBrokerOptions } from "@tool/server";
import { createToolDispatcher } from "@tool/helpers/execution/helpers/dispatcher";
import { JsonRpcErrorCodes, type ActionEnvelope } from "@microsoft/agent-host-protocol";
import { jsonRpcParamsSchema, JSONRPC_VERSION, RpcError, type JsonRpcMessage } from "@jsonrpc";
import type { SessionsFactory } from "@sessions/types";
import { ACTION_TYPE_SESSION_META_CHANGED } from "@sessions/constants";
import { canonicalJsonEqual, toAhpToolDefinition } from "@tool";
import type { ExecutorRevision, ResourceRef } from "@authorization";
import type { PublishedTool } from "@tool/helpers/policy/helpers/admission";
import { createClientToolDispatcher, type ClientToolBrokerOptions, type ClientToolProof, type ClientToolRegistration } from "@tool/helpers/execution/helpers/remote";
import type { ToolDispatchHandle } from "@tool/helpers/execution/helpers/dispatcher";
import { parseToolWire, toolCorrelation, assignedToolSchema, toolAssignedReplySchema, toolInvokeSchema, toolCompleteSchema, toolExecutorCancelSchema } from "@tool/protocol";
import type { AssignedTool, ToolComplete, ToolInvoke } from "@tool/protocol";
import type { PrivateToolProtocolPorts } from "./helpers/toolProtocol/types";
import { createPrivateToolProtocol, type PrivateAssignmentTicket } from "./helpers/toolProtocol";
import type { ConnectionSecuritySnapshot } from "@websocket/helpers/security/types";
import type { WebSocketConnectionContext } from "../../types";
import { TOOL_INVOCATION_METHOD } from "./constants";
import type { AHPBindingOptions, AHPPeer } from "./types";

const unavailable = (): never => {
  throw new RpcError(JsonRpcErrorCodes.InvalidParams, "Tool operation unavailable");
};

interface Advertisement {
  readonly advertisementId: string;
  readonly clientId: string;
  readonly origin: ResourceRef<"session">;
  readonly manifestRevision: number | undefined;
  readonly setup: ConnectionSecuritySnapshot;
  readonly entries: readonly { readonly registration: ClientToolRegistration; readonly executor: ExecutorRevision }[];
}
interface PendingCompletion {
  release(): void;
  readonly invocation: ToolInvoke;
  readonly context: WebSocketConnectionContext;
  readonly generation: number;
  readonly channel: string;
  resolve(output: unknown): void;
  reject(error: Error): void;
}

/** Sole transport correlation adapter. Missing canonical policy wiring fails closed. */
export function createToolInvocationBroker(factory: SessionsFactory, peers: ReadonlyMap<string, AHPPeer>,
  requirePeer: (context: WebSocketConnectionContext) => AHPPeer, options?: ClientToolBrokerOptions, serverOptions?: ServerToolBrokerOptions,
  prepareWork?: AHPBindingOptions["prepareToolWork"]) {
  const authorization = factory.authorization;
  if (options !== undefined && (authorization === undefined || !authorization.usesRegistry(options.registry))) {
    throw new Error("Tool broker requires the canonical session registry.");
  }
  if (serverOptions !== undefined && (authorization === undefined || !authorization.usesRegistry(serverOptions.registry)
    || (options !== undefined && (serverOptions.registry !== options.registry || serverOptions.policies !== options.policies)))) throw new Error("Server tools require the canonical session registry.");
  if (options?.dispatcher !== undefined && serverOptions?.dispatcher !== undefined && options.dispatcher !== serverOptions.dispatcher) throw new Error("Tool routes require one shared dispatcher configuration.");
  const configuration = options ?? serverOptions;
  const dispatcherOptions = options?.dispatcher ?? serverOptions?.dispatcher;
  const lifecycle = configuration === undefined ? undefined : createToolDispatcher(dispatcherOptions);
  const dispatcher = options === undefined ? undefined : createClientToolDispatcher(options, lifecycle);
  const artifactSource = options?.artifacts;
  const serverDispatcher = serverOptions === undefined ? undefined : createServerToolDispatcher(serverOptions, lifecycle);
  factory.managedTools?.admission.reserveBase([...options?.registrations ?? [], ...serverOptions?.registrations ?? []].map(({ definition }) => definition));
  if (dispatcher !== undefined && serverDispatcher !== undefined && dispatcher.policy.registrations.some((client) => serverDispatcher.policy.registrations.some((server) => server.definition.id === client.definition.id))) throw new Error("Client and server tool contracts overlap.");
  const advertisements = new Map<string, Map<string, Advertisement>>();
  const runtimeRegistrations = new WeakMap<PublishedTool, ClientToolRegistration>();
  const manifestRevision = (origin: ResourceRef<"session">): number | undefined => factory.managedTools?.revision(origin);
  const registrationsFor = (origin: ResourceRef<"session">, contractId: string): readonly ClientToolRegistration[] => {
    if (dispatcher === undefined) return [];
    const entry = factory.managedTools?.registration(origin, contractId);
    if (entry === undefined) return dispatcher.policy.registrations.filter((candidate) => candidate.definition.id === contractId);
    const existing = runtimeRegistrations.get(entry);
    if (existing !== undefined) return [existing];
    const { id, key, version } = entry.definition;
    const artifact = artifactSource?.find({ id, key, version }, entry.source);
    const registration = dispatcher.policy.registerRuntime({ definition: entry.definition, source: entry.source,
      revision: artifact?.descriptor.implementationRevision ?? entry.source.revision,
      implementation: artifact === undefined
        ? { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: entry.source.id }
        : { location: "client", suppliedBy: "server", implementation: "approved-artifact", artifactRef: artifact.descriptor.artifactId } });
    runtimeRegistrations.set(entry, registration);
    return [registration];
  };
  let privateAdvertisementEpoch: object = {};
  const privateAdvertisementEpochs = new WeakMap<Advertisement, object>();
  const advertisementReady = (advertisement: Advertisement): boolean => manifestRevision(advertisement.origin) === advertisement.manifestRevision
    && privateAdvertisementEpochs.get(advertisement) === privateAdvertisementEpoch;
  const sessionTokens = new Map<string, ResourceRef<"session">>();
  const stagedPrivateAdvertisements = new Set<object>();
  const pending = new Map<string, PendingCompletion>();
  const calls = new Map<string, { readonly caller: WebSocketConnectionContext; readonly executor?: WebSocketConnectionContext;
    readonly channel: string; readonly handle: ToolDispatchHandle<unknown>; }>();
  let disposed = false;
  let admissions = 0;

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
    return { origin, manifest, manifestRevision: manifestRevision(origin), providerId, sessionType: { key: manifest.sessionType.key, version: manifest.sessionType.version } };
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
    if (lifecycle === undefined || configuration === undefined || setup === undefined || !livePeer(peer, setup)
      || !peer.subscriptions.has(channel) || signal.aborted) return unavailable();
    const facts = session(channel);
    const epoch = configuration.registry.captureFence();
    let includesServer = false;
    const executor: ExecutorRevision = { actor: setup.context.actor, connectionId: context.connectionId,
      generation: setup.fence.connectionGeneration, registrationRevision: 1 };
    const tools: AssignedTool[] = [];
    const proofs: ClientToolProof[] = [];
    const entries: Array<{ readonly tool: AssignedTool; readonly registration: ClientToolRegistration; readonly executor: ExecutorRevision }> = [];
    for (const contract of facts.manifest.toolContracts) {
      const serverRegistration = serverDispatcher?.policy.registrations.find((entry) => entry.definition.id === contract.id);
      if (serverDispatcher !== undefined && serverRegistration !== undefined) {
        const base = { caller: setup.context, origin: facts.origin, sessionType: facts.sessionType, providerId: facts.providerId, registration: serverRegistration, input: null, signal };
        try {
          if (!serverDispatcher.executorCurrent()) continue;
          const resolution = await serverDispatcher.policy.resolve(base);
          const discover = await serverDispatcher.policy.authorize({ ...base, resolution, operation: "discover" });
          const currentProofs = [discover];
          const purposes: AssignedTool["purposes"] = ["discover"];
          let challengeRequired = false;
          try {
            const invoke = await serverDispatcher.policy.authorize({ ...base, resolution, operation: "invoke" });
            const execute = await serverDispatcher.policy.authorize({ ...base, resolution, operation: "execute", executor: serverDispatcher.executorFor(serverRegistration), executorContext: serverDispatcher.executor.context });
            purposes.push("invoke");
            currentProofs.push(invoke, execute);
            challengeRequired = invoke.challengeRequired || execute.challengeRequired;
          } catch {
            /* Discovery does not confer invocation or executor authority. */ }
          tools.push(parseToolWire(assignedToolSchema, { contract: { id: contract.id, key: contract.key, version: contract.version }, descriptor: toAhpToolDefinition(serverRegistration.definition),
            purposes, conditions: challengeRequired ? ["challenge-required"] : [], ...(purposes.includes("invoke") ? { execution: { binding: serverRegistration.implementation, registrationRevision: serverRegistration.revision, source: serverRegistration.source } } : {}) }));
          proofs.push(...currentProofs);
          includesServer = true;
        } catch {
          /* Host descriptors still require a complete private reveal path. */ }
        continue;
      }
      if (dispatcher === undefined) continue;
      const permitted: Array<{ readonly tool: AssignedTool; readonly registration: ClientToolRegistration;
        readonly executor: ExecutorRevision; readonly proofs: ClientToolProof[]; }> = [];
      for (const registration of registrationsFor(facts.origin, contract.id)) {
        const selectedExecutor = { ...executor, registrationRevision: registration.revision };
        const base = { caller: setup.context, origin: facts.origin, sessionType: facts.sessionType, providerId: facts.providerId,
          registration, input: null, signal };
        try {
          const resolution = await dispatcher.policy.resolve(base);
          const discover = await dispatcher.policy.authorize({ ...base, resolution, operation: "discover" });
          const currentProofs = [discover];
          const purposes: AssignedTool["purposes"] = ["discover"];
          let challengeRequired = false;
          for (const operation of ["invoke", "advertise", "execute"] as const) {
            try {
              const proof = await dispatcher.policy.authorize({ ...base, resolution, operation,
                ...(operation === "execute" ? { executor: selectedExecutor, executorContext: setup.context } : {}) });
              if (operation !== "advertise" && proof.challengeRequired) challengeRequired = true;
              purposes.push(operation);
              currentProofs.push(proof);
            } catch {
              /* An affordance cannot create its missing grant. */ }
          }
          const executable = purposes.includes("advertise") && purposes.includes("execute");
          const tool = parseToolWire(assignedToolSchema, { contract: { id: contract.id, key: contract.key, version: contract.version },
            descriptor: toAhpToolDefinition(registration.definition), purposes, conditions: challengeRequired ? ["challenge-required"] : [],
            ...(executable ? { execution: { binding: registration.implementation, registrationRevision: registration.revision, source: registration.source } } : {}) });
          permitted.push({ tool, registration, executor: selectedExecutor, proofs: currentProofs });
        } catch {
          /* Private descriptors require a complete discover/reveal path. */ }
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
      && peer.subscriptions.has(channel) && sessionTokens.get(channel) === facts.origin
      && manifestRevision(facts.origin) === facts.manifestRevision
      && (!includesServer || serverDispatcher?.executorFence() === true);
    const current = (): boolean => !signal.aborted && livePeer(peer, setup) && liveSession(facts.origin)
      && (!includesServer || serverDispatcher?.executorCurrent() === true)
      && (proofs.length === 0 || configuration.registry.validateAssignmentCohort(proofs.map((proof) => ({ authorization: proof.authorization, actor: setup.context })))) && fence();
    if (!current()) return unavailable();
    const deliveredArtifacts = new Set<ClientToolRegistration>();
    return { value, current, fence,
      async artifact(contract, requestSignal) {
        if (artifactSource === undefined || dispatcher === undefined || !current()) return undefined;
        const entry = entries.find((candidate) => canonicalJsonEqual(candidate.tool.contract, contract));
        if (entry?.registration.implementation.implementation !== "approved-artifact" || entry.tool.execution === undefined) return undefined;
        const artifact = artifactSource.find(contract, entry.registration.source);
        if (artifact === undefined || artifact.descriptor.artifactId !== entry.registration.implementation.artifactRef
          || artifact.descriptor.implementationRevision !== entry.registration.revision) return undefined;
        const base = { caller: setup.context, origin: facts.origin, sessionType: facts.sessionType, providerId: facts.providerId,
          registration: entry.registration, input: null, signal: requestSignal };
        const resolution = await dispatcher.policy.resolve(base);
        const advertise = await dispatcher.policy.authorize({ ...base, resolution, operation: "advertise" });
        const execute = await dispatcher.policy.authorize({ ...base, resolution, operation: "execute", executor: entry.executor, executorContext: setup.context });
        if (advertise.challengeRequired || execute.challengeRequired) return undefined;
        const live = (): boolean => !requestSignal.aborted && current() && dispatcher.policy.current([advertise, execute]) && fence();
        if (!live()) return undefined;
        const encoded = await artifactSource.read(artifact, requestSignal, live);
        if (encoded === undefined || !live()) return undefined;
        return { artifact, encoded, current: live, recordDelivery: () => {
          if (live()) deliveredArtifacts.add(entry.registration);
        } };
      },
      advertise(contracts, advertisementId) {
        if (!current() || stagedPrivateAdvertisements.size >= 64) return unavailable();
        const selected: typeof entries = [];
        const seen = new Set<string>();
        for (const contract of contracts) {
          const entry = entries.find((candidate) => candidate.tool.contract.id === contract.id
            && candidate.tool.contract.key === contract.key && candidate.tool.contract.version === contract.version);
          if (entry === undefined || entry.tool.execution === undefined || seen.has(contract.id)) return unavailable();
          if (entry.registration.implementation.implementation === "approved-artifact" && !deliveredArtifacts.has(entry.registration)) return unavailable();
          seen.add(contract.id);
          selected.push(entry);
        }
        const previous = advertisements.get(context.connectionId)?.get(channel);
        const advertisement: Advertisement = { advertisementId, clientId: peer.clientId ?? "", origin: facts.origin, manifestRevision: facts.manifestRevision, setup,
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
              privateAdvertisementEpochs.set(advertisement, privateAdvertisementEpoch);
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

  const startCall: PrivateToolProtocolPorts["dispatch"] = (context, request, callId) => {
    const caller = requirePeer(context);
    const setup = context.security;
    if (lifecycle === undefined || setup === undefined || !livePeer(caller, setup) || !caller.subscriptions.has(request.channel)
      || admissions + lifecycle.stats().active >= 64) return unavailable();
    const restriction = request.work === undefined ? {} : { work: request.work, prepareWork: prepareWork?.bind(undefined, context) };
    admissions += 1;
    let admitting = true;
    try {
      const facts = session(request.channel);
      const contract = facts.manifest.toolContracts.find((entry) => entry.id === request.contract.id && entry.key === request.contract.key && entry.version === request.contract.version);
      if (contract === undefined) return unavailable();
      const serverRegistration = serverDispatcher?.policy.registrations.find((entry) => entry.definition.id === contract.id);
      if (serverDispatcher !== undefined && serverRegistration !== undefined) {
        const controller = new AbortController();
        const current = () => livePeer(caller, setup) && caller.subscriptions.has(request.channel) && liveSession(facts.origin)
          && manifestRevision(facts.origin) === facts.manifestRevision;
        const fence = () => ownedPeer(caller, setup) && caller.subscriptions.has(request.channel) && sessionTokens.get(request.channel) === facts.origin
          && manifestRevision(facts.origin) === facts.manifestRevision;
        const handle = serverDispatcher.dispatch({ ...restriction, caller: setup.context, origin: facts.origin, sessionType: facts.sessionType, providerId: facts.providerId,
          registration: serverRegistration, input: request.input, signal: controller.signal, callId, current, fence });
        calls.set(callId, { caller: context, channel: request.channel, handle });
        void handle.settled.then(() => {
          calls.delete(callId);
        });
        return handle;
      }
      if (dispatcher === undefined) return unavailable();
      const candidates: { peer: AHPPeer; ad: Advertisement; registration: ClientToolRegistration; executor: ExecutorRevision }[] = [];
      for (const peer of peers.values()) {
        const ad = advertisements.get(peer.context.connectionId)?.get(request.channel);
        if (ad === undefined || ad.origin !== facts.origin || !advertisementReady(ad) || !ownAdvertisement(peer, request.channel, ad)) continue;
        for (const entry of ad.entries) {
          const definition = entry.registration.definition;
          if (definition.id === contract.id && definition.key === contract.key && definition.version === contract.version) {
            candidates.push({ peer, ad, ...entry });
          }
        }
      }
      // Admission is checked again by the one dispatcher; ambiguity is never an implicit routing policy.
      const selected = candidates[0];
      if (selected === undefined || candidates.length !== 1) return unavailable();
      const controller = new AbortController();
      let enqueued = false;
      // Invalidation retires new dispatch readiness, not ownership of work that
      // has already crossed the exact executor's enqueue boundary.
      const current = (): boolean => livePeer(caller, setup) && caller.subscriptions.has(request.channel)
        && ownAdvertisement(selected.peer, request.channel, selected.ad) && liveSession(facts.origin)
        && (enqueued || advertisementReady(selected.ad));
      const fence = (): boolean => ownedPeer(caller, setup) && ownedPeer(selected.peer, selected.ad.setup)
        && caller.subscriptions.has(request.channel) && selected.peer.subscriptions.has(request.channel)
        && advertisements.get(selected.peer.context.connectionId)?.get(request.channel) === selected.ad
        && sessionTokens.get(request.channel) === facts.origin && (enqueued || advertisementReady(selected.ad));
      const handle = dispatcher.dispatch({ ...restriction, caller: setup.context, origin: facts.origin, sessionType: facts.sessionType,
        providerId: facts.providerId, registration: selected.registration, input: request.input,
        signal: controller.signal, callId, executor: selected.executor, executorContext: selected.ad.setup.context, current, fence,
        send: (input, actionContext, onEnqueued) => new Promise<unknown>((resolve, reject) => {
          if (!current()) {
            reject(new Error("Unavailable"));
            return;
          }
          const privateInvocation = parseToolWire(toolInvokeSchema, {
            version: 1, callId, channel: request.channel, contract: { id: contract.id, key: contract.key, version: contract.version },
            route: actionContext.resources, execution: { binding: selected.registration.implementation,
              registrationRevision: selected.registration.revision, source: selected.registration.source },
            connection: { id: selected.peer.context.connectionId, generation: selected.executor.generation },
            advertisementId: selected.ad.advertisementId, input,
          });
          let cancellationSent = false;
          const cancel = (): void => {
            if (!enqueued || cancellationSent) return;
            cancellationSent = true;
            const correlation = toolCorrelation(privateInvocation);
            selected.peer.context.send({ jsonrpc: JSONRPC_VERSION, method: "x-ahp/tools/cancel",
              params: jsonRpcParamsSchema.parse(parseToolWire(toolExecutorCancelSchema, correlation)) },
            () => pending.get(callId) === entry && ownedPeer(selected.peer, selected.ad.setup));
          };
          const entry: PendingCompletion = { context: selected.peer.context, generation: selected.executor.generation,
            channel: request.channel, invocation: privateInvocation, resolve, reject,
            release: () => {
              actionContext.signal.removeEventListener("abort", cancel);
            } };
          pending.set(callId, entry);
          actionContext.signal.addEventListener("abort", cancel, { once: true });
          const message: JsonRpcMessage = { jsonrpc: JSONRPC_VERSION, method: TOOL_INVOCATION_METHOD,
            params: jsonRpcParamsSchema.parse(privateInvocation) };
          enqueued = selected.peer.context.send(message, handle.current);
          if (enqueued) onEnqueued();
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
  const matched = (params: unknown, context: WebSocketConnectionContext) => {
    let completion: ToolComplete;
    try {
      completion = parseToolWire(toolCompleteSchema, params);
    } catch {
      return undefined;
    }
    const entry = pending.get(completion.callId);
    if (entry === undefined || entry.context !== context || entry.generation !== context.connectionGeneration
      || entry.channel !== completion.channel || !privateProtocol?.negotiated(context)
      || !(["version", "callId", "channel", "contract", "route", "execution", "connection", "advertisementId"] as const)
        .every((key) => JSON.stringify(completion[key]) === JSON.stringify(entry.invocation[key]))) return undefined;
    return { entry, completion };
  };
  const privateProtocol = configuration === undefined
    ? undefined
    : createPrivateToolProtocol({
        continuation: dispatcherOptions?.challenge !== undefined,
        artifacts: artifactSource !== undefined,
        ...(factory.managedTools === undefined
          ? {}
          : { async manage(context, request, signal) {
              const peer = requirePeer(context), setup = context.security;
              if (setup === undefined || !livePeer(peer, setup) || !peer.subscriptions.has(request.channel)) return undefined;
              const facts = session(request.channel);
              const fence = (): boolean => ownedPeer(peer, setup) && peer.subscriptions.has(request.channel) && liveSession(facts.origin);
              return factory.managedTools?.admission.manage({ ...facts, actor: setup.context, signal, fence,
                current: () => livePeer(peer, setup) && fence() }, request);
            } }),
        ready: (context) => {
          const peer = peers.get(context.connectionId), setup = context.security;
          return peer !== undefined && setup !== undefined && livePeer(peer, setup);
        },
        fence: (context) => {
          const peer = peers.get(context.connectionId), setup = context.security;
          return peer !== undefined && setup !== undefined && ownedPeer(peer, setup);
        },
        assignment,
        dispatch: startCall,
        onInvalidate: (listener) => configuration.registry.onInvalidate(() => {
          privateAdvertisementEpoch = {};
          lifecycle?.invalidateChallenges();
          listener();
        }),
      });
  return {
    privateHandlers: privateProtocol?.handlers ?? {},
    observeEnvelope(envelope: ActionEnvelope): void {
      const action = envelope.action;
      if (action.type === ACTION_TYPE_SESSION_META_CHANGED && factory.managedTools !== undefined) privateProtocol?.invalidate(envelope.channel);
    },
    complete(params: unknown, context: WebSocketConnectionContext): null {
      requirePeer(context);
      const match = matched(params, context);
      if (match === undefined) return null;
      match.entry.release();
      pending.delete(match.completion.callId);
      if ("error" in match.completion) match.entry.reject(new Error("Remote tool failed"));
      else match.entry.resolve(match.completion.output);
      return null;
    },
    unsubscribe: (peer: AHPPeer, channel: string) => {
      clearAdvertisement(peer, channel);
      privateProtocol?.forget(peer.context, channel);
    },
    removeSession(channel: string): void {
      privateProtocol?.removeSession(channel);
      sessionTokens.delete(channel);
      for (const sessions of advertisements.values()) sessions.delete(channel);
      for (const call of calls.values()) if (call.channel === channel) call.handle.cancel();
    },
    removeConnection(connectionId: string): void {
      const peer = peers.get(connectionId);
      if (peer !== undefined) privateProtocol?.forget(peer.context);
      advertisements.delete(connectionId);
      for (const call of calls.values()) if (call.caller.connectionId === connectionId || call.executor?.connectionId === connectionId) call.handle.cancel();
    },
    dispose(): void {
      disposed = true;
      privateProtocol?.dispose();
      advertisements.clear();
      sessionTokens.clear();
      stagedPrivateAdvertisements.clear();
      for (const call of calls.values()) call.handle.cancel();
    },
    drain: () => lifecycle?.shutdown() ?? Promise.resolve({ draining: 0 }),
    stats: () => lifecycle?.stats() ?? { active: 0, draining: 0, retainedOutputBytes: 0 },
  };
}

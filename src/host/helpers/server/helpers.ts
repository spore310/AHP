import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { resourceRefSchema, type ReferenceAuthorizer, type ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import type { SessionCreationContext, SessionFactoryAuthorization } from "@sessions/helpers/creation/types";

import { createAgentDirectory } from "@agents";
import { legacyIdentitySource } from "@agents/helpers/policyIdentity/helpers";
import { createActionSequence, createSessionsFactory } from "@sessions";
import { createReservedActionSequence } from "@sessions/helpers/sequence/helpers";
import type { SessionsFactory } from "@sessions/types";
import type { DurableHost, HostEventDelivery } from "@persistence";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebSocketConnectionContext } from "@websocket/types";
import { HOST_HEALTH_LIVE_PATH, HOST_HEALTH_READY_PATH, HOST_HEALTH_STARTUP_PATH } from "../../constants";
import { createHostRouter, createRelayListener } from "../routing";
import { captureHostTopology } from "../topology";
import { createHostedWork } from "../work";
import { createSessionOwnerRegistry, createWorkReadPort } from "@work";

import { createAHPBinding } from "@websocket/helpers/ahp";
import { isSettlingSession } from "@websocket/helpers/settling";
import { createWebSocketServer } from "@websocket/helpers/server";
import { captureTransportLimits } from "@websocket/helpers/capacity";
import { createConnectionSetupAdapter, setupCount, setupDeadline } from "@websocket/helpers/security";
import type { AHPServerHandle, AHPServerOptions, HostPhase } from "../../types";

const HOST_STOPPED = "AHP host cannot be started after shutdown has begun.";
const HOST_SESSIONS_STOPPED = "AHP host sessions cannot be used after shutdown has begun.";
const HOST_SESSIONS_SETTLING = "A session disposal is still settling; create the session once it completes.";

/**
 * Compose one sequence allocator, session factory, AHP binding, and transport.
 *
 * Callers do not register methods or fan-out listeners. `stop()` is terminal
 * and attempts every cleanup even when one fails.
 */
export const createAHPServer = (options: AHPServerOptions): AHPServerHandle => {
  const diagnostic = (event: Parameters<NonNullable<AHPServerOptions["onDiagnostic"]>>[0]["event"], correlationId?: string) => {
    try {
      void Promise.resolve(options.onDiagnostic?.({ event, correlationId: correlationId ?? randomUUID() })).catch(() => undefined);
    } catch { /* Sink failure is isolated. */ }
  };
  const security = options.security;
  const creationConfig = options.sessions.creationSecurity;
  const coherent: unknown = creationConfig?.registry.usesPolicyFactory(creationConfig.policies);
  if (creationConfig !== undefined && (security === undefined || coherent !== true)) {
    throw new Error("Protected host creation requires security and coherent compiler identity.");
  }
  if (options.toolExecution !== undefined && (creationConfig === undefined || security === undefined
    || options.toolExecution.registry !== creationConfig.registry || options.toolExecution.policies !== creationConfig.policies)) {
    throw new Error("Tool execution requires coherent protected host authority.");
  }
  if (options.serverToolExecution !== undefined && (creationConfig === undefined || security === undefined
    || options.serverToolExecution.registry !== creationConfig.registry || options.serverToolExecution.policies !== creationConfig.policies)) {
    throw new Error("Server tool execution requires coherent protected host authority.");
  }
  if (options.protectedViews !== undefined && (creationConfig === undefined || security === undefined
    || options.protectedViews.registry !== creationConfig.registry || options.protectedViews.policies !== creationConfig.policies)) {
    throw new Error("Resource views require coherent protected host authority.");
  }
  const canonicalOwner = creationConfig?.registry.owner.bind(creationConfig.registry);
  const workDomain = security?.workDomainId;
  if (security !== undefined && options.agentWork?.authenticator !== undefined) {
    const source = legacyIdentitySource(security.composition.identity);
    if (source === undefined || source.authenticator !== options.agentWork.authenticator
      || source.domainId !== security.workDomainId) {
      throw new Error("Conflicting security and work identity sources.");
    }
  }
  if (options.agentWork && !security && !options.agentWork.authenticator) throw new TypeError("A work identity source is required.");
  // Validate/capture before creating sessions, listeners, directory or work services.
  const topology = captureHostTopology(options);
  const hostSetup = security === undefined ? undefined : createConnectionSetupAdapter(security);
  const transportLimits = captureTransportLimits(options.transportLimits);
  const deadlineMs = setupDeadline(security?.setupDeadlineMs);
  const maxInitialSubscriptions = setupCount(security?.maxInitialSubscriptions);
  let durability = options.sessions.durability;
  let currentLease: DurableHost | undefined;
  // In a shared namespace the store allocates every native sequence value.
  const sequence = options.sessions.sequence ?? (topology?.shared === true
    ? createReservedActionSequence((count) => {
        const coordination = currentLease?.coordination;
        return coordination === undefined ? Promise.reject(new Error("Server sequence unavailable.")) : coordination.allocateServerSeq(count);
      })
    : createActionSequence());
  let phase: HostPhase = "idle";
  const activation = new AbortController();
  const connections = new Set<WebSocketConnectionContext>();
  const authorityRevoked = (revision: number): void => {
    // Every cached authority in this process hangs off a connection. Closing them is the
    // synchronous local revocation; reconnecting callers are authenticated again from scratch.
    diagnostic("hostAuthorityRevoked");
    for (const context of [...connections]) context.close();
    queueMicrotask(() => currentLease?.coordination?.acknowledgeAuthority(revision));
  };
  if (durability && (options.agentWork || topology)) {
    const acquire = durability.storage.acquire.bind(durability.storage);
    durability = { ...durability, storage: { async acquire(id, onLost) {
      const lease = await acquire(id, onLost, topology?.claim({ signal: activation.signal, onAuthorityRevoked: authorityRevoked, onStandby: () => {
        phase = "standby";
        diagnostic("hostStandby");
      } }));
      currentLease = lease;
      if (!isStopped()) phase = "recovering";
      return lease;
    } } };
  }
  const sessions: SessionsFactory = createSessionsFactory({
    ...options.sessions,
    onDiagnostic(event) {
      diagnostic(event.event);
      if (options.sessions.onDiagnostic !== (options.onDiagnostic as unknown)) {
        try {
          void Promise.resolve(options.sessions.onDiagnostic?.(event)).catch(() => undefined);
        } catch { /* Optional module sink. */ }
      }
    },
    durability,
    sequence,
  });
  let stopped = false;
  const isStopped = (): boolean => stopped;
  const actualAuthorization = sessions.authorization;
  const capturedGetResource = actualAuthorization?.getResource.bind(actualAuthorization);
  const capturedIsReady = actualAuthorization?.isReady.bind(actualAuthorization);
  const capturedUsesRegistry = actualAuthorization?.usesRegistry.bind(actualAuthorization);
  const sessionOwners = actualAuthorization === undefined ? createSessionOwnerRegistry() : undefined;
  const ownerLookup = { owner: (uri: string): string | undefined => {
    if (stopped) return undefined;
    if (sessionOwners !== undefined) return sessionOwners.owner(uri);
    const ref = capturedGetResource?.(uri);
    const owner = ref === undefined ? undefined : canonicalOwner?.(ref);
    if (ref === undefined || capturedGetResource?.(uri) !== ref || isStopped()) return undefined;
    return owner?.domainId === workDomain ? owner?.subject : undefined;
  } };
  const agents = options.agentWork === undefined
    ? undefined
    : createAgentDirectory({
        registrations: options.agentWork.registrations,
        changed: () => { hostedWork?.binding.changed(); },
        domainId: workDomain,
        registrationLimits: options.agentWork.registrationLimits,
        ...(options.agentWork.presenceTtlMs !== undefined
          ? { presenceTtlMs: options.agentWork.presenceTtlMs }
          : {}),
        ...(options.agentWork.now !== undefined ? { now: options.agentWork.now } : {}),
      });
  const hostedWork = agents && createHostedWork(options, sessions, agents, () => currentLease, isStopped, diagnostic);
  const work = options.agentWork === undefined || agents === undefined
    ? undefined
    : createWorkReadPort({
        repository: options.agentWork.work,
        sessions: ownerLookup,
        legacyReadCurrent: () => !stopped && !security,
      });
  const binding = createAHPBinding(
    sessions,
    (event) => { diagnostic(event.event); },
    options.agentWork === undefined || agents === undefined || work === undefined
      ? { maxInitialSubscriptions, nativeWrites: options.nativeWrites, ...(options.toolExecution === undefined ? {} : { toolExecution: options.toolExecution }),
          ...(options.serverToolExecution === undefined ? {} : { serverToolExecution: options.serverToolExecution }),
          ...(options.protectedViews === undefined ? {} : { protectedViews: options.protectedViews }) }
      : {
          maxInitialSubscriptions, nativeWrites: options.nativeWrites,
          ...(options.protectedViews === undefined ? {} : { protectedViews: options.protectedViews }),
          ...(options.toolExecution === undefined ? {} : { toolExecution: options.toolExecution }),
          ...(options.serverToolExecution === undefined ? {} : { serverToolExecution: options.serverToolExecution }),
          agents,
          work,
          protectedWork: hostedWork?.binding,
          prepareToolWork: hostedWork?.prepareToolWork,
          ...(sessionOwners === undefined ? {} : { sessionOwners }),
        },
  );
  const settle = async (connectionId: string): Promise<void> => {
    await sessions.durability?.flush();
    await binding.settle(connectionId);
  };
  const accept = (context: WebSocketConnectionContext): void => {
    connections.add(context);
    context.onClose(() => {
      connections.delete(context);
    });
    hostedWork?.connected(context);
    binding.onConnection(context);
  };
  const routing = topology?.routing;
  const admission = topology?.admission;
  const router = routing === undefined || admission === undefined
    ? undefined
    : createHostRouter({
        admission, coordination: () => currentLease?.isOpen() === true && !stopped ? currentLease.coordination : undefined,
        isLocal: (uri) => capturedGetResource?.(uri) !== undefined || sessions.getSessionSnapshot(uri) !== undefined,
        settleLocal: settle, requestTimeoutMs: routing.requestTimeoutMs, maxPending: routing.maxPending,
        maxLinksPerConnection: routing.maxLinksPerConnection, orderTimeoutMs: routing.orderTimeoutMs,
        ...(routing.connect === undefined ? {} : { connect: routing.connect }), ...(routing.clientTls === undefined ? {} : { tls: routing.clientTls }),
        presenceEpoch: (connectionId) => agents?.getByConnection(connectionId)?.executionEpoch,
      });
  const connectionSetup = hostSetup === undefined || router === undefined ? hostSetup : router.wrapSetup(hostSetup);
  const isReady = (): boolean => phase === "active" && !stopped && (currentLease === undefined || currentLease.isOpen()) && admission?.isCurrent() !== false;
  // Standby, recovery and a dependency outage are alive and unready. Only a stopped host is not alive.
  const health = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    let path: string;
    try {
      path = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      return false;
    }
    const ok = path === HOST_HEALTH_LIVE_PATH
      ? phase !== "stopped"
      : path === HOST_HEALTH_STARTUP_PATH
        ? phase !== "idle" && phase !== "starting" && phase !== "stopped"
        : path === HOST_HEALTH_READY_PATH ? isReady() : undefined;
    if (ok === undefined) return false;
    response.writeHead(ok ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store", "Connection": "close" });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status: ok ? "ok" : "unavailable", phase }));
    return true;
  };
  const transport = createWebSocketServer({
    host: options.host,
    port: options.port,
    path: options.path,
    handlers: router === undefined ? binding.handlers : router.wrapHandlers(binding.handlers),
    transportLimits,
    authentication: security !== undefined || options.agentWork !== undefined ? "required" : "optional",
    setupDeadlineMs: deadlineMs,
    ...(connectionSetup !== undefined
      ? { connectionSetup }
      : options.agentWork !== undefined
        ? { authenticator: options.agentWork.authenticator }
        : {}),
    ...(topology === undefined ? {} : { httpHandler: health, admission: isReady }),
    onConnection: (context) => {
      // The router takes over outbound ordering before any module can send on this connection.
      router?.attach(context);
      accept(context);
    },
    beforeDispatch: (dispatch) => {
      binding.beforeDispatch(dispatch);
    },
  });
  const relay = routing === undefined || admission === undefined || hostSetup === undefined
    ? undefined
    : createRelayListener({
        host: routing.host, port: routing.port, path: routing.path, ...(routing.tls === undefined ? {} : { tls: routing.tls }),
        admission, coordination: () => currentLease?.isOpen() === true ? currentLease.coordination : undefined,
        setup: hostSetup, handlers: binding.handlers, transportLimits, setupDeadlineMs: deadlineMs,
        admitting: () => (phase === "active" || phase === "draining") && !stopped,
        settle, onConnection: accept,
        beforeDispatch: (dispatch) => {
          if (!dispatch.method.startsWith("x-ahp-host/")) binding.beforeDispatch(dispatch);
        },
        async attachAgent(context, agentKey, executionEpoch) {
          const actor = context.security?.context.actor;
          const attach = agents?.attachPresence?.bind(agents);
          // The owner derives the agent from the caller it authenticated itself, never from the relaying host.
          if (attach === undefined || hostedWork === undefined || actor?.kind !== "agent" || context.isSecurityCurrent?.() !== true
            || hostedWork.binding.agentKey(context) !== agentKey) throw new Error("Agent presence unavailable.");
          await attach(actor.principal, agentKey, context.connectionId, executionEpoch);
          hostedWork.binding.changed();
        },
      });
  const hostEventListeners = new Set<(delivery: HostEventDelivery) => void>();
  let stopEvents: (() => void) | undefined;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  let recoveryPending = false;
  /** Restores sessions this host owns that are not live. The session factory serializes concurrent calls. */
  const recoverOwned = async (): Promise<readonly string[]> => {
    const durable = sessions.durability;
    if (durable === undefined || stopped) return [];
    try {
      const restored = await durable.recoverOwned();
      recoveryPending = false;
      return restored;
    } catch (error) {
      // Owned sessions may not be live yet. The periodic reconciliation below tries again.
      recoveryPending = !isStopped();
      if (!isStopped()) diagnostic("hostRecoveryFailed");
      throw error;
    }
  };
  /** Adoption is bounded per transaction, so a large owner is taken over in several steps. */
  const adoptAll = async (coordination: NonNullable<DurableHost["coordination"]>, fromHostId: string): Promise<string[]> => {
    const adopted: string[] = [];
    for (let round = 0; round < 64; round += 1) {
      const moved = await coordination.adopt(fromHostId);
      adopted.push(...moved.map((location) => location.session.id));
      if (moved.length < 64) break;
    }
    return adopted;
  };
  const sweep = async (): Promise<void> => {
    const coordination = currentLease?.coordination;
    if (coordination === undefined || topology === undefined || stopped || phase !== "active" || admission?.allows(topology.hostId, "adopt") === false) return;
    try {
      let adopted = 0;
      for (const orphan of await coordination.orphanedOwners()) {
        // Refused while the previous owner's lease or membership is still live.
        adopted += (await adoptAll(coordination, orphan).catch(() => [])).length;
      }
      if (adopted > 0 || recoveryPending) await recoverOwned();
    } catch {
      diagnostic("hostAdoptionFailed");
    }
  };
  const watchCoordination = (): void => {
    const coordination = currentLease?.coordination;
    if (coordination === undefined || topology === undefined) return;
    stopEvents = coordination.subscribeEvents((delivery) => {
      router?.invalidate();
      if (delivery.type === "reset") {
        // Retained events were skipped: reconcile from current state instead of trusting the stream.
        void recoverOwned().catch(() => undefined);
        hostedWork?.binding.changed();
      } else {
        const event = delivery.event;
        if (event.topic === "ownership" && event.entityId === topology.hostId) void recoverOwned().catch(() => undefined);
        if (event.topic === "work" && event.originHostId !== topology.hostId) hostedWork?.binding.changed();
        if (event.topic === "membership" && topology.adoption === "automatic") void sweep();
      }
      for (const listener of [...hostEventListeners]) {
        try {
          listener(delivery);
        } catch { /* One observer cannot block another. */ }
      }
    });
    if (topology.shared) {
      // Reconciles what this host owns with what it serves, and takes over orphaned owners when configured.
      sweepTimer = setInterval(() => {
        if (topology.adoption === "automatic") void sweep();
        else if (recoveryPending) void recoverOwned().catch(() => undefined);
      }, 2_000);
      sweepTimer.unref();
    }
  };
  const requireCoordination = () => {
    const coordination = currentLease?.isOpen() === true && !stopped ? currentLease.coordination : undefined;
    if (coordination === undefined) throw new Error("Host coordination is unavailable.");
    return coordination;
  };
  const assertSessionsOpen = (): void => {
    if (stopped) {
      throw new Error(HOST_SESSIONS_STOPPED);
    }
  };

  const channelFromParams = (params: unknown): string | undefined => {
    if (typeof params !== "object" || params === null || !("channel" in params)) {
      return undefined;
    }
    const { channel } = params;
    return typeof channel === "string" ? channel : undefined;
  };

  const hostedAuthorization: SessionFactoryAuthorization | undefined = actualAuthorization === undefined
    ? undefined
    : Object.freeze({
        resolveWorkType: actualAuthorization.resolveWorkType.bind(actualAuthorization),
        usesRegistry: (registry: ReferenceAuthorizer) => capturedUsesRegistry?.(registry) === true,
        isReady: (expected: ResourceRef<"session">) => !stopped && capturedIsReady?.(expected) === true && !stopped,
        createSession: (params: unknown, caller: SessionCreationContext) => {
          assertSessionsOpen();
          return actualAuthorization.createSession(params, caller);
        },
        getResource: (uri: string) => {
          assertSessionsOpen();
          return capturedGetResource?.(uri);
        },
        isSettling: (uri: string) => {
          assertSessionsOpen();
          return actualAuthorization.isSettling(uri);
        },
        disposeSession: async (expected: ResourceRef<"session">, admission?: () => boolean) => {
          assertSessionsOpen();
          const parsed = resourceRefSchema.parse(expected);
          if (parsed.kind !== "session") throw new Error("Invalid session resource.");
          const captured = Object.freeze({ ...parsed, kind: "session" as const });
          const current = actualAuthorization.getResource(captured.id);
          if (current === undefined) return actualAuthorization.disposeSession(captured, admission);
          if (!sameResource(current, captured)) return false;
          if (!sessions.durability) await work?.assertSessionDisposable(captured.id);
          return actualAuthorization.disposeSession(captured, admission);
        },
      });

  const hostedSessions: SessionsFactory = {
    ...(sessions.durability ? { durability: sessions.durability } : {}),
    ...(hostedAuthorization === undefined ? {} : { authorization: hostedAuthorization }),
    ...(sessions.managedTools === undefined ? {} : { managedTools: sessions.managedTools }),
    createSession: (params: unknown): Promise<void> => {
      if (stopped) {
        return Promise.reject(new Error(HOST_SESSIONS_STOPPED));
      }
      const channel = channelFromParams(params);
      // Mirror the AHP handler: an owner binding without a live record marks a
      // disposal still settling, and a create landing in the window would leave
      // an ownerless record behind once the settlement releases the binding.
      if (channel !== undefined && (actualAuthorization?.isSettling(channel) ?? (sessionOwners !== undefined && isSettlingSession(sessionOwners, sessions, channel)))) {
        return Promise.reject(new Error(HOST_SESSIONS_SETTLING));
      }
      return sessions.createSession(params);
    },
    getSessionSnapshot: (sessionUri: string) => sessions.getSessionSnapshot(sessionUri),
    getSessionToolManifest: (sessionUri: string) => sessions.getSessionToolManifest(sessionUri),
    listSessionSnapshots: () => sessions.listSessionSnapshots(),
    listSessions: (params) => {
      assertSessionsOpen();
      return sessions.listSessions(params);
    },
    disposeSession: async (params) => {
      if (stopped) {
        throw new Error(HOST_SESSIONS_STOPPED);
      }
      const channel = channelFromParams(params);
      if (hostedAuthorization !== undefined && channel !== undefined) {
        const expected = actualAuthorization?.getResource(channel);
        if (expected === undefined) return sessions.disposeSession(params);
        await hostedAuthorization.disposeSession(expected);
        return;
      }
      if (work !== undefined && channel !== undefined) {
        await work.assertSessionDisposable(channel);
      }
      try {
        await sessions.disposeSession(params);
      } finally {
        // Mirror the AHP handler: the owner binding is released when the
        // record is removed, even when backend disposal fails.
        if (channel !== undefined) {
          sessionOwners?.unbind(channel);
        }
      }
    },
    getCurrentServerSeq: () => sessions.getCurrentServerSeq(),
    listAgents: () => sessions.listAgents(),
    dispatchAction: async (params) => {
      assertSessionsOpen();
      return sessions.dispatchAction(params);
    },
    onCatalogueNotification: (listener) => sessions.onCatalogueNotification(listener),
    onSessionEnvelope: (listener) => sessions.onSessionEnvelope(listener),
    dispose: () => sessions.dispose(),
  };

  const disposeAgentWork = async (): Promise<void> => {
    if (options.agentWork?.dispose === undefined) {
      return;
    }
    await options.agentWork.dispose();
  };

  const performStop = async (): Promise<void> => {
    const failures: unknown[] = [];
    const attempt = async (cleanup: () => unknown): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    };
    const retireAdmissions = attempt(() => sessions.managedTools?.admission.dispose());
    const retireOwners = attempt(() => sessionOwners?.clear());
    // Protected in-process callers must be cancelled synchronously too, before socket shutdown awaits.
    const earlyDisposal = actualAuthorization === undefined ? undefined : attempt(() => sessions.dispose());
    await attempt(() => relay?.stop());
    await attempt(() => transport.stop());
    await attempt(() => {
      binding.dispose();
    });
    await attempt(() => binding.drainTools());
    await (earlyDisposal ?? attempt(() => sessions.dispose()));
    await attempt(disposeAgentWork);
    await Promise.all([retireAdmissions, retireOwners]);
    if (failures.length > 0) {
      throw new AggregateError(failures, "AHP host shutdown failed");
    }
  };
  let shutdown: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (shutdown !== undefined) return shutdown;
    const completion = Promise.withResolvers<undefined>();
    shutdown = completion.promise;
    stopped = true;
    phase = "stopped";
    activation.abort();
    clearInterval(sweepTimer);
    stopEvents?.();
    hostEventListeners.clear();
    router?.close();
    hostedWork?.close();
    void performStop().then(() => {
      completion.resolve(undefined);
    }, completion.reject);
    return shutdown;
  };

  return {
    work: hostedWork?.service,
    get workMethods() {
      return Object.freeze(Object.keys(binding.handlers).filter((method) => method.startsWith("x-ahp/work/")
        && (currentLease?.workEvents || (method !== "x-ahp/work/subscribe" && method !== "x-ahp/work/unsubscribe"))));
    },
    prepareResourceWork: hostedWork?.prepareResourceWork,
    workConfiguration: hostedWork?.configuration,
    setAgentEnabled: hostedWork && agents.setEnabled.bind(agents),
    toolExecutionStats: binding.toolStats.bind(binding),
    sessions: hostedSessions,
    start: async (): Promise<AddressInfo> => {
      if (stopped) {
        throw new Error(HOST_STOPPED);
      }
      // Ownership, recovery and work services complete before this instance reports ready.
      const activate = async (): Promise<void> => {
        if (sessions.durability) await sessions.durability.start(() => {
          void stop().catch(() => undefined);
        });
        if (isStopped()) throw new Error(HOST_STOPPED);
        await hostedWork?.start();
        await relay?.start();
        if (isStopped()) throw new Error(HOST_STOPPED);
        watchCoordination();
        phase = "active";
        if (topology !== undefined) diagnostic("hostActive");
        if (topology?.adoption === "automatic") void sweep();
      };
      try {
        phase = "starting";
        if (topology?.standby === true) {
          // A replica is observable before it owns anything: the listener answers
          // probes and refuses protocol traffic until activation finishes.
          const address = await transport.start();
          void activate().catch(() => {
            if (isStopped()) return;
            diagnostic("lifecycleFailed");
            void stop().catch(() => undefined);
          });
          return address;
        }
        await activate();
        return await transport.start();
      } catch (error) {
        diagnostic("lifecycleFailed");
        await stop();
        throw error;
      }
    },
    stop,
    status: () => Object.freeze({
      mode: topology?.mode ?? "single", phase, ready: isReady(),
      ...(topology === undefined ? {} : { hostId: topology.hostId, namespaceId: topology.namespaceId, instanceId: topology.instanceId }),
      ...(currentLease?.coordination === undefined ? {} : { generation: currentLease.coordination.generation, authorityRevision: currentLease.coordination.authorityRevision() }),
      ...(currentLease === undefined ? {} : { epoch: currentLease.epoch }),
    }),
    async drain(input) {
      if (stopped) return stop();
      // Unready first: new connections are refused while admitted work settles.
      phase = "draining";
      const coordination = currentLease?.coordination;
      await coordination?.setRole("draining").catch(() => undefined);
      const durable = sessions.durability;
      if (input?.transferTo !== undefined && durable !== undefined && topology?.shared === true) {
        for (const snapshot of sessions.listSessionSnapshots()) {
          await durable.transfer(snapshot.resource, input.transferTo).catch(() => {
            diagnostic("hostRecoveryFailed");
          });
        }
      }
      return stop();
    },
    members: async () => requireCoordination().members(),
    async transferSession(sessionUri, toHostId) {
      const durable = sessions.durability;
      if (durable === undefined || topology?.shared !== true) throw new Error("Session transfer requires a distributed host.");
      requireCoordination();
      // Trusted policy decides who may own sessions. The store decides whether that member is fit right now.
      if (admission?.allows(toHostId, "serve") === false) throw new Error("That host is not permitted to serve sessions.");
      try {
        await durable.transfer(sessionUri, toHostId);
      } catch (error) {
        // After a refusal that withdrew nothing there is nothing to restore. Otherwise the session may be
        // owned here and served nowhere: a restoration that fails now is retried by the reconciliation timer.
        if (sessions.getSessionSnapshot(sessionUri) === undefined) await recoverOwned().catch(() => undefined);
        throw error;
      }
    },
    async adoptSessions(fromHostId) {
      if (topology?.shared !== true || admission?.allows(topology.hostId, "adopt") === false) throw new Error("Session adoption is not permitted for this host.");
      const adopted = await adoptAll(requireCoordination(), fromHostId);
      await recoverOwned();
      return adopted;
    },
    revokeNamespaceAuthority: async () => requireCoordination().revokeAuthority(),
    onHostEvent(listener) {
      hostEventListeners.add(listener);
      return () => {
        hostEventListeners.delete(listener);
      };
    },
    routingStats: () => router?.stats() ?? { connections: 0, links: 0, pending: 0, held: 0 },
  };
};

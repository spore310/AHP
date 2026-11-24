import type { AddressInfo } from "node:net";
import { resourceRefSchema, type ReferenceAuthorizer, type ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import type { SessionCreationContext, SessionFactoryAuthorization } from "@sessions/helpers/creation/types";

import { createAgentDirectory } from "@agents";
import { legacyIdentitySource } from "@agents/helpers/policyIdentity/helpers";
import { createActionSequence, createSessionsFactory } from "@sessions";
import type { SessionsFactory } from "@sessions/types";
import type { DurableWorkRepository } from "@persistence/helpers/durability/workTypes";
import { createSessionOwnerRegistry, createWorkReadPort } from "@work";

import { createAHPBinding } from "../ahp";
import { TOOL_CALL_METHOD, TOOL_COMPLETE_METHOD } from "../ahp/constants";
import { isSettlingSession } from "../settling";
import { createWebSocketServer } from "../server";
import { captureTransportLimits } from "../capacity";
import { createConnectionSetupAdapter, setupCount, setupDeadline } from "../security";
import type { AHPServerHandle, AHPServerOptions } from "./types";

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
  if (security !== undefined && options.agentWork !== undefined) {
    const source = legacyIdentitySource(security.composition.identity);
    if (source === undefined || source.authenticator !== options.agentWork.authenticator
      || source.domainId !== security.workDomainId) {
      throw new Error("Conflicting security and work identity sources.");
    }
  }
  // Validate/capture before creating sessions, listeners, directory or work services.
  const connectionSetup = security === undefined ? undefined : createConnectionSetupAdapter(security);
  const transportLimits = captureTransportLimits(options.transportLimits);
  const deadlineMs = setupDeadline(security?.setupDeadlineMs);
  const maxInitialSubscriptions = setupCount(security?.maxInitialSubscriptions);
  const sequence = options.sessions.sequence ?? createActionSequence();
  let durability = options.sessions.durability;
  let canonicalRead: { get: DurableWorkRepository["get"]; isOpen(): boolean } | undefined;
  if (durability && options.agentWork) {
    const acquire = durability.storage.acquire.bind(durability.storage);
    durability = { ...durability, storage: { async acquire(id, onLost) {
      const lease = await acquire(id, onLost);
      canonicalRead = { get: lease.work.get.bind(lease.work), isOpen: lease.isOpen.bind(lease) };
      return lease;
    } } };
  }
  const sessions: SessionsFactory = createSessionsFactory({
    ...options.sessions,
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
        domainId: workDomain,
        registrationLimits: options.agentWork.registrationLimits,
        ...(options.agentWork.presenceTtlMs !== undefined
          ? { presenceTtlMs: options.agentWork.presenceTtlMs }
          : {}),
        ...(options.agentWork.now !== undefined ? { now: options.agentWork.now } : {}),
      });
  const work = options.agentWork === undefined || agents === undefined
    ? undefined
    : createWorkReadPort({
        repository: options.agentWork.work,
        sessions: ownerLookup,
        ...(sessions.durability
          ? {
              canonicalGet: (domainId, id) => canonicalRead?.isOpen() ? canonicalRead.get(domainId, id) : Promise.resolve(undefined),
              currentInstance: (uri, instanceId, subject, domainId) => {
                const ref = capturedGetResource?.(uri);
                if (!ref || stopped || ref.instanceId !== instanceId || ref.domainId !== domainId) return false;
                const owner = canonicalOwner?.(ref);
                return owner?.domainId === domainId && owner.subject === subject && capturedIsReady?.(ref) === true
                  && capturedGetResource?.(uri) === ref && canonicalRead?.isOpen() === true && !isStopped();
              },
            }
          : { legacyReadCurrent: () => !stopped }),
      });
  const binding = createAHPBinding(
    sessions,
    () => undefined,
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
          ...(sessionOwners === undefined ? {} : { sessionOwners }),
        },
  );
  const transport = createWebSocketServer({
    host: options.host,
    port: options.port,
    path: options.path,
    handlers: binding.handlers,
    transportLimits,
    authentication: security !== undefined || options.agentWork !== undefined ? "required" : "optional",
    setupDeadlineMs: deadlineMs,
    ...(connectionSetup !== undefined
      ? { connectionSetup }
      : options.agentWork !== undefined
        ? { authenticator: options.agentWork.authenticator }
        : {}),
    onConnection: (context) => {
      binding.onConnection(context);
    },
    beforeDispatch: (dispatch) => {
      binding.beforeDispatch(dispatch);
    },
    deferredRequestCompletionMethods: new Map([[TOOL_CALL_METHOD, {
      method: TOOL_COMPLETE_METHOD,
      matches: (params, context) => binding.isToolCompletion(params, context),
    }]]),
  });
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
    void performStop().then(() => {
      completion.resolve(undefined);
    }, completion.reject);
    return shutdown;
  };

  return {
    toolExecutionStats: binding.toolStats.bind(binding),
    sessions: hostedSessions,
    start: async (): Promise<AddressInfo> => {
      if (stopped) {
        throw new Error(HOST_STOPPED);
      }
      try {
        if (sessions.durability) await sessions.durability.start(() => {
          void stop().catch(() => undefined);
        });
        if (isStopped()) throw new Error(HOST_STOPPED);
        return await transport.start();
      } catch (error) {
        await stop();
        throw error;
      }
    },
    stop,
  };
};

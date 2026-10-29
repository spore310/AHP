import type { AddressInfo } from "node:net";
import { resourceRefSchema, type ReferenceAuthorizer, type ResourceRef } from "@authorization";
import { sameResource } from "@authorization/helpers/context";
import type { SessionCreationContext, SessionFactoryAuthorization } from "@sessions/helpers/creation/types";

import { createAgentDirectory } from "@agents";
import { legacyIdentitySource } from "@agents/helpers/policyIdentity/helpers";
import type { DurableSessionInput } from "@persistence/types";
import { createActionSequence, createSessionsFactory } from "@sessions";
import type { SessionsFactory } from "@sessions/types";
import { createSessionOwnerRegistry, createWorkService } from "@work";

import { createAHPBinding } from "../ahp";
import { TOOL_CALL_METHOD, TOOL_COMPLETE_METHOD } from "../ahp/constants";
import { isSettlingSession } from "../settling";
import { createWebSocketServer } from "../server";
import { createConnectionSetupAdapter, setupCount, setupDeadline } from "../security";
import type { AHPServerHandle, AHPServerOptions } from "./types";

const HOST_STOPPED = "AHP host cannot be started after shutdown has begun.";
const HOST_SESSIONS_STOPPED = "AHP host sessions cannot be used after shutdown has begun.";
const HOST_SESSIONS_SETTLING = "A session disposal is still settling; create the session once it completes.";

const collectFailure = (failures: unknown[], error: unknown): void => {
  failures.push(error);
};

/**
 * Project the live session snapshot into the durable row shape.
 *
 * Only the session URI should reach this function. The provider is read from
 * the session state the factory exposes; an absent provider is treated as an
 * unavailable projection rather than inventing metadata.
 */
const describeSession = (
  sessions: SessionsFactory,
): ((sessionUri: string) => DurableSessionInput | undefined) =>
  (sessionUri: string): DurableSessionInput | undefined => {
    const snapshot = sessions.getSessionSnapshot(sessionUri);
    if (snapshot === undefined) {
      return undefined;
    }
    const state = snapshot.state as { readonly provider?: unknown };
    if (typeof state.provider !== "string") {
      return undefined;
    }
    const now = new Date().toISOString();
    return {
      sessionUri,
      ownerPrincipalSubject: "",
      providerId: state.provider,
      createdAt: now,
      modifiedAt: now,
      lastServerSeq: snapshot.fromSeq,
      durableState: {
        fromSeq: snapshot.fromSeq,
        state: snapshot.state,
      },
    };
  };

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
  const deadlineMs = setupDeadline(security?.setupDeadlineMs);
  const maxInitialSubscriptions = setupCount(security?.maxInitialSubscriptions);
  const sequence = options.sessions.sequence ?? createActionSequence();
  const sessions: SessionsFactory = createSessionsFactory({
    ...options.sessions,
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
        ...(options.agentWork.presenceTtlMs !== undefined
          ? { presenceTtlMs: options.agentWork.presenceTtlMs }
          : {}),
        ...(options.agentWork.now !== undefined ? { now: options.agentWork.now } : {}),
      });
  const describe = describeSession(sessions);
  const work = options.agentWork === undefined || agents === undefined
    ? undefined
    : createWorkService({
        repository: options.agentWork.work,
        sessions: ownerLookup,
        presence: agents,
        registrations: options.agentWork.registrations,
        describeSession: (sessionUri): DurableSessionInput | undefined => {
          const projection = describe(sessionUri);
          if (projection === undefined) {
            return undefined;
          }
          const owner = ownerLookup.owner(sessionUri);
          return owner === undefined
            ? undefined
            : { ...projection, ownerPrincipalSubject: owner };
        },
        allowedKinds: options.agentWork.allowedKinds,
        ...(options.agentWork.now !== undefined ? { now: options.agentWork.now } : {}),
      });
  const binding = createAHPBinding(
    sessions,
    () => undefined,
    options.agentWork === undefined || agents === undefined || work === undefined
      ? { maxInitialSubscriptions, ...(options.toolExecution === undefined ? {} : { toolExecution: options.toolExecution }) }
      : {
          maxInitialSubscriptions,
          ...(options.toolExecution === undefined ? {} : { toolExecution: options.toolExecution }),
          agents,
          work,
          ...(sessionOwners === undefined ? { ownerLookup } : { sessionOwners }),
        },
  );
  const transport = createWebSocketServer({
    host: options.host,
    port: options.port,
    path: options.path,
    handlers: binding.handlers,
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
        disposeSession: async (expected: ResourceRef<"session">) => {
          assertSessionsOpen();
          const parsed = resourceRefSchema.parse(expected);
          if (parsed.kind !== "session") throw new Error("Invalid session resource.");
          const captured = Object.freeze({ ...parsed, kind: "session" as const });
          const current = actualAuthorization.getResource(captured.id);
          if (current === undefined) return actualAuthorization.disposeSession(captured);
          if (!sameResource(current, captured)) return false;
          await work?.assertSessionDisposable(captured.id);
          return actualAuthorization.disposeSession(captured);
        },
      });

  const hostedSessions: SessionsFactory = {
    ...(hostedAuthorization === undefined ? {} : { authorization: hostedAuthorization }),
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
    dispatchAction: (params) => {
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

  const stop = async (): Promise<void> => {
    if (stopped) {
      await transport.stop();
      return;
    }
    stopped = true;
    sessionOwners?.clear();
    const failures: unknown[] = [];
    // Protected in-process callers must be cancelled synchronously too, before socket shutdown awaits.
    const earlyDisposal = actualAuthorization === undefined
      ? undefined
      : sessions.dispose().catch((error: unknown) => {
          collectFailure(failures, error);
        });
    try {
      await transport.stop();
    } catch (error) {
      collectFailure(failures, error);
    }
    try {
      binding.dispose();
      await binding.drainTools();
    } catch (error) {
      collectFailure(failures, error);
    }
    try {
      await (earlyDisposal ?? sessions.dispose());
    } catch (error) {
      collectFailure(failures, error);
    }
    try {
      await disposeAgentWork();
    } catch (error) {
      collectFailure(failures, error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "AHP host shutdown failed");
    }
  };

  return {
    toolExecutionStats: binding.toolStats.bind(binding),
    sessions: hostedSessions,
    start: async (): Promise<AddressInfo> => {
      if (stopped) {
        throw new Error(HOST_STOPPED);
      }
      try {
        return await transport.start();
      } catch (error) {
        await stop();
        throw error;
      }
    },
    stop,
  };
};

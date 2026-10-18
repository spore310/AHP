import { AhpErrorCodes, JsonRpcErrorCodes, type ActionEnvelope } from "@microsoft/agent-host-protocol";

import { ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED, ROOT_CHANNEL_URI } from "@sessions/constants";
import { executeCreateSession } from "@sessions/createSession";
import {
  BASELINE_UNSUPPORTED_ACTION_REASON,
  isBaselineSupportedSessionAction,
  parseClientSeq,
  parseClientSessionAction,
  toClientSessionAction,
  toSupportedSessionAction,
} from "@sessions/helpers/actions";
import { SessionsDisposingError, SessionsError } from "@sessions/helpers/errors";
import { createInMemorySessionRegistry } from "@sessions/helpers/registry";
import {
  adaptSequenceAllocator,
  createActionSequence,
  type ActionSequence,
} from "@sessions/helpers/sequence";
import { applySessionAction, buildSessionSnapshot } from "@sessions/helpers/state";
import { buildSessionSummary, changedSessionSummaryFields } from "@sessions/helpers/summary";
import type {
  CatalogueNotification,
  SessionProvider,
  SessionsDependencies,
  SessionsDiagnostic,
  SessionsFactory,
  SessionsFactoryOptions,
  SessionSnapshot,
} from "@sessions/types";

/**
 * Creates the host's session factory.
 *
 * The factory owns the provider registry, the in-memory session store, the
 * shared action-sequence allocator, and the event seams a connection layer
 * subscribes to. It is deliberately AHP-aware (parameters, action envelopes,
 * snapshots, catalogue methods) but transport-agnostic: it imports no network
 * or JSON-RPC transport and can be composed behind any transport.
 */
export function createSessionsFactory(options: SessionsFactoryOptions): SessionsFactory {
  const providers = buildProviderMap(options.providers);
  const defaultProviderId = resolveDefaultProviderId(options, providers);
  const sessions = options.registryFactory === undefined
    ? createInMemorySessionRegistry()
    : options.registryFactory();
  const now = options.now ?? ((): Date => new Date());
  const sequence = resolveActionSequence(options);
  const nextServerSeq = (): number => sequence.next();

  const catalogueListeners = new Set<(notification: CatalogueNotification) => void>();
  const envelopeListeners = new Set<(envelope: ActionEnvelope) => void>();

  let shutdown: Promise<void> | null = null;

  const dependencies: SessionsDependencies = {
    providers,
    defaultProviderId,
    sessions,
    now,
    nextServerSeq,
    emitCatalogueNotification: (notification: CatalogueNotification): void => {
      deliver(catalogueListeners, notification);
    },
    emitSessionEnvelope: (envelope: ActionEnvelope): void => {
      deliver(envelopeListeners, envelope);
    },
    reportDiagnostic: (diagnostic: SessionsDiagnostic): void => {
      // A broken sink must not break lifecycle cleanup, and detached callbacks
      // have no caller to observe a throw.
      try {
        options.onDiagnostic?.(diagnostic);
      } catch {
        // Isolated intentionally.
      }
    },
  };

  const dispose = (): Promise<void> => {
    // Share one in-flight shutdown so concurrent callers await the same
    // cleanup, then reset so a later dispose cleans a reused factory again.
    shutdown ??= performDispose().finally(() => {
      shutdown = null;
    });
    return shutdown;
  };

  /**
   * Clears the registry and listeners synchronously, then releases every
   * attached backend, collecting failures. Backends still starting are skipped:
   * their completion detects the cleared registry and disposes itself detached.
   */
  const emitActiveSessionsChanged = (): void => {
    const envelope: ActionEnvelope = {
      channel: ROOT_CHANNEL_URI,
      action: {
        type: ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED,
        activeSessions: sessions.size,
      },
      serverSeq: sequence.next(),
      origin: undefined,
    };
    deliver(envelopeListeners, envelope);
  };

  async function performDispose(): Promise<void> {
    const records = sessions.records();
    sessions.clear();
    if (records.length > 0) {
      emitActiveSessionsChanged();
    }
    catalogueListeners.clear();
    envelopeListeners.clear();

    const failures: unknown[] = [];
    for (const record of records) {
      // A record without a backend is still starting; its completion detects
      // the cleared registry and disposes itself without publishing.
      if (record.backend === undefined) {
        continue;
      }
      try {
        await record.backend.dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Failed to dispose one or more session backends.",
      );
    }
  }

  return {
    createSession: (params: unknown): Promise<void> => {
      // Disposal clears the registry and listeners and releases attached
      // backends; accepting a session now would register it after that
      // boundary. Reuse is allowed again once disposal settles.
      if (shutdown !== null) {
        return Promise.reject(new SessionsDisposingError());
      }
      const previousCount = sessions.size;
      return executeCreateSession(dependencies, params).then(() => {
        if (sessions.size !== previousCount) {
          emitActiveSessionsChanged();
        }
      });
    },
    getSessionSnapshot: (sessionUri: string): SessionSnapshot | undefined => {
      const record = sessions.get(sessionUri);
      return record === undefined ? undefined : buildSessionSnapshot(record);
    },
    listSessionSnapshots: (): SessionSnapshot[] => {
      return sessions.records().map((record) => buildSessionSnapshot(record));
    },
    getCurrentServerSeq: (): number => sequence.current(),
    listAgents: () => [...providers.values()].map((provider) => structuredClone(provider.agentInfo)),
    onCatalogueNotification: (listener) => subscribe(catalogueListeners, listener),
    onSessionEnvelope: (listener) => subscribe(envelopeListeners, listener),
    dispatchAction: ({ channel, clientSeq, action, clientId }) => {
      if (typeof channel !== "string" || channel.length === 0) {
        throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction channel");
      }
      if (typeof clientId !== "string" || clientId.length === 0) {
        throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction clientId");
      }

      const parsedClientSeq = parseClientSeq(clientSeq);
      const parsedAction = parseClientSessionAction(action);

      const record = sessions.get(channel);
      if (record === undefined) {
        throw new SessionsError(
          AhpErrorCodes.SessionNotFound,
          `Session not found: ${channel}`,
        );
      }

      if (!isBaselineSupportedSessionAction(parsedAction)) {
        return {
          channel,
          action: toClientSessionAction(parsedAction),
          serverSeq: sequence.next(),
          origin: { clientId, clientSeq: parsedClientSeq },
          rejectionReason: BASELINE_UNSUPPORTED_ACTION_REASON,
        } satisfies ActionEnvelope;
      }

      const before = buildSessionSummary(record);
      const envelope = applySessionAction(
        record,
        toSupportedSessionAction(parsedAction),
        now().toISOString(),
        nextServerSeq,
      );
      const stamped = {
        ...envelope,
        origin: { clientId, clientSeq: parsedClientSeq },
      } satisfies ActionEnvelope;
      deliver(envelopeListeners, stamped);

      const changes = changedSessionSummaryFields(before, buildSessionSummary(record));
      if (Object.keys(changes).length > 0) {
        deliver(catalogueListeners, {
          method: "root/sessionSummaryChanged",
          params: {
            channel: ROOT_CHANNEL_URI,
            session: record.sessionUri,
            changes,
          },
        });
      }

      return stamped;
    },
    dispose,
  };
}

/**
 * Delivers an isolated copy to each listener.
 *
 * Per-listener cloning means a mutating observer cannot change authoritative
 * state or what later observers receive, and a throwing observer cannot block
 * other observers or the operation that produced the event. Delivery failures
 * are dropped here; operational diagnostics belong to the composition root.
 */
function deliver<TValue>(
  listeners: ReadonlySet<(value: TValue) => void>,
  value: TValue,
): void {
  for (const listener of [...listeners]) {
    try {
      listener(structuredClone(value));
    } catch {
      // Isolated intentionally: a broken subscriber must not veto the caller.
    }
  }
}

function buildProviderMap(
  providers: readonly SessionProvider[],
): ReadonlyMap<string, SessionProvider> {
  if (providers.length === 0) {
    throw new Error("A sessions factory requires at least one session provider.");
  }

  const map = new Map<string, SessionProvider>();
  for (const provider of providers) {
    if (provider.providerId.length === 0) {
      throw new Error("Session providers must have a non-empty providerId.");
    }
    if (map.has(provider.providerId)) {
      throw new Error(`Duplicate session provider id: ${provider.providerId}`);
    }
    map.set(provider.providerId, provider);
  }

  return map;
}

function resolveDefaultProviderId(
  options: SessionsFactoryOptions,
  providers: ReadonlyMap<string, SessionProvider>,
): string {
  const defaultProviderId = options.defaultProviderId ?? firstProviderId(providers);
  if (!providers.has(defaultProviderId)) {
    throw new Error(`Default provider is not registered: ${defaultProviderId}`);
  }

  return defaultProviderId;
}

function resolveActionSequence(options: SessionsFactoryOptions): ActionSequence {
  if (options.sequence !== undefined) {
    return options.sequence;
  }
  if (options.nextServerSeq !== undefined) {
    return adaptSequenceAllocator(options.nextServerSeq);
  }
  return createActionSequence();
}

function firstProviderId(providers: ReadonlyMap<string, SessionProvider>): string {
  const [firstProviderId] = providers.keys();
  if (firstProviderId === undefined) {
    // Unreachable: buildProviderMap rejects empty provider lists.
    throw new Error("A sessions factory requires at least one session provider.");
  }

  return firstProviderId;
}

/** Adds a listener and returns an unsubscribe function. */
function subscribe<TValue>(
  listeners: Set<(value: TValue) => void>,
  listener: (value: TValue) => void,
): () => void {
  listeners.add(listener);

  return (): void => {
    listeners.delete(listener);
  };
}

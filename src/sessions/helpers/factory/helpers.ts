import type { ActionEnvelope } from "@microsoft/agent-host-protocol";

import { executeCreateSession } from "@/sessions/createSession";
import { createInMemorySessionRegistry } from "@/sessions/helpers/registry";
import { createSequenceAllocator } from "@/sessions/helpers/sequence";
import { buildSessionSnapshot } from "@/sessions/helpers/state";
import type {
  CatalogueNotification,
  SessionProvider,
  SessionsDependencies,
  SessionsFactory,
  SessionsFactoryOptions,
  SessionSnapshot,
} from "@/sessions/types";

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
  const sessions = createInMemorySessionRegistry();
  const now = options.now ?? ((): Date => new Date());
  const nextServerSeq = options.nextServerSeq ?? createSequenceAllocator();

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
  };

  const dispose = (): Promise<void> => {
    // Share one in-flight shutdown so concurrent callers await the same
    // cleanup, then reset so a later dispose cleans a reused factory again.
    shutdown ??= performDispose().finally(() => {
      shutdown = null;
    });
    return shutdown;
  };

  async function performDispose(): Promise<void> {
    const records = sessions.records();
    sessions.clear();
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
    createSession: (params: unknown): Promise<void> => executeCreateSession(dependencies, params),
    getSessionSnapshot: (sessionUri: string): SessionSnapshot | undefined => {
      const record = sessions.get(sessionUri);
      return record === undefined ? undefined : buildSessionSnapshot(record);
    },
    listAgents: () => [...providers.values()].map((provider) => structuredClone(provider.agentInfo)),
    onCatalogueNotification: (listener) => subscribe(catalogueListeners, listener),
    onSessionEnvelope: (listener) => subscribe(envelopeListeners, listener),
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

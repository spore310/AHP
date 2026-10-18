import type { ActionEnvelope } from "@microsoft/agent-host-protocol";

import { executeCreateSession } from "@/sessions/createSession";
import { createInMemorySessionRegistry } from "@/sessions/helpers/registry";
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
 * The factory owns the provider registry, the in-memory session store, and the
 * event seams a connection layer subscribes to. It knows nothing about the wire
 * protocol, so it can be composed with any transport.
 */
export function createSessionsFactory(options: SessionsFactoryOptions): SessionsFactory {
  const providers = buildProviderMap(options.providers);
  const defaultProviderId = resolveDefaultProviderId(options, providers);
  const sessions = createInMemorySessionRegistry();
  const now = options.now ?? ((): Date => new Date());

  const catalogueListeners = new Set<(notification: CatalogueNotification) => void>();
  const envelopeListeners = new Set<(envelope: ActionEnvelope) => void>();

  const dependencies: SessionsDependencies = {
    providers,
    defaultProviderId,
    sessions,
    now,
    emitCatalogueNotification: (notification: CatalogueNotification): void => {
      for (const listener of [...catalogueListeners]) {
        listener(notification);
      }
    },
    emitSessionEnvelope: (envelope: ActionEnvelope): void => {
      for (const listener of [...envelopeListeners]) {
        listener(envelope);
      }
    },
  };

  return {
    createSession: (params: unknown): Promise<void> => executeCreateSession(dependencies, params),
    getSessionSnapshot: (sessionUri: string): SessionSnapshot | undefined => {
      const record = sessions.get(sessionUri);
      return record === undefined ? undefined : buildSessionSnapshot(record);
    },
    listAgents: () => [...providers.values()].map((provider) => provider.agentInfo),
    onCatalogueNotification: (listener) => subscribe(catalogueListeners, listener),
    onSessionEnvelope: (listener) => subscribe(envelopeListeners, listener),
    dispose: async (): Promise<void> => {
      for (const record of sessions.records()) {
        await record.backend?.dispose();
      }
      sessions.clear();
      catalogueListeners.clear();
      envelopeListeners.clear();
    },
  };
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

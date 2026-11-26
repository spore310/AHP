import { AhpErrorCodes, JsonRpcErrorCodes, type ActionEnvelope } from "@microsoft/agent-host-protocol";
import { createDurableLifecycle, captureProviderLifecycle } from "@sessions/helpers/recovery/helpers";
import { parseUnknownJson } from "@jsonrpc";

import { ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED, ACTION_TYPE_SESSION_META_CHANGED, ROOT_CHANNEL_URI } from "@sessions/constants";
import { sameResource } from "@authorization/helpers/context";
import type { ResourceRef } from "@authorization";
import { APPLICATION_META_KEY, MAX_TOOLS_PER_TYPE, type ToolContractDefinition } from "@tool";
import type { PublishedTool } from "@tool/helpers/policy/helpers/admission";
import { executeCreateSession, prepareCreateSession, publishCreatedSession, startSessionBackend } from "@sessions/createSession";
import { captureCreationSecurity, createSessionAuthorization, freezeCreation, validateCreationRegistrations } from "@sessions/helpers/creation";
import {
  BASELINE_UNSUPPORTED_ACTION_REASON,
  isBaselineSupportedSessionAction,
  parseClientSeq,
  parseClientSessionAction,
  toClientSessionAction,
  toSupportedSessionAction,
} from "@sessions/helpers/actions";
import { admitTypedAdvertisement } from "@sessions/helpers/application/admission";
import { captureSessionApplication } from "@sessions/helpers/application/helpers";
import { projectSessionToolManifest } from "@sessions/helpers/application/manifest";
import { SessionsDisposingError, SessionsError } from "@sessions/helpers/errors";
import { createInMemorySessionRegistry } from "@sessions/helpers/registry";
import {
  adaptSequenceAllocator,
  createActionSequence,
  type ActionSequence,
} from "@sessions/helpers/sequence";
import { applySessionAction, buildSessionSnapshot } from "@sessions/helpers/state";
import { buildSessionSummary, changedSessionSummaryFields } from "@sessions/helpers/summary";
import { sessionUriSchema, type CatalogueNotification, type SessionProvider } from "@sessions/types";
import type {
  SessionsDependencies,
  SessionsDiagnostic,
  SessionsFactory,
  SessionsFactoryOptions,
  SessionRecord,
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
  const creationSecurity = captureCreationSecurity(options.creationSecurity);
  const providers = new Map(buildProviderMap(options.providers));
  if (creationSecurity !== undefined) {
    for (const [id, provider] of providers) {
      providers.set(id, Object.freeze({ providerId: id, agentInfo: freezeCreation(structuredClone(provider.agentInfo)), startSession: provider.startSession.bind(provider), ...captureProviderLifecycle(provider),
        ...(provider.config === undefined ? {} : { config: Object.freeze({ schema: freezeCreation(structuredClone(provider.config.schema)), parse: provider.config.parse.bind(provider.config) }) }),
      }));
    }
  }
  const defaultProviderId = resolveDefaultProviderId(options, providers);
  const application = captureSessionApplication(options.application, creationSecurity !== undefined);
  if (application !== undefined) {
    for (const definition of application.catalogue.list()) {
      if (!providers.has(definition.providerId)) {
        throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Session type provider is not registered.");
      }
    }
    if (application.defaultType !== undefined) {
      application.catalogue.resolveForCreation(application.defaultType);
    }
  }
  if (creationSecurity === undefined && application?.catalogue.list().some((definition) => application.catalogue.resolveExisting(definition).policy !== undefined) === true) {
    throw new Error("Policy-bearing session types require protected creation.");
  }
  if (creationSecurity !== undefined) validateCreationRegistrations(creationSecurity, application);
  const toolAdmission = options.toolAdmission;
  if (toolAdmission !== undefined) {
    if (creationSecurity === undefined || application === undefined || !toolAdmission.usesRegistry(creationSecurity.originalRegistry)) {
      throw new Error("Tool admission requires canonical protected creation.");
    }
    toolAdmission.reserveBase(application.catalogue.list().flatMap((entry) => application.catalogue.resolveExisting(entry).tools));
  }
  const sessions = options.registryFactory === undefined
    ? createInMemorySessionRegistry()
    : options.registryFactory();
  const now = options.now ?? ((): Date => new Date());
  const sequence = resolveActionSequence(options);
  let allocationRevision = 0;
  let lastAllocation = 0;
  const nextServerSeq = (): number => {
    allocationRevision += 1;
    const next = sequence.next();
    if (!Number.isSafeInteger(next) || next <= lastAllocation) throw new Error("Invalid host sequence allocation.");
    lastAllocation = next;
    return next;
  };

  const catalogueListeners = new Set<(notification: CatalogueNotification) => void>();
  const envelopeListeners = new Set<(envelope: ActionEnvelope) => void>();

  let shutdown: Promise<void> | null = null;
  let disposing = false;

  const activated = new WeakMap<SessionRecord, { readonly revision: number; readonly tools: readonly PublishedTool[] }>();
  const effectiveTools = (record: SessionRecord): readonly ToolContractDefinition[] => {
    if (record.application === undefined || application === undefined) return [];
    const base = application.catalogue.resolveExisting(record.application).tools;
    const additions = activated.get(record)?.tools ?? [];
    return [...base.filter((definition) => !additions.some(({ definition: added }) => added.key === definition.key)),
      ...additions.map(({ definition }) => definition)];
  };
  const managedRecord = (ref: ResourceRef<"session">): SessionRecord | undefined => {
    const record = sessions.get(ref.id);
    return !disposing && record?.resource !== undefined && sameResource(ref, record.resource) ? record : undefined;
  };
  const managedTools: SessionsFactory["managedTools"] = toolAdmission === undefined || creationSecurity === undefined
    ? undefined
    : {
        admission: toolAdmission,
        revision(ref) {
          const record = managedRecord(ref);
          return record === undefined ? undefined : (activated.get(record)?.revision ?? 0);
        },
        registration(ref, contractId) {
          const record = managedRecord(ref);
          return record === undefined ? undefined : activated.get(record)?.tools.find(({ definition }) => definition.id === contractId);
        },
        async activate(input) {
          const record = managedRecord(input.origin);
          const binding = record?.application;
          if (record === undefined || binding === undefined || record.backend === undefined) return undefined;
          const previous = activated.get(record);
          const revision = previous?.revision ?? 0;
          if (revision !== input.expectedRevision || !Number.isSafeInteger(revision + 1)) return undefined;
          const owned = (): boolean => managedRecord(input.origin) === record && record.application === binding && activated.get(record) === previous;
          const prepared = await toolAdmission.prepareActivation({ ...input, sessionType: { key: binding.key, version: binding.version }, providerId: record.provider.providerId,
            current: () => input.current() && owned(), fence: () => input.fence() && owned() }, input.proposalId);
          if (prepared === undefined) return undefined;
          const { definition } = prepared.tool;
          if (binding.tools.some((ref) => ref.key === definition.key && ref.version === definition.version)) return undefined;
          const refs = [...binding.tools.filter((ref) => ref.key !== definition.key), { key: definition.key, version: definition.version }];
          if (refs.length > MAX_TOOLS_PER_TYPE) return undefined;
          const definitions = [...effectiveTools(record).filter((entry) => entry.key !== definition.key), definition];
          const manifest = projectSessionToolManifest({ id: binding.typeId, key: binding.key, version: binding.version }, definitions, refs);
          if (new Set(manifest.toolContracts.map((tool) => tool.definition.name)).size !== manifest.toolContracts.length) return undefined;
          const additions = [...(previous?.tools ?? []).filter((entry) => entry.definition.key !== definition.key), prepared.tool];
          const action = { type: ACTION_TYPE_SESSION_META_CHANGED, _meta: { ...record.state._meta, [APPLICATION_META_KEY]: manifest } };
          const modifiedAt = now().toISOString();
          if (!prepared.current() || !owned()) return undefined;
          return ordered(async () => {
            if (!prepared.current() || !owned()) return undefined;
            const priorAllocation = allocationRevision;
            const priorSequence = record.serverSeq;
            const serverSeq = nextServerSeq();
            if (!prepared.current() || !owned() || record.serverSeq !== priorSequence || allocationRevision !== priorAllocation + 1) return undefined;
            const staged = { ...record };
            const envelope = applySessionAction(staged, action, modifiedAt, () => serverSeq);
            if (durable) {
              await durable.commit(record, staged, () => prepared.current() && owned());
              if (!owned()) return undefined;
            }
            try {
              creationSecurity.originalRegistry.installTool(definition);
            } catch {
              return undefined;
            }
            record.application = Object.freeze({ ...binding, tools: Object.freeze(refs) });
            activated.set(record, { revision: revision + 1, tools: Object.freeze(additions) });
            Object.assign(record, { state: staged.state, modifiedAt, serverSeq });
            deliver(envelopeListeners, envelope);
            return { revision: revision + 1, tool: prepared.tool };
          });
        },
      };

  const dependencies: SessionsDependencies = {
    providers,
    defaultProviderId,
    sessions,
    application,
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

  if (options.durability && !creationSecurity) throw new Error("Durable hosts require trusted typed session creation.");
  const durable = options.durability && creationSecurity && createDurableLifecycle(options.durability, dependencies, creationSecurity);
  let startup: Promise<void> | undefined;
  let writeTail = Promise.resolve();
  let pendingWrites = 0;
  function ordered<T>(run: () => Promise<T>): Promise<T> {
    if (!durable) return run();
    if (!durable.isOpen() || pendingWrites >= 256) return Promise.reject(new Error("State write unavailable."));
    let expire: ReturnType<typeof setTimeout> | undefined;
    let waiting = true;
    const expired = new Promise<never>((_, reject) => {
      expire = setTimeout(() => {
        if (waiting) {
          waiting = false;
          reject(new Error("State write queue deadline exceeded."));
        }
      }, 5000);
    });
    pendingWrites++;
    const result = writeTail.then(async () => {
      clearTimeout(expire);
      if (!durable.isOpen() || !waiting) throw new Error("State write unavailable.");
      waiting = false;
      // A shared store owns allocation. Values are obtained inside the ordered
      // slot so a later slot on this host can never publish a lower value.
      if (sequence.reserve) await sequence.reserve(2);
      if (!durable.isOpen()) throw new Error("State write unavailable.");
      return run();
    });
    writeTail = result.then(() => undefined, () => undefined).finally(() => {
      pendingWrites--;
    });
    return Promise.race([result, expired]);
  }

  let recovering: Promise<readonly string[]> | undefined;
  let recoverAgain = false;
  const shouldRecoverAgain = (): boolean => recoverAgain && !disposing;
  /** Single-flight for every caller: one session is never restored twice concurrently. */
  function recoverOwned(): Promise<readonly string[]> {
    if (disposing || !durable) return Promise.reject(new SessionsDisposingError());
    if (recovering !== undefined) {
      recoverAgain = true;
      return recovering;
    }
    const run = (async (): Promise<readonly string[]> => {
      const restored: string[] = [];
      do {
        recoverAgain = false;
        let announced = 0;
        try {
          await durable.recoverOwned((record) => {
            // Announced as each session is restored, so a pass that ends with a failure still publishes them.
            dependencies.emitCatalogueNotification({ method: "root/sessionAdded", params: { channel: ROOT_CHANNEL_URI, summary: buildSessionSummary(record) } });
            restored.push(record.sessionUri);
            announced += 1;
          });
        } finally {
          if (announced > 0) emitActiveSessionsChanged();
        }
      } while (shouldRecoverAgain());
      return restored;
    })();
    recovering = run;
    const clear = (): void => {
      if (recovering === run) recovering = undefined;
    };
    run.then(clear, clear);
    return run;
  }

  const dispose = (): Promise<void> => {
    // Publish the barrier BEFORE synchronous cleanup can reenter dispose().
    if (shutdown !== null) return shutdown;
    disposing = true;
    durable?.closeAdmission();
    let complete = (): void => undefined;
    let fail: (error: unknown) => void = () => undefined;
    const completion = new Promise<void>((resolve, reject) => {
      complete = () => {
        resolve();
      };
      fail = (error) => {
        reject(error instanceof Error ? error : new Error("Session factory shutdown failed.", { cause: error }));
      };
    });
    const owned: Promise<void> = completion.finally(() => {
      if (shutdown === owned) {
        shutdown = null;
        disposing = false;
      }
    });
    shutdown = owned;
    void performDispose().then(complete, fail);
    return owned;
  };

  /**
   * Clears the registry and listeners synchronously, then releases every
   * attached backend, collecting failures. Backends still starting are skipped:
   * their completion detects the cleared registry and disposes itself detached.
   */
  const publishActiveSessions = (): void => {
    const envelope: ActionEnvelope = {
      channel: ROOT_CHANNEL_URI,
      action: {
        type: ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED,
        activeSessions: sessions.size,
      },
      serverSeq: nextServerSeq(),
      origin: undefined,
    };
    deliver(envelopeListeners, envelope);
  };

  const emitActiveSessionsChanged = (): void => {
    if (!durable) publishActiveSessions();
    else if (!disposing) void ordered(() => {
      publishActiveSessions();
      return Promise.resolve();
    }).catch(() => undefined);
  };
  const creation = creationSecurity === undefined
    ? undefined
    : createSessionAuthorization(dependencies, creationSecurity, {
        ...(durable ? { reserve: durable.reserve.bind(durable), retire: durable.retire.bind(durable), attachmentFailed: durable.attachmentFailed.bind(durable) } : {}),
        prepare: (params) => prepareCreateSession(dependencies, params),
        publish: (record) => {
          publishCreatedSession(dependencies, record);
        },
        start: (prepared, beforeFailure) => startSessionBackend(dependencies, prepared.record, prepared.workingDirectories, prepared.config, beforeFailure,
          durable && { backend: durable.backend, ordered, commit: durable.commit.bind(durable), fail: durable.fail.bind(durable), quarantine: durable.quarantine, releaseBackend: durable.releaseBackend }),
        changed: emitActiveSessionsChanged,
        isStopping: () => disposing,
      });

  async function performDispose(): Promise<void> {
    creation?.cancelAll();
    const records = sessions.records();
    const failures: unknown[] = [];
    sessions.clear();
    for (const record of records) {
      try {
        creation?.teardown(record);
      } catch (error) {
        failures.push(error);
      }
    }
    if (records.length > 0) {
      emitActiveSessionsChanged();
    }
    catalogueListeners.clear();
    envelopeListeners.clear();

    if (durable) {
      try {
        const timeout = AbortSignal.timeout(5000);
        const drain = new Promise<never>((_, reject) => {
          timeout.addEventListener("abort", () => {
            reject(new Error("Pending durable writes did not drain."));
          }, { once: true });
        });
        try {
          await Promise.race([writeTail, drain]);
        } finally {
          await durable.stop();
        }
      } catch (error) { failures.push(error); }
    }
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
    ...(durable && creation
      ? { durability: {
          start: (onLost?: () => void) => startup ??= durable.start(creation.restore, (n) => {
            if (sequence.seed) sequence.seed(n);
            else if (sequence.current() < n) throw new Error("Sequence cannot restore checkpoint.");
          }, () => {
            onLost?.();
            void dispose().catch(() => undefined);
          }, creation.teardown),
          inspect: durable.inspect, purge: durable.purge,
          publishWorkReady: (publish: (seq: number) => void) => ordered(() => {
            if (disposing) throw new SessionsDisposingError();
            publish(nextServerSeq());
            return Promise.resolve();
          }),
          flush: () => writeTail,
          recoverOwned,
          async transfer(sessionUri: string, toHostId: string) {
            if (disposing) throw new SessionsDisposingError();
            const record = sessions.get(sessionUri);
            const ref = record?.resource;
            if (record === undefined || ref === undefined) throw new SessionsError(AhpErrorCodes.SessionNotFound, `Session not found: ${sessionUri}`);
            // Local authority and handles are withdrawn first: after the durable
            // change this host can no longer write, and before it nothing is lost.
            const progress = { withdrawn: false };
            try {
              // Queued behind this session's admitted writes. Once it is withdrawn nothing else can write it.
              const move = await ordered(() => durable.relocate(record, toHostId, () => {
                progress.withdrawn = true;
                dependencies.emitCatalogueNotification({ method: "root/sessionRemoved", params: { channel: ROOT_CHANNEL_URI, session: sessionUri } });
                emitActiveSessionsChanged();
              }));
              await move();
            } catch (error) {
              // Whatever failed after the withdrawal, this host is still the owner: restore the session here.
              if (progress.withdrawn) await recoverOwned().catch(() => undefined);
              throw error;
            }
          },
        } }
      : {}),
    ...(managedTools === undefined ? {} : { managedTools }),
    ...(creation === undefined ? {} : { authorization: creation.authorization }),
    createSession: (params: unknown, onRecordCreated?: (sessionUri: string) => void): Promise<void> => {
      // Disposal clears the registry and listeners and releases attached
      // backends; accepting a session now would register it after that
      // boundary. Reuse is allowed again once disposal settles.
      if (disposing) {
        return Promise.reject(new SessionsDisposingError());
      }
      if (creation !== undefined) return Promise.reject(new SessionsError(JsonRpcErrorCodes.InvalidRequest, "Trusted creation context required."));
      const previousCount = sessions.size;
      return executeCreateSession(dependencies, params, onRecordCreated).then(() => {
        if (sessions.size !== previousCount) {
          emitActiveSessionsChanged();
        }
      });
    },
    getSessionSnapshot: (sessionUri: string): SessionSnapshot | undefined => {
      const record = sessions.get(sessionUri);
      return record === undefined ? undefined : buildSessionSnapshot(record);
    },
    getSessionToolManifest: (sessionUri: string) => {
      const record = sessions.get(sessionUri);
      if (record?.application === undefined || application === undefined) {
        return undefined;
      }
      return structuredClone(projectSessionToolManifest(
        {
          id: record.application.typeId,
          key: record.application.key,
          version: record.application.version,
        },
        effectiveTools(record),
        record.application.tools,
      ));
    },
    listSessionSnapshots: (): SessionSnapshot[] => {
      return sessions.records().map((record) => buildSessionSnapshot(record));
    },
    listSessions: (params: unknown) => listSessions(sessions, params),
    disposeSession: async (params: unknown): Promise<void> => {
      if (shutdown !== null) {
        throw new SessionsDisposingError();
      }
      const channel = readDisposeChannel(params);
      const record = sessions.get(channel);
      if (record === undefined) {
        throw new SessionsError(AhpErrorCodes.SessionNotFound, `Session not found: ${channel}`);
      }
      if (creation !== undefined && record.resource !== undefined) {
        await creation.authorization.disposeSession(record.resource);
        return;
      }
      sessions.delete(record.sessionUri);
      dependencies.emitCatalogueNotification({
        method: "root/sessionRemoved",
        params: { channel: ROOT_CHANNEL_URI, session: record.sessionUri },
      });
      emitActiveSessionsChanged();
      if (record.backend === undefined) {
        return;
      }
      try {
        await record.backend.dispose();
      } catch (error) {
        dependencies.reportDiagnostic({
          event: "lateBackendDisposeFailed",
          sessionUri: record.sessionUri,
          errorType: error instanceof Error ? error.name : "unknown",
        });
        throw new SessionsError(JsonRpcErrorCodes.InternalError, "Session backend failed to dispose.");
      }
    },
    getCurrentServerSeq: (): number => sequence.current(),
    listAgents: () => [...providers.values()].map((provider) => structuredClone(provider.agentInfo)),
    onCatalogueNotification: (listener) => subscribe(catalogueListeners, listener),
    onSessionEnvelope: (listener) => subscribe(envelopeListeners, listener),
    dispatchAction: async ({ channel, clientSeq, action, clientId, admission }) => {
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

      const expectedSeq = record.serverSeq;
      return ordered(async () => {
        if (!isBaselineSupportedSessionAction(parsedAction)) {
          return {
            channel,
            action: toClientSessionAction(parsedAction),
            serverSeq: nextServerSeq(),
            origin: { clientId, clientSeq: parsedClientSeq },
            rejectionReason: BASELINE_UNSUPPORTED_ACTION_REASON,
          } satisfies ActionEnvelope;
        }

        const admitted = admitTypedAdvertisement(
          record,
          dependencies.application,
          parsedAction,
          clientId,
          activated.has(record) ? effectiveTools(record) : undefined,
        );
        if ("rejectionReason" in admitted) {
          return {
            channel,
            action: toClientSessionAction(parsedAction),
            serverSeq: nextServerSeq(),
            origin: { clientId, clientSeq: parsedClientSeq },
            rejectionReason: admitted.rejectionReason,
          } satisfies ActionEnvelope;
        }
        if (!isBaselineSupportedSessionAction(admitted.accepted)) {
          return {
            channel,
            action: toClientSessionAction(parsedAction),
            serverSeq: nextServerSeq(),
            origin: { clientId, clientSeq: parsedClientSeq },
            rejectionReason: BASELINE_UNSUPPORTED_ACTION_REASON,
          } satisfies ActionEnvelope;
        }

        const before = buildSessionSummary(record);
        const priorSequence = record.serverSeq;
        const priorAllocation = allocationRevision;
        const modifiedAt = now().toISOString();
        // Resolve injected callbacks before the last synchronous admission check.
        const serverSeq = nextServerSeq();
        let allowed: unknown = true;
        try {
          if (!durable && admission !== undefined) allowed = admission();
        } catch {
          allowed = false;
        }
        if (allowed !== true) void Promise.resolve(allowed).catch(() => undefined);
        if (allowed !== true || disposing || sessions.get(channel) !== record || record.serverSeq !== expectedSeq || record.serverSeq !== priorSequence
          || allocationRevision !== priorAllocation + 1) {
          return { channel, action: toClientSessionAction(parsedAction), serverSeq: nextServerSeq(),
            origin: { clientId, clientSeq: parsedClientSeq }, rejectionReason: "Action admission is no longer current." } satisfies ActionEnvelope;
        }
        const staged = durable ? { ...record } : record;
        const envelope = applySessionAction(
          staged,
          toSupportedSessionAction(admitted.accepted),
          modifiedAt,
          () => serverSeq,
        );
        if (durable) {
          await durable.commit(record, staged, () => !disposing && sessions.get(channel) === record && record.serverSeq === expectedSeq && (admission === undefined || admission()));
          if (!durable.isOpen() || sessions.get(channel) !== record) throw new Error("Session detached during commit.");
          record.state = staged.state;
          record.modifiedAt = staged.modifiedAt;
          record.serverSeq = staged.serverSeq;
        }
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
      });
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
const LIST_SESSIONS_CURSOR_VERSION = 1;

function readDisposeChannel(params: unknown): string {
  if (typeof params !== "object" || params === null || !("channel" in params)) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid disposeSession params");
  }
  const parsed = sessionUriSchema.safeParse(params.channel);
  if (!parsed.success) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid disposeSession params");
  }
  return parsed.data;
}

function listSessions(
  sessions: SessionsDependencies["sessions"],
  params: unknown,
): { items: ReturnType<typeof buildSessionSummary>[]; nextCursor?: string } {
  const limit = readListLimit(params);
  const ordered = sessions.records().slice().sort((left, right) => {
    if (left.modifiedAt === right.modifiedAt) {
      return left.sessionUri < right.sessionUri ? -1 : 1;
    }
    return left.modifiedAt < right.modifiedAt ? 1 : -1;
  });
  const offset = readListOffset(params, ordered.length);
  const page = limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page.map((record) => buildSessionSummary(record)),
    ...(limit !== undefined && nextOffset < ordered.length
      ? { nextCursor: encodeListCursor(nextOffset) }
      : {}),
  };
}

function readListLimit(params: unknown): number | undefined {
  if (!isRecord(params) || params.channel !== ROOT_CHANNEL_URI) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid listSessions params");
  }
  if (params.limit === undefined) {
    return undefined;
  }
  if (typeof params.limit !== "number" || !Number.isInteger(params.limit) || params.limit < 1) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid listSessions params");
  }
  return Math.min(params.limit, 100);
}

function readListOffset(params: unknown, length: number): number {
  if (!isRecord(params) || params.cursor === undefined) {
    return 0;
  }
  if (typeof params.cursor !== "string" || params.cursor.length === 0) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid listSessions cursor");
  }
  let decoded: unknown;
  try {
    decoded = parseUnknownJson(Buffer.from(params.cursor, "base64url").toString("utf8"));
  } catch {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid listSessions cursor");
  }
  if (
    !isRecord(decoded)
    || decoded.v !== LIST_SESSIONS_CURSOR_VERSION
    || typeof decoded.o !== "number"
    || !Number.isInteger(decoded.o)
    || decoded.o < 0
    || decoded.o > length
  ) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid listSessions cursor");
  }
  return decoded.o;
}

function encodeListCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: LIST_SESSIONS_CURSOR_VERSION, o: offset }), "utf8").toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

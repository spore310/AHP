import type { ErrorInfo, SessionAction } from "@microsoft/agent-host-protocol";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import {
  ACTION_TYPE_SESSION_CREATION_FAILED,
  ACTION_TYPE_SESSION_READY,
  DEFAULT_SESSION_TITLE,
  ROOT_CHANNEL_URI,
  SESSION_START_FAILURE_INFO,
} from "@sessions/constants";
import { prepareSessionCreation } from "@sessions/helpers/application";
import { APPLICATION_META_KEY } from "@tool";
import {
  SessionConfigError,
  SessionStartError,
  SessionsError,
} from "@sessions/helpers/errors";
import { applySessionAction, createInitialSessionState } from "@sessions/helpers/state";
import { buildSessionSummary } from "@sessions/helpers/summary";
import type { SessionProvider, SessionRecord, SessionsDependencies } from "@sessions/types";

import { createSessionParamsSchema } from "./types";

/**
 * Handles one `createSession` request.
 *
 * Enforces the create-time contract in order: params shape, provider
 * resolution, URI uniqueness, configuration parsing, then registration and
 * catalogue broadcast. The backend is started last so a failure leaves a
 * well-formed, inspectable session rather than a half-registered one.
 */
export async function executeCreateSession(
  dependencies: SessionsDependencies,
  rawParams: unknown,
  onRecordCreated?: (sessionUri: string) => void,
): Promise<void> {
  const prepared = prepareCreateSession(dependencies, rawParams);
  const { record } = prepared;
  dependencies.sessions.add(record);
  try {
    onRecordCreated?.(record.sessionUri);
  } catch (error) {
    if (dependencies.sessions.get(record.sessionUri) === record) dependencies.sessions.delete(record.sessionUri);
    throw error;
  }
  publishCreatedSession(dependencies, record);
  await startSessionBackend(dependencies, record, prepared.workingDirectories, prepared.config);
}

/** Internal pure preparation shared by legacy and contextual creation. No registration or publication. */
export function prepareCreateSession(dependencies: SessionsDependencies, rawParams: unknown) {
  const parsed = createSessionParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new SessionsError(
      JsonRpcErrorCodes.InvalidParams,
      `Invalid createSession params: ${parsed.error.message}`,
    );
  }

  const params = parsed.data;
  const prepared = prepareSessionCreation(dependencies.application, params.provider, params.config);
  if (dependencies.application !== undefined && params.activeClient !== undefined) {
    throw new SessionsError(
      JsonRpcErrorCodes.InvalidParams,
      "Creation-time active client is not supported on a typed host.",
    );
  }
  const provider = resolveProvider(
    dependencies,
    prepared.providerId.length === 0 ? params.provider : prepared.providerId,
  );

  if (dependencies.sessions.has(params.channel)) {
    throw new SessionsError(
      AhpErrorCodes.SessionAlreadyExists,
      `Session already exists: ${params.channel}`,
    );
  }

  // Parsing runs before registration so invalid configuration creates no record
  // and never reaches the provider.
  const config = parseSessionConfig(provider, prepared.providerConfig);

  // No agent advertises multiple working directories yet, so the host keeps only
  // the first directory, per the `createSession` contract.
  const workingDirectories = (params.workingDirectories ?? []).slice(0, 1);
  const createdAt = dependencies.now().toISOString();
  const record: SessionRecord = {
    sessionUri: params.channel,
    provider,
    createdAt,
    modifiedAt: createdAt,
    state: {
      ...createInitialSessionState({
        providerId: provider.providerId,
        title: DEFAULT_SESSION_TITLE,
        workingDirectories,
      }),
      ...(prepared.binding === undefined
        ? {}
        : {
            _meta: {
              [APPLICATION_META_KEY]: prepared.manifest,
            },
          }),
    },
    serverSeq: 0,
    ...(prepared.binding === undefined ? {} : { application: prepared.binding }),
  };

  return { record, workingDirectories, config };
}

export function publishCreatedSession(dependencies: SessionsDependencies, record: SessionRecord): void {
  dependencies.emitCatalogueNotification({
    method: "root/sessionAdded",
    params: { channel: ROOT_CHANNEL_URI, summary: buildSessionSummary(record) },
  });
}

function resolveProvider(
  dependencies: SessionsDependencies,
  providerId: string | undefined,
): SessionProvider {
  const resolvedProviderId = providerId ?? dependencies.defaultProviderId;
  const provider = dependencies.providers.get(resolvedProviderId);
  if (provider === undefined) {
    throw new SessionsError(
      AhpErrorCodes.ProviderNotFound,
      `No agent for provider: ${resolvedProviderId}`,
    );
  }

  return provider;
}

/**
 * Resolves the configuration the provider's backend receives.
 *
 * The provider's parser is the single runtime validation owner: it applies
 * required/default/type/enum and unknown-key policy and returns the normalized
 * values. A provider without a contract accepts only an empty configuration.
 */
function parseSessionConfig(
  provider: SessionProvider,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const supplied = config ?? {};
  if (provider.config === undefined) {
    if (Object.keys(supplied).length > 0) {
      throw new SessionsError(
        JsonRpcErrorCodes.InvalidParams,
        `Provider "${provider.providerId}" accepts no session configuration.`,
      );
    }
    return {};
  }

  try {
    return provider.config.parse(supplied);
  } catch (error) {
    if (error instanceof SessionConfigError) {
      throw new SessionsError(JsonRpcErrorCodes.InvalidParams, error.message);
    }
    throw new SessionsError(
      JsonRpcErrorCodes.InvalidParams,
      `Invalid session configuration for provider "${provider.providerId}".`,
    );
  }
}

export async function startSessionBackend(
  dependencies: SessionsDependencies,
  record: SessionRecord,
  workingDirectories: readonly string[],
  config: Readonly<Record<string, unknown>>,
  beforeFailure?: () => void,
  durable?: Pick<ReturnType<typeof import("@sessions/helpers/recovery/helpers").createDurableLifecycle>, "backend" | "commit" | "fail" | "quarantine" | "releaseBackend"> & { ordered<T>(run: () => Promise<T>): Promise<T> },
): Promise<void> {
  if (dependencies.sessions.get(record.sessionUri) !== record) return;
  let action: SessionAction;
  let acquired: SessionRecord["backend"];
  try {
    const backend = durable
      ? await durable.backend(record, workingDirectories, config)
      : await record.provider.startSession({
          sessionUri: record.sessionUri,
          workingDirectories,
          config,
        });

    // The factory may have been disposed (or the URI reused) while the backend
    // was starting. Release the late backend and publish nothing rather than
    // attaching it to a detached record or emitting a stale ready action.
    if (dependencies.sessions.get(record.sessionUri) !== record) {
      try {
        if (durable) await durable.releaseBackend(record, backend);
        else await backend.dispose();
      } catch (error) {
        // Detached cleanup has no caller to observe it, so report a sanitized
        // lifecycle diagnostic instead of publishing anything.
        dependencies.reportDiagnostic({
          event: "lateBackendDisposeFailed",
          sessionUri: record.sessionUri,
          errorType: error instanceof Error ? error.name : "unknown",
        });
      }
      return;
    }

    acquired = backend;
    action = { type: ACTION_TYPE_SESSION_READY };
  } catch (error) {
    action = { type: ACTION_TYPE_SESSION_CREATION_FAILED, error: toErrorInfo(error) };
  }

  if (dependencies.sessions.get(record.sessionUri) !== record) {
    return;
  }

  let cleanup: Promise<void> | undefined;
  const publish = async (): Promise<void> => {
    if (dependencies.sessions.get(record.sessionUri) !== record) {
      if (durable && acquired) cleanup = durable.releaseBackend(record, acquired);
      return;
    }
    if (action.type === ACTION_TYPE_SESSION_CREATION_FAILED) {
      beforeFailure?.();
      if (durable) await durable.fail(record);
    }
    const staged = durable ? { ...record } : record;
    const envelope = applySessionAction(
      staged,
      action,
      dependencies.now().toISOString(),
      dependencies.nextServerSeq,
    );
    if (durable) {
      await durable.commit(record, staged, () => dependencies.sessions.get(record.sessionUri) === record, false);
      if (dependencies.sessions.get(record.sessionUri) !== record) {
        if (acquired) cleanup = durable.releaseBackend(record, acquired);
        return;
      }
      Object.assign(record, { state: staged.state, modifiedAt: staged.modifiedAt, serverSeq: staged.serverSeq });
    }
    if (acquired) record.backend = acquired;
    dependencies.emitSessionEnvelope(envelope);
    dependencies.emitCatalogueNotification({
      method: "root/sessionSummaryChanged",
      params: {
        channel: ROOT_CHANNEL_URI,
        session: record.sessionUri,
        changes: { modifiedAt: record.modifiedAt },
      },
    });
  };
  if (durable) {
    try {
      await durable.ordered(async () => {
        try {
          await publish();
        } catch (error) {
          // Withdraw before the next ordered write. Await external cleanup outside the slot.
          cleanup = durable.quarantine(record, acquired);
          throw error;
        }
      });
    } catch (error) {
      cleanup ??= durable.quarantine(record, acquired);
      throw error;
    } finally {
      await cleanup;
    }
  } else await publish();
}

/**
 * Builds the public `session/creationFailed` payload.
 *
 * A provider's deliberate {@link SessionStartError} contributes only
 * `errorType` and `message`; every other thrown value collapses to a generic
 * category, so arbitrary exception detail never becomes client-visible state.
 */
function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof SessionStartError) {
    return { errorType: error.info.errorType, message: error.info.message };
  }

  return SESSION_START_FAILURE_INFO;
}

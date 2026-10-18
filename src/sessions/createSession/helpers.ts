import type { ErrorInfo, SessionAction } from "@microsoft/agent-host-protocol";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import {
  ACTION_TYPE_SESSION_CREATION_FAILED,
  ACTION_TYPE_SESSION_READY,
  DEFAULT_SESSION_TITLE,
  ROOT_CHANNEL_URI,
} from "@/sessions/constants";
import { SessionStartError, SessionsError } from "@/sessions/helpers/errors";
import { applySessionAction, createInitialSessionState } from "@/sessions/helpers/state";
import { buildSessionSummary } from "@/sessions/helpers/summary";
import type { SessionProvider, SessionRecord, SessionsDependencies } from "@/sessions/types";

import { createSessionParamsSchema } from "./types";

/**
 * Handles one `createSession` request.
 *
 * Enforces the create-time contract in order: params shape, provider
 * resolution, URI uniqueness, configuration support, then registration and
 * catalogue broadcast. The backend is started last so a failure leaves a
 * well-formed, inspectable session rather than a half-registered one.
 */
export async function executeCreateSession(
  dependencies: SessionsDependencies,
  rawParams: unknown,
): Promise<void> {
  const parsed = createSessionParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new SessionsError(
      JsonRpcErrorCodes.InvalidParams,
      `Invalid createSession params: ${parsed.error.message}`,
    );
  }

  const params = parsed.data;
  const provider = resolveProvider(dependencies, params.provider);

  if (dependencies.sessions.has(params.channel)) {
    throw new SessionsError(
      AhpErrorCodes.SessionAlreadyExists,
      `Session already exists: ${params.channel}`,
    );
  }

  assertConfigSupported(provider, params.config);

  // No agent advertises multiple working directories yet, so the host keeps only
  // the first directory, per the `createSession` contract.
  const workingDirectories = (params.workingDirectories ?? []).slice(0, 1);
  const createdAt = dependencies.now().toISOString();
  const record: SessionRecord = {
    sessionUri: params.channel,
    provider,
    createdAt,
    modifiedAt: createdAt,
    state: createInitialSessionState({
      providerId: provider.providerId,
      title: DEFAULT_SESSION_TITLE,
      workingDirectories,
    }),
    serverSeq: 0,
  };

  dependencies.sessions.add(record);
  dependencies.emitCatalogueNotification({
    method: "root/sessionAdded",
    params: { channel: ROOT_CHANNEL_URI, summary: buildSessionSummary(record) },
  });

  await startBackend(dependencies, record, workingDirectories, params.config ?? {});
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

function assertConfigSupported(
  provider: SessionProvider,
  config: Record<string, unknown> | undefined,
): void {
  if (config === undefined || Object.keys(config).length === 0) {
    return;
  }
  if (provider.configSchema === undefined) {
    throw new SessionsError(
      JsonRpcErrorCodes.InvalidParams,
      `Provider "${provider.providerId}" accepts no session configuration.`,
    );
  }
}

async function startBackend(
  dependencies: SessionsDependencies,
  record: SessionRecord,
  workingDirectories: readonly string[],
  config: Readonly<Record<string, unknown>>,
): Promise<void> {
  let action: SessionAction;
  try {
    const backend = await record.provider.startSession({
      sessionUri: record.sessionUri,
      workingDirectories,
      config,
    });
    record.backend = backend;
    action = { type: ACTION_TYPE_SESSION_READY };
  } catch (error) {
    action = { type: ACTION_TYPE_SESSION_CREATION_FAILED, error: toErrorInfo(error) };
  }

  const envelope = applySessionAction(record, action, dependencies.now().toISOString());
  dependencies.emitSessionEnvelope(envelope);
  dependencies.emitCatalogueNotification({
    method: "root/sessionSummaryChanged",
    params: {
      channel: ROOT_CHANNEL_URI,
      session: record.sessionUri,
      changes: { modifiedAt: record.modifiedAt },
    },
  });
}

function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof SessionStartError) {
    return error.info;
  }
  if (error instanceof Error) {
    return { errorType: error.name, message: error.message };
  }

  return { errorType: "sessionStartFailed", message: "Session backend failed to start." };
}

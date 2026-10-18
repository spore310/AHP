import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import { SessionsError } from "@sessions/helpers/errors";
import { SessionTypeError } from "@sessions/helpers/sessionTypes";
import { CONTRACT_KEY_PATTERN, SESSION_TYPE_SELECTOR_KEY, type ToolContractRef } from "@tools";

import { ClientAccessRole, ToolAccessLevel } from "./constants";
import type {
  AuthorizedToolGrant,
  SessionApplicationBinding,
  SessionApplicationOptions,
  SessionTypeToolMap,
} from "./types";

export interface PreparedSessionCreation {
  readonly providerId: string;
  readonly providerConfig: Record<string, unknown>;
  readonly binding?: SessionApplicationBinding;
  readonly visibleTools?: readonly ToolContractRef[];
}

/** Builds the header-enum map. Each session-type key points at its authorized tools. */
export function createSessionTypeToolMap(
  entries: Readonly<Record<string, readonly AuthorizedToolGrant[]>>,
): SessionTypeToolMap {
  const map = new Map<string, readonly AuthorizedToolGrant[]>();
  for (const [header, grants] of Object.entries(entries)) {
    if (!CONTRACT_KEY_PATTERN.test(header)) {
      throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
    }
    map.set(header, grants.map((grant) => ({ ...grant, ref: { ...grant.ref } })));
  }
  return map;
}

/** Admin tools are omitted unless the server-derived role is admin. */
export function visibleTools(
  grants: readonly AuthorizedToolGrant[],
  role: ClientAccessRole,
): readonly ToolContractRef[] {
  return grants
    .filter((grant) => grant.access === ToolAccessLevel.Standard || role === ClientAccessRole.Admin)
    .map((grant) => ({ ...grant.ref }));
}

/**
 * Resolves an optional typed-session selector without mutating the caller's config.
 *
 * An untyped host rejects a selector. A typed host requires an explicit type or
 * its configured default, and the native provider must match that type.
 */
export function prepareSessionCreation(
  application: SessionApplicationOptions | undefined,
  providerId: string | undefined,
  config: Readonly<Record<string, unknown>> | undefined,
): PreparedSessionCreation {
  const split = splitSelector(config);
  if (application === undefined) {
    if (split.selector !== undefined) {
      throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Session type selector is not supported.");
    }
    return { providerId: providerId ?? "", providerConfig: split.providerConfig };
  }

  const selected = split.selector ?? application.defaultType;
  if (selected === undefined) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Session type selection is required.");
  }
  const selector = {
    key: selected.key,
    version: "version" in selected && selected.version !== undefined
      ? selected.version
      : enabledVersion(application, selected.key),
  };
  let resolved;
  try {
    resolved = application.catalogue.resolveForCreation(selector);
  } catch (error) {
    if (error instanceof SessionTypeError) {
      throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type selection.");
    }
    throw error;
  }

  if (providerId !== undefined && providerId !== resolved.definition.providerId) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Session provider does not match the selected type.");
  }

  let applicationConfig: Record<string, unknown>;
  try {
    applicationConfig = resolved.config.parse(split.applicationConfig);
  } catch {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type configuration.");
  }

  const grants = application.authorizedTools?.get(selector.key);
  if (application.authorizedTools !== undefined && grants === undefined) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
  }
  const role = application.role ?? ClientAccessRole.Anonymous;
  const visible = grants === undefined
    ? resolved.tools.map((tool) => ({ key: tool.key, version: tool.version }))
    : visibleTools(grants, role);

  return {
    providerId: resolved.definition.providerId,
    providerConfig: split.providerConfig,
    binding: {
      typeId: resolved.definition.id,
      key: resolved.definition.key,
      version: resolved.definition.version,
      config: applicationConfig,
    },
    visibleTools: visible,
  };
}

function splitSelector(config: Readonly<Record<string, unknown>> | undefined): {
  readonly selector: { readonly key: string; readonly version?: number } | undefined;
  readonly applicationConfig: Record<string, unknown>;
  readonly providerConfig: Record<string, unknown>;
} {
  const supplied = config === undefined ? {} : { ...config };
  const { [SESSION_TYPE_SELECTOR_KEY]: raw, ...providerConfig } = supplied;
  if (raw === undefined) {
    return { selector: undefined, applicationConfig: {}, providerConfig };
  }
  if (typeof raw !== "string" || !CONTRACT_KEY_PATTERN.test(raw)) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
  }
  return { selector: { key: raw }, applicationConfig: providerConfig, providerConfig: {} };
}

function enabledVersion(application: SessionApplicationOptions, key: string): number {
  const matches = application.catalogue.list().filter((definition) => definition.key === key);
  const [only] = matches;
  if (only === undefined || matches.length !== 1) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
  }
  return only.version;
}

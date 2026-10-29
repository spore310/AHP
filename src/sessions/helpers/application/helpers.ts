import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import { SESSION_TYPE_KEY_PATTERN } from "@sessions/constants";
import { SessionsError } from "@sessions/helpers/errors";
import { SessionTypeError, type ResolvedSessionType } from "@sessions/helpers/sessionTypes";
import { captureCreationPolicy, freezeCreation } from "@sessions/helpers/creation";
import { SESSION_TYPE_SELECTOR_KEY, type ToolContractRef } from "@tools";

import { ClientAccessRole, ToolAccessLevel } from "./constants";
import { projectSessionToolManifest, type SessionToolManifest } from "./manifest";
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
  readonly manifest?: SessionToolManifest;
}

/** Capture host policy once; later caller edits cannot switch a live factory's policy. */
export function captureSessionApplication(
  application: SessionApplicationOptions | undefined,
  protectedCreation = false,
): SessionApplicationOptions | undefined {
  if (application === undefined) {
    return undefined;
  }
  let { catalogue } = application;
  if (protectedCreation) {
    const entries = new Map<string, ResolvedSessionType>();
    for (const definition of catalogue.list()) {
      const resolved = catalogue.resolveExisting(definition);
      entries.set(`${definition.key}@${String(definition.version)}`, freezeCreation({
        definition: structuredClone(resolved.definition), tools: structuredClone(resolved.tools), enabledForCreation: resolved.enabledForCreation,
        config: { schema: structuredClone(resolved.config.schema), parse: resolved.config.parse.bind(resolved.config) },
        ...(resolved.policy === undefined ? {} : { policy: captureCreationPolicy(resolved.policy) }),
      }));
    }
    const find = (ref: { key: string; version: number }, creating: boolean): ResolvedSessionType => {
      const found = entries.get(`${ref.key}@${String(ref.version)}`);
      if (found === undefined || (creating && !found.enabledForCreation)) throw new SessionTypeError("type-not-found", "Invalid captured session type.");
      return found;
    };
    catalogue = { list: () => [...entries.values()].map((entry) => structuredClone(entry.definition)),
      resolveExisting: (ref) => find(ref, false), resolveForCreation: (ref) => find(ref, true),
    };
  }
  return {
    catalogue: {
      list: catalogue.list.bind(catalogue),
      resolveExisting: catalogue.resolveExisting.bind(catalogue),
      resolveForCreation: catalogue.resolveForCreation.bind(catalogue),
    },
    ...(application.defaultType === undefined ? {} : { defaultType: { ...application.defaultType } }),
    ...(application.role === undefined ? {} : { role: application.role }),
    ...(application.authorizedTools === undefined
      ? {}
      : {
          authorizedTools: new Map([...application.authorizedTools].map(([header, grants]) => [
            header,
            grants.map((grant) => ({ access: grant.access, ref: { ...grant.ref } })),
          ])),
        }),
  };
}

/** Builds the header-enum map. Each session-type key points at its authorized tools. */
export function createSessionTypeToolMap(
  entries: Readonly<Record<string, readonly AuthorizedToolGrant[]>>,
): SessionTypeToolMap {
  const map = new Map<string, readonly AuthorizedToolGrant[]>();
  for (const [header, grants] of Object.entries(entries)) {
    if (!SESSION_TYPE_KEY_PATTERN.test(header)) {
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
    return { providerId: providerId ?? "", providerConfig: split.rest };
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
    applicationConfig = resolved.config.parse(split.rest);
  } catch {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type configuration.");
  }

  const grants = application.authorizedTools?.get(selector.key);
  if (application.authorizedTools !== undefined && grants === undefined) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
  }
  if (grants?.some((grant) => !resolved.tools.some(
    (tool) => tool.key === grant.ref.key && tool.version === grant.ref.version,
  )) === true) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Session type grant is not assigned to this type.");
  }
  const role = application.role ?? ClientAccessRole.Anonymous;
  const visible = grants === undefined
    ? resolved.tools.map((tool) => ({ key: tool.key, version: tool.version }))
    : visibleTools(grants, role);
  const binding: SessionApplicationBinding = {
    typeId: resolved.definition.id,
    key: resolved.definition.key,
    version: resolved.definition.version,
    config: applicationConfig,
    tools: visible,
  };

  return {
    providerId: resolved.definition.providerId,
    providerConfig: {},
    binding,
    manifest: projectSessionToolManifest(
      { id: binding.typeId, key: binding.key, version: binding.version },
      resolved.tools,
      visible,
    ),
  };
}

function splitSelector(config: Readonly<Record<string, unknown>> | undefined): {
  readonly selector: { readonly key: string; readonly version?: number } | undefined;
  readonly rest: Record<string, unknown>;
} {
  const supplied = config === undefined ? {} : { ...config };
  const { [SESSION_TYPE_SELECTOR_KEY]: raw, ...rest } = supplied;
  if (raw === undefined) {
    return { selector: undefined, rest };
  }
  if (typeof raw !== "string" || !SESSION_TYPE_KEY_PATTERN.test(raw)) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
  }
  return { selector: { key: raw }, rest };
}

function enabledVersion(application: SessionApplicationOptions, key: string): number {
  const matches = application.catalogue.list().filter((definition) => definition.key === key && application.catalogue.resolveExisting(definition).enabledForCreation);
  const [only] = matches;
  if (only === undefined || matches.length !== 1) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid session type header.");
  }
  return only.version;
}

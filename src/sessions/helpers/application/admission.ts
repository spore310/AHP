import type { ToolDefinition } from "@microsoft/agent-host-protocol";

import {
  ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED,
  ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET,
} from "@sessions/constants";
import type { ParsedClientSessionAction } from "@sessions/helpers/actions/types";
import type { SessionRecord } from "@sessions/types";
import {
  TOOL_CONTRACT_META_KEY,
  canonicalJsonEqual,
  toAhpToolDefinition,
  type ToolContractDefinition,
} from "@tools";

import type { SessionApplicationOptions } from "./types";

const ADMISSION_REJECTION = "Tool advertisement is not permitted for this session.";

export type AdvertisementDecision
  = { readonly accepted: ParsedClientSessionAction }
    | { readonly rejectionReason: string };

/**
 * Checks a typed session's client advertisement before the reducer runs.
 *
 * Untyped sessions keep the existing advertisement behavior. A typed session
 * may advertise a subset of its pinned contracts, including none. One mismatch
 * rejects the whole action. This does not authenticate the client or execute a tool.
 */
export function admitTypedAdvertisement(
  record: SessionRecord,
  application: SessionApplicationOptions | undefined,
  action: ParsedClientSessionAction,
  clientId: string,
): AdvertisementDecision {
  if (record.application === undefined || application === undefined) {
    return { accepted: action };
  }
  if (action.type === ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED) {
    return action.clientId === clientId
      ? { accepted: action }
      : { rejectionReason: ADMISSION_REJECTION };
  }
  if (action.type !== ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET) {
    return { accepted: action };
  }
  if (action.activeClient.clientId !== clientId) {
    return { rejectionReason: ADMISSION_REJECTION };
  }

  const resolved = application.catalogue.resolveExisting({
    key: record.application.key,
    version: record.application.version,
  });
  const visible = new Map<string, ToolContractDefinition>();
  for (const tool of resolved.tools) {
    const pinned = record.application.tools.some(
      (ref) => ref.key === tool.key && ref.version === tool.version,
    );
    if (pinned) {
      visible.set(tool.id, tool);
    }
  }

  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const tools: ToolDefinition[] = [];
  for (const advertised of action.activeClient.tools) {
    const identity = readContractIdentity(advertised._meta);
    if (identity === undefined || seenNames.has(advertised.name) || seenIds.has(identity.id)) {
      return { rejectionReason: ADMISSION_REJECTION };
    }
    const contract = visible.get(identity.id);
    if (
      contract === undefined
      || contract.key !== identity.key
      || contract.version !== identity.version
      || advertised.name !== contract.name
    ) {
      return { rejectionReason: ADMISSION_REJECTION };
    }
    const projected = toAhpToolDefinition(contract);
    if (!canonicalJsonEqual(advertised.inputSchema, projected.inputSchema)) {
      return { rejectionReason: ADMISSION_REJECTION };
    }
    const outputDeclared = projected.outputSchema !== undefined;
    if (outputDeclared !== (advertised.outputSchema !== undefined)) {
      return { rejectionReason: ADMISSION_REJECTION };
    }
    if (outputDeclared && !canonicalJsonEqual(advertised.outputSchema, projected.outputSchema)) {
      return { rejectionReason: ADMISSION_REJECTION };
    }
    seenNames.add(advertised.name);
    seenIds.add(identity.id);
    tools.push(projected);
  }

  return {
    accepted: {
      ...action,
      activeClient: {
        ...action.activeClient,
        tools,
      },
    },
  };
}

function readContractIdentity(
  meta: Readonly<Record<string, unknown>> | undefined,
): { readonly id: string; readonly key: string; readonly version: number } | undefined {
  if (meta === undefined) {
    return undefined;
  }
  const raw = meta[TOOL_CONTRACT_META_KEY];
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = raw.id;
  const key = raw.key;
  const version = raw.version;
  if (typeof id !== "string" || id.length === 0 || typeof key !== "string" || key.length === 0) {
    return undefined;
  }
  if (typeof version !== "number" || !Number.isSafeInteger(version)) {
    return undefined;
  }
  return { id, key, version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

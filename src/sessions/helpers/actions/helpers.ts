import type { ClientSessionAction, SessionAction } from "@microsoft/agent-host-protocol";
import { JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

import {
  ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED,
  ACTION_TYPE_SESSION_IS_READ_CHANGED,
  ACTION_TYPE_SESSION_TITLE_CHANGED,
} from "@sessions/constants";
import { SessionsError } from "@sessions/helpers/errors";

import {
  clientSeqSchema,
  clientSessionActionSchema,
  type ParsedClientSessionAction,
} from "./types";

/** Stable rejection text for a valid action this baseline does not apply. */
export const BASELINE_UNSUPPORTED_ACTION_REASON
  = "Action is not supported by this host baseline.";

const BASELINE_SUPPORTED_ACTION_TYPES = new Set<ParsedClientSessionAction["type"]>([
  ACTION_TYPE_SESSION_TITLE_CHANGED,
  ACTION_TYPE_SESSION_IS_READ_CHANGED,
  ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED,
]);

/**
 * Validates `clientSeq` as a JSON number in the pinned non-negative safe-integer
 * range. Strings, booleans, null, fractions, and unsafe integers are rejected.
 */
export function parseClientSeq(value: unknown): number {
  const { data, error } = clientSeqSchema.safeParse(value);
  if (error !== undefined) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction clientSeq");
  }

  return data;
}

/**
 * Validates a client session action against the pinned payload inventory.
 *
 * The result is a typed client action. Unrepresentable input never enters the
 * SDK `SessionAction` union.
 */
export function parseClientSessionAction(value: unknown): ParsedClientSessionAction {
  const { data, error } = clientSessionActionSchema.safeParse(value);
  if (error !== undefined) {
    throw new SessionsError(JsonRpcErrorCodes.InvalidParams, "Invalid dispatchAction action");
  }

  return data;
}

/** Whether this baseline applies the action through the session reducer. */
export function isBaselineSupportedSessionAction(
  action: ParsedClientSessionAction,
): action is Extract<
  ParsedClientSessionAction,
  {
    readonly type:
      | typeof ACTION_TYPE_SESSION_TITLE_CHANGED
      | typeof ACTION_TYPE_SESSION_IS_READ_CHANGED
      | typeof ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED;
  }
> {
  return BASELINE_SUPPORTED_ACTION_TYPES.has(action.type);
}

/**
 * Narrows a supported client action to {@link SessionAction} after validation.
 *
 * Supported variants are a subset of the SDK union; this helper exists so the
 * reducer never receives an unvalidated value.
 */
export function toSupportedSessionAction(
  action: Extract<
    ParsedClientSessionAction,
    {
      readonly type:
        | typeof ACTION_TYPE_SESSION_TITLE_CHANGED
        | typeof ACTION_TYPE_SESSION_IS_READ_CHANGED
        | typeof ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED;
    }
  >,
): SessionAction {
  return action;
}

/**
 * Turns a schema-validated client action into the SDK union.
 *
 * Nested optional SDK fields are wider than the parser output; the value has
 * already passed the pinned payload schema.
 */
export function toClientSessionAction(action: ParsedClientSessionAction): ClientSessionAction {
  return action as ClientSessionAction;
}

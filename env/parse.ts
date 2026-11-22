import { parseUnknownJson } from "@jsonrpc";

/**
 * Parsers for compound environment values.
 *
 * These functions validate shape without including received values in thrown
 * messages, so tokens cannot leak through startup errors or logs.
 */

export const parseAuthTokens = (value: string | undefined): ReadonlyMap<string, string> => {
  if (value === undefined) {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = parseUnknownJson(value);
  } catch {
    throw new Error("AGENT_HOSTING_PROTOCOL_AUTH_TOKENS must be a JSON object");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AGENT_HOSTING_PROTOCOL_AUTH_TOKENS must be a JSON object");
  }

  const tokens = new Map<string, string>();
  for (const [token, subject] of Object.entries(parsed)) {
    if (token.length === 0 || typeof subject !== "string" || subject.trim().length === 0) {
      throw new Error("AGENT_HOSTING_PROTOCOL_AUTH_TOKENS must map non-empty tokens to non-empty subjects");
    }
    tokens.set(token, subject.trim());
  }
  if (tokens.size === 0) {
    throw new Error("AGENT_HOSTING_PROTOCOL_AUTH_TOKENS must contain at least one token");
  }

  return tokens;
};

export const parseAllowedKinds = (value: string): ReadonlySet<string> => {
  const kinds = value
    .split(",")
    .map((kind) => kind.trim())
    .filter((kind) => kind.length > 0);

  if (kinds.length === 0) {
    throw new Error("AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS must list at least one kind");
  }
  if (new Set(kinds).size !== kinds.length) {
    throw new Error("AGENT_HOSTING_PROTOCOL_ALLOWED_WORK_KINDS must not repeat a kind");
  }

  return new Set(kinds);
};

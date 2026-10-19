import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";

import { SessionConfigError } from "@sessions/helpers/errors";
import type { SessionConfigContract } from "@sessions/types";

import type { CreateSessionConfigInput } from "./types";

const INVALID_SESSION_CONFIGURATION = "Invalid session configuration.";

/**
 * Binds a session configuration descriptor to a runtime parser.
 *
 * The helper clones and freezes the descriptor so later mutation of the
 * caller's object cannot change what clients are advertised. `parse` runs the
 * supplied parser, preserves its defaults, and throws {@link SessionConfigError}
 * with a sanitized message. It does not prove that the descriptor and parser
 * describe the same language.
 */
export function createSessionConfig(input: CreateSessionConfigInput): SessionConfigContract {
  const schema = freezeSessionConfigSchema(structuredClone(input.schema));
  const { parser } = input;

  return {
    schema,
    parse: (config: Readonly<Record<string, unknown>>): Record<string, unknown> => {
      let parsed: ReturnType<typeof parser.safeParse>;
      try {
        parsed = parser.safeParse(config);
      } catch {
        throw new SessionConfigError(INVALID_SESSION_CONFIGURATION);
      }

      if (!parsed.success) {
        throw new SessionConfigError(sanitizeParserFailure(parsed.error));
      }

      return structuredClone(parsed.data);
    },
  };
}

function freezeSessionConfigSchema(schema: SessionConfigSchema): SessionConfigSchema {
  for (const property of Object.values(schema.properties)) {
    Object.freeze(property);
  }
  Object.freeze(schema.properties);
  if (schema.required !== undefined) {
    Object.freeze(schema.required);
  }
  return Object.freeze(schema);
}

/**
 * Builds a public configuration error from a parser failure without copying
 * received values, issue messages, or stacks.
 */
function fieldNamesFromParserIssue(issue: unknown): string[] {
  if (typeof issue !== "object" || issue === null) {
    return [];
  }

  const record = issue as Record<string, unknown>;
  if (Array.isArray(record.keys)) {
    return record.keys.filter((key): key is string => typeof key === "string" && key.length > 0);
  }

  const { path } = record;
  if (!Array.isArray(path) || path.length === 0) {
    return [];
  }
  return [path.map(String).join(".")];
}

function sanitizeParserFailure(error: unknown): string {
  if (typeof error !== "object" || error === null || !("issues" in error)) {
    return INVALID_SESSION_CONFIGURATION;
  }

  const { issues } = error;
  if (!Array.isArray(issues)) {
    return INVALID_SESSION_CONFIGURATION;
  }

  const paths = issues.flatMap((issue) => fieldNamesFromParserIssue(issue));

  if (paths.length === 0) {
    return INVALID_SESSION_CONFIGURATION;
  }

  return `Invalid session configuration at ${paths.join(", ")}.`;
}

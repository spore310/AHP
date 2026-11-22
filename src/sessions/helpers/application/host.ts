import type { SessionsFactory } from "@sessions/types";
import type { SessionCreationContext } from "@sessions/helpers/creation/types";
import { SESSION_TYPE_SELECTOR_KEY } from "@tools";

/**
 * Creates a session through the existing factory using a session-type header enum.
 *
 * The selector is the string enum value, not a selector object. Application
 * config is forwarded as ordinary createSession config only; this helper does
 * not invent a second pipeline or a client-supplied role.
 */
export function createApplicationSession(
  factory: SessionsFactory,
  input: {
    readonly channel: string;
    readonly type: string;
    readonly config?: Readonly<Record<string, unknown>>;
    readonly workingDirectories?: readonly string[];
  },
  caller?: SessionCreationContext,
): Promise<void> {
  const config: Record<string, unknown> = {
    ...(input.config ?? {}),
    [SESSION_TYPE_SELECTOR_KEY]: input.type,
  };
  const params = {
    channel: input.channel,
    config,
    ...(input.workingDirectories === undefined
      ? {}
      : { workingDirectories: input.workingDirectories }),
  };
  return caller === undefined
    ? factory.createSession(params)
    : factory.authorization === undefined
      ? Promise.reject(new Error("Protected session creation unavailable."))
      : factory.authorization.createSession(params, caller);
}

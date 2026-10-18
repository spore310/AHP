import type { SessionsFactory } from "@sessions/types";
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
): Promise<void> {
  const config: Record<string, unknown> = {
    ...(input.config ?? {}),
    [SESSION_TYPE_SELECTOR_KEY]: input.type,
  };
  return factory.createSession({
    channel: input.channel,
    config,
    ...(input.workingDirectories === undefined
      ? {}
      : { workingDirectories: input.workingDirectories }),
  });
}

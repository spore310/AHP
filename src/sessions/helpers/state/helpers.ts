import type {
  ActionEnvelope,
  SessionAction,
  SessionState,
} from "@microsoft/agent-host-protocol";
import { sessionReducer } from "@microsoft/agent-host-protocol";

import { SESSION_LIFECYCLE_CREATING, SESSION_STATUS_IDLE } from "@/sessions/constants";
import type { SessionRecord, SessionSnapshot } from "@/sessions/types";

/** Inputs that shape the state a session holds before its backend settles. */
export interface NewSessionStateInput {
  readonly providerId: string;
  readonly title: string;
  readonly workingDirectories: readonly string[];
}

/**
 * Builds the initial session state.
 *
 * Backend initialisation is asynchronous, so the session is registered and its
 * subscribers see `lifecycle: creating` until `session/ready` (or
 * `session/creationFailed`) is applied through
 * {@link applySessionAction}.
 */
export function createInitialSessionState(input: NewSessionStateInput): SessionState {
  return {
    lifecycle: SESSION_LIFECYCLE_CREATING,
    provider: input.providerId,
    title: input.title,
    status: SESSION_STATUS_IDLE,
    activeClients: [],
    chats: [],
    ...(input.workingDirectories.length === 0
      ? {}
      : { workingDirectories: [...input.workingDirectories] }),
  };
}

/**
 * Applies a server-originated action to the record and returns the envelope to
 * broadcast.
 *
 * This is the only path that mutates a session's state. The wire-level sequence
 * comes from the host's shared {@link SessionsDependencies.nextServerSeq}
 * allocator rather than from the record, so actions across every session share
 * one ordered, gap-free stream that an ordinary connection-wide replay cursor
 * can select from.
 */
export function applySessionAction(
  record: SessionRecord,
  action: SessionAction,
  modifiedAt: string,
  nextServerSeq: () => number,
): ActionEnvelope {
  record.state = sessionReducer(record.state, action);
  record.serverSeq = nextServerSeq();
  record.modifiedAt = modifiedAt;

  return {
    channel: record.sessionUri,
    action,
    serverSeq: record.serverSeq,
    origin: undefined,
  };
}

/**
 * Captures a session snapshot at the record's current `serverSeq`.
 *
 * The state is defensively cloned so an in-process consumer cannot mutate
 * authoritative state, advance the sequence, or affect another observer by
 * editing a returned snapshot (including nested arrays and error objects).
 */
export function buildSessionSnapshot(record: SessionRecord): SessionSnapshot {
  return {
    resource: record.sessionUri,
    state: structuredClone(record.state),
    fromSeq: record.serverSeq,
  };
}

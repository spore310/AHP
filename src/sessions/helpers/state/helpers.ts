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
 * This is the only path that mutates a session's state and the only place the
 * per-channel `serverSeq` advances, so envelopes stay contiguous and replayable
 * through the protocol reducer.
 */
export function applySessionAction(
  record: SessionRecord,
  action: SessionAction,
  modifiedAt: string,
): ActionEnvelope {
  record.state = sessionReducer(record.state, action);
  record.serverSeq += 1;
  record.modifiedAt = modifiedAt;

  return {
    channel: record.sessionUri,
    action,
    serverSeq: record.serverSeq,
    origin: undefined,
  };
}

/** Captures a session snapshot at the record's current `serverSeq`. */
export function buildSessionSnapshot(record: SessionRecord): SessionSnapshot {
  return {
    resource: record.sessionUri,
    state: record.state,
    fromSeq: record.serverSeq,
  };
}

import type { SessionState } from "@microsoft/agent-host-protocol";
import { idleSessionStatus, SESSION_STATUS_READ, SESSION_STATUS_ARCHIVED } from "@sessions/constants";
import { z } from "zod";
import { createInitialSessionState } from "@sessions/helpers/state";
import type { PersistedSessionStateV1 } from "./types";

const codec = z.strictObject({ version: z.literal(1), title: z.string(), isRead: z.boolean(), isArchived: z.boolean(), workingDirectories: z.array(z.string()).optional() });

export function encodeState(state: SessionState): PersistedSessionStateV1 {
  return { version: 1, title: state.title, isRead: (state.status & SESSION_STATUS_READ) !== 0, isArchived: (state.status & SESSION_STATUS_ARCHIVED) !== 0,
    ...(state.workingDirectories === undefined ? {} : { workingDirectories: [...state.workingDirectories] }) };
}
export function restoreState(providerId: string, persisted: unknown): SessionState {
  const state = codec.parse(persisted);
  const base = createInitialSessionState({ providerId, title: state.title, workingDirectories: state.workingDirectories ?? [] });
  return { ...base, status: idleSessionStatus(state.isRead, state.isArchived) };
}

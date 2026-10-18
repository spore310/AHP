import type { SessionSummary } from "@microsoft/agent-host-protocol";

import type { SessionRecord } from "@/sessions/types";

/**
 * Projects session state into the catalog summary broadcast on the root channel.
 *
 * No chats exist yet, so the summary mirrors the session state directly. The
 * cross-chat aggregation rules (merged status/activity, `changes` stats) arrive
 * with the chat channel, which owns that data.
 */
export function buildSessionSummary(record: SessionRecord): SessionSummary {
  const { state } = record;

  return {
    resource: record.sessionUri,
    provider: state.provider,
    title: state.title,
    status: state.status,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
    ...(state.activity === undefined ? {} : { activity: state.activity }),
    ...(state.workingDirectories === undefined
      ? {}
      : { workingDirectories: state.workingDirectories }),
  };
}

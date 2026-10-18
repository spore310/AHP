import type { SessionSummary } from "@microsoft/agent-host-protocol";

import type { SessionRecord } from "@sessions/types";

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

/**
 * Mutable catalogue fields that changed between two summaries.
 *
 * Identity fields (`resource`, `provider`, `createdAt`) are never included.
 */
export function changedSessionSummaryFields(
  before: SessionSummary,
  after: SessionSummary,
): Partial<SessionSummary> {
  const changes: Partial<SessionSummary> = {};

  if (before.title !== after.title) {
    changes.title = after.title;
  }
  if (before.status !== after.status) {
    changes.status = after.status;
  }
  if (before.modifiedAt !== after.modifiedAt) {
    changes.modifiedAt = after.modifiedAt;
  }
  if (before.activity !== after.activity) {
    changes.activity = after.activity;
  }
  if (!sameWorkingDirectories(before.workingDirectories, after.workingDirectories)) {
    changes.workingDirectories = after.workingDirectories;
  }

  return changes;
}

function sameWorkingDirectories(
  before: SessionSummary["workingDirectories"],
  after: SessionSummary["workingDirectories"],
): boolean {
  if (before === after) {
    return true;
  }
  if (before === undefined || after === undefined) {
    return false;
  }
  if (before.length !== after.length) {
    return false;
  }
  return before.every((directory, index) => directory === after[index]);
}

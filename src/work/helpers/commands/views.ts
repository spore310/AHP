import type { StoredWork } from "@persistence/helpers/durability/workTypes";
import type { AuthorizedWorkView, WorkListSummary } from "./types";

export function workSummary(row: StoredWork): WorkListSummary {
  return { id: row.id, session: row.session, kind: row.kind, priority: row.priority, status: row.status,
    revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function workDetail(row: StoredWork): AuthorizedWorkView {
  return { ...workSummary(row), input: row.input, data: row.data, dataRevision: row.dataRevision,
    ...(row.result ? { result: row.result } : {}), scope: row.scope, announce: row.announce,
    entities: { submitter: row.submitter, owner: { domainId: row.session.domainId, subject: row.owner } },
    attemptCount: row.attemptCount, maxAttempts: row.maxAttempts, ...(row.failure ? { failure: row.failure } : {}) };
}

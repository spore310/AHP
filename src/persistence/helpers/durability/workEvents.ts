import { createWorkEventPublisher, type WorkEventKind } from "@work/helpers/events";
import type { StoredWork, WorkIntent } from "./workTypes";
import type { DurableHost, ResourceRecord, RetiredWork, RetirementObserver } from "./types";

/** Emit only after the acquired store has confirmed the mutation and invalidated prior observations. */
export function publishHostWork(host: DurableHost): DurableHost {
  const events = createWorkEventPublisher();
  const work = host.work;
  const emit = (session: WorkIntent["session"], workId: string, revision: string, type: WorkEventKind, occurredAt = new Date().toISOString()) => {
    events.publish({ session, workId, revision, type, occurredAt, version: 1 });
  };
  const fromRow = (row: StoredWork, type: WorkEventKind) => {
    emit(row.session, row.id, row.revision, type, row.updatedAt);
    return row;
  };
  const terminal = (row: StoredWork) => fromRow(row, row.status === "queued" ? "requeued" : row.status === "completed" ? "completed" : row.status === "cancelled" ? "cancelled" : "failed");
  async function retirement(session: WorkIntent["session"], run: (save: RetirementObserver) => Promise<readonly ResourceRecord[]>, observer?: RetirementObserver) {
    const exact = structuredClone(session);
    let cancelled: RetiredWork = [];
    const records = await run((rows) => {
      cancelled = rows;
    });
    for (const { id, revision } of cancelled) emit(exact, id, revision, "cancelled");
    if (observer) {
      try {
        void Promise.resolve(observer(cancelled)).catch(() => undefined);
      } catch { /* The retirement is already committed. */ }
    }
    return records;
  }
  return {
    ...host, workEvents: { subscribe: events.subscribe.bind(events) },
    async release() {
      events.dispose();
      await host.release();
    },
    sessions: {
      ...host.sessions, beginRetirement: (session, admit, observer) =>
        retirement(session, (save) => host.sessions.beginRetirement(session, admit, save), observer),
    },
    resources: {
      ...host.resources, beginRetirement: (session, ref, admit, observer) =>
        retirement(session, (save) => host.resources.beginRetirement(session, ref, admit, save), observer),
    },
    work: {
      ...work,
      async submit(intent, ...args) {
        const session = structuredClone(intent.session);
        const result = await work.submit(intent, ...args);
        if (result.created) emit(session, result.id, "1", "submitted");
        return result;
      },
      async claimPrepared(...args) {
        const result = await work.claimPrepared(...args);
        if (result.status === "claimed") fromRow(result.row, "claimed");
        return result;
      },
      async renewPrepared(...args) {
        return fromRow(await work.renewPrepared(...args), "renewed");
      },
      async settle(...args) {
        return terminal(await work.settle(...args));
      },
      async disposition(...args) {
        return terminal(await work.disposition(...args));
      },
      async replaceData(fence, ...args) {
        const exact = structuredClone(fence);
        const value = await work.replaceData(exact, ...args);
        emit(exact.session, exact.id, (BigInt(exact.revision) + 1n).toString(), "dataUpdated");
        return value;
      },
      async expireExhausted(ref, ...args) {
        const session = structuredClone(ref);
        const rows = await work.expireExhausted(session, ...args);
        for (const row of rows) emit(session, row.id, row.revision, "failed");
        return rows;
      },
    },
  };
}

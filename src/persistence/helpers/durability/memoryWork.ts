import { randomUUID } from "node:crypto";
import { sameActor, sameResource } from "@authorization/helpers/context";
import type { ResourceRef } from "@authorization";
import { RepositoryError, type AgentRegistrationRecord } from "../../types";
import { atomic, captureData } from "./helpers";
import type { Admission, ReplaceData, ResourceRecord, StoredSession } from "./types";
import type { DurableWorkRepository, StoredWork, WorkFence } from "./workTypes";
import { captureWorkIntent, sameWorkIntent } from "./workIntent";
import { createWorkSelectionGraph } from "@work/helpers/selections";

function conflict(): never {
  throw new RepositoryError("conflict", "Work state or capacity changed.");
}
const advance = (value: string) => (BigInt(value) + 1n).toString();
const active = (row: StoredWork) => row.status === "queued" || row.status === "leased";

/** One synchronous operation per call, sharing sessions, resources, registration epochs and work with retirement. */
export function createMemoryWorkRepository(
  jobs: Map<string, StoredWork>, registrations: ReadonlyMap<string, AgentRegistrationRecord>,
  resources: ReadonlyMap<string, ResourceRecord>, session: (ref: ResourceRef<"session">) => StoredSession | undefined,
  guard: (admit?: Admission) => void,
): DurableWorkRepository {
  function fenced(fence: WorkFence): StoredWork {
    const row = jobs.get(fence.id);
    if (!row || !sameResource(fence.session, row.session) || session(row.session)?.lifecycle !== "active" || row.revision !== fence.revision) conflict();
    if (fence.execution) {
      const { lease } = row;
      const check = fence.execution;
      const agent = registrations.get(check.registrationId);
      if (!lease || row.status !== "leased" || !agent?.enabled || agent.domainId !== row.session.domainId || agent.executionEpoch !== check.executionEpoch
        || lease.attempt !== check.attempt || lease.leaseToken !== check.leaseToken || lease.registrationId !== check.registrationId
        || lease.executionEpoch !== check.executionEpoch || Date.parse(lease.expiresAt) <= Date.now()) conflict();
    }
    return row;
  }
  function changeData(row: StoredWork, change: ReplaceData) {
    if (row.dataRevision !== change.expectedDataRevision) conflict();
    return { data: captureData(change.data), dataRevision: advance(row.dataRevision) };
  }
  return {
    graph(domainId, locator, replay) {
      return atomic(() => {
        guard();
        const matches = (ref: ResourceRef) => ref.domainId === domainId && ref.kind === locator.kind && ref.id === locator.id
          && (locator.instanceId === undefined || locator.instanceId === ref.instanceId);
        const anchor = [...resources.values()].find((r) => r.lifecycle === "active" && matches(r.ref) && session(r.session)?.lifecycle === "active");
        let root = anchor && session(anchor.session);
        let previous: StoredWork | undefined;
        if (replay && replay.submitter.principal.domainId === domainId) {
          for (const job of jobs.values()) {
            if (job.session.domainId !== domainId || job.kind !== replay.kind || job.requestKey !== replay.requestKey
              || !sameActor(job.submitter, replay.submitter)) continue;
            if (anchor) {
              if (sameResource(job.session, anchor.session)) {
                previous = job;
                break;
              }
            } else if ([...job.scope, ...job.announce].some((rule) => matches(rule.resource))) {
              const candidate = session(job.session);
              if (candidate?.lifecycle !== "active") continue;
              if (previous) return undefined;
              root = candidate;
              previous = job;
            }
          }
        }
        if (!root || root.lifecycle !== "active") return undefined;
        const ref = root.ref;
        return structuredClone({ session: root, resources: [...resources.values()].filter((r) => sameResource(r.session, ref)),
          ...(previous && { previous }) });
      });
    },
    get(domainId, id) {
      return atomic(() => {
        guard();
        const row = jobs.get(id);
        return row?.session.domainId === domainId ? structuredClone(row) : undefined;
      });
    },
    submit(command, graphRevision, limits, admit) {
      return atomic(() => {
        guard();
        const intent = captureWorkIntent(command);
        const root = session(intent.session);
        if (!root || root.lifecycle !== "active" || root.graphRevision !== graphRevision || root.ref.domainId !== intent.submitter.principal.domainId) conflict();
        if (!intent.scope.some((rule) => rule.include) || ![limits.session, limits.host].every((v) => Number.isSafeInteger(v) && v > 0)) conflict();
        const existing = [...jobs.values()].find((row) => sameResource(row.session, root.ref) && row.kind === intent.kind && row.requestKey === intent.requestKey);
        if (existing) {
          if (!sameWorkIntent(existing, intent)) conflict();
          guard(admit);
          return { id: existing.id, created: false };
        }
        const graph = createWorkSelectionGraph(root.ref.domainId, root, [...resources.values()].filter((row) => sameResource(row.session, root.ref)));
        if ([...intent.scope, ...intent.announce].some(({ resource }) =>
          !graph.selected(resource, [{ resource, include: true, includeDescendants: false }], graphRevision))) conflict();
        if (intent.targetAgentId !== null) {
          const agent = registrations.get(intent.targetAgentId);
          if (!agent?.enabled || agent.domainId !== root.ref.domainId) conflict();
        }
        const occupied = [...jobs.values()].filter(active);
        if (occupied.length >= limits.host || occupied.filter((row) => sameResource(row.session, root.ref)).length >= limits.session) conflict();
        const stamp = new Date().toISOString();
        const id = randomUUID();
        const data = captureData(intent.submittedData);
        const row: StoredWork = { ...intent, input: captureData(intent.input), submittedData: data, data, id, owner: root.owner, status: "queued", attemptCount: 0,
          revision: "1", dataRevision: "1", createdAt: stamp, updatedAt: stamp };
        guard(admit);
        jobs.set(id, row);
        return { id, created: true };
      });
    },
    replaceData(fence, change, admit) {
      return atomic(() => {
        guard();
        const row = fenced(fence);
        const value = changeData(row, change);
        guard(admit);
        jobs.set(row.id, { ...row, ...value, revision: advance(row.revision), updatedAt: new Date().toISOString() });
        return structuredClone(value);
      });
    },
    settle(fence, command, admit) {
      return atomic(() => {
        guard();
        if (!fence.execution) conflict();
        const row = fenced(fence);
        const stamp = new Date().toISOString();
        const update = { ...row, ...(command.data ? changeData(row, command.data) : {}), updatedAt: stamp, revision: advance(row.revision), lease: undefined };
        const next: StoredWork = command.status === "completed"
          ? { ...update, status: "completed", result: captureData(command.result, 256 * 1024) }
          : { ...update, status: command.retryable && row.attemptCount < row.maxAttempts ? "queued" : "failed",
              failure: { code: command.code, summary: command.summary, occurredAt: stamp } };
        guard(admit);
        jobs.set(row.id, next);
        return structuredClone(next);
      });
    },
  };
}

import { randomUUID } from "node:crypto";
import { sameActor, sameResource } from "@authorization/helpers/context";
import type { ResourceRef } from "@authorization";
import { RepositoryError, type AgentRegistrationRecord } from "../../types";
import { atomic, captureData } from "./helpers";
import type { Admission, ReplaceData, ResourceRecord, StoredSession } from "./types";
import type { DurableWorkRepository, StoredWork, WorkFence } from "./workTypes";
import { captureWorkIntent, durableSelectionLimits, sameWorkIntent } from "./workIntent";
import { createWorkSelectionGraph } from "@work/helpers/selections";
import { createMemoryScheduling } from "./memoryScheduling";

function conflict(): never {
  throw new RepositoryError("conflict", "Work state or capacity changed.");
}
const advance = (value: string) => (BigInt(value) + 1n).toString();
const active = (row: StoredWork) => row.status === "queued" || row.status === "leased";

/** One synchronous operation per call, sharing sessions, resources, registration epochs and work with retirement. */
export function createMemoryWorkRepository(
  jobs: Map<string, StoredWork>, registrations: ReadonlyMap<string, AgentRegistrationRecord>,
  resources: ReadonlyMap<string, ResourceRecord>, session: (ref: ResourceRef<"session">) => StoredSession | undefined,
  guard: (admit?: Admission) => void, hostEpoch: string,
): DurableWorkRepository {
  // SQL serializes fresh work inserts under the host quota lock. A synchronous
  // admission callback can reenter this adapter before the outer insert lands.
  let inserting = false;
  function fenced(fence: WorkFence): StoredWork {
    const row = jobs.get(fence.id);
    const root = row && session(row.session);
    if (!row || !sameResource(fence.session, row.session) || root?.lifecycle !== "active" || row.revision !== fence.revision
      || (fence.graphRevision !== undefined && root.graphRevision !== fence.graphRevision)) conflict();
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
    ...createMemoryScheduling(jobs, registrations, resources, session, guard, hostEpoch),
    leased(after, limit) {
      return atomic(() => {
        guard();
        if (!Number.isInteger(limit) || limit < 1 || limit > 128) return conflict();
        return [...jobs.values()].filter((r) => r.status === "leased" && (!after || r.id > after))
          .sort((a, b) => a.id < b.id ? -1 : 1).slice(0, limit).map((r) => ({ domainId: r.session.domainId, id: r.id }));
      });
    },
    disposition(fence, action, admit) {
      return atomic(() => {
        guard();
        const row = jobs.get(fence.id);
        if (!row || !active(row) || row.revision !== fence.revision || !sameResource(row.session, fence.session)) return conflict();
        const lease = row.lease;
        const proof = fence.execution;
        if (proof && (!lease || row.status !== "leased" || lease.registrationId !== proof.registrationId || lease.executionEpoch !== proof.executionEpoch
          || lease.attempt !== proof.attempt || lease.leaseToken !== proof.leaseToken)) return conflict();
        if (action !== "cancel" && !proof) return conflict();
        const root = session(row.session);
        if (!root || root.lifecycle === "retired" || root.lifecycle === "retiring") return conflict();
        const graph = createWorkSelectionGraph(row.session.domainId, root, [...resources.values()].filter((r) => sameResource(r.session, row.session)), durableSelectionLimits);
        const canRetry = action === "requeue" && row.attemptCount < row.maxAttempts && root.lifecycle === "active"
          && graph.hasActivePositiveScope(row.scope, root.graphRevision);
        const status = action === "cancel" ? "cancelled" : canRetry ? "queued" : "failed";
        const stamp = new Date().toISOString();
        const next: StoredWork = { ...row, lease: undefined, status, revision: advance(row.revision), updatedAt: stamp,
          ...(status === "failed" && { failure: { code: "authority_lost", summary: "Work authority changed.", occurredAt: stamp } }) };
        guard(admit);
        if (jobs.get(row.id) !== row || session(row.session)?.graphRevision !== root.graphRevision) conflict();
        jobs.set(row.id, next);
        return structuredClone(next);
      });
    },
    sampleLease({ session: ref, id, revision }) {
      return atomic(() => {
        guard();
        const row = jobs.get(id);
        const root = session(ref);
        if (!root || root.lifecycle === "retiring" || root.lifecycle === "retired" || row?.status !== "leased"
          || !row.lease || row.revision !== revision || !sameResource(row.session, ref)) return undefined;
        return { expiresAt: row.lease.expiresAt, databaseTime: Date.now() };
      });
    },
    inspect(domainId, id) {
      return atomic(() => {
        guard();
        const row = jobs.get(id);
        if (!row || row.session.domainId !== domainId) return undefined;
        const root = session(row.session);
        if (!root || root.lifecycle === "retired" || root.lifecycle === "retiring") return undefined;
        const agent = row.lease && registrations.get(row.lease.registrationId);
        const registration = agent?.domainId === domainId && agent.executionEpoch !== undefined
          ? { id: agent.id, subject: agent.principalSubject, key: agent.agentKey, enabled: agent.enabled, epoch: agent.executionEpoch }
          : undefined;
        return structuredClone({ session: root, resources: [...resources.values()].filter((r) => sameResource(r.session, row.session)),
          row, databaseTime: Date.now(), registration });
      });
    },
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
          guard(() => admit({ id: existing.id, revision: existing.revision }));
          if (jobs.get(existing.id) !== existing || session(root.ref)?.graphRevision !== graphRevision) conflict();
          return { id: existing.id, created: false };
        }
        if (inserting) return conflict();
        const graph = createWorkSelectionGraph(root.ref.domainId, root, [...resources.values()].filter((row) => sameResource(row.session, root.ref)), durableSelectionLimits);
        if ([...intent.scope, ...intent.announce].some(({ resource }) =>
          !graph.selected(resource, [{ resource, include: true, includeDescendants: false }], graphRevision))) conflict();
        const targetCurrent = () => {
          if (intent.targetAgentId === null) return true;
          const agent = registrations.get(intent.targetAgentId);
          return agent?.enabled && agent.domainId === root.ref.domainId;
        };
        if (!targetCurrent()) conflict();
        const occupied = [...jobs.values()].filter(active);
        if (occupied.length >= limits.host || occupied.filter((row) => sameResource(row.session, root.ref)).length >= limits.session) conflict();
        const stamp = new Date().toISOString();
        const id = randomUUID();
        const data = captureData(intent.submittedData);
        const row: StoredWork = { ...intent, input: captureData(intent.input), submittedData: data, data, id, owner: root.owner, status: "queued", attemptCount: 0,
          revision: "1", dataRevision: "1", createdAt: stamp, updatedAt: stamp };
        inserting = true;
        try {
          guard(() => admit(null));
          // An admission callback may synchronously retire an anchor or disable the target.
          // Every lifecycle transition advances the owning session's graph revision.
          if (session(root.ref)?.graphRevision !== graphRevision || !targetCurrent()) conflict();
          jobs.set(id, row);
        } finally {
          inserting = false;
        }
        return { id, created: true };
      });
    },
    replaceData(fence, change, admit) {
      return atomic(() => {
        guard();
        const row = fenced(fence);
        const value = changeData(row, change);
        guard(admit);
        fenced(fence);
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
        fenced(fence);
        jobs.set(row.id, next);
        return structuredClone(next);
      });
    },
  };
}

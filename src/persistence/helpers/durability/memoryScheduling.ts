import { randomUUID } from "node:crypto";
import { sameResource } from "@authorization/helpers/context";
import type { AgentRegistrationRecord } from "../../types";
import type { ResourceRecord, StoredSession } from "./types";
import { atomic, memoryResourceKey } from "./helpers";
import type { ClaimActor, ClaimAdmission, ClaimCursor, LockedClaim, StoredWork, WorkScheduling } from "./workTypes";
import { admitSchedule, bounded, schedulingConflict as conflict, synchronousAdmission, validateScan, validateSchedule } from "./scheduling";

const compare = (a: ClaimCursor, b: ClaimCursor) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const eligible = (r: StoredWork, now: number) => r.attemptCount < r.maxAttempts
  && (r.status === "queued" || (r.status === "leased" && !!r.lease && Date.parse(r.lease.expiresAt) <= now));
const next = (v: string) => String(BigInt(v) + 1n);

export function createMemoryScheduling(jobs: Map<string, StoredWork>, registrations: ReadonlyMap<string, AgentRegistrationRecord>,
  resources: ReadonlyMap<string, ResourceRecord>, session: (ref: StoredSession["ref"]) => StoredSession | undefined,
  open: () => void, hostEpoch: string): WorkScheduling {
  function root(ref: StoredSession["ref"], expected?: string) {
    const value = session(ref);
    if (!value || value.lifecycle !== "active" || (expected !== undefined && value.graphRevision !== expected)) return conflict();
    return value;
  }
  function identity(actor: ClaimActor, domain: string) {
    const r = registrations.get(actor.registrationId);
    if (!r?.enabled || r.domainId !== domain || actor.principal.domainId !== domain || r.principalSubject !== actor.principal.subject
      || r.executionEpoch !== actor.executionEpoch || r.agentKey !== actor.agentKey) return conflict();
    return { id: r.id, enabled: true, subject: r.principalSubject, epoch: r.executionEpoch, key: r.agentKey };
  }
  function capacity(agent: string, now: number) {
    let count = 0;
    for (const r of jobs.values()) if (r.status === "leased" && r.lease?.registrationId === agent && Date.parse(r.lease.expiresAt) > now) count++;
    return count;
  }
  function snapshot(session: StoredSession, row: StoredWork, registration: LockedClaim["registration"], databaseTime: number): LockedClaim {
    return { session, row, registration, databaseTime, hostEpoch, resources: [...resources.values()].filter((r) => sameResource(r.session, session.ref)) };
  }
  function admitLocked(locked: LockedClaim, admit: ClaimAdmission) {
    admitSchedule(locked, admit);
    open();
    if (session(locked.session.ref) !== locked.session) return conflict();
    if (locked.resources.some((r) => resources.get(memoryResourceKey(r.ref)) !== r)) return conflict();
  }
  return {
    scanCandidates(input) {
      return atomic(() => {
        open();
        validateScan(input);
        root(input.session);
        const now = Date.now();
        const matches = [...jobs.values()].filter((r) => sameResource(r.session, input.session) && input.allowedKinds.includes(r.kind)
          && (!r.targetAgentId || r.targetAgentId === input.registrationId) && eligible(r, now) && (!input.after || compare(r, input.after) > 0)).sort(compare);
        return { rows: structuredClone(matches.slice(0, input.limit)), hasMore: matches.length > input.limit };
      });
    },
    claimPrepared(raw, admit) {
      return atomic(() => {
        const input = structuredClone(raw);
        open();
        validateSchedule(input);
        const s = root(input.session, input.graphRevision);
        const agent = identity(input.actor, s.ref.domainId);
        const now = Date.now();
        const count = capacity(agent.id, now);
        if (count >= input.maxActiveClaims) return { status: "capacity" };
        const row = input.candidates.flatMap(({ id, revision }) => {
          const r = jobs.get(id);
          return r && r.revision === revision && sameResource(r.session, s.ref) && input.allowedKinds.includes(r.kind)
            && (!r.targetAgentId || r.targetAgentId === agent.id) && eligible(r, now)
            ? [r]
            : [];
        }).sort(compare)[0];
        if (!row) return { status: "changed" };
        const token = randomUUID();
        admitLocked({ ...snapshot(s, row, agent, now), activeClaims: count }, admit);
        identity(input.actor, s.ref.domainId);
        const at = Date.now();
        if (jobs.get(row.id) !== row || !eligible(row, at) || capacity(agent.id, at) >= input.maxActiveClaims) return conflict();
        const leased: StoredWork = { ...row, attemptCount: row.attemptCount + 1, status: "leased", revision: next(row.revision), updatedAt: new Date(at).toISOString(),
          lease: { registrationId: agent.id, executionEpoch: agent.epoch, attempt: row.attemptCount + 1, leaseToken: token, expiresAt: new Date(at + input.leaseMs).toISOString() } };
        jobs.set(row.id, leased);
        return { status: "claimed", row: structuredClone(leased) };
      });
    },
    renewPrepared(raw, admit) {
      return atomic(() => {
        const input = structuredClone(raw);
        open();
        validateSchedule(input);
        const { fence, actor } = input;
        const s = root(fence.session, fence.graphRevision);
        const agent = identity(actor, s.ref.domainId);
        const row = jobs.get(fence.id);
        const lease = row?.lease;
        const proof = fence.execution;
        const at = Date.now();
        if (!row || !lease || !sameResource(row.session, s.ref) || row.status !== "leased" || row.revision !== fence.revision || lease.registrationId !== agent.id
          || lease.executionEpoch !== agent.epoch || proof.executionEpoch !== agent.epoch || proof.registrationId !== agent.id || lease.attempt !== proof.attempt
          || lease.leaseToken !== proof.leaseToken || Date.parse(lease.expiresAt) <= at) return conflict();
        admitLocked(snapshot(s, row, agent, at), admit);
        identity(actor, s.ref.domainId);
        const now = Date.now();
        if (jobs.get(row.id) !== row || Date.parse(lease.expiresAt) <= now) return conflict();
        const renewed = { ...row, revision: next(row.revision), updatedAt: new Date(now).toISOString(),
          lease: { ...lease, expiresAt: new Date(now + input.leaseMs).toISOString() } };
        jobs.set(row.id, renewed);
        return structuredClone(renewed);
      });
    },
    expireExhausted(ref, limit, beforeWrite) {
      return atomic(() => {
        open();
        if (!bounded(limit, 1, 32)) return conflict();
        const s = root(ref);
        const now = Date.now(), stamp = new Date(now).toISOString();
        const rows = [...jobs.values()].filter((r) => sameResource(r.session, s.ref) && r.status === "leased" && r.lease
          && Date.parse(r.lease.expiresAt) <= now && r.attemptCount >= r.maxAttempts).sort((a, b) => (a.lease?.expiresAt ?? "").localeCompare(b.lease?.expiresAt ?? "") || compare(a, b)).slice(0, limit);
        if (rows.length && beforeWrite) synchronousAdmission(beforeWrite, rows.map((r) => r.id));
        open();
        root(ref, s.graphRevision);
        if (rows.some((r) => jobs.get(r.id) !== r)) return conflict();
        return rows.map((r) => {
          const revision = next(r.revision);
          jobs.set(r.id, { ...r, status: "failed", revision, lease: undefined, updatedAt: stamp,
            failure: { code: "lease_expired", summary: "Work lease expired.", occurredAt: stamp } });
          return { id: r.id, revision };
        });
      });
    },
  };
}

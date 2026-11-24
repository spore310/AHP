import { sameResource } from "@authorization/helpers/context";
import { isDeepStrictEqual } from "node:util";
import type { ResourceRef } from "@authorization";
import { atomic, canRetrySessionStart, captureData, captureRef, resourceOrder } from "./helpers";
import { createMemoryWorkRepository } from "./memoryWork";
import { fenceHostWork } from "./workFences";
import type { StoredWork } from "./workTypes";
import type { AgentRegistrationRecord } from "../../types";
import type { Admission, DurableHost, DurableStorage, ResourceRecord, StoredSession, Transition } from "./types";

const key = (ref: ResourceRef): string => JSON.stringify([ref.domainId, ref.kind, ref.id, ref.instanceId]);
const advance = (revision: string): string => (BigInt(revision) + 1n).toString();
function unavailable(): never {
  throw new Error("Durable operation unavailable.");
}

/** One storage instance may outlive multiple hosts. Every mutation below runs in one synchronous critical section. */
export function createMemoryDurableStorage(work = new Map<string, StoredWork>(), registrations: ReadonlyMap<string, AgentRegistrationRecord> = new Map()): DurableStorage {
  const sessions = new Map<string, StoredSession>();
  const resources = new Map<string, ResourceRecord>();
  const typesById = new Map<string, { type: StoredSession["type"]; providerId: string }>();
  const typeVersions = new Map<string, string>();
  let hostId: string | undefined;
  let epoch = 0n;
  let checkpoint = 0;
  let occupied = false;
  return { acquire(id) {
    return atomic(() => {
      if (!id.trim() || occupied || (hostId !== undefined && id !== hostId)) unavailable();
      hostId = id;
      occupied = true;
      const owned = ++epoch;
      const isOpen = (): boolean => occupied && epoch === owned;
      const guard = (admit: Admission = () => true): void => {
        if (!isOpen()) unavailable();
        const decision = admit();
        if (decision !== true) {
          void Promise.resolve(decision).catch(() => undefined);
          unavailable();
        }
        if (!isOpen()) unavailable();
      };
      const sessionRows = (session: ResourceRef): ResourceRecord[] => [...resources.values()].filter((r) => sameResource(r.session, session));
      const find = (ref: ResourceRef): ResourceRecord => resources.get(key(ref)) ?? unavailable();
      const requireOperationalParents = (row: ResourceRecord, requireActiveAncestors = false): void => {
        const pending = [row.parent, row.grantParent];
        const visited = new Set<ResourceRecord>();
        while (pending.length) {
          const ref = pending.pop();
          if (!ref) continue;
          const parent = find(ref);
          if (visited.has(parent)) continue;
          if (!sameResource(parent.session, row.session) || !["creating", "active"].includes(parent.lifecycle)) unavailable();
          if (requireActiveAncestors && parent.ref.kind !== "session" && parent.lifecycle !== "active") unavailable();
          visited.add(parent);
          pending.push(parent.parent, parent.grantParent);
        }
      };
      const transition = (input: Transition, admit: Admission): Promise<void> => {
        return atomic(() => {
          const metadata = input.runtimeMetadata === undefined ? undefined : captureData(input.runtimeMetadata);
          guard(admit);
          const r = find(input.ref);
          const s = sessions.get(key(input.session));
          if (s === undefined || !sameResource(r.session, s.ref) || r.operationId !== input.operationId || r.lifecycle !== input.expected || ["retired", "retiring"].includes(r.lifecycle)) unavailable();
          if (input.next === "creating" && (!canRetrySessionStart(r) || metadata !== undefined)) unavailable();
          if (input.next === "active" && r.ref.kind !== "session") requireOperationalParents(r, true);
          resources.set(key(r.ref), { ...r, lifecycle: input.next, resourceRevision: advance(r.resourceRevision), ...(metadata === undefined ? {} : { runtimeMetadata: metadata }) });
          if (r.lifecycle !== input.next) sessions.set(key(s.ref), { ...s, graphRevision: advance(s.graphRevision),
            ...(r.ref.kind === "session" ? { lifecycle: input.next } : {}) });
        });
      };
      const begin = (session: ResourceRef<"session">, ref: ResourceRef, admit: Admission): readonly ResourceRecord[] => {
        guard(admit);
        const s = sessions.get(key(session));
        const target = find(ref);
        if (s === undefined || !sameResource(target.session, session) || target.lifecycle === "retired") unavailable();
        const ordered = resourceOrder(sessionRows(session));
        const closure = new Set([key(ref)]);
        for (const row of ordered) {
          if (row.lifecycle === "retired") continue;
          if ((row.parent && closure.has(key(row.parent))) || (row.grantParent && closure.has(key(row.grantParent)))) closure.add(key(row.ref));
        }
        for (const [id, job] of work) {
          if (!sameResource(job.session, session) || !["queued", "leased"].includes(job.status)) continue;
          if (sameResource(session, ref) || job.scope.some((anchor) => anchor.include && closure.has(key(anchor.resource)))) {
            work.set(id, { ...job, lease: undefined, status: "cancelled", revision: advance(job.revision), updatedAt: new Date().toISOString() });
          }
        }
        let changed = false;
        for (const k of closure) {
          const row = resources.get(k);
          if (row && row.lifecycle !== "retiring") {
            resources.set(k, { ...row, resourceRevision: advance(row.resourceRevision), lifecycle: "retiring" });
            changed = true;
          }
        }
        if (changed) sessions.set(key(session), { ...s, graphRevision: advance(s.graphRevision), ...(sameResource(ref, session) ? { lifecycle: "retiring" } : {}) });
        return structuredClone(ordered.filter((r) => closure.has(key(r.ref))).reverse().map((r) => find(r.ref)));
      };
      const finish = (session: ResourceRef<"session">, ref: ResourceRef): void => {
        guard();
        const s = sessions.get(key(session)) ?? unavailable();
        const row = find(ref);
        if (!sameResource(session, row.session) || row.lifecycle !== "retiring" || sessionRows(session).some((r) => r.lifecycle !== "retired"
          && [r.parent, r.grantParent].some((p) => p && sameResource(p, ref)))) unavailable();
        resources.set(key(ref), { ...row, modifiedAt: new Date().toISOString(), lifecycle: "retired", resourceRevision: advance(row.resourceRevision) });
        sessions.set(key(session), { ...s, graphRevision: advance(s.graphRevision),
          ...(ref.kind === "session" ? { modifiedAt: new Date().toISOString(), lifecycle: "retired" as const } : {}) });
      };
      function unique(record: ResourceRecord): void {
        captureRef(record.ref);
        if (resources.has(key(record.ref)) || [...resources.values()].some((r) => r.operationId === record.operationId
          || (r.lifecycle !== "retired" && r.ref.kind === record.ref.kind && r.ref.id === record.ref.id))) unavailable();
      }
      const host: DurableHost = { epoch: String(owned), serverSeq: checkpoint, isOpen, release() {
        return atomic(() => {
          if (isOpen()) occupied = false;
        });
      },
      work: createMemoryWorkRepository(work, registrations, resources, (ref) => sessions.get(key(ref)), guard),
      sessions: {
        reserve(s, root, admit) {
          return atomic(() => {
            const state = captureData(s.state, 2 * 1024 * 1024);
            const session = structuredClone({ ...s, state });
            const resource = structuredClone({ ...root, data: captureData(root.data), registration: captureData(root.registration), recoveryInput: captureData(root.recoveryInput), runtimeMetadata: captureData(root.runtimeMetadata) });
            guard(admit);
            unique(resource);
            if (sessions.has(key(session.ref)) || !sameResource(resource.ref, session.ref) || !sameResource(resource.session, session.ref)
              || resource.owner !== session.owner || resource.providerId !== session.providerId || resource.parent || resource.grantParent
              || session.lifecycle !== "creating" || resource.lifecycle !== "creating") unavailable();
            const typeId = session.type.id.toLowerCase();
            const revision = JSON.stringify([session.type.key, session.type.version]);
            const pinned = typesById.get(typeId);
            const registeredId = typeVersions.get(revision);
            const descriptor = { type: { ...session.type, id: typeId, workManifest: session.type.workManifest ?? [] }, providerId: session.providerId };
            if ((registeredId !== undefined && registeredId !== typeId) || (pinned && !isDeepStrictEqual(pinned, descriptor))) unavailable();
            if (!pinned) {
              typesById.set(typeId, descriptor);
              typeVersions.set(revision, typeId);
            }
            sessions.set(key(session.ref), session);
            resources.set(key(resource.ref), resource);
          });
        },
        get(ref) {
          return atomic(() => {
            guard();
            return structuredClone(sessions.get(key(ref)));
          });
        },
        listRecoverable(after) {
          return atomic(() => {
            guard();
            return structuredClone([...sessions.values()].filter((s) => s.lifecycle !== "retired" && (!after || s.ref.instanceId > after))
              .sort((a, b) => a.ref.instanceId.localeCompare(b.ref.instanceId)).slice(0, 64));
          });
        },
        commitState(write, admit) {
          return atomic(() => {
            const state = captureData(write.state, 2 * 1024 * 1024);
            guard(admit);
            const s = sessions.get(key(write.ref));
            if (!s || !["creating", "active", "failed"].includes(s.lifecycle) || s.stateRevision !== write.expectedRevision || !Number.isSafeInteger(write.serverSeq) || write.serverSeq <= checkpoint) unavailable();
            const stateRevision = advance(s.stateRevision);
            sessions.set(key(s.ref), { ...s, state, stateRevision, modifiedAt: write.modifiedAt, lastServerSeq: write.serverSeq });
            checkpoint = write.serverSeq;
            return stateRevision;
          });
        },
        transition,
        beginRetirement(s, admit) {
          return atomic(() => {
            return begin(s, s, admit);
          });
        },
        finishRetirement(s) {
          return atomic(() => {
            finish(s, s);
          });
        },
        purge(ref, retainAfter) {
          return atomic(() => {
            guard();
            const s = sessions.get(key(ref));
            if (!s || s.lifecycle !== "retired" || !(Date.parse(s.modifiedAt) < Date.parse(retainAfter)) || sessionRows(ref).some((r) => r.lifecycle !== "retired")) return false;
            const jobs = [...work.entries()].filter(([,job]) => sameResource(job.session, ref));
            if (jobs.some(([,job]) => job.status === "queued" || job.status === "leased" || Date.parse(job.updatedAt) >= Date.parse(retainAfter))) return false;
            for (const [id] of jobs.slice(0, 256)) work.delete(id);
            if (jobs.length > 256) return false;
            for (const r of sessionRows(ref)) resources.delete(key(r.ref));
            return sessions.delete(key(ref));
          });
        },
      },
      resources: {
        reserve(row, admit) {
          return atomic(() => {
            const copy = structuredClone({ ...row, data: captureData(row.data), recoveryInput: captureData(row.recoveryInput), registration: captureData(row.registration) });
            guard(admit);
            unique(copy);
            const s = sessions.get(key(row.session));
            if (!s || row.ref.kind === "session" || row.ref.domainId !== s.ref.domainId || row.providerId !== s.providerId || row.owner !== s.owner || row.lifecycle !== "creating"
              || !["active", "creating"].includes(s.lifecycle) || !row.parent || sessionRows(s.ref).length >= 256) unavailable();
            requireOperationalParents(copy);
            resourceOrder([...sessionRows(s.ref), copy]);
            resources.set(key(copy.ref), copy);
            sessions.set(key(s.ref), { ...s, graphRevision: advance(s.graphRevision) });
          });
        },
        get(ref) {
          return atomic(() => {
            guard();
            return structuredClone(resources.get(key(ref)));
          });
        },
        listSession(s) {
          return atomic(() => {
            guard();
            return structuredClone(sessionRows(s));
          });
        },
        activate: transition,
        replaceData(session, ref, change, admit) {
          return atomic(() => {
            const data = captureData(change.data);
            guard(admit);
            const r = find(ref);
            if (!sameResource(r.session, session) || !["active", "creating"].includes(r.lifecycle) || !["active", "creating"].includes(find(session).lifecycle)) unavailable();
            requireOperationalParents(r, true);
            if (r.dataRevision !== change.expectedDataRevision) return { status: "conflict" };
            const dataRevision = advance(r.dataRevision);
            resources.set(key(ref), { ...r, data, dataRevision, resourceRevision: advance(r.resourceRevision) });
            return { status: "updated", value: structuredClone({ data, dataRevision }) };
          });
        },
        beginRetirement(s, ref, admit) {
          return atomic(() => {
            return begin(s, ref, admit);
          });
        },
        finishRetirement(s, ref) {
          return atomic(() => {
            finish(s, ref);
          });
        },
      },
      };
      return fenceHostWork(host);
    });
  } };
}

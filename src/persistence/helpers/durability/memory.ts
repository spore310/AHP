import { sameResource } from "@authorization/helpers/context";
import { isDeepStrictEqual } from "node:util";
import type { ResourceRef } from "@authorization";
import { atomic, canRetrySessionStart, captureData, captureRef, memoryResourceKey as key, resourceOrder } from "./helpers";
import { createMemoryWorkRepository } from "./memoryWork";
import { memoryWorkPages } from "./workPages";
import { fenceHostWork } from "./workFences";
import type { StoredWork } from "./workTypes";
import type { AgentRegistrationRecord } from "../../types";
import { randomUUID } from "node:crypto";
import { RepositoryError } from "../../types";
import type { Admission, DurableHost, DurableStorage, HostCoordination, HostEvent, HostEventDelivery, HostMember, ResourceRecord, RetirementObserver, SessionLocation, StoredSession, Transition } from "./types";

const advance = (revision: string): string => (BigInt(revision) + 1n).toString();
function unavailable(): never {
  throw new Error("Durable operation unavailable.");
}

/** One storage instance may outlive multiple hosts. Every mutation below runs in one synchronous critical section. */
export function createMemoryDurableStorage(work = new Map<string, StoredWork>(), registrations: ReadonlyMap<string, AgentRegistrationRecord> = new Map()): DurableStorage {
  const allSessions = new Map<string, StoredSession>();
  const resources = new Map<string, ResourceRecord>();
  // Coordination state mirrors the PostgreSQL adapter: one lease per logical host,
  // one owner per session, and a namespace binding shared by every member.
  interface Lease { epoch: bigint; holder?: symbol; checkpoint: number }
  interface Member extends HostMember { readonly token: symbol }
  const leases = new Map<string, Lease>();
  const members = new Map<string, Member>();
  const owners = new Map<string, { hostId: string; epoch: bigint }>();
  const namespace: { id?: string; shared: boolean; revision: number; digest?: string; authority: number } = { shared: false, revision: 0, authority: 0 };
  const eventListeners = new Set<(delivery: HostEventDelivery) => void>();
  // Every live host learns of a revocation as soon as it commits.
  const authorityObservers = new Set<() => void>();
  let generations = 0;
  let sharedSeq = 0;
  // One page index for the store, like one table: every host pages the same work, whoever inserted it.
  let index = memoryWorkPages(work);
  const pages: ReturnType<typeof memoryWorkPages> = {
    add: (row) => {
      index.add(row);
    },
    remove: (row) => {
      index.remove(row);
    },
    page: (session, limit, after, upper) => index.page(session, limit, after, upper),
  };
  const memberKey = (host: string, instance: string): string => JSON.stringify([host, instance]);
  const publish = (event: Omit<HostEvent, "eventId" | "occurredAt">): void => {
    const delivery: HostEventDelivery = { type: "event", event: { ...event, eventId: randomUUID(), occurredAt: new Date().toISOString() } };
    for (const listener of [...eventListeners]) queueMicrotask(() => {
      if (!eventListeners.has(listener)) return;
      try {
        listener(structuredClone(delivery));
      } catch { /* One consumer cannot block another. */ }
    });
  };
  const typesById = new Map<string, { type: StoredSession["type"]; providerId: string }>();
  const typeVersions = new Map<string, string>();
  return { async acquire(id, onLost, claim) {
    const instanceId = claim?.instanceId ?? randomUUID();
    const token = Symbol(id);
    const leave = (): void => {
      if (members.get(memberKey(id, instanceId))?.token === token) members.delete(memberKey(id, instanceId));
    };
    await atomic(() => {
      if (!id.trim() || !instanceId.trim()) unavailable();
      const otherRows = [...leases.keys()].some((host) => host !== id);
      const liveOthers = [...members.values()].some((member) => member.hostId !== id);
      if (claim === undefined) {
        if (namespace.shared || otherRows) unavailable();
      } else {
        // A store that already served another logical host is never rebound by a newcomer.
        if (namespace.id === undefined ? otherRows : namespace.id !== claim.namespaceId) unavailable();
        if (namespace.shared !== claim.shared && (liveOthers || (!claim.shared && otherRows))) unavailable();
        if (!claim.shared && otherRows) unavailable();
        if (claim.policy.revision < namespace.revision
          || (claim.policy.revision === namespace.revision && namespace.digest !== undefined && namespace.digest !== claim.policy.digest)) unavailable();
        if (claim.shared && !namespace.shared) {
          sharedSeq = Math.max(sharedSeq, ...[...leases.values()].map((lease) => lease.checkpoint), ...[...allSessions.values()].map((session) => session.lastServerSeq));
        }
        Object.assign(namespace, { id: claim.namespaceId, shared: claim.shared, revision: claim.policy.revision, digest: claim.policy.digest });
      }
      const siblings = [...members.values()].filter((member) => member.hostId === id);
      if (siblings.some((member) => member.instanceId === instanceId) || (claim?.maxInstances !== undefined && siblings.length >= claim.maxInstances)) unavailable();
      members.set(memberKey(id, instanceId), { token, hostId: id, instanceId, generation: String(++generations), role: "standby",
        ...(claim?.endpoint === undefined ? {} : { endpoint: claim.endpoint }), capabilities: structuredClone(claim?.capabilities ?? {}), policyRevision: namespace.revision });
      if (!leases.has(id)) leases.set(id, { epoch: 0n, checkpoint: 0 });
    });
    const lease = leases.get(id) ?? unavailable();
    for (let waiting = false; lease.holder !== undefined; waiting = true) {
      const standby = claim?.standby;
      if (!standby || standby.signal.aborted) {
        leave();
        unavailable();
      }
      if (!waiting) standby.onStandby?.();
      const isAborted = (): boolean => standby.signal.aborted;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          standby.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, standby.retryMs ?? 25);
        standby.signal.addEventListener("abort", done, { once: true });
      });
      if (isAborted() || members.get(memberKey(id, instanceId))?.token !== token) {
        leave();
        unavailable();
      }
    }
    return atomic(() => {
      const member = members.get(memberKey(id, instanceId));
      if (member?.token !== token || lease.holder !== undefined) unavailable();
      lease.holder = token;
      members.set(memberKey(id, instanceId), { ...member, role: "active" });
      const owned = ++lease.epoch;
      const policyRevision = namespace.revision;
      let acknowledged = namespace.authority;
      let observed = namespace.authority;
      let lostReported = false;
      // Rebuilt from the rows themselves at each acquisition, for every host at once.
      index = memoryWorkPages(work);
      const ownsLease = (): boolean => lease.holder === token && lease.epoch === owned;
      const isOpen = (): boolean => {
        // Stale trusted configuration is fenced exactly like a lost lease.
        if (ownsLease() && namespace.revision !== policyRevision && !lostReported) {
          lostReported = true;
          lease.holder = undefined;
          leave();
          queueMicrotask(() => {
            onLost();
          });
        }
        return ownsLease() && namespace.revision === policyRevision;
      };
      const observeAuthority = (): void => {
        if (namespace.authority <= observed) return;
        observed = namespace.authority;
        try {
          claim?.onAuthorityRevoked?.(observed);
        } catch { /* The fence stays closed until the host acknowledges. */ }
      };
      authorityObservers.add(observeAuthority);
      // The view admits only sessions this logical host owns. Existence stays store-wide.
      const sessions = {
        get: (k: string): StoredSession | undefined => owners.get(k)?.hostId === id ? allSessions.get(k) : undefined,
        has: (k: string): boolean => allSessions.has(k),
        set(k: string, value: StoredSession): void {
          allSessions.set(k, value);
          if (!owners.has(k)) owners.set(k, { hostId: id, epoch: 1n });
        },
        delete(k: string): boolean {
          owners.delete(k);
          return allSessions.delete(k);
        },
        values: (): StoredSession[] => [...allSessions.entries()].filter(([k]) => owners.get(k)?.hostId === id).map(([, value]) => value),
      };
      const guard = (admit: Admission = () => true): void => {
        if (!isOpen()) unavailable();
        observeAuthority();
        if (namespace.authority !== acknowledged) throw new RepositoryError("unauthorized", "Namespace authority was revoked.");
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
      const begin = (session: ResourceRef<"session">, ref: ResourceRef, admit: Admission, onCancelled?: RetirementObserver): readonly ResourceRecord[] => {
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
        const cancelled: { id: string; revision: string }[] = [];
        for (const [id, job] of work) {
          if (!sameResource(job.session, session) || !["queued", "leased"].includes(job.status)) continue;
          if (sameResource(session, ref) || job.scope.some((anchor) => anchor.include && closure.has(key(anchor.resource)))) {
            const revision = advance(job.revision);
            work.set(id, { ...job, lease: undefined, status: "cancelled", revision, updatedAt: new Date().toISOString() });
            cancelled.push({ id, revision });
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
        const records = structuredClone(ordered.filter((r) => closure.has(key(r.ref))).reverse().map((r) => find(r.ref)));
        onCancelled?.(cancelled);
        return records;
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
      // Plain reads are fenced by ownership only, exactly like unlocked reads in SQL.
      const reading = (): void => {
        if (!isOpen()) unavailable();
      };
      const locate = (k: string): SessionLocation | undefined => {
        const session = allSessions.get(k);
        const owner = owners.get(k);
        return session && owner && session.lifecycle !== "retired"
          ? structuredClone({ session: session.ref, hostId: owner.hostId, ownershipEpoch: String(owner.epoch), lifecycle: session.lifecycle })
          : undefined;
      };
      const move = (k: string, to: string, kind: string): SessionLocation => {
        const owner = owners.get(k) ?? unavailable();
        owners.set(k, { hostId: to, epoch: owner.epoch + 1n });
        const moved = locate(k) ?? unavailable();
        publish({ topic: "ownership", kind, originHostId: id, session: moved.session, entityId: to, revision: moved.ownershipEpoch });
        return moved;
      };
      const notShared = (): never => {
        throw new RepositoryError("conflict", "This store is not shared between logical hosts.");
      };
      const coordination: HostCoordination = {
        namespaceId: claim?.namespaceId ?? "", hostId: id, instanceId, generation: member.generation, shared: claim?.shared === true,
        members: () => atomic(() => structuredClone([...members.values()].map((row): HostMember => ({
          hostId: row.hostId, instanceId: row.instanceId, generation: row.generation, role: row.role,
          ...(row.endpoint === undefined ? {} : { endpoint: row.endpoint }), capabilities: row.capabilities, policyRevision: row.policyRevision }))
          .sort((a, b) => a.hostId.localeCompare(b.hostId) || a.instanceId.localeCompare(b.instanceId)))),
        isCurrentMember: (host, instance, generation) => atomic(() => members.get(memberKey(host, instance))?.generation === generation),
        setRole: (role) => atomic(() => {
          const current = members.get(memberKey(id, instanceId));
          if (current?.token !== token || !isOpen()) unavailable();
          members.set(memberKey(id, instanceId), { ...current, role });
          publish({ topic: "membership", kind: role, originHostId: id });
        }),
        locate: (target) => atomic(() => {
          if ("sessionUri" in target) {
            const found = [...allSessions.entries()].find(([, session]) => session.ref.id === target.sessionUri && session.lifecycle !== "retired");
            return found && locate(found[0]);
          }
          const job = work.get(target.workId);
          return job && locate(key(job.session));
        }),
        listOwned: (after) => atomic(() => {
          reading();
          return structuredClone(sessions.values().filter((s) => s.lifecycle !== "retired" && (!after || s.ref.instanceId > after))
            .sort((a, b) => a.ref.instanceId.localeCompare(b.ref.instanceId)).slice(0, 64));
        }),
        transfer: (session, toHostId) => atomic(() => {
          if (claim?.shared !== true) notShared();
          guard();
          const current = sessions.get(key(session));
          // Placement is authoritative: a live, active member that declares the session's provider.
          const target = [...members.values()].some((row) => row.hostId === toHostId && row.role === "active"
            && Array.isArray(row.capabilities.providers) && current !== undefined && row.capabilities.providers.includes(current.providerId));
          if (!current || toHostId === id || !target || ["retired", "retiring"].includes(current.lifecycle)) unavailable();
          move(key(session), toHostId, "transferred");
        }),
        orphanedOwners: () => atomic(() => [...new Set([...allSessions.entries()].filter(([, session]) => session.lifecycle !== "retired")
          .map(([k]) => owners.get(k)?.hostId).filter((host): host is string => host !== undefined && host !== id
            && ![...members.values()].some((row) => row.hostId === host)))].sort()),
        adopt: (fromHostId, limit = 64) => atomic(() => {
          if (claim?.shared !== true) notShared();
          guard();
          const previous = leases.get(fromHostId);
          if (fromHostId === id || !Number.isSafeInteger(limit) || limit < 1 || limit > 256) unavailable();
          if (!previous) return [];
          // A held lease or a live membership means the previous owner may still be authoritative.
          if (previous.holder !== undefined || [...members.values()].some((row) => row.hostId === fromHostId)) unavailable();
          previous.epoch++;
          const providers = member.capabilities.providers;
          return [...allSessions.entries()].filter(([k, session]) => owners.get(k)?.hostId === fromHostId && session.lifecycle !== "retired"
            && Array.isArray(providers) && providers.includes(session.providerId))
            .sort(([, a], [, b]) => a.ref.instanceId.localeCompare(b.ref.instanceId)).slice(0, limit).map(([k]) => move(k, id, "adopted"));
        }),
        authorityRevision: () => observed,
        revokeAuthority: () => atomic(() => {
          if (!isOpen()) unavailable();
          namespace.authority++;
          publish({ topic: "authority", kind: "revoked", originHostId: id, revision: String(namespace.authority) });
          for (const observe of [...authorityObservers]) observe();
          return namespace.authority;
        }),
        acknowledgeAuthority(revision) {
          if (Number.isSafeInteger(revision) && revision <= observed && revision > acknowledged) acknowledged = revision;
        },
        allocateServerSeq: (count) => atomic(() => {
          if (claim?.shared !== true) notShared();
          if (!isOpen() || !Number.isSafeInteger(count) || count < 1 || count > 16) unavailable();
          return Array.from({ length: count }, () => ++sharedSeq);
        }),
        subscribeEvents(listener) {
          eventListeners.add(listener);
          return () => {
            eventListeners.delete(listener);
          };
        },
      };
      const host: DurableHost = { epoch: String(owned), serverSeq: Math.max(lease.checkpoint, namespace.shared ? sharedSeq : 0), isOpen, coordination, release() {
        return atomic(() => {
          authorityObservers.delete(observeAuthority);
          if (ownsLease()) lease.holder = undefined;
          leave();
        });
      },
      work: createMemoryWorkRepository(work, registrations, resources, (ref) => sessions.get(key(ref)), guard, String(owned), pages),
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
            reading();
            return structuredClone(allSessions.get(key(ref)));
          });
        },
        listRecoverable(after) {
          return atomic(() => {
            reading();
            return structuredClone(sessions.values().filter((s) => s.lifecycle !== "retired" && (!after || s.ref.instanceId > after))
              .sort((a, b) => a.ref.instanceId.localeCompare(b.ref.instanceId)).slice(0, 64));
          });
        },
        commitState(write, admit) {
          return atomic(() => {
            const state = captureData(write.state, 2 * 1024 * 1024);
            guard(admit);
            const s = sessions.get(key(write.ref));
            if (!s || !["creating", "active", "failed"].includes(s.lifecycle) || s.stateRevision !== write.expectedRevision || !Number.isSafeInteger(write.serverSeq) || write.serverSeq <= lease.checkpoint) unavailable();
            const stateRevision = advance(s.stateRevision);
            sessions.set(key(s.ref), { ...s, state, stateRevision, modifiedAt: write.modifiedAt, lastServerSeq: write.serverSeq });
            lease.checkpoint = write.serverSeq;
            return stateRevision;
          });
        },
        transition,
        beginRetirement(s, admit, onCancelled) {
          return atomic(() => {
            return begin(s, s, admit, onCancelled);
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
            for (const [id, job] of jobs.slice(0, 256)) {
              pages.remove(job);
              work.delete(id);
            }
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
            reading();
            return structuredClone(resources.get(key(ref)));
          });
        },
        listSession(s) {
          return atomic(() => {
            reading();
            return structuredClone(sessionRows(s));
          });
        },
        activate: transition,
        replaceData(session, ref, change, admit) {
          return atomic(() => {
            const data = captureData(change.data);
            guard(admit);
            const r = find(ref);
            if (!sessions.get(key(session)) || !sameResource(r.session, session) || !["active", "creating"].includes(r.lifecycle) || !["active", "creating"].includes(find(session).lifecycle)) unavailable();
            requireOperationalParents(r, true);
            if (r.dataRevision !== change.expectedDataRevision) return { status: "conflict" };
            const dataRevision = advance(r.dataRevision);
            resources.set(key(ref), { ...r, data, dataRevision, resourceRevision: advance(r.resourceRevision) });
            return { status: "updated", value: structuredClone({ data, dataRevision }) };
          });
        },
        beginRetirement(s, ref, admit, onCancelled) {
          return atomic(() => {
            return begin(s, ref, admit, onCancelled);
          });
        },
        finishRetirement(s, ref) {
          return atomic(() => {
            finish(s, ref);
          });
        },
      },
      };
      const fenced = fenceHostWork(host);
      // Work changes reach every namespace consumer as identifier-only events.
      const stop = fenced.workEvents?.subscribe((event) => {
        publish({ topic: "work", kind: event.type, originHostId: id, session: event.session, entityId: event.workId, revision: event.revision });
      });
      return { ...fenced, async release() {
        stop?.();
        await fenced.release();
      } };
    });
  } };
}

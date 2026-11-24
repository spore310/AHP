import { sameResource } from "@authorization/helpers/context";
import { RepositoryError } from "@persistence";
import type { ClaimCursor, DurableWorkRepository, LockedClaim, StoredWork, WorkGraph } from "@persistence/helpers/durability/workTypes";
import { confirmedWorkDenial } from "../authorization/helpers";
import { immutableFacts } from "../commands/facts";
import type { WorkAgentContext, WorkApproval, WorkClaimResult, WorkCommandOptions, WorkDiagnosticEvent, WorkExecutionRef, WorkLease } from "../commands/types";
import { WorkError } from "../errors";
import { captureSchedulingStamp, captureSignal } from "./admission";
import { workRequestSchemas, executionSchema } from "../protocol/schemas";
import { createWorkSelectionGraph } from "../selections";
import type { ResourceLocator } from "../selections/types";

function unavailable(): never {
  throw new WorkError("unauthorized", "Work acquisition unavailable.");
}
function stale(): never {
  throw new WorkError("stale", "Work attempt changed.");
}
function changed(error: unknown) {
  return (error instanceof RepositoryError && error.code === "conflict") || (error instanceof WorkError && error.code === "stale");
}
function affirmative(value: unknown) {
  if (value !== true) void Promise.resolve(value).catch(() => undefined);
  return value === true;
}
interface Continuation { readonly key: string; readonly after: ClaimCursor; readonly until: number }

function actorFor(caller: WorkAgentContext) {
  const { actor } = caller.context;
  const { agent } = caller;
  if (actor.kind !== "agent" || actor.agentId !== agent.actorAgentId || agent.principal.subject !== actor.principal.subject
    || agent.principal.domainId !== actor.principal.domainId || !caller.executionEpoch) return unavailable();
  return { registrationId: agent.registrationId, principal: { ...agent.principal }, agentKey: agent.agentKey, executionEpoch: caller.executionEpoch };
}

function leaseView(row: StoredWork): WorkLease {
  const lease = row.lease ?? stale();
  return { workId: row.id, attempt: lease.attempt, leaseToken: lease.leaseToken, session: row.session, kind: row.kind, priority: row.priority,
    input: row.input, data: row.data, dataRevision: row.dataRevision, revision: row.revision, scope: row.scope, leaseExpiresAt: lease.expiresAt };
}

export function createWorkAcquisition(options: WorkCommandOptions, report: (event: WorkDiagnosticEvent, correlationId?: string) => void) {
  const scheduling = options.scheduling;
  const selectionLimits = Object.freeze({ ...options.selectionLimits });
  const hostKinds = new Set(scheduling?.allowedKinds ?? []);
  const leaseMs = scheduling?.leaseMs ?? 60000;
  if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) throw new RangeError("Invalid work lease duration.");
  const sweeps = new Map<string, Continuation>();
  let generation = 0, pending = 0, scanDeferrals = 0, capacityDenials = 0, closed = false;
  function clear() {
    generation++;
    sweeps.clear();
  }
  function defer(): WorkClaimResult {
    scanDeferrals++;
    report("claimScanDeferred");
    return { status: "deferred", retryAfterMs: 100 };
  }
  function capacity(): WorkClaimResult {
    capacityDenials++;
    report("claimCapacityDenied");
    return { status: "capacity" };
  }
  const local = (caller: WorkAgentContext) => !closed && !caller.signal.aborted && (!caller.fence || affirmative(caller.fence()));
  const live = (caller: WorkAgentContext) => affirmative(caller.isCurrent()) && local(caller);
  function remember(owner: string, key: string, row: StoredWork) {
    if (sweeps.size >= 1024 && !sweeps.has(owner)) {
      const oldest = sweeps.keys().next().value;
      if (oldest !== undefined) sweeps.delete(oldest);
    }
    sweeps.delete(owner);
    sweeps.set(owner, { key, after: { id: row.id, priority: row.priority, createdAt: row.createdAt }, until: performance.now() + 60000 });
  }
  function eligible(graph: WorkGraph, row: StoredWork) {
    return sameResource(row.session, graph.session.ref) && createWorkSelectionGraph(row.session.domainId, graph.session, graph.resources, selectionLimits)
      .hasActivePositiveScope(row.scope, graph.session.graphRevision);
  }
  function matchesAgent(actor: ReturnType<typeof actorFor>, locked: Pick<LockedClaim, "registration" | "session">) {
    return locked.registration.enabled && locked.registration.id === actor.registrationId
      && locked.registration.key === actor.agentKey && locked.registration.subject === actor.principal.subject
      && locked.registration.epoch === actor.executionEpoch && locked.session.lifecycle === "active";
  }
  function trusted(caller: WorkAgentContext, locked: Pick<LockedClaim, "registration" | "session">) {
    return local(caller) && matchesAgent(actorFor(caller), locked);
  }
  // The observation is acquired after our write and before locked reconciliation.
  // A second mutation can never authorize returning the first mutation's lease.
  async function disclosure<T>(caller: WorkAgentContext, store: DurableWorkRepository, row: StoredWork, approval: WorkApproval,
    kindAllowed: () => boolean, answer: () => T): Promise<T> {
    const start = performance.now();
    let observation: ReturnType<NonNullable<DurableWorkRepository["observe"]>> | undefined;
    let transferred = false;
    try {
      const observed = store.observe?.(row.session, row.id) ?? unavailable();
      observation = observed;
      const locked = await store.inspect(row.session.domainId, row.id);
      const lease = locked?.row.lease;
      if (!locked || !lease || !locked.registration || !trusted(caller, { session: locked.session, registration: locked.registration })
        || !eligible(locked, locked.row)
        || locked.row.revision !== row.revision || lease.leaseToken !== row.lease?.leaseToken || !sameResource(locked.row.session, row.session)
        || lease.registrationId !== caller.agent.registrationId || lease.executionEpoch !== caller.executionEpoch) return stale();
      const deadline = start + Date.parse(lease.expiresAt) - locked.databaseTime;
      const valid = () => live(caller) && affirmative(approval.isCurrent()) && kindAllowed() && observed.current() && performance.now() < deadline && local(caller);
      if (!valid()) return unavailable();
      const result = answer();
      if (caller.retainReply) {
        caller.retainReply({ isCurrent: valid, release() {
          try {
            approval.release();
          } finally { observed.release(); }
        } });
        transferred = true;
      }
      return result;
    } finally {
      if (!transferred) {
        observation?.release();
        approval.release();
      }
    }
  }
  async function claim(caller: WorkAgentContext, locator: ResourceLocator): Promise<WorkClaimResult> {
    if (!scheduling) return unavailable();
    const parsed = workRequestSchemas.claim.shape.session.safeParse(locator);
    if (!parsed.success) throw new WorkError("invalid", "Invalid session locator.");
    if (pending >= 64) return defer();
    pending++;
    try {
      caller = await options.authenticateAgent?.(caller) ?? caller;
      const actor = actorFor(caller);
      const connected = captureSignal(caller.signal);
      if (!live(caller)) return unavailable();
      const store = options.repository();
      const graph = await store.graph(actor.principal.domainId, parsed.data);
      if (!graph || graph.session.lifecycle !== "active" || !live(caller)) return unavailable();
      const session = graph.session.ref;
      const config = scheduling.configuration.resolve(caller.agent);
      const kindAllowed = (kind: string) => scheduling.configuration.resolve(caller.agent).allowedKinds?.includes(kind) !== false;
      const allowedKinds = (graph.session.type.workManifest ?? []).map((item) => item.kind)
        .filter((kind) => hostKinds.has(kind) && (config.allowedKinds?.includes(kind) ?? true));
      const cohort = generation;
      const prepared = () => generation === cohort && local(caller) && scheduling.configuration.resolve(caller.agent).revision === config.revision;
      const owner = JSON.stringify([caller.context.connectionId, actor.registrationId, session.instanceId]);
      const key = JSON.stringify([actor, caller.context.authRevision, graph.session.graphRevision, config.revision, allowedKinds, cohort]);
      const saved = sweeps.get(owner);
      let after = saved && saved.key === key && saved.until > performance.now() ? saved.after : undefined;
      const base = { session, graphRevision: graph.session.graphRevision, actor, allowedKinds, maxActiveClaims: config.maxActiveClaims, leaseMs };
      await store.expireExhausted(session, 32);
      for (let examined = 0; examined < 128;) {
        if (!live(caller)) return unavailable();
        if (!prepared()) return defer();
        const limit = Math.min(32, 128 - examined);
        const page = await store.scanCandidates({ session, registrationId: actor.registrationId, allowedKinds, after, limit });
        examined += Math.max(1, page.rows.length);
        const proofs = new Map<string, { row: StoredWork; proof: WorkApproval; admitted: (locking: boolean) => boolean }>();
        let uncertain = false;
        try {
          for (const row of page.rows) {
            if (!eligible(graph, row)) continue;
            try {
              const facts = immutableFacts(row);
              const proof = await options.prepare(caller, "claim", facts, facts);
              try {
                const admitted = captureSchedulingStamp(scheduling.admission(caller, proof, "claim", row.kind, config.revision), proof);
                proofs.set(row.id, { row, proof, admitted });
                if (!affirmative(proof.isCurrent()) || !admitted(true)) uncertain = true;
              } finally {
                if (!proofs.has(row.id)) proof.release();
              }
            } catch (error) {
              if (!confirmedWorkDenial(error)) uncertain = true;
            }
          }
          if (!live(caller)) return unavailable();
          if (!prepared() || uncertain) return defer();
          const result = await store.claimPrepared({ ...base, candidates: [...proofs.values()].map(({ row }) => ({ id: row.id, revision: row.revision })) }, (locked) => {
            const item = proofs.get(locked.row.id);
            if (!item || item.row.revision !== locked.row.revision || closed || generation !== cohort || !connected() || !item.admitted(true)
              || !matchesAgent(actor, locked) || !eligible(locked, locked.row)) throw new RepositoryError("conflict", "Claim preparation changed.");
            return undefined;
          }).catch((error: unknown) => {
            if (changed(error)) return undefined;
            throw error;
          });
          if (!result) return defer();
          if (!live(caller)) return unavailable();
          if (result.status === "claimed") {
            const row = result.row;
            const winner = proofs.get(row.id) ?? stale();
            proofs.delete(row.id);
            sweeps.delete(owner);
            return await disclosure(caller, store, row, winner.proof, () => winner.admitted(false) && kindAllowed(row.kind), () => ({ status: "claimed" as const, lease: leaseView(row) }));
          }
          if (!prepared()) return defer();
          if (result.status === "capacity") return capacity();
          if (proofs.size) {
            // Another transaction acquired or locked all permitted rows. Retry the head within the same call budget.
            if (!page.hasMore) {
              after = undefined;
              continue;
            }
          }
          const last = page.rows.at(-1);
          if (!last || !page.hasMore) {
            sweeps.delete(owner);
            return { status: "empty" };
          }
          after = { id: last.id, priority: last.priority, createdAt: last.createdAt };
          if (examined >= 128) remember(owner, key, last);
        } finally { for (const { proof } of proofs.values()) proof.release(); }
      }
      return defer();
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "outcome_unknown") report("storageOutcomeUnknown", error.correlationId);
      throw error;
    } finally { pending--; }
  }
  async function renew(caller: WorkAgentContext, execution: WorkExecutionRef) {
    if (!scheduling) return unavailable();
    const parsed = executionSchema.safeParse(execution);
    if (!parsed.success) throw new WorkError("invalid", "Invalid work attempt.");
    if (pending >= 64) throw new WorkError("exhausted", "Work admission is busy.");
    pending++;
    try {
      caller = await options.authenticateAgent?.(caller) ?? caller;
      const actor = actorFor(caller);
      const connected = captureSignal(caller.signal);
      if (!live(caller)) return unavailable();
      const store = options.repository();
      const inspected = await store.inspect(actor.principal.domainId, parsed.data.workId);
      const row = inspected?.row;
      if (!inspected || !row?.lease || !eligible(inspected, row) || row.lease.registrationId !== actor.registrationId
        || row.lease.executionEpoch !== actor.executionEpoch || row.lease.attempt !== parsed.data.attempt || row.lease.leaseToken !== parsed.data.leaseToken
        || Date.parse(row.lease.expiresAt) <= inspected.databaseTime) return stale();
      const allowed = () => hostKinds.has(row.kind) && scheduling.configuration.resolve(caller.agent).allowedKinds?.includes(row.kind) !== false;
      const config = scheduling.configuration.resolve(caller.agent);
      if (!hostKinds.has(row.kind) || config.allowedKinds?.includes(row.kind) === false) return unavailable();
      const facts = immutableFacts(row);
      const approval = await options.prepare(caller, "renew", facts, facts);
      let handedOff = false;
      try {
        const admitted = captureSchedulingStamp(scheduling.admission(caller, approval, "renew", row.kind, config.revision), approval);
        if (!affirmative(approval.isCurrent()) || !live(caller) || !admitted(true)) return unavailable();
        const updated = await store.renewPrepared({ actor, leaseMs, fence: { session: row.session, id: row.id, revision: row.revision,
          execution: row.lease, graphRevision: inspected.session.graphRevision } }, (locked) => {
          if (closed || !connected() || !admitted(true) || !matchesAgent(actor, locked)
            || !eligible(locked, locked.row)) throw new RepositoryError("conflict", "Renewal preparation changed.");
          return undefined;
        });
        handedOff = true;
        return await disclosure(caller, store, updated, approval, () => admitted(false) && allowed(), () => ({ leaseExpiresAt: updated.lease?.expiresAt ?? stale(), revision: updated.revision }));
      } finally { if (!handedOff) approval.release(); }
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "outcome_unknown") report("storageOutcomeUnknown", error.correlationId);
      if (changed(error)) {
        report("staleLeaseRejected");
        return stale();
      }
      throw error;
    } finally { pending--; }
  }
  return { claim, renew, changed: clear, close() {
    closed = true;
    clear();
  },
  stats: () => ({ pending, scanDeferrals, capacityDenials, continuations: sweeps.size }) };
}

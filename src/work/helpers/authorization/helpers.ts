import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { POLICY_LIMIT_ABSOLUTE, POLICY_LIMIT_DEFAULTS, identifierSchema, policyActorRefSchema, policyScopeRulesSchema, trustedRequestContextSchema,
  type LocalDecisionStamp, type PolicyRef, type ResourceRef } from "@authorization";
import { sameActor, sameResource } from "@authorization/helpers/context";
import { resourceKey } from "@authorization/helpers/resources";
import { captureValue } from "@jsonrpc/value";
import type { StoredWork, WorkIntent } from "@persistence/helpers/durability/workTypes";
import { captureWorkIntent, sameWorkIntent } from "@persistence/helpers/durability/workIntent";
import { resolveWorkKind } from "../definitions";
import type { WorkAgentContext, WorkRequestContext } from "../commands/types";
import { WorkError } from "../errors";
import { captureSignal, issueWorkApproval } from "../claims/admission";
import { samePolicy, workOperations } from "./registration";
import type { WorkAuthorizerOptions, WorkOperation, WorkPolicyFacts, WorkPolicyRestriction } from "./types";

const deny = (): never => {
  throw new WorkError("unauthorized", "Work authorization unavailable.");
};
class ConfirmedWorkDenial extends WorkError {
  constructor() {
    super("unauthorized", "Work authorization unavailable.");
    this.name = "ConfirmedWorkDenial";
  }
}
export function confirmedWorkDenial(error: unknown): boolean {
  return error instanceof ConfirmedWorkDenial;
}
function refused(): never {
  throw new ConfirmedWorkDenial();
}
const bounded = (n: number, max: number): number => {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new TypeError("Invalid work preparation budget.");
  return n;
};
function current(check: () => unknown): boolean {
  try {
    const result = check();
    if (result !== true) {
      void Promise.resolve(result).catch(() => undefined);
      return false;
    }
    return true;
  } catch { return false; }
}
function factsCopy<T>(input: T): T {
  return captureValue(input, { maxBytes: 512 * 1024, maxDepth: 24, maxKeys: 20000, postgres: true }).value as T;
}
interface Restriction { readonly validUntil: number; readonly isCurrent: () => boolean; readonly active?: () => boolean; release(): void }
function restriction(value: WorkPolicyRestriction | null | undefined, needsFence: boolean): Restriction {
  if (!value || typeof value.release !== "function") return deny();
  const drop: () => unknown = value.release.bind(value);
  const release = () => {
    try {
      void Promise.resolve(drop()).catch(() => undefined);
    } catch { /* Cleanup cannot authorize a request. */ }
  };
  try {
    const effect: unknown = value.effect;
    if (effect === "deny") return refused();
    if (value.effect !== "allow" || !Number.isSafeInteger(value.validUntil) || typeof value.isCurrent !== "function") return deny();
    if (needsFence && value.signal === undefined && value.invalidation !== "registry") return deny();
    const active = value.signal === undefined ? undefined : captureSignal(value.signal);
    return { validUntil: value.validUntil, isCurrent: value.isCurrent.bind(value), active, release };
  } catch (error) {
    release();
    throw error;
  }
}

export function createWorkAuthorizer(options: WorkAuthorizerOptions) {
  const { registry, policies } = options;
  const coherent: unknown = registry.usesPolicyFactory(policies);
  if (coherent !== true) throw new TypeError("Work compiler identity mismatch.");
  const ceiling = factsCopy(policyScopeRulesSchema.parse(options.ceiling));
  const kinds = new Set(z.array(identifierSchema).max(128).parse(options.allowedKinds));
  const operations = new Set(z.array(z.enum(workOperations)).max(workOperations.length).parse(options.allowedOperations ?? workOperations));
  const deadlineMs = bounded(options.prepareDeadlineMs ?? POLICY_LIMIT_DEFAULTS.asyncHookDeadlineMs, POLICY_LIMIT_ABSOLUTE.asyncHookDeadlineMs);
  const maxPending = bounded(options.maxPending ?? 64, 1024);
  for (const ref of [...ceiling.admitted.policies, ...ceiling.mandatory]) {
    if (policies.getPolicy(ref)?.challenge.required !== false) throw new TypeError("Unsupported work ceiling policy.");
  }
  for (const ref of ceiling.admitted.namespaces) {
    if (!policies.selectRules || !policies.inspect().namespaces.some((ns) => ns.name === ref.name && ns.revision === ref.revision)) {
      throw new TypeError("Unsupported work ceiling namespace.");
    }
  }
  const resolveType = options.resolveType.bind(options);
  const sessionByRef = options.session.bind(options);
  const resourceByRef = options.resource?.bind(options);
  const sessionIsCurrent = options.isSessionCurrent.bind(options);
  let pending = 0;
  async function evaluateRequest(caller: WorkRequestContext, operation: WorkOperation, request: WorkIntent, previous?: StoredWork,
    execution?: WorkPolicyFacts["execution"], fencedRead = false) {
    if (pending >= maxPending || caller.signal.aborted) return deny();
    if (!operations.has(operation)) return refused();
    const controller = new AbortController();
    const before = registry.captureFence();
    const deadline = Date.now() + deadlineMs;
    const cancelled = Promise.withResolvers<never>();
    const callerActive = captureSignal(caller.signal);
    const stop = () => {
      controller.abort();
      cancelled.reject(new WorkError("unauthorized", "Work preparation expired."));
    };
    const timer = setTimeout(stop, deadlineMs);
    caller.signal.addEventListener("abort", stop, { once: true });
    const proofs: LocalDecisionStamp[] = [];
    const restrictions: Restriction[] = [];
    let released = false;
    const release = () => {
      released = true;
      controller.abort();
      for (const receipt of restrictions.splice(0)) receipt.release();
    };
    const preparing = () => !controller.signal.aborted && !caller.signal.aborted && before() && Date.now() < deadline && !released;
    const evaluate = async () => {
      if (!current(caller.isCurrent.bind(caller)) || !preparing()) return deny();
      const intent = captureWorkIntent(request);
      if (!kinds.has(intent.kind)) return refused();
      const row = previous && { ...captureWorkIntent(previous), id: previous.id, revision: previous.revision, dataRevision: previous.dataRevision,
        data: factsCopy(previous.data), attemptCount: previous.attemptCount, status: previous.status, ...(previous.lease && { lease: {
          registrationId: previous.lease.registrationId, executionEpoch: previous.lease.executionEpoch, expiresAt: previous.lease.expiresAt } }) };
      const actor = factsCopy(trustedRequestContextSchema.parse(caller.context));
      const durable = await sessionByRef(intent.session);
      if (!preparing() || !durable || !sameResource(durable.ref, intent.session) || actor.actor.principal.domainId !== durable.ref.domainId
        || (durable.lifecycle !== "active" && !(operation === "read" && ["failed", "suspended"].includes(durable.lifecycle)))
        || !current(() => sessionIsCurrent(durable.ref, operation))) return deny();
      const type = resolveType(durable.type);
      const { definition } = type;
      if (definition.id !== durable.type.id || definition.key !== durable.type.key || definition.version !== durable.type.version
        || definition.providerId !== durable.providerId || !isDeepStrictEqual(definition.work ?? [], durable.type.workManifest ?? [])
        || (row && (!sameResource(row.session, durable.ref) || row.kind !== intent.kind)) || (operation === "submit" && !sameActor(actor.actor, intent.submitter))) return deny();
      const work = type.policy?.work ?? deny();
      const kind = resolveWorkKind(type, intent.kind);
      const owner = registry.owner(durable.ref);
      if (!owner || owner.domainId !== durable.ref.domainId || owner.subject !== durable.owner) return deny();
      const agentCaller = caller as Partial<WorkAgentContext>;
      const bound = agentCaller.agent;
      if (["claim", "renew", "complete", "fail"].includes(operation) && !bound) return deny();
      if (bound && (actor.actor.kind !== "agent" || actor.actor.agentId !== bound.actorAgentId || !agentCaller.executionEpoch
        || !isDeepStrictEqual(actor.actor.principal, bound.principal))) return deny();
      const lease = row?.lease;
      let leaseDeadline = 0, expiredAtSource = false;
      if (bound && row && lease) {
        const sampled = performance.now();
        const snapshot = await options.sampleLease?.({ session: durable.ref, id: row.id, revision: row.revision });
        if (!snapshot || snapshot.expiresAt !== lease.expiresAt || !preparing()) return deny();
        const remaining = Date.parse(lease.expiresAt) - snapshot.databaseTime;
        leaseDeadline = sampled + remaining;
        expiredAtSource = remaining <= 0;
      }
      if (operation === "claim" && ((intent.targetAgentId && bound?.registrationId !== intent.targetAgentId)
        || (row && ((row.status !== "queued" && !(row.status === "leased" && expiredAtSource))
          || row.attemptCount >= row.maxAttempts)))) return deny();
      const executing = bound && row?.status === "leased" && lease?.registrationId === bound.registrationId
        && lease.executionEpoch === agentCaller.executionEpoch && leaseDeadline > performance.now();
      if (["renew", "complete", "fail"].includes(operation) && !executing) return deny();
      const entities = { submitter: policyActorRefSchema.parse(intent.submitter), owner, ...((operation === "claim" || executing) && bound && { executor: {
        registrationId: bound.registrationId, principal: actor.actor.principal, actorAgentId: bound.actorAgentId, agentKey: bound.agentKey } }) };
      if (entities.submitter.principal.domainId !== durable.ref.domainId) return deny();
      const base: Omit<WorkPolicyFacts, "operation"> = { caller: actor, session: durable.ref, kind: intent.kind, entities,
        ...(execution && { execution: factsCopy(execution) }),
        input: intent.input, data: row?.data ?? intent.submittedData, scope: intent.scope, announce: intent.announce,
        ...(row && { work: { id: row.id, revision: row.revision, dataRevision: row.dataRevision, status: row.status, attempt: row.attemptCount } }) };
      const requests: { op: WorkOperation; refs: ResourceRef[] }[] = [{ op: operation, refs: [durable.ref] }];
      if (operation === "submit") {
        requests[0]?.refs.push(...intent.scope.filter((r) => r.include).map((r) => r.resource));
        if (intent.announce.some((r) => r.include)) requests.push({ op: "announce", refs: [durable.ref, ...intent.announce.filter((r) => r.include).map((r) => r.resource)] });
      }
      const policyFacts: WorkPolicyFacts[] = [];
      const registeredRules = policies.forSessionType(definition, definition.providerId);
      const matchingReplay = operation === "submit" && row !== undefined && sameWorkIntent(row, intent);
      if (operation === "submit" && row && !matchingReplay) return deny();
      let attempts = 0;
      for (const { op, refs } of requests) {
        const entry = work.operations[op];
        if (!operations.has(op) || !entry?.policies.length) return refused();
        if (refs.length > 129) return deny();
        const core = factsCopy({ ...base, operation: op });
        const facts = kind.parseFacts ? factsCopy({ ...core, extension: kind.parseFacts(core) }) : core;
        policyFacts.push(facts);
        for (const scope of new Map(refs.map((ref) => [resourceKey(ref), ref])).values()) {
          if (!sameResource(scope, durable.ref)) {
            const anchor = await resourceByRef?.(scope);
            if (!preparing() || !anchor || !sameResource(anchor.ref, scope) || !sameResource(anchor.session, durable.ref)) return deny();
            if (anchor.lifecycle === "retired" && matchingReplay) continue;
            if (anchor.lifecycle !== "active") return deny();
          }
          const registered = registry.readResource(scope);
          if (!preparing() || !registered || scope.domainId !== durable.ref.domainId || registered.admission?.sessionType.key !== definition.key
            || registered.admission.sessionType.version !== definition.version || registered.admission.providerId !== definition.providerId
            || !isDeepStrictEqual(registered.owner, owner)) return deny();
          const context = { actor, resource: scope, session: durable.ref, input: facts };
          const selected = await policies.select({ sessionType: definition, providerId: definition.providerId, context });
          if (!preparing() || selected.effect !== "selected") return deny();
          let allowed: readonly PolicyRef[] = ceiling.admitted.policies;
          if (ceiling.admitted.namespaces.length) {
            const host = isDeepStrictEqual(ceiling, registeredRules) ? selected : await policies.selectRules?.(ceiling, context);
            if (!preparing() || host?.effect !== "selected") return deny();
            allowed = host.alternatives;
          }
          if (ceiling.mandatory.some((ref) => {
            const override = registered.mandatory.find((item) => samePolicy(item.ref, ref));
            return !(override?.applicable ?? selected.mandatory.some((item) => samePolicy(item, ref)));
          })) return deny();
          const bindings = registry.readBindings({ actor: actor.actor, scope });
          let accepted = false;
          let indeterminate = false;
          for (const ref of selected.alternatives) {
            if (!entry.policies.some((item) => samePolicy(item, ref)) || !allowed.some((item) => samePolicy(item, ref))) continue;
            for (const binding of bindings.bindings) {
              if (!binding.policies.some((item) => samePolicy(item, ref))) continue;
              if (++attempts > 256 || !preparing()) return deny();
              const result = await registry.evaluate({ actor, scope, operation: entry.purpose, policyRef: ref, bindingId: binding.id, route: registered.route });
              if (!preparing()) return deny();
              if (result.decision.effect === "deny") {
                if (!["missing-authority", "expired", "mandatory-deny", "missing-assignment", "external-expired"].includes(result.decision.code)) indeterminate = true;
                continue;
              }
              const challengeRequired: unknown = result.decision.challengeRequired;
              if (challengeRequired !== false) continue;
              if (op === "read" && entry.purpose === "discover" && !result.decision.reveal) continue;
              proofs.push(result.stamp);
              accepted = true;
              break;
            }
            if (accepted) break;
          }
          if (!accepted) return indeterminate || !preparing() ? deny() : refused();
        }
      }
      const stillCurrent = () => current(caller.isCurrent.bind(caller)) && current(() => sessionIsCurrent(durable.ref, operation))
        && isDeepStrictEqual(caller.context, actor) && registry.matchesAll(proofs, actor) && before();
      if (!stillCurrent() || !preparing()) return deny();
      if (work.prepare) {
        for (const facts of policyFacts) {
          const receipt = restriction(await work.prepare(facts, controller.signal), fencedRead || operation === "claim" || operation === "renew");
          if (!preparing()) {
            receipt.release();
            return deny();
          }
          restrictions.push(receipt);
          if (!stillCurrent() || !preparing()) return deny();
        }
      }
      const validUntil = Math.min(...proofs.map((proof) => proof.validUntil), ...restrictions.map((receipt) => receipt.validUntil));
      const fence = (): boolean => !released && callerActive() && before() && Date.now() < validUntil && restrictions.every((receipt) => receipt.active?.() !== false)
        && (!executing || performance.now() < leaseDeadline);
      const isCurrent = (): boolean => fence() && restrictions.every((receipt) => current(receipt.isCurrent)) && current(stillCurrent) && fence();
      if (!isCurrent() || !preparing()) return deny();
      return issueWorkApproval(Object.freeze({ isCurrent, fence, release }), fence);
    };
    pending += 1;
    try {
      return await Promise.race([cancelled.promise, evaluate().finally(() => {
        pending -= 1;
      })]);
    } catch (error) {
      release();
      if (confirmedWorkDenial(error) && before() && callerActive() && Date.now() < deadline) throw error;
      return deny();
    } finally {
      clearTimeout(timer);
      caller.signal.removeEventListener("abort", stop);
    }
  }
  return {
    prepare(caller: WorkRequestContext, operation: WorkOperation, request: WorkIntent, previous?: StoredWork, execution?: WorkPolicyFacts["execution"]) {
      return evaluateRequest(caller, operation, request, previous, execution);
    },
    prepareViewRead(caller: WorkRequestContext, operation: "read", request: WorkIntent, row: StoredWork) {
      return evaluateRequest(caller, operation, request, row, undefined, true);
    },
  };
}

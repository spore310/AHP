import { sameResource } from "@authorization/helpers/context";
import type { PolicyRef, SecuritySubjectRef } from "@authorization";
import { canonicalJsonEqual, defineToolContract, type ToolContractDefinition } from "@tools";
import { captureToolDefinition } from "@tools/helpers/contracts";
import type { PublishedTool, ToolAdmission, ToolAdmissionOptions, ToolAdmissionScope, ToolManagementRequest, ToolProposalReceipt } from "./types";

interface Entry {
  readonly tool: PublishedTool;
  readonly proposer: SecuritySubjectRef;
  readonly expiresAt: number;
  readonly receipt: ToolProposalReceipt;
}

const proposalTtlMs = 300_000;
const revisionKey = (definition: ToolContractDefinition): string => `${definition.key}@${String(definition.version)}`;
const sameSubject = (left: SecuritySubjectRef, right: SecuritySubjectRef): boolean => left.domainId === right.domainId && left.subject === right.subject;
const samePolicy = (left: PolicyRef, right: PolicyRef): boolean => left.id === right.id && left.revision === right.revision;

/** Host-owned proposal lifecycle. Publication never grants session access or executor authority. */
export function createToolAdmission(options: ToolAdmissionOptions): ToolAdmission {
  const { registry, policies } = options;
  if (!registry.usesPolicyFactory(policies) || options.activationPolicies.length > 128) throw new TypeError("Invalid tool admission configuration.");
  const activationPolicies = structuredClone(options.activationPolicies);
  const resolve = options.resolve?.bind(options);
  const allowSelf = options.allowSelfApproval?.bind(options);
  const now = options.now?.bind(options) ?? Date.now;
  const entries = new Map<string, Entry>();
  const baseIds = new Set<string>();
  const baseRevisions = new Set<string>();
  let closed = false;

  const authorize = async (scope: ToolAdmissionScope, operation: ToolManagementRequest["operation"] | "activate", definition?: ToolContractDefinition) => {
    const available = (): boolean => !closed && !scope.signal.aborted && scope.current();
    if (!available() || scope.actor.actor.principal.domainId !== scope.origin.domainId) return undefined;
    const registered = registry.readResource(scope.origin);
    if (registered === undefined) return undefined;
    const resolution = resolve === undefined ? { route: registered.route } : await resolve(scope);
    if (!sameResource(resolution.route.origin, scope.origin) || !available()) return undefined;
    const selected = await policies.select({ providerId: scope.providerId, sessionType: scope.sessionType,
      context: { actor: scope.actor, resource: scope.origin, session: scope.origin, input: null,
        ...(definition === undefined ? {} : { tool: { id: definition.id, revision: definition.version } }) } });
    if (selected.effect !== "selected") return undefined;
    const bindings = registry.readBindings({ actor: scope.actor.actor, scope: scope.origin }).bindings;
    for (const binding of bindings) for (const policy of binding.policies) {
      if (!available()) return undefined;
      if (!selected.alternatives.some((ref) => samePolicy(ref, policy))
        || (operation === "activate" && !activationPolicies.some((ref) => samePolicy(ref, policy)))) continue;
      const proof = await registry.evaluate({ actor: scope.actor, operation: operation === "activate" ? "publish" : operation,
        bindingId: binding.id, policyRef: policy, scope: scope.origin, route: resolution.route,
        ...(resolution.externalProofs === undefined ? {} : { externalProofs: resolution.externalProofs }),
        ...(resolution.mandatoryBindings === undefined ? {} : { mandatoryBindings: resolution.mandatoryBindings }) });
      const current = (): boolean => available() && registry.matches(proof.stamp, scope.actor) && scope.fence();
      if (proof.decision.effect === "allow" && !proof.decision.challengeRequired && current()) return current;
    }
    return undefined;
  };

  const prune = (time: number): void => {
    for (const [id, entry] of entries) if (entry.receipt.status !== "published" && entry.expiresAt <= time) entries.delete(id);
  };
  const receipt = (proposalId: string, revision: number, status: ToolProposalReceipt["status"]): ToolProposalReceipt => Object.freeze({ proposalId, revision, status });
  const lookup = (scope: ToolAdmissionScope, proposalId: string): Entry | undefined => {
    prune(now());
    const entry = entries.get(proposalId);
    return entry !== undefined && sameResource(entry.tool.origin, scope.origin) ? entry : undefined;
  };

  return Object.freeze<ToolAdmission>({
    usesRegistry: (candidate) => candidate === registry,
    reserveBase(definitions) {
      for (const definition of definitions) {
        baseIds.add(definition.id);
        baseRevisions.add(revisionKey(definition));
      }
    },
    async manage(scope, request) {
      try {
        if (request.operation === "propose") {
          const candidate = captureToolDefinition(request.definition);
          const current = await authorize(scope, "propose", candidate);
          if (current === undefined) return undefined;
          const time = now();
          prune(time);
          const principal = scope.actor.actor.principal;
          const occupied = [...entries.values()];
          if (occupied.length >= 128 || occupied.filter((entry) => entry.receipt.status !== "published").length >= 64
            || occupied.filter((entry) => entry.receipt.status !== "published" && sameSubject(entry.proposer, principal)).length >= 8
            || baseIds.has(candidate.id) || baseRevisions.has(revisionKey(candidate)) || registry.getContract(candidate.id) !== undefined
            || occupied.some(({ tool }) => tool.definition.id === candidate.id || revisionKey(tool.definition) === revisionKey(candidate))) return undefined;
          const definition = defineToolContract(candidate);
          const id = globalThis.crypto.randomUUID();
          const value = receipt(id, 1, "proposed");
          if (!current()) return undefined;
          entries.set(id, { tool: Object.freeze({ definition, origin: Object.freeze({ ...scope.origin }), source: Object.freeze({ id, revision: 1 }) }),
            proposer: Object.freeze({ ...principal }), expiresAt: time + proposalTtlMs, receipt: value });
          return { receipt: value, current };
        }
        const target = lookup(scope, request.proposalId);
        const expected = request.operation === "approve" ? "proposed" : "approved";
        if (target?.receipt.status !== expected || target.receipt.revision !== request.revision) return undefined;
        const current = await authorize(scope, request.operation, target.tool.definition);
        if (current === undefined || (request.operation === "approve" && sameSubject(target.proposer, scope.actor.actor.principal) && allowSelf?.(scope) !== true)
          || lookup(scope, request.proposalId) !== target || !current()) return undefined;
        const value = receipt(request.proposalId, request.revision + 1, request.operation === "approve" ? "approved" : "published");
        entries.set(request.proposalId, { ...target, receipt: value });
        return { receipt: value, current };
      } catch {
        return undefined;
      }
    },
    async review(scope, proposalId) {
      try {
        const target = lookup(scope, proposalId);
        if (target === undefined) return undefined;
        const current = await authorize(scope, "approve", target.tool.definition);
        return current?.() === true && lookup(scope, proposalId) === target ? target.tool.definition : undefined;
      } catch {
        return undefined;
      }
    },
    async prepareActivation(scope, proposalId) {
      try {
        const target = lookup(scope, proposalId);
        if (target?.receipt.status !== "published") return undefined;
        const current = await authorize(scope, "activate", target.tool.definition);
        if (current === undefined) return undefined;
        const canonical = registry.getContract(target.tool.definition.id);
        if (canonical !== undefined && !canonicalJsonEqual(canonical, target.tool.definition)) return undefined;
        return { tool: target.tool, current: () => entries.get(proposalId) === target && current() };
      } catch {
        return undefined;
      }
    },
    dispose() {
      closed = true;
      entries.clear();
    },
  });
}

import { vi } from "vitest";
import { createReferenceAuthorizer, createResourceOperations } from "@authorization";
import type { ResourceKindAdapter, ResourceOperation, ResourceOperationAuthority, ResourceOperationRequest, ResourceRef, ResourceRoute, ScopedPolicyBinding, TrustedRequestContext } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import { resourceKey } from "@authorization/helpers/resources";

export const operationNames = ["read", "write", "input", "terminate", "mutate"] as const;
export const operationRef = (name: string) => ({ id: "resource." + name, revision: 1 });
export const operationActor: TrustedRequestContext = { actor: { kind: "user", principal: { domainId: "local", subject: "caller" } }, connectionId: "connection-caller", authRevision: "auth-1" };
export const operationResource = (kind: string, id: string): ResourceRef => ({ domainId: "local", kind, id, instanceId: id + "-instance" });
export function resourceFixture(options: { targetKind?: string; challengeOperation?: string; mandatory?: boolean; evaluator?: boolean; external?: boolean; timeoutMs?: number; maxPending?: number; ttl?: number; commit?: ResourceOperation["commit"] } = {}) {
  let time = 0;
  let providerAllowed = true;
  let currentHook = () => {};
  let resolveHook = async () => {};
  let proofEnabled = true;
  let proofDeadline = 1000;
  const targetKind = options.targetKind ?? "workspace";
  const first = operationResource("session", "ahp-session:/first");
  const second = operationResource("session", "ahp-session:/second");
  const chat = operationResource("chat", "ahp-chat:/triage");
  const otherChat = operationResource("chat", "ahp-chat:/other");
  const target = targetKind === "session" ? first : operationResource(targetKind, "test:/shared");
  const route: ResourceRoute = { origin: first, targets: [chat, ...(targetKind === "session" ? [] : [target])] };
  const otherRoute: ResourceRoute = { origin: second, targets: [otherChat, ...(targetKind === "session" ? [] : [target])] };
  const refs = [...new Map([first, second, chat, otherChat, target].map((ref) => [resourceKey(ref), ref])).values()];
  const instances = new Map(refs.map((ref) => [ref.id, ref.instanceId]));
  const policies = createToolPolicyFactory({ policies: [...operationNames.map((name) => ({ ...operationRef(name), operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] } } }, challenge: { required: options.challengeOperation === name } })),
    { ...operationRef("provider"), operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["user" as const] }, requiredPermissions: ["provider.allowed"] } }, challenge: { required: false } }],
  bindings: [...new Set(refs.map((ref) => ref.kind))].map((kind) => ({ sessionType: { key: "test." + kind, version: 1 }, providerId: "provider", admitted: { policies: operationNames.map(operationRef), namespaces: [] }, mandatory: options.mandatory === true ? [operationRef("provider")] : [] })) });
  const registry = createReferenceAuthorizer({ policies, now: () => time, decisionTtlMs: options.ttl ?? 100,
    permissionEvaluators: options.evaluator === false ? {} : { "provider.allowed": () => providerAllowed ? "allow" : "deny" } });
  const commits: unknown[] = [];
  const commit = vi.fn(options.commit ?? ((payload: unknown, _context: ResourceOperationRequest, admit: () => boolean) => {
    if (!admit()) return false;
    commits.push(payload);
    return true;
  }));
  const kinds: ResourceKindAdapter[] = [...new Set(refs.map((ref) => ref.kind))].map((kind) => ({ kind,
    resolve: async (selector) => {
      await resolveHook();
      const ref = refs.find((entry) => entry.id === selector.id);
      return ref === undefined ? undefined : { ...ref, instanceId: instances.get(ref.id) ?? "removed" };
    },
    current: (ref) => {
      currentHook();
      return instances.get(ref.id) === ref.instanceId;
    },
    fence: (ref) => instances.get(ref.id) === ref.instanceId,
    proof: (ref) => proofEnabled ? { resource: ref, revision: "external-1", validUntil: proofDeadline } : undefined }));
  const types = kinds.map(({ kind }) => ({ kind, type: { key: "test." + kind, version: 1 }, providerId: "provider", operations: operationNames.filter((name) => kind !== "terminal" || ["read", "input", "terminate"].includes(name)).map((name): ResourceOperation => ({ name, purpose: "invoke", policies: [operationRef(name)], validate: (payload) => typeof payload === "object" && payload !== null && "value" in payload && typeof payload.value === "string", commit })) }));
  const resources = createResourceOperations({ registry, policies, kinds, types, timeoutMs: options.timeoutMs, maxPending: options.maxPending });
  for (const ref of refs) resources.install({ resource: ref, owner: { domainId: "local", subject: "owner" }, route: ref === second || ref === otherChat ? otherRoute : route,
    ...(ref === target && targetKind !== "session" ? { allowedRoutes: [otherRoute] } : {}), externalAuthority: options.external === true ? "required" : "none", admission: { sessionType: { key: "test." + ref.kind, version: 1 }, providerId: "provider" } });
  const revisions = new Map<string, number>();
  const grant = (ref: ResourceRef, operations: readonly string[]) => {
    const revision = (revisions.get(ref.id) ?? 0) + 1;
    revisions.set(ref.id, revision);
    const binding: ScopedPolicyBinding = { id: "binding:" + ref.id, actor: operationActor.actor, scope: ref, roles: [], policies: [...operations.map(operationRef), ...(options.mandatory === true ? [operationRef("provider")] : [])], authority: { kind: "host-policy", policy: operationRef("read") }, revision };
    if (revision > 1) registry.removeBinding({ bindingId: binding.id, scope: ref, revision: revision - 1 });
    registry.installBinding(binding);
  };
  for (const ref of refs) grant(ref, ["read"]);
  const request = (operation = "read", selectedRoute = route): ResourceOperationRequest => ({ actor: operationActor, route: selectedRoute, target, operation, payload: { value: "changed" }, signal: new AbortController().signal });
  const admission = (authority: ResourceOperationAuthority) => authority.registry === registry && registry.validateAuthorityCohort([], authority.decisions);
  const invoke = () => registry.evaluate({ actor: operationActor, scope: first, route, operation: "invoke", bindingId: "binding:" + first.id, policyRef: operationRef("read") });
  return { registry, policies, resources, kinds, types, first, second, chat, otherChat, target, route, otherRoute, refs, instances, commits, commit, grant, request, admission, invoke,
    proofDeadline: (value: number) => {
      proofDeadline = value;
    },
    time: (value: number) => {
      time = value;
    }, provider: (value: boolean) => {
      providerAllowed = value;
    }, proof: (value: boolean) => {
      proofEnabled = value;
    },
    onCurrent: (hook: () => void) => {
      currentHook = hook;
    }, onResolve: (hook: () => Promise<void>) => {
      resolveHook = hook;
    } };
}

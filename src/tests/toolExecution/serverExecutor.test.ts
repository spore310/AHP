import { afterEach, describe, expect, it, vi } from "vitest";
import { createReferenceAuthorizer, createResourceOperations } from "@authorization";
import type { PolicyActorRef, ResourceRef, ResourceRoute, TrustedRequestContext } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import { createServerToolDispatcher, createServerToolRegistration } from "@toolExecution/server";
import { createToolDispatcher, createToolResultProjection, ToolAction } from "@toolExecution";
import type { ToolActionContext, ToolPreparationHooks, ValidationResult, ToolDispatcherOptions, ToolDispatcher, ToolResultProjection } from "@toolExecution";
import { createClientToolDispatcher } from "@toolExecution/helpers/client/helpers/broker";
import { contract } from "./fixtures";
import type { Input, Output } from "./fixtures";

const owned: Array<ReturnType<typeof createServerToolDispatcher>> = [];
afterEach(async () => {
  for (const dispatcher of owned.splice(0)) await dispatcher.shutdown();
  vi.useRealTimers();
});
const subject = (name: string): PolicyActorRef => ({ kind: "user", principal: { domainId: "local", subject: name } });
const context = (name: string): TrustedRequestContext => ({ actor: subject(name), connectionId: "connection-" + name, authRevision: "auth-1" });
const ref = (id: string, kind = "workspace"): ResourceRef => ({ domainId: "local", kind, id, instanceId: id + "-instance" });
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
};
function fixture(options: { normalize?: boolean; callerGrant?: boolean; executorGrant?: boolean; provider?: boolean; missingEvaluator?: boolean; challenge?: boolean; dispatcher?: ToolDispatcherOptions; shared?: ToolDispatcher } = {}) {
  const caller = context("junior");
  const executorContext = context("host-service");
  const origin = ref("session:/server", "session"), initial = ref("workspace:/initial"), normalized = ref("workspace:/normalized");
  const routes: Record<string, ResourceRoute> = { initial: { origin, targets: [initial] }, normalized: { origin, targets: [normalized] } };
  const policyRef = { id: "test.server", revision: 1 }, providerRef = { id: "test.provider", revision: 1 };
  const operations = ["discover", "invoke", "advertise", "execute"] as const;
  const sessionType = { key: "test.server-session", version: 1 };
  const policies = createToolPolicyFactory({ policies: [{ ...policyRef, operations: Object.fromEntries(operations.map((operation) => [operation, { actor: { mode: "roles", actors: { user: { anyOf: [operation] } } }, reveal: operation === "discover" }])), challenge: { required: options.challenge === true } },
    { ...providerRef, operations: Object.fromEntries(operations.map((operation) => [operation, { actor: { mode: "direct-grant", actors: ["user"] }, requiredPermissions: ["provider.allowed"], reveal: true }])), challenge: { required: false } }],
  bindings: [{ sessionType, providerId: "mock", admitted: { policies: [policyRef], namespaces: [] }, mandatory: [] }, { sessionType: { key: "test.workspace", version: 1 }, providerId: "mock", admitted: { policies: [providerRef], namespaces: [] }, mandatory: [] }] });
  const registry = createReferenceAuthorizer({ policies, now: () => 1, permissionEvaluators: options.missingEvaluator === true ? {} : { "provider.allowed": () => options.provider === false ? "deny" : "allow" } });
  registry.installAdmission({ sessionType, providerId: "mock" });
  registry.installResource({ resource: origin, owner: subject("owner").principal, route: required(routes.initial), allowedRoutes: [required(routes.normalized)], externalAuthority: "none", admission: { sessionType, providerId: "mock" } });
  for (const resource of [initial, normalized]) registry.installResource({ resource, owner: subject("owner").principal, route: resource === initial ? required(routes.initial) : required(routes.normalized), externalAuthority: "none", mandatory: [{ ref: providerRef, applicable: true }] });
  registry.installTool(contract);
  const implementation = { location: "server" as const, suppliedBy: "server" as const, implementation: "host" as const, implementationId: "host-echo-v1" };
  const executor = { actor: executorContext.actor, connectionId: executorContext.connectionId, generation: 7, registrationRevision: 3 };
  const installActor = (actual: TrustedRequestContext, roles: readonly string[], executorRole = false) => {
    for (const [name, route] of Object.entries(routes)) {
      const bindingId = actual.actor.principal.subject + ":" + name;
      registry.installBinding({ id: bindingId, actor: actual.actor, scope: origin, roles, policies: [policyRef], revision: 1, authority: { kind: "host-policy", policy: policyRef } });
      for (const operation of executorRole ? ["execute" as const] : ["discover" as const, "invoke" as const]) {
        const tuple = { resource: origin, route, recipient: actual.actor, contract: { id: contract.id, key: contract.key, version: contract.version }, operation, bindingId, policyRef,
          ...(executorRole ? { executor, implementation } : {}) };
        if (executorRole) registry.installExecutorAssignment(tuple);
        else registry.installToolAssignment(tuple);
      }
    }
    for (const resource of [initial, normalized]) registry.installBinding({ id: actual.actor.principal.subject + ":" + resource.id, actor: actual.actor, scope: resource, roles: [], policies: [providerRef], revision: 1, authority: { kind: "host-policy", policy: providerRef } });
  };
  installActor(caller, options.callerGrant === false ? ["discover"] : ["discover", "invoke"]);
  installActor(executorContext, options.executorGrant === false ? [] : ["execute"], true);
  const events: string[] = [];
  const authenticate = vi.fn(() => {
    events.push("authenticate");
  });
  const validate = vi.fn((): ValidationResult<Input> => {
    events.push("validate");
    if (options.normalize === true) return { kind: "normalized", input: { path: "normalized" } };
  });
  const prepare = vi.fn((_input: Input, _context: ToolActionContext, hooks: ToolPreparationHooks) => {
    events.push("prepare");
    hooks.onCleanup(() => {
      events.push("resource-cleanup");
    });
  });
  const execute = vi.fn((input: Input, actual: ToolActionContext): Output | Promise<Output> => {
    events.push("execute");
    return { value: "host:" + actual.caller.actor.principal.subject + ":" + input.path };
  });
  const cleanup = vi.fn<() => void | Promise<void>>(() => {
    events.push("cleanup");
  });
  class Action extends ToolAction<Input, Output> { override authenticate = authenticate; override validate = validate; override prepare = prepare; override execute = execute; override cleanup = cleanup; }
  const create = vi.fn(() => new Action());
  const registration = createServerToolRegistration({ definition: contract, implementation, revision: 3, source: { id: "server-source", revision: 9 }, create });
  const inputs: unknown[] = [];
  let hostCurrent = true;
  const dispatcher = createServerToolDispatcher({ registry, policies, registrations: [registration], executor: { context: executorContext, generation: 7, current: () => hostCurrent, fence: () => hostCurrent },
    resolve: ({ input }) => {
      inputs.push(input);
      const name = typeof input === "object" && input !== null && "path" in input ? String(input.path) : "initial";
      return { route: routes[name] ?? required(routes.initial) };
    },
    dispatcher: { limits: { shutdownWaitMs: 5 }, ...options.dispatcher } }, options.shared);
  owned.push(dispatcher);
  const dispatch = (callId = "server-call", actual = caller) => dispatcher.dispatch({ callId, caller: actual, origin, sessionType, providerId: "mock", registration: required(dispatcher.policy.registrations[0]), input: { path: "initial" }, signal: new AbortController().signal, current: () => true, fence: () => true });
  return { dispatcher, registration, dispatch, sessionType, policyRef, providerRef, caller, executorContext, executor, registry, policies, origin, initial, normalized, routes, inputs, events, create, prepare, execute, cleanup, installActor, hostCurrent: (value: boolean) => {
    hostCurrent = value;
  } };
}

describe("host-controlled tool executor", () => {
  it("E01/E02 executes only the exact host registration with independent caller and executor", async () => {
    const f = fixture();
    const handle = f.dispatch();
    expect(await handle.admitted).toEqual({ status: "ready" });
    expect(await handle.settled).toMatchObject({ status: "succeeded", output: { value: "host:junior:initial" } });
    const actual = required(f.execute.mock.calls[0])[1];
    expect(actual.caller).toEqual(f.caller);
    expect(actual.executor).toEqual(f.executor);
    expect(actual.implementation).toEqual(f.registration.implementation);
    expect(actual.resources).toEqual(f.routes.initial);
    expect(f.events).toEqual(["authenticate", "validate", "prepare", "execute", "cleanup", "resource-cleanup"]);
  });
  it.each(["caller", "executor", "provider", "evaluator", "challenge"])("E01 denies %s without preparation or execution", async (missing) => {
    const f = fixture({ callerGrant: missing !== "caller", executorGrant: missing !== "executor", provider: missing !== "provider", missingEvaluator: missing === "evaluator", challenge: missing === "challenge" });
    expect(await f.dispatch().settled).toMatchObject({ status: "failed" });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    if (missing !== "challenge") expect(f.create).not.toHaveBeenCalled();
  });
  it("E03 pins normalized target input for execution and status refresh", async () => {
    const f = fixture({ normalize: true });
    const handle = f.dispatch();
    expect(await handle.settled).toMatchObject({ status: "succeeded", output: { value: "host:junior:normalized" } });
    expect(required(f.execute.mock.calls[0])[1].resources).toEqual(f.routes.normalized);
    f.inputs.length = 0;
    expect(await handle.refresh(new AbortController().signal)).toBeTypeOf("function");
    expect(f.inputs).toEqual([{ path: "normalized" }]);
    f.registry.removeBinding({ bindingId: "junior:" + f.normalized.id, scope: f.normalized, revision: 1 });
    expect(await handle.refresh(new AbortController().signal)).toBeUndefined();
  });
  it("E03 normalized target still needs independent permission", async () => {
    const f = fixture({ normalize: true });
    f.registry.removeBinding({ bindingId: "junior:" + f.normalized.id, scope: f.normalized, revision: 1 });
    expect(await f.dispatch().settled).toMatchObject({ status: "failed" });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it("E04 one host executor keeps two callers isolated", async () => {
    const f = fixture();
    const senior = context("senior");
    f.installActor(senior, ["discover", "invoke"]);
    const [junior, privileged] = await Promise.all([f.dispatch("junior", f.caller).settled, f.dispatch("senior", senior).settled]);
    expect(junior).toMatchObject({ output: { value: "host:junior:initial" } });
    expect(privileged).toMatchObject({ output: { value: "host:senior:initial" } });
    expect(f.execute.mock.calls.map((call) => call[1].executor)).toEqual([f.executor, f.executor]);
    const unauthorized = context("observer");
    expect(await f.dispatch("observer", unauthorized).settled).toMatchObject({ status: "failed" });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it("E02 rejects forged registration and stale host identity", async () => {
    const f = fixture();
    f.hostCurrent(false);
    expect(await f.dispatch().settled).toMatchObject({ status: "failed" });
    expect(f.execute).not.toHaveBeenCalled();
    f.hostCurrent(true);
    expect(await f.dispatch().settled).toMatchObject({ status: "succeeded" });
    expect(Object.isFrozen(f.dispatcher.executor.context.actor)).toBe(true);
    expect(() => createServerToolRegistration({ definition: contract, implementation: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "forged" } as never, revision: 1, source: { id: "forged", revision: 1 }, create: f.create })).toThrow();
    expect(() => createServerToolDispatcher({ registry: f.registry, policies: f.policies, registrations: [f.registration, f.registration], executor: { context: f.executorContext, generation: 7, current: () => true, fence: () => true }, resolve: () => ({ route: required(f.routes.initial) }) })).toThrow();
  });
  it.each(["capacity", "output-budget"])("E03 client and server adapters share actual %s ownership", async (limit) => {
    const core = createToolDispatcher({ limits: { maxInFlight: limit === "capacity" ? 1 : 2, maxRetainedOutputBytes: 64, shutdownWaitMs: 5 } });
    const f = fixture({ shared: core });
    const remoteDefinition = { ...contract, id: "11111111-1111-4111-8111-111111111119", key: "test.remote" };
    const remoteRegistration = { definition: remoteDefinition, revision: 3, source: { id: "remote-source", revision: 1 }, implementation: { location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "remote-id" } };
    f.registry.installTool(remoteDefinition);
    const route = required(f.routes.initial), selected = { id: remoteDefinition.id, key: remoteDefinition.key, version: 1 };
    f.registry.installBinding({ id: "remote-binding", actor: f.executorContext.actor, scope: f.origin, roles: ["advertise", "execute"], policies: [f.policyRef], revision: 1, authority: { kind: "host-policy", policy: f.policyRef } });
    f.registry.installToolAssignment({ resource: f.origin, route, recipient: f.caller.actor, contract: selected, operation: "invoke", bindingId: "junior:initial", policyRef: f.policyRef });
    f.registry.installToolAssignment({ resource: f.origin, route, recipient: f.executorContext.actor, contract: selected, operation: "advertise", bindingId: "remote-binding", policyRef: f.policyRef });
    f.registry.installExecutorAssignment({ resource: f.origin, route, recipient: f.executorContext.actor, contract: selected, operation: "execute", bindingId: "remote-binding", policyRef: f.policyRef, executor: f.executor, implementation: remoteRegistration.implementation });
    const client = createClientToolDispatcher({ registry: f.registry, policies: f.policies, registrations: [remoteRegistration], resolve: () => ({ route }) }, core);
    const send = vi.fn((_input: unknown, _context: ToolActionContext, enqueued: () => void) => {
      enqueued();
      return Promise.resolve({ value: "r".repeat(40) });
    });
    const dispatchRemote = (callId: string) => client.dispatch({ callId, caller: f.caller, executor: f.executor, executorContext: f.executorContext, registration: required(client.policy.registrations[0]), origin: f.origin, sessionType: f.sessionType, providerId: "mock", input: { path: "initial" }, signal: new AbortController().signal, current: () => true, fence: () => true, send });
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
    f.execute.mockReturnValue({ value: "s".repeat(40) });
    f.cleanup.mockImplementation(() => {
      entered.resolve(undefined);
      return release.promise;
    });
    const local = f.dispatch();
    try {
      await entered.promise;
      expect(core.stats()).toEqual({ active: 1, draining: 0, retainedOutputBytes: 52 });
      const rejected = dispatchRemote("remote-rejected");
      expect(await rejected.settled).toMatchObject({ status: "failed", code: limit === "capacity" ? "capacity" : "result-capacity" });
      expect(send).toHaveBeenCalledTimes(limit === "capacity" ? 0 : 1);
      local.cancel();
      expect(await local.result).toMatchObject({ status: "failed", code: "cancelled" });
      expect(client.stats()).toEqual({ active: 1, draining: 1, retainedOutputBytes: 52 });
      release.resolve(undefined);
      await local.settled;
      expect(client.stats()).toEqual({ active: 0, draining: 0, retainedOutputBytes: 0 });
      expect(await dispatchRemote("remote-fresh").settled).toMatchObject({ status: "succeeded" });
      expect(f.execute).toHaveBeenCalledOnce();
      expect(f.cleanup).toHaveBeenCalledOnce();
    } finally {
      release.resolve(undefined);
      await local.settled;
    }
  });

  it.each([false, true])("E03 server result projection joins invocation and resource authority; revoke=%s", async (revoke) => {
    const core = createToolDispatcher({ projection: { project: (...args) => projection.project(...args) } });
    const f = fixture({ shared: core });
    const refs = [f.origin, f.initial, f.normalized], commits: unknown[] = [];
    const resources = createResourceOperations({ registry: f.registry, policies: f.policies,
      kinds: ["session", "workspace"].map((kind) => ({ kind, resolve: (selector) => refs.find((ref) => ref.id === selector.id), current: () => true, fence: () => true })),
      types: ["session", "workspace"].map((kind) => ({ kind, type: kind === "session" ? f.sessionType : { key: "test.workspace", version: 1 }, providerId: "mock", operations: [{ name: "mutate", purpose: "invoke", policies: [kind === "session" ? f.policyRef : f.providerRef], validate: () => true,
        commit: (payload, _context, admit) => {
          if (!admit()) return false;
          commits.push(payload);
          return true;
        } }] })) });
    for (const ref of refs) resources.install({ resource: ref, owner: subject("owner").principal, route: ref === f.normalized ? required(f.routes.normalized) : required(f.routes.initial),
      ...(ref === f.origin ? { allowedRoutes: [required(f.routes.normalized)] } : {}), externalAuthority: "none", admission: { sessionType: ref === f.origin ? f.sessionType : { key: "test.workspace", version: 1 }, providerId: "mock" },
      ...(ref === f.origin ? {} : { mandatory: [{ ref: f.providerRef, applicable: true }] }) });
    const projection: ToolResultProjection = createToolResultProjection({ resources, project: (output) => {
      expect(f.cleanup).toHaveBeenCalledOnce();
      if (revoke) f.registry.removeBinding({ bindingId: "host-service:initial", scope: f.origin, revision: 1 });
      return { target: f.initial, operation: "mutate", payload: output };
    } });
    try {
      expect(await f.dispatch().settled).toMatchObject({ status: revoke ? "failed" : "succeeded" });
      expect(commits).toEqual(revoke ? [] : [{ value: "host:junior:initial" }]);
      expect(f.execute).toHaveBeenCalledOnce();
    } finally {
      resources.dispose();
    }
  });
});

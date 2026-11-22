import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createReferenceAuthorizer, type BindingResolver, type PolicyActorRef, type ReferenceAuthorizerOptions, type ResourceRef, type ScopedPolicyBinding, type SecurityComposition } from "@authorization";
import { createLegacyConnectionIdentityAdapter, createStaticTokenAuthenticator } from "@agents";
import { createAHPServer, type AHPServerHandle, type AHPServerSecurityOptions, type InitialAuthoritySource } from "@websocket";
import { createConnectionSetupAdapter } from "@websocket/helpers/security";
import { FrameLog, responseWithId } from "../websocket/helpers";
import { createSessionTypeCatalogue, createSessionsFactory, type SessionBackend, type SessionProvider, type SessionsFactory } from "@sessions";
import * as publicSessions from "@sessions";
import { createWorkService } from "@work";
import * as publicWork from "@work";
import type { SessionOwnerLookup } from "@work";
import { createMemoryPersistenceFixture } from "../persistence/conformance/helpers";
import { mockProvider } from "@sessions/mock";
import { DEFAULT_GRANT_LIMITS, MAX_GRANT_LIMITS, type GrantControlApproval, type GrantControlRequest, type GrantService, type GrantServiceOptions, type RegisteredGrantControlRule, type ResolvedGrantTarget } from "@authorization";
import type { SessionCreationContext } from "@sessions/helpers/creation/types";
import { createToolPolicyFactory } from "@toolPolicy";

const factories: SessionsFactory[] = [];
const services: GrantService[] = [];
const hosts: AHPServerHandle[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(factories.splice(0).map((factory) => factory.dispose()));
});
const gate = <T>() => {
  let resolve: (value?: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = (value) => {
      yes(value as T);
    };
    reject = no;
  });
  return { promise, resolve, reject };
};
const policy = { id: "control", revision: 1 };
const providerPolicy = { id: "provider", revision: 1 };
const sessionType = { key: "protected", version: 1 };
const principal = { domainId: "local", subject: "alice" };
const context = { actor: { kind: "user" as const, principal }, connectionId: "connection", authRevision: "auth" };
const caller = (): SessionCreationContext => ({ context, connectionId: context.connectionId, connectionGeneration: 1,
  validUntil: Date.now() + 60000, signal: new AbortController().signal, isCurrent: () => true });
const setup = (startSession: SessionProvider["startSession"] = () => Promise.resolve({ dispose: () => undefined }), now = () => Date.now(), restriction?: "deny" | "challenge", caps?: ReferenceAuthorizerOptions["caps"]) => {
  const rules = { admitted: { policies: [policy], namespaces: [] }, mandatory: restriction === undefined ? [] : [providerPolicy] };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: {
    invoke: { actor: { mode: "direct-grant", actors: ["user", "agent"] }, reveal: true },
    execute: { actor: { mode: "direct-grant", actors: ["user", "agent"] }, reveal: true },
  }, challenge: { required: false } }, { ...providerPolicy, operations: {
    invoke: { actor: restriction === "deny" ? { mode: "roles", actors: { user: { anyOf: ["operator"] } } } : { mode: "direct-grant", actors: ["user", "agent"] } },
  }, challenge: { required: restriction === "challenge" } }], bindings: [{ sessionType, providerId: "test", ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now, caps });
  const installed = vi.spyOn(registry, "installBinding");
  const start = vi.fn(startSession);
  const provider: SessionProvider = { providerId: "test", agentInfo: { ...mockProvider.agentInfo, provider: "test" }, startSession: start };
  const catalogue = createSessionTypeCatalogue({ tools: { list: () => [], get: () => undefined,
    validateInput: () => ({ status: "valid" }), validateOutput: () => ({ status: "schema-not-declared" }),
  }, types: [{ definition: { id: "22222222-2222-4222-8222-222222222222", ...sessionType, providerId: "test", configSchema: { type: "object", properties: {} }, tools: [] },
    enabledForCreation: true, config: { schema: { type: "object", properties: {} }, parse: (input) => input },
    policy: { rules, creatorBootstrap: { id: "bootstrap", revision: 1, bindings: [{ key: "root", purpose: "admitted", roles: [], policies: [policy],
      authority: { kind: "host-policy", policy }, maxLifetimeMs: 60000 }] },
    creation: { capability: { key: "create", revision: 1 }, prepare: ({ request }) => Promise.resolve({ effect: "allow", request,
      bootstrap: { kind: "template", id: "bootstrap", revision: 1, bindings: [{ key: "root", lifetimeMs: 30000 }] },
      validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined,
    }) } },
  }] });
  const create = () => {
    const factory = createSessionsFactory({ providers: [provider], application: { catalogue, defaultType: sessionType }, creationSecurity: { registry, policies } });
    factories.push(factory);
    if (factory.authorization === undefined) throw new Error("Missing protected capability");
    return { factory, auth: factory.authorization };
  };
  return { registry, policies, installed, start, create, provider, catalogue };
};
const evaluate = (registry: ReturnType<typeof setup>["registry"], binding: ScopedPolicyBinding) => registry.evaluate({
  actor: context, operation: "invoke", bindingId: binding.id, policyRef: policy, scope: binding.scope,
  route: { origin: binding.scope, targets: [binding.scope] },
});

const grantRule = (): RegisteredGrantControlRule => ({
  ref: { id: "delegate", revision: 1 }, issuerKinds: ["user"],
  root: { mode: "direct", authorityPolicy: policy, requiredPolicies: [policy] }, delegated: true,
  assign: { actorKinds: ["user"], roles: [], policies: [policy], scope: "same", maxLifetimeMs: 30000, maxDepth: 4,
    childRules: [{ id: "delegate", revision: 1 }] },
  revoke: { relation: "descendants", scope: "same" },
  prepare: ({ request }) => Promise.resolve({ effect: "allow", request, validUntil: Date.now() + 30000,
    isCurrent: () => true, release: () => undefined }),
});

const bob = { kind: "user" as const, principal: { ...principal, subject: "bob" } };
const verifiedTarget = (actor = bob): ResolvedGrantTarget => ({ actor, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined });
const readyGrants = async (options: { rule?: RegisteredGrantControlRule; resolveTarget?: GrantServiceOptions["resolveTarget"];
  limits?: GrantServiceOptions["limits"]; now?: () => number; restriction?: "deny" | "challenge"; caps?: ReferenceAuthorizerOptions["caps"]; } = {}) => {
  const f = setup(undefined, options.now, options.restriction, options.caps);
  const { auth } = f.create();
  const rule = options.rule ?? grantRule();
  const resolveTarget = vi.fn<GrantServiceOptions["resolveTarget"]>(options.resolveTarget ?? ((actor) => Promise.resolve({ ...verifiedTarget(), actor })));
  const approve = vi.spyOn(rule, "prepare");
  const service = f.registry.createGrantService({ sessions: auth, rules: [rule], resolveTarget, limits: options.limits });
  services.push(service);
  await auth.createSession({ channel: "ahp-session:/grant-fixture" }, caller());
  const scope = auth.getResource("ahp-session:/grant-fixture");
  if (scope === undefined) throw new Error("Missing real resource");
  const snapshot = f.registry.readBindings({ actor: context.actor, scope });
  const basis = snapshot.tokens[0];
  const binding = snapshot.bindings[0];
  if (basis === undefined || binding === undefined) throw new Error("Missing actual bootstrap");
  const bound = { ...caller(), rule: rule.ref, basis, scope };
  const request = { operation: "assign" as const, issuer: context.actor, actor: bob, scope, roles: [], policies: [policy],
    authority: { kind: "delegation" as const, issuer: context.actor, parentGrantId: basis.bindingId }, delegationDepth: 1 };
  return { ...f, auth, rule, service, resolveTarget, approve, scope, snapshot, binding, bound, request };
};

// Application composition over the real public host, bootstrap and canonical
// registry. Neither deferred port can provide authority until bound exactly once.
const hostedGrants = (now = () => Date.now(), startSession?: SessionProvider["startSession"], withWork = false,
  beforeHost?: (registry: ReturnType<typeof setup>["registry"]) => void) => {
  const f = setup(startSession, now);
  beforeHost?.(f.registry);
  const uri = "ahp-session:/hosted-grants";
  let bound: { service: GrantService; source: InitialAuthoritySource } | undefined;
  let afterRead: () => Promise<void> = () => Promise.resolve();
  let afterCanonical: () => void = () => undefined;
  const generations = new Map<string, number>();
  const read = vi.fn<BindingResolver["read"]>(async (query) => {
    if (bound === undefined) throw new Error("Unbound grant composition");
    const bindings = await bound.service.bindings.read(query);
    await afterRead();
    return bindings;
  });
  const initialAuthority: InitialAuthoritySource = { prepare: (input) => {
    if (bound === undefined) return Promise.reject(new Error("Unbound initial authority"));
    return bound.source.prepare(input);
  } };
  const authenticator = createStaticTokenAuthenticator(new Map([["fixture-alice", principal.subject]]));
  const identity = createLegacyConnectionIdentityAdapter({ domainId: principal.domainId, authenticator });
  const freshness = vi.fn(() => Promise.resolve({ domainId: principal.domainId, revision: 1, invalidated: false }));
  const composition: SecurityComposition = {
    identity,
    actors: { resolve: (input) => Promise.resolve({ actor: { kind: "user", principal: input.principal },
      connectionId: input.connectionId, authRevision: input.authRevision }) },
    bindings: { read },
    resources: { resolve: (selector) => {
      const scope = auth.getResource(uri);
      if (scope === undefined || selector.id !== scope.id || selector.domainId !== scope.domainId || selector.kind !== scope.kind) {
        return Promise.reject(new Error("Unselected resource"));
      }
      const owner = f.registry.owner(scope);
      if (owner === undefined) return Promise.reject(new Error("Missing owner"));
      return Promise.resolve({ resource: scope, owner, operations: ["invoke"], related: [], admitted: { policies: [policy], namespaces: [] }, mandatory: [] });
    } },
    freshness: { current: freshness, invalidate: () => Promise.resolve() },
    grants: { prepare: () => Promise.reject(new Error("No connection issuance")), commit: () => {
      throw new Error("No connection issuance");
    }, rollback: () => undefined, revoke: () => Promise.reject(new Error("No connection issuance")) },
    policies: { evaluate: () => Promise.resolve({ effect: "deny", code: "no-tool-admission" }) },
  };
  const security: AHPServerSecurityOptions = { composition, initialAuthority, now, ...(withWork ? { workDomainId: principal.domainId } : {}) };
  const memory = withWork ? createMemoryPersistenceFixture() : undefined;
  const host = createAHPServer({ host: "127.0.0.1", port: 0, security,
    ...(memory === undefined
      ? {}
      : { agentWork: { authenticator, work: memory.provider.work, registrations: memory.provider.registrations,
          allowedKinds: new Set(["fixture.task"]), dispose: () => memory.provider.dispose() } }), sessions: {
      providers: [f.provider], application: { catalogue: f.catalogue, defaultType: sessionType }, creationSecurity: { registry: f.registry, policies: f.policies },
    } });
  hosts.push(host);
  const hostedAuthorization = host.sessions.authorization;
  if (hostedAuthorization === undefined) throw new Error("Missing hosted authorization");
  const auth = hostedAuthorization;
  const resolveTarget = vi.fn((actor: PolicyActorRef) => Promise.resolve({ ...verifiedTarget(), actor }));
  const rule = grantRule();
  const approve = vi.spyOn(rule, "prepare");
  const bind = (registry = f.registry): GrantService => {
    if (bound !== undefined) throw new Error("Composition already bound");
    const service = registry.createGrantService({ sessions: auth, rules: [rule], resolveTarget });
    services.push(service);
    const source: InitialAuthoritySource = { prepare: (input) => {
      if (!auth.usesRegistry(registry)) return Promise.reject(new Error("Registry mismatch"));
      const scope = auth.getResource(uri);
      if (scope === undefined || !auth.isReady(scope)) return Promise.reject(new Error("Scope not ready"));
      const snapshot = registry.readBindings({ actor: input.context.actor, scope });
      generations.set(input.fence.connectionId, input.fence.connectionGeneration);
      let released = false;
      return Promise.resolve({ scopes: [{ scope, grantRevision: snapshot.grantRevision }], validUntil: Date.now() + 30000,
        allowGlobalSequence: true,
        isCurrent: () => {
          const current = service.isBindingSnapshotCurrent(snapshot, () => !released && !input.signal.aborted
            && input.context.actor.principal.subject === principal.subject
            && input.context.connectionId === input.fence.connectionId
            && generations.get(input.fence.connectionId) === input.fence.connectionGeneration);
          if (current) afterCanonical();
          return current;
        }, release: () => {
          released = true;
        } });
    } };
    bound = { service, source };
    return service;
  };
  const input = (controller = new AbortController()) => ({ handshake: { headers: { authorization: "Bearer fixture-alice" } },
    fence: { connectionId: "setup-connection", connectionGeneration: 1 }, authRevision: "verified-auth", signal: controller.signal });
  const prepare = (controller?: AbortController) => createConnectionSetupAdapter(security).prepare(input(controller));
  const create = () => auth.createSession({ channel: uri }, caller());
  const revoke = () => {
    const scope = auth.getResource(uri);
    if (scope === undefined) throw new Error("Missing resource");
    for (const binding of f.registry.readBindings({ actor: context.actor, scope }).bindings) {
      f.registry.removeBinding({ bindingId: binding.id, scope, revision: binding.revision });
    }
  };
  return { ...f, host, auth, bind, create, prepare, input, security, read, freshness, resolveTarget, approve, revoke, generations,
    onRead: (callback: () => Promise<void>) => { afterRead = callback; },
    onCanonical: (callback: () => void) => { afterCanonical = callback; } };
};

describe("P06 real public-host composition", () => {
  it("creating authority cannot issue and backend failure withdraws its basis before failure publication", async () => {
    const started = gate<undefined>();
    const backend = gate<SessionBackend>();
    const f = hostedGrants(undefined, () => {
      started.resolve();
      return backend.promise;
    });
    const service = f.bind();
    const creating = f.create();
    await started.promise;
    const scope = f.auth.getResource("ahp-session:/hosted-grants");
    if (scope === undefined) throw new Error("No creating resource");
    const snapshot = f.registry.readBindings({ actor: context.actor, scope });
    const basis = snapshot.tokens[0];
    if (basis === undefined) throw new Error("No actual bootstrap");
    const issuer = service.issuer({ ...caller(), rule: grantRule().ref, scope, basis });
    const pending = issuer.prepare({ operation: "assign", issuer: context.actor, actor: bob, scope, roles: [], policies: [policy],
      authority: { kind: "delegation", issuer: context.actor, parentGrantId: basis.bindingId }, delegationDepth: 1 });
    const rejected = expect(pending).rejects.toThrow();
    const observations: boolean[] = [];
    f.host.sessions.onSessionEnvelope((event) => {
      const type: string = event.action.type;
      if (type === "session/creationFailed") observations.push(f.registry.isBindingSnapshotCurrent(snapshot));
    });
    backend.reject(new Error("startup failed"));
    await creating;
    await rejected;
    expect(observations).toEqual([false]);
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.registry.owner(scope)).toEqual(principal);
    expect(f.registry.readBindings({ actor: bob, scope }).bindings).toEqual([]);
  });

  it("reentrant canonical owner replacement cannot project successor ownership through the old hosted record", async () => {
    const original = publicWork.createWorkService;
    let lookup: SessionOwnerLookup | undefined;
    const spy = vi.spyOn(publicWork, "createWorkService").mockImplementationOnce((options) => {
      lookup = options.sessions;
      return original(options);
    });
    let armed = false;
    const f = hostedGrants(undefined, undefined, true, (registry) => {
      const owner = registry.owner.bind(registry);
      registry.owner = (scope) => {
        const value = owner(scope);
        if (armed) {
          armed = false;
          registry.teardown(scope);
          registry.installResource({ resource: scope, owner: bob.principal, route: { origin: scope, targets: [scope] }, externalAuthority: "none" });
        }
        return value;
      };
    });
    spy.mockRestore();
    if (lookup === undefined) throw new Error("No actual owner projection");
    f.bind();
    await f.create();
    const scope = f.auth.getResource("ahp-session:/hosted-grants");
    if (scope === undefined) throw new Error("No resource");
    expect(lookup.owner(scope.id)).toBe(principal.subject);
    armed = true;
    expect(lookup.owner(scope.id)).toBeUndefined();
    expect(f.auth.getResource(scope.id)).toBeUndefined();
    expect(f.auth.isReady(scope)).toBe(false);
    expect(f.registry.owner(scope)).toEqual(bob.principal);
    await f.host.stop();
    expect(lookup.owner(scope.id)).toBeUndefined();
    expect(f.registry.owner(scope)).toEqual(bob.principal);
  });

  it("projects actual creating, ready, settling and stopped lifecycle through the hosted capability", async () => {
    const started = gate<undefined>();
    const backend = gate<SessionBackend>();
    const disposing = gate<undefined>();
    const disposed = gate<undefined>();
    const f = hostedGrants(undefined, () => {
      started.resolve();
      return backend.promise;
    });
    const service = f.bind();
    const creating = f.create();
    await started.promise;
    const scope = f.auth.getResource("ahp-session:/hosted-grants");
    if (scope === undefined) throw new Error("No real creating resource");
    expect(f.auth.usesRegistry(f.registry)).toBe(true);
    expect(f.auth.isReady(scope)).toBe(false);
    const snapshot = f.registry.readBindings({ actor: context.actor, scope });
    await expect(service.bindings.read({ actor: context.actor, scope, grantRevision: snapshot.grantRevision })).rejects.toThrow();
    backend.resolve({ dispose: () => {
      disposing.resolve();
      return disposed.promise;
    } });
    await creating;
    expect(f.auth.isReady(scope)).toBe(true);
    const disposingSession = f.auth.disposeSession(scope);
    await disposing.promise;
    expect(f.auth.isReady(scope)).toBe(false);
    expect(f.auth.isSettling(scope.id)).toBe(true);
    disposed.resolve();
    await disposingSession;
    await f.host.stop();
    expect(f.auth.isReady(scope)).toBe(false);
    expect(f.auth.usesRegistry(f.registry)).toBe(true);
  });

  it("failed startup retains ownership but no hosted readiness or bootstrap authority", async () => {
    const f = hostedGrants(undefined, () => Promise.reject(new Error("backend failed")));
    const service = f.bind();
    await f.create();
    const scope = f.auth.getResource("ahp-session:/hosted-grants");
    if (scope === undefined) throw new Error("No failed resource");
    expect(f.host.sessions.getSessionSnapshot(scope.id)?.state.lifecycle).toBe("failed");
    expect(f.registry.owner(scope)).toEqual(principal);
    expect(f.auth.isReady(scope)).toBe(false);
    const snapshot = f.registry.readBindings({ actor: context.actor, scope });
    expect(snapshot.bindings).toEqual([]);
    await expect(service.bindings.read({ actor: context.actor, scope, grantRevision: snapshot.grantRevision })).rejects.toThrow();
    f.registry.teardown(scope);
    f.registry.installResource({ resource: scope, owner: bob.principal, route: { origin: scope, targets: [scope] }, externalAuthority: "none" });
    await f.host.stop();
    expect(f.registry.owner(scope)).toEqual(bob.principal);
  });

  it("terminal host stays non-ready after its same genuine bare factory is reused", async () => {
    const original = publicSessions.createSessionsFactory;
    let captured: SessionsFactory | undefined;
    const spy = vi.spyOn(publicSessions, "createSessionsFactory").mockImplementationOnce((options) => {
      captured = original(options);
      return captured;
    });
    const f = hostedGrants();
    spy.mockRestore();
    const bare = captured;
    if (bare?.authorization === undefined) throw new Error("No real factory capture");
    factories.push(bare);
    f.bind();
    await f.create();
    const first = f.auth.getResource("ahp-session:/hosted-grants");
    if (first === undefined) throw new Error("No ready resource");
    expect(f.auth.isReady(first)).toBe(true);
    await f.host.stop();
    await bare.authorization.createSession({ channel: first.id }, caller());
    const successor = bare.authorization.getResource(first.id);
    if (successor === undefined) throw new Error("No reused factory resource");
    expect(successor.instanceId).not.toBe(first.instanceId);
    expect(bare.authorization.isReady(successor)).toBe(true);
    expect(f.auth.isReady(successor)).toBe(false);
    expect(f.auth.isReady(first)).toBe(false);
  });

  it("binds once to hosted authority and retains the actual bootstrap across setup", async () => {
    const f = hostedGrants();
    await expect(f.prepare()).rejects.toThrow("Unbound");
    expect(() => f.bind(setup().registry)).toThrow("identity mismatch");
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    f.bind();
    expect(() => f.bind()).toThrow("already bound");
    await f.create();
    const prepared = await f.prepare();
    expect(prepared?.isCurrent()).toBe(true);
    expect(prepared?.snapshot.scopes[0]?.bindings[0]?.id).toBe(f.installed.mock.calls[0]?.[0].id);
    expect(prepared?.snapshot.context.actor).toEqual(context.actor);
    const externalReads = f.freshness.mock.calls.length;
    f.revoke();
    expect(prepared?.isCurrent()).toBe(false);
    expect(f.freshness).toHaveBeenCalledTimes(externalReads);
    prepared?.release();
  });

  it("revocation during awaited canonical binding read rejects actual setup without an external freshness change", async () => {
    const f = hostedGrants();
    f.bind();
    await f.create();
    const stable = await f.prepare();
    expect(stable?.isCurrent()).toBe(true);
    stable?.release();
    const read = gate<undefined>();
    const resume = gate<undefined>();
    f.onRead(() => {
      read.resolve();
      return resume.promise;
    });
    const pending = f.prepare();
    const rejected = expect(pending).rejects.toThrow("Stale prepared setup");
    await read.promise;
    f.revoke();
    resume.resolve();
    await rejected;
  });

  it("never samples a trailing clock after the final canonical predicate", async () => {
    const order: string[] = [];
    let armed = false;
    let compared = false;
    const f = hostedGrants(() => {
      order.push("clock");
      if (armed && compared) {
        armed = false;
        f.revoke();
      }
      return Date.now();
    });
    f.bind();
    await f.create();
    const prepared = await f.prepare();
    expect(prepared?.isCurrent()).toBe(true);
    order.length = 0;
    f.onCanonical(() => {
      compared = true;
      order.push("canonical");
    });
    armed = true;
    expect(prepared?.isCurrent()).toBe(true);
    expect(order.at(-1)).toBe("canonical");
    armed = false;
    expect(prepared?.isCurrent()).toBe(true);
    prepared?.release();
  });

  it.each(["nan", "infinite", "throw", "abort", "revoke"] as const)("fails closed when the final clock returns or triggers %s", async (mode) => {
    let armed = false;
    const controller = new AbortController();
    const f = hostedGrants(() => {
      if (!armed) return Date.now();
      armed = false;
      if (mode === "nan") return Number.NaN;
      if (mode === "infinite") return Number.POSITIVE_INFINITY;
      if (mode === "throw") throw new Error("clock failed");
      if (mode === "abort") controller.abort();
      if (mode === "revoke") f.revoke();
      return Date.now();
    });
    f.bind();
    await f.create();
    const prepared = await f.prepare(controller);
    expect(prepared?.isCurrent()).toBe(true);
    armed = true;
    expect(prepared?.isCurrent()).toBe(false);
    prepared?.release();
  });

  it("rechecks released and aborted SDK state after a reentrant canonical callback", async () => {
    const f = hostedGrants();
    f.bind();
    await f.create();
    const controller = new AbortController();
    const prepared = await f.prepare(controller);
    expect(prepared?.isCurrent()).toBe(true);
    f.onCanonical(() => {
      controller.abort();
      prepared?.release();
    });
    expect(prepared?.isCurrent()).toBe(false);
  });

  it("rejects a nonfinite intermediate TTL even when later deadline samples recover", async () => {
    const f = hostedGrants();
    f.bind();
    await f.create();
    let samples = 0;
    const adapter = createConnectionSetupAdapter({ ...f.security, now: () => ++samples === 3 ? Number.NaN : Date.now() });
    await expect(adapter.prepare(f.input())).rejects.toThrow("Stale prepared setup");
    expect(samples).toBeGreaterThanOrEqual(3);
  });

  it("native initialize succeeds with real scoped authority and closes after no-event revocation", async () => {
    const f = hostedGrants();
    f.bind();
    await f.create();
    const address = await f.host.start();
    const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`, { headers: { Authorization: "Bearer fixture-alice" } });
    sockets.push(socket);
    const frames = new FrameLog(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      channel: "ahp-root://", clientId: "untrusted-client-label", protocolVersions: ["1.0.0"],
    } }));
    expect(await frames.waitFor(responseWithId(1))).toMatchObject({ result: { snapshots: [] } });
    expect(f.read).toHaveBeenCalled();
    const reads = f.freshness.mock.calls.length;
    f.revoke();
    const closed = new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
    });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {
      channel: "ahp-root://", clientId: "untrusted-client-label", protocolVersions: ["1.0.0"],
    } }));
    await closed;
    expect(frames.frames.filter(responseWithId(2))).toEqual([]);
    expect(f.freshness).toHaveBeenCalledTimes(reads);
  });
});

describe("P06 explicit grant service", () => {
  it("global canonical binding storage includes roots independently of actor and fanout quotas", async () => {
    const f = await readyGrants({ caps: { maxBindings: 3 }, limits: { maxBindingsPerActor: 10, maxChildrenPerParent: 10 } });
    const issuer = f.service.issuer(f.bound);
    const one = issuer.commit(await issuer.prepare(f.request));
    issuer.commit(await issuer.prepare(f.request));
    await expect(issuer.prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledTimes(2);
    f.registry.removeBinding({ bindingId: one.id, scope: f.scope, revision: one.revision });
    expect(issuer.commit(await issuer.prepare(f.request)).actor).toEqual(bob);
  });

  it.each(["duplicate", "over-cap", "unknown-child"] as const)("catalogue %s rejection does not publish a partial service", (mode) => {
    const f = setup();
    const { auth } = f.create();
    const rule = grantRule();
    const second = { ...rule, ref: { id: mode === "duplicate" ? rule.ref.id : "second", revision: 1 } };
    if (mode === "unknown-child") Reflect.set(rule, "assign", { ...rule.assign, childRules: [{ id: "unregistered", revision: 1 }] });
    const resolveTarget = vi.fn((actor: PolicyActorRef) => Promise.resolve({ ...verifiedTarget(), actor }));
    expect(() => f.registry.createGrantService({ sessions: auth, rules: mode === "unknown-child" ? [rule] : [rule, second],
      resolveTarget, limits: { maxRegisteredRules: mode === "over-cap" ? 1 : 2 } })).toThrow();
    const service = f.registry.createGrantService({ sessions: auth, rules: [grantRule()], resolveTarget });
    services.push(service);
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it("absolute grant configuration is accepted without conflating independent defaults", () => {
    const f = setup();
    const { auth } = f.create();
    const service = f.registry.createGrantService({ sessions: auth, rules: [grantRule()], limits: { ...MAX_GRANT_LIMITS },
      resolveTarget: (actor) => Promise.resolve({ ...verifiedTarget(), actor }) });
    services.push(service);
    expect(Object.isFrozen(DEFAULT_GRANT_LIMITS)).toBe(true);
    expect(Object.isFrozen(MAX_GRANT_LIMITS)).toBe(true);
  });

  it("oversized or accessor-bearing mutation input rejects before callbacks without reading getters", async () => {
    const f = await readyGrants({ limits: { maxMutationInputBytes: 1024 } });
    const issuer = f.service.issuer(f.bound);
    const snapshot = f.registry.readBindings({ actor: context.actor, scope: f.scope });
    const getter = vi.fn(() => bob);
    const accessor = { ...f.request };
    Object.defineProperty(accessor, "actor", { get: getter, enumerable: true });
    await expect(issuer.prepare(accessor)).rejects.toThrow();
    await expect(issuer.prepare({ ...f.request, roles: ["x".repeat(1025)] })).rejects.toThrow();
    await expect(issuer.prepare({ ...f.request, policies: Array.from({ length: 65 }, () => policy) })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.registry.isBindingSnapshotCurrent(snapshot)).toBe(true);
    expect(issuer.commit(await issuer.prepare(f.request)).actor).toEqual(bob);
  });

  it("mutation of original caller intent during target resolution cannot redirect the captured grant", async () => {
    const entered = gate<undefined>();
    const target = gate<ResolvedGrantTarget>();
    const f = await readyGrants({ resolveTarget: () => {
      entered.resolve();
      return target.promise;
    } });
    const intent = { ...f.request, actor: { ...bob, principal: { ...bob.principal } } };
    const issuer = f.service.issuer(f.bound);
    const pending = issuer.prepare(intent);
    await entered.promise;
    intent.actor.principal.subject = "mallory";
    target.resolve(verifiedTarget());
    expect(issuer.commit(await pending).actor).toEqual(bob);
  });

  it("bounded sweep removes one expired root cohort including descendants per call", async () => {
    let time = Date.now();
    const f = await readyGrants({ now: () => time, limits: { maxCleanupRoots: 1 } });
    for (let i = 0; i < 3; i += 1) {
      const root = { ...f.binding, id: `expired-root-${String(i)}`, actor: bob, expiresAt: new Date(time + 1000).toISOString() };
      f.registry.installBinding(root);
      f.registry.installBinding({ ...root, id: `expired-child-${String(i)}`, authority: { kind: "delegation", issuer: bob, parentGrantId: root.id } });
    }
    f.registry.drainInvalidations();
    const notice = vi.fn();
    f.registry.onInvalidate(notice);
    time += 1001;
    for (let count = 1; count <= 3; count += 1) {
      f.service.sweep();
      expect(notice).toHaveBeenCalledTimes(count);
    }
    f.service.sweep();
    expect(notice).toHaveBeenCalledTimes(3);
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
    expect(f.registry.readBindings({ actor: context.actor, scope: f.scope }).bindings).toEqual([f.binding]);
  });

  it("pending actor cap permits another issuer while the independent global cap bounds both", async () => {
    const entered = gate<undefined>();
    const unresolved = gate<ResolvedGrantTarget>();
    const f = await readyGrants({ limits: { maxPendingMutations: 2, maxPendingPerActor: 1 }, resolveTarget: () => {
      entered.resolve();
      return unresolved.promise;
    } });
    const manager: PolicyActorRef = { kind: "user", principal: { ...principal, subject: "manager" } };
    f.registry.installBinding({ ...f.binding, id: "manager-root", actor: manager });
    const thirdActor: PolicyActorRef = { kind: "user", principal: { ...principal, subject: "third-issuer" } };
    f.registry.installBinding({ ...f.binding, id: "third-root", actor: thirdActor });
    const thirdBasis = f.registry.readBindings({ actor: thirdActor, scope: f.scope }).tokens[0];
    if (thirdBasis === undefined) throw new Error("No third basis");
    const basis = f.registry.readBindings({ actor: manager, scope: f.scope }).tokens[0];
    if (basis === undefined) throw new Error("No manager basis");
    const controller = new AbortController();
    const first = f.service.issuer({ ...f.bound, signal: controller.signal }).prepare(f.request);
    const firstRejected = expect(first).rejects.toThrow();
    await entered.promise;
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledOnce();
    const managerContext = { ...context, actor: manager, connectionId: "manager" };
    const second = f.service.issuer({ ...f.bound, context: managerContext, connectionId: "manager", basis, signal: controller.signal })
      .prepare({ ...f.request, issuer: manager, authority: { kind: "delegation", issuer: manager, parentGrantId: basis.bindingId } });
    const secondRejected = expect(second).rejects.toThrow();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(f.resolveTarget).toHaveBeenCalledTimes(2);
    await expect(f.service.issuer({ ...f.bound, context: { ...context, actor: thirdActor }, basis: thirdBasis })
      .prepare({ ...f.request, issuer: thirdActor, authority: { kind: "delegation", issuer: thirdActor, parentGrantId: thirdBasis.bindingId } })).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledTimes(2);
    controller.abort();
    await firstRejected;
    await secondRejected;
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledTimes(2);
    unresolved.resolve(verifiedTarget());
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const issuer = f.service.issuer(f.bound);
    expect(issuer.commit(await issuer.prepare(f.request)).actor).toEqual(bob);
  });

  it("rule depth cannot be bypassed by a child choosing a smaller declaration", async () => {
    const rule = grantRule();
    if (rule.assign === undefined) throw new Error("No assign rule");
    const f = await readyGrants({ rule: { ...rule, assign: { ...rule.assign, maxDepth: 1 } } });
    const issuer = f.service.issuer(f.bound);
    const child = issuer.commit(await issuer.prepare(f.request));
    const basis = f.registry.readBindings({ actor: bob, scope: f.scope }).tokens[0];
    if (basis === undefined) throw new Error("No child token");
    const delegated = f.service.issuer({ ...f.bound, context: { ...context, actor: bob }, basis });
    for (const depth of [0, 1, 2]) await expect(delegated.prepare({ ...f.request, issuer: bob, delegationDepth: depth,
      authority: { kind: "delegation", issuer: bob, parentGrantId: child.id } })).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledOnce();
  });

  it("foreign canonical tokens and snapshots cannot authorize identical nominal data", async () => {
    const f = await readyGrants();
    const other = setup().registry;
    other.installResource({ resource: f.scope, owner: principal, route: { origin: f.scope, targets: [f.scope] }, externalAuthority: "none" });
    other.installBinding(f.binding);
    const foreign = other.readBindings({ actor: context.actor, scope: f.scope });
    const basis = foreign.tokens[0];
    if (basis === undefined) throw new Error("Missing foreign basis");
    expect(f.registry.isBindingSnapshotCurrent(foreign)).toBe(false);
    expect(f.service.isBindingSnapshotCurrent(foreign, () => true)).toBe(false);
    await expect(f.service.issuer({ ...f.bound, basis }).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    const issuer = f.service.issuer(f.bound);
    const receipt = await issuer.prepare(f.request);
    expect(() => f.service.issuer(f.bound).commit(receipt)).toThrow();
    expect(issuer.commit(receipt).actor).toEqual(bob);
  });

  it.each(["kind", "subject", "domain", "agent-id"] as const)("target resolution cannot substitute %s", async (dimension) => {
    const rule = grantRule();
    if (rule.assign === undefined) throw new Error("No assignment rule");
    const f = await readyGrants({ rule: { ...rule, assign: { ...rule.assign, actorKinds: ["user", "agent"] } }, resolveTarget: (actor) => {
      const replacement: PolicyActorRef = dimension === "kind" || dimension === "agent-id"
        ? { kind: "agent", principal: actor.principal, agentId: "unrequested-agent" }
        : { ...actor, principal: { ...actor.principal, ...(dimension === "subject" ? { subject: "mallory" } : { domainId: "elsewhere" }) } };
      return Promise.resolve({ ...verifiedTarget(), actor: replacement });
    } });
    const requested: PolicyActorRef = dimension === "agent-id" ? { kind: "agent", principal: bob.principal, agentId: "expected-agent" } : bob;
    await expect(f.service.issuer(f.bound).prepare({ ...f.request, actor: requested })).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledOnce();
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
  });

  it("grant lifetime cannot exceed the actual ancestor and known policies still obey the admission ceiling", async () => {
    const rule = grantRule();
    if (rule.assign === undefined) throw new Error("Missing assign rule");
    const f = await readyGrants({ rule: { ...rule, assign: { ...rule.assign, maxLifetimeMs: 60000, policies: [policy, providerPolicy] } } });
    const issuer = f.service.issuer(f.bound);
    await expect(issuer.prepare({ ...f.request, expiresAt: new Date(Date.parse(f.binding.expiresAt ?? "") + 1).toISOString() })).rejects.toThrow();
    await expect(issuer.prepare({ ...f.request, policies: [providerPolicy] })).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    const prepared = await issuer.prepare(f.request);
    expect(Date.parse(issuer.commit(prepared).expiresAt ?? "")).toBeLessThanOrEqual(Date.parse(f.binding.expiresAt ?? ""));
  });

  it("generation loss before the scheduled target callback produces zero adapter effects", async () => {
    const f = await readyGrants();
    let current = true;
    const pending = f.service.issuer({ ...f.bound, isCurrent: () => current }).prepare(f.request);
    current = false;
    await expect(pending).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
  });

  for (const stage of ["target", "approval"] as const) {
    it.each(["timeout", "abort", "dispose"] as const)(`${stage} retains its cancelled slot until late settlement after %s`, async (mode) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const entered = gate<undefined>();
      const target = gate<ResolvedGrantTarget>();
      const approval = gate<GrantControlApproval>();
      let captured: GrantControlRequest | undefined;
      let parked = true;
      const release = vi.fn();
      const rule: RegisteredGrantControlRule = { ...grantRule(), prepare: ({ request }) => {
        if (stage === "approval" && parked) {
          captured = request;
          entered.resolve();
          return approval.promise;
        }
        return Promise.resolve({ effect: "allow", request, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined });
      } };
      const f = await readyGrants({ rule, limits: { maxPendingMutations: 1, prepareDeadlineMs: 1000 }, resolveTarget: (actor) => {
        if (stage === "target" && parked) {
          entered.resolve();
          return target.promise;
        }
        return Promise.resolve({ ...verifiedTarget(), actor });
      } });
      const controller = new AbortController();
      const pending = f.service.issuer({ ...f.bound, signal: controller.signal }).prepare(f.request);
      const rejected = expect(pending).rejects.toThrow();
      await entered.promise;
      if (mode === "timeout") await vi.advanceTimersByTimeAsync(1001);
      if (mode === "abort") controller.abort();
      if (mode === "dispose") f.service.dispose();
      await rejected;
      const calls = f.resolveTarget.mock.calls.length;
      if (mode === "dispose") expect(() => f.service.issuer(f.bound)).toThrow();
      else await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
      expect(f.resolveTarget).toHaveBeenCalledTimes(calls);
      if (stage === "target") target.resolve({ ...verifiedTarget(), release });
      else {
        if (captured === undefined) throw new Error("No captured approval request");
        approval.resolve({ effect: "allow", request: captured, validUntil: Date.now() + 30000, isCurrent: () => true, release });
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(release).toHaveBeenCalledOnce();
      expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
      parked = false;
      if (mode !== "dispose") {
        const issuer = f.service.issuer(f.bound);
        expect(issuer.commit(await issuer.prepare(f.request)).actor).toEqual(bob);
      } else expect(() => f.registry.createGrantService({ sessions: f.auth, rules: [rule], resolveTarget: f.resolveTarget })).toThrow();
    });
  }

  it("late rejected target after cancellation releases capacity without an unhandled rejection", async () => {
    const entered = gate<undefined>();
    const target = gate<ResolvedGrantTarget>();
    let parked = true;
    const f = await readyGrants({ limits: { maxPendingMutations: 1 }, resolveTarget: (actor) => {
      if (!parked) return Promise.resolve({ ...verifiedTarget(), actor });
      entered.resolve();
      return target.promise;
    } });
    const controller = new AbortController();
    const pending = f.service.issuer({ ...f.bound, signal: controller.signal }).prepare(f.request);
    const rejected = expect(pending).rejects.toThrow();
    await entered.promise;
    controller.abort();
    await rejected;
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    target.reject(new Error("late target failure"));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    parked = false;
    const issuer = f.service.issuer(f.bound);
    expect(issuer.commit(await issuer.prepare(f.request)).actor).toEqual(bob);
  });

  it.each(["cloned-request", "promise-guard", "false-guard", "expired", "mutation"] as const)("rejects invalid approval %s without issuing authority", async (mode) => {
    const rule: RegisteredGrantControlRule = { ...grantRule(), prepare: ({ request }) => {
      const result = { effect: "allow" as const, request, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined };
      if (mode === "cloned-request") result.request = { ...request };
      if (mode === "promise-guard") Reflect.set(result, "isCurrent", () => Promise.resolve(true));
      if (mode === "false-guard") result.isCurrent = () => false;
      if (mode === "expired") result.validUntil = Date.now() - 1;
      if (mode === "mutation") {
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.request)).toBe(true);
        expect(Reflect.set(request.request, "actor", context.actor)).toBe(false);
        return Promise.reject(new Error("cannot widen request"));
      }
      return Promise.resolve(result);
    } };
    const f = await readyGrants({ rule });
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
  });

  it("ancestor revocation during awaited control approval cannot commit late allow", async () => {
    const entered = gate<GrantControlRequest>();
    const approval = gate<GrantControlApproval>();
    const rule: RegisteredGrantControlRule = { ...grantRule(), prepare: ({ request }) => {
      entered.resolve(request);
      return approval.promise;
    } };
    const f = await readyGrants({ rule });
    const pending = f.service.issuer(f.bound).prepare(f.request);
    const rejected = expect(pending).rejects.toThrow();
    const request = await entered.promise;
    f.registry.removeBinding({ bindingId: f.binding.id, scope: f.scope, revision: f.binding.revision });
    approval.resolve({ effect: "allow", request, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined });
    await rejected;
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
  });

  it.each(["false", "promise", "throw"] as const)("rejects initially %s caller currentness before target callbacks", async (mode) => {
    const f = await readyGrants();
    const bound = { ...f.bound };
    Reflect.set(bound, "isCurrent", () => {
      if (mode === "throw") throw new Error("guard failed");
      return mode === "promise" ? Promise.resolve(true) : false;
    });
    await expect(f.service.issuer(bound).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
  });

  it.each(["deny", "challenge"] as const)("issued grant cannot bypass mandatory provider %s", async (restriction) => {
    const f = await readyGrants({ restriction });
    const issuer = f.service.issuer(f.bound);
    const child = issuer.commit(await issuer.prepare(f.request));
    const input = { actor: { ...context, actor: bob }, operation: "invoke" as const, bindingId: child.id, policyRef: policy,
      scope: f.scope, route: { origin: f.scope, targets: [f.scope] } };
    expect((await f.registry.evaluate(input)).decision.effect).toBe("deny");
    f.registry.installBinding({ ...f.binding, id: "provider-bob", actor: bob, policies: [providerPolicy],
      authority: { kind: "host-policy", policy: providerPolicy } });
    const decision = (await f.registry.evaluate(input)).decision;
    if (restriction === "deny") expect(decision.effect).toBe("deny");
    else expect(decision).toMatchObject({ effect: "allow", challengeRequired: true });
  });

  it("real agent delegation keeps caller and executor tuples separate and removes both with the ancestor", async () => {
    const baseRule = grantRule();
    if (baseRule.assign === undefined) throw new Error("Missing rule ceiling");
    const f = await readyGrants({ rule: { ...baseRule, issuerKinds: ["user", "agent"], assign: { ...baseRule.assign, actorKinds: ["user", "agent"] } } });
    const a: PolicyActorRef = { kind: "agent", principal: bob.principal, agentId: "same-harness-a" };
    const b: PolicyActorRef = { kind: "agent", principal: { ...principal, subject: "carol" }, agentId: "same-harness-b" };
    const rootIssuer = f.service.issuer(f.bound);
    const aBinding = rootIssuer.commit(await rootIssuer.prepare({ ...f.request, actor: a }));
    const aBasis = f.registry.readBindings({ actor: a, scope: f.scope }).tokens[0];
    if (aBasis === undefined) throw new Error("Missing agent basis");
    const aContext = { actor: a, connectionId: "agent-a", authRevision: "auth-a", agentGeneration: 3 };
    const aIssuer = f.service.issuer({ ...f.bound, context: aContext, connectionId: aContext.connectionId, connectionGeneration: 3, basis: aBasis });
    const bBinding = aIssuer.commit(await aIssuer.prepare({ ...f.request, issuer: a, actor: b, delegationDepth: 2,
      authority: { kind: "delegation", issuer: a, parentGrantId: aBinding.id } }));
    const route = { origin: f.scope, targets: [f.scope] };
    const contract = { id: "44444444-4444-4444-8444-444444444444", key: "fixture.exact", version: 1, name: "fixture_exact",
      schemaDialect: "draft-07" as const, inputSchema: { type: "object", additionalProperties: false, properties: {} } };
    f.registry.installTool(contract);
    const callerTuple = { resource: f.scope, route, recipient: a, contract: { id: contract.id, key: contract.key, version: 1 },
      operation: "invoke" as const, bindingId: aBinding.id, policyRef: policy };
    const executor = { actor: b, connectionId: "agent-b", generation: 7, registrationRevision: 1 };
    const callerQuery = { actor: aContext, purpose: "invoke" as const, recipient: "caller" as const, scope: f.scope, route,
      tools: [{ contractId: contract.id, bindingId: aBinding.id, policyRef: policy }] };
    const executorQuery = { ...callerQuery, purpose: "execute" as const, recipient: "executor" as const, executor,
      tools: [{ contractId: contract.id, bindingId: bBinding.id, policyRef: policy }] };
    expect((await f.registry.projectAssignments(callerQuery)).admitted).toEqual([]);
    f.registry.installToolAssignment(callerTuple);
    const callerView = await f.registry.projectAssignments(callerQuery);
    expect(callerView.admitted).toHaveLength(1);
    expect((await f.registry.projectAssignments(executorQuery)).admitted).toEqual([]);
    f.registry.installExecutorAssignment({ ...callerTuple, recipient: b, operation: "execute", bindingId: bBinding.id, executor,
      implementation: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "exact-b" } });
    const executorView = await f.registry.projectAssignments(executorQuery);
    expect(executorView.admitted).toHaveLength(1);
    expect(executorView.admitted[0]?.tuple.implementation).toMatchObject({ implementationId: "exact-b" });
    expect((await f.registry.projectAssignments({ ...executorQuery, executor: { ...executor, generation: 8 } })).admitted).toEqual([]);
    expect((await f.registry.projectAssignments({ ...callerQuery, actor: { ...aContext, actor: b } })).admitted).toEqual([]);
    f.registry.removeBinding({ bindingId: f.binding.id, scope: f.scope, revision: f.binding.revision });
    expect(f.registry.validateAssignments(callerView, aContext)).toBe(false);
    expect(f.registry.validateAssignments(executorView, aContext)).toBe(false);
    expect(f.registry.readBindings({ actor: a, scope: f.scope }).bindings).toEqual([]);
    expect(f.registry.readBindings({ actor: b, scope: f.scope }).bindings).toEqual([]);
    f.registry.installBinding(f.binding);
    f.registry.installBinding(aBinding);
    f.registry.installBinding(bBinding);
    expect((await f.registry.projectAssignments(callerQuery)).admitted).toEqual([]);
    expect((await f.registry.projectAssignments(executorQuery)).admitted).toEqual([]);
  });

  it("a genuine junior tool grant does not authorize owner-only durable work", async () => {
    const f = await readyGrants();
    const issuer = f.service.issuer(f.bound);
    const child = issuer.commit(await issuer.prepare(f.request));
    expect((await f.registry.evaluate({ actor: { ...context, actor: bob }, operation: "invoke", bindingId: child.id, policyRef: policy,
      scope: f.scope, route: { origin: f.scope, targets: [f.scope] } })).decision.effect).toBe("allow");
    const memory = createMemoryPersistenceFixture();
    const submit = vi.spyOn(memory.provider.work, "submit");
    const timestamp = new Date().toISOString();
    const work = createWorkService({ repository: memory.provider.work, registrations: memory.provider.registrations,
      presence: { getByConnection: () => undefined }, allowedKinds: new Set(["fixture.task"]),
      sessions: { owner: (uri) => uri === f.scope.id ? f.registry.owner(f.scope)?.subject : undefined },
      describeSession: (uri) => uri === f.scope.id
        ? { sessionUri: uri, ownerPrincipalSubject: principal.subject,
            providerId: "test", createdAt: timestamp, modifiedAt: timestamp, lastServerSeq: 1, durableState: {} }
        : undefined,
    });
    await expect(work.submit({ subject: bob.principal.subject }, { sessionUri: f.scope.id, requestKey: "junior", kind: "fixture.task", input: {} })).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
    const submitted = await work.submit({ subject: principal.subject }, { sessionUri: f.scope.id, requestKey: "owner", kind: "fixture.task", input: {} });
    expect(typeof submitted.id).toBe("string");
    expect(submit).toHaveBeenCalledOnce();
    expect(f.registry.owner(f.scope)).toEqual(principal);
    await memory.provider.dispose();
  });

  it("counts all bindings of the full actor across scopes before invoking grant adapters", async () => {
    const f = await readyGrants({ limits: { maxBindingsPerActor: 1 } });
    const other = { ...f.scope, id: "ahp-session:/other-grant-scope", instanceId: "other-instance" };
    f.registry.installResource({ resource: other, owner: principal, route: { origin: other, targets: [other] }, externalAuthority: "none" });
    f.registry.installBinding({ ...f.binding, id: "bob-other-scope", actor: bob, scope: other });
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    f.registry.removeBinding({ bindingId: "bob-other-scope", scope: other, revision: f.binding.revision });
    const issuer = f.service.issuer(f.bound);
    expect(issuer.commit(await issuer.prepare(f.request)).actor).toEqual(bob);
  });

  for (const key of Object.keys(DEFAULT_GRANT_LIMITS) as Array<keyof typeof DEFAULT_GRANT_LIMITS>) {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_GRANT_LIMITS[key] + 1])(`rejects invalid independent ${key} = %s before callbacks`, (value) => {
      const f = setup();
      const { auth } = f.create();
      const resolveTarget = vi.fn(() => Promise.resolve(verifiedTarget()));
      const rule = grantRule();
      const approve = vi.spyOn(rule, "prepare");
      expect(() => f.registry.createGrantService({ sessions: auth, rules: [rule], resolveTarget, limits: { [key]: value } })).toThrow();
      expect(resolveTarget).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
    });
  }

  it("rejects an invalid later catalogue entry atomically and captures later caller mutations", async () => {
    const f = setup();
    const { auth } = f.create();
    await auth.createSession({ channel: "ahp-session:/catalogue" }, caller());
    const scope = auth.getResource("ahp-session:/catalogue");
    if (scope === undefined) throw new Error("No catalogue resource");
    const snapshot = f.registry.readBindings({ actor: context.actor, scope });
    const valid = grantRule();
    const invalid = { ...grantRule(), ref: { id: "bad-later", revision: 1 }, assign: { ...grantRule().assign, policies: [{ id: "unknown", revision: 1 }] } };
    const resolveTarget = vi.fn((actor: typeof bob) => Promise.resolve({ ...verifiedTarget(), actor }));
    expect(() => f.registry.createGrantService({ sessions: auth, rules: [valid, invalid as RegisteredGrantControlRule], resolveTarget })).toThrow();
    expect(f.registry.isBindingSnapshotCurrent(snapshot)).toBe(true);
    expect(resolveTarget).not.toHaveBeenCalled();
    const limits = { maxChildrenPerParent: 1 };
    const service = f.registry.createGrantService({ sessions: auth, rules: [valid], resolveTarget, limits });
    services.push(service);
    limits.maxChildrenPerParent = 100;
    Reflect.set(valid, "assign", { ...valid.assign, roles: ["administrator"] });
    const basis = f.registry.readBindings({ actor: context.actor, scope }).tokens[0];
    if (basis === undefined) throw new Error("No catalogue basis");
    const issuer = service.issuer({ ...caller(), scope, basis, rule: valid.ref });
    const request = { operation: "assign" as const, issuer: context.actor, actor: bob, scope, roles: [], policies: [policy],
      authority: { kind: "delegation" as const, issuer: context.actor, parentGrantId: basis.bindingId }, delegationDepth: 1 };
    await expect(issuer.prepare({ ...request, roles: ["administrator"] })).rejects.toThrow();
    const child = issuer.commit(await issuer.prepare(request));
    await expect(issuer.prepare(request)).rejects.toThrow();
    expect(resolveTarget).toHaveBeenCalledOnce();
    f.registry.removeBinding({ bindingId: child.id, scope, revision: child.revision });
    expect(issuer.commit(await issuer.prepare(request)).actor).toEqual(bob);
  });

  it("grant assignment does not imply a missing revoke branch", async () => {
    const rule = grantRule();
    Reflect.deleteProperty(rule, "revoke");
    const f = await readyGrants({ rule });
    const issuer = f.service.issuer(f.bound);
    const child = issuer.commit(await issuer.prepare(f.request));
    const target = f.registry.readBindings({ actor: bob, scope: f.scope }).tokens[0];
    if (target === undefined) throw new Error("No child token");
    const approvals = f.approve.mock.calls.length;
    await expect(f.service.issuer({ ...f.bound, revokeTarget: target }).revoke({ operation: "revoke", issuer: context.actor,
      grantId: child.id, instanceId: f.scope.instanceId })).rejects.toThrow();
    expect(f.approve).toHaveBeenCalledTimes(approvals);
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([child]);
  });

  it("authorized already-absent revoke is inert but a same-tuple replacement rejects its old token", async () => {
    const f = await readyGrants();
    const issuer = f.service.issuer(f.bound);
    const child = issuer.commit(await issuer.prepare(f.request));
    const target = f.registry.readBindings({ actor: bob, scope: f.scope }).tokens[0];
    if (target === undefined) throw new Error("No child token");
    f.registry.removeBinding({ bindingId: child.id, scope: f.scope, revision: child.revision });
    const empty = f.registry.readBindings({ actor: bob, scope: f.scope });
    const revoker = f.service.issuer({ ...f.bound, revokeTarget: target });
    const request = { operation: "revoke" as const, issuer: context.actor, grantId: child.id, instanceId: f.scope.instanceId };
    await revoker.revoke(request);
    expect(f.registry.isBindingSnapshotCurrent(empty)).toBe(true);
    f.registry.installBinding(child);
    await expect(revoker.revoke(request)).rejects.toThrow();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([child]);
  });

  it("rechecks caller identity after a target currentness callback invalidates its generation", async () => {
    let armed = false;
    let identityCurrent = true;
    const f = await readyGrants({ resolveTarget: (actor) => Promise.resolve({ ...verifiedTarget(), actor, isCurrent: () => {
      if (armed) identityCurrent = false;
      return true;
    } }) });
    const issuer = f.service.issuer({ ...f.bound, isCurrent: () => identityCurrent });
    const prepared = await issuer.prepare(f.request);
    armed = true;
    expect(() => issuer.commit(prepared)).toThrow();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
  });

  it("private snapshot currentness prunes unrelated expiry and invalidates an empty read without hints", async () => {
    let time = Date.now();
    const f = await readyGrants({ now: () => time });
    f.registry.installBinding({ ...f.binding, id: "unrelated-expiring", expiresAt: new Date(time + 1000).toISOString() });
    const empty = f.registry.readBindings({ actor: bob, scope: f.scope });
    expect(empty.bindings).toEqual([]);
    expect(f.service.isBindingSnapshotCurrent(empty, () => true)).toBe(true);
    time += 1001;
    expect(f.service.isBindingSnapshotCurrent(empty, () => true)).toBe(false);
    expect(f.registry.readBindings({ actor: context.actor, scope: f.scope }).bindings.map((binding) => binding.id)).toEqual([f.binding.id]);
  });

  it("final grant CAS prunes unrelated expiry before comparing its captured revision", async () => {
    let time = Date.now();
    const f = await readyGrants({ now: () => time });
    f.registry.installBinding({ ...f.binding, id: "unrelated-expiring", expiresAt: new Date(time + 1000).toISOString() });
    const issuer = f.service.issuer(f.bound);
    const prepared = await issuer.prepare(f.request);
    time += 1001;
    expect(() => issuer.commit(prepared)).toThrow();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
    const fresh = f.service.issuer(f.bound);
    const retry = await fresh.prepare(f.request);
    expect(fresh.commit(retry).actor).toEqual(bob);
  });

  it.each(["control", "control-only-anchor"])("explicit root authority %s can grant without itself holding tool-use policies", async (anchor) => {
    const rule: RegisteredGrantControlRule = { ...grantRule(), root: { mode: "roles", authorityPolicy: { id: anchor, revision: 1 },
      requiredPolicies: [], anyOf: ["manager"] } };
    const f = await readyGrants({ rule });
    const manager = { kind: "user" as const, principal: { ...principal, subject: "manager" } };
    const root: ScopedPolicyBinding = { ...f.binding, id: "manager", actor: manager, roles: ["manager"], policies: [],
      authority: { kind: "host-policy", policy: { id: anchor, revision: 1 } } };
    f.registry.installBinding(root);
    const basis = f.registry.readBindings({ actor: manager, scope: f.scope }).tokens[0];
    if (basis === undefined) throw new Error("Missing explicit root");
    const managerContext = { ...context, actor: manager };
    expect((await f.registry.evaluate({ actor: managerContext, operation: "invoke", bindingId: root.id, policyRef: policy,
      scope: f.scope, route: { origin: f.scope, targets: [f.scope] } })).decision.effect).toBe("deny");
    const issuer = f.service.issuer({ ...f.bound, context: managerContext, basis });
    const prepared = await issuer.prepare({ ...f.request, issuer: manager,
      authority: { ...f.request.authority, issuer: manager, parentGrantId: root.id } });
    const child = issuer.commit(prepared);
    expect((await f.registry.evaluate({ actor: { ...context, actor: bob }, operation: "invoke", bindingId: child.id, policyRef: policy,
      scope: f.scope, route: { origin: f.scope, targets: [f.scope] } })).decision.effect).toBe("allow");
    expect(f.registry.owner(f.scope)).toEqual(principal);
  });

  it("explicit control-only descendants can delegate and revoke without gaining tool-use authority", async () => {
    const source = grantRule();
    if (source.assign === undefined) throw new Error("Missing control fixture");
    const f = await readyGrants({ rule: { ...source, assign: { ...source.assign, policies: [] } } });
    const rootIssuer = f.service.issuer(f.bound);
    const child = rootIssuer.commit(await rootIssuer.prepare({ ...f.request, policies: [] }));
    const bobContext = { ...context, actor: bob };
    expect((await f.registry.evaluate({ actor: bobContext, operation: "invoke", bindingId: child.id, policyRef: policy,
      scope: f.scope, route: { origin: f.scope, targets: [f.scope] } })).decision.effect).toBe("deny");
    const basis = f.registry.readBindings({ actor: bob, scope: f.scope }).tokens[0];
    if (basis === undefined) throw new Error("Missing control-only child");
    const carol = { ...bob, principal: { ...principal, subject: "carol" } };
    const bound = { ...f.bound, context: bobContext, basis };
    const issuer = f.service.issuer(bound);
    const grandchild = issuer.commit(await issuer.prepare({ ...f.request, issuer: bob, actor: carol, policies: [], delegationDepth: 2,
      authority: { ...f.request.authority, issuer: bob, parentGrantId: child.id } }));
    const target = f.registry.readBindings({ actor: carol, scope: f.scope }).tokens[0];
    if (target === undefined) throw new Error("Missing delegated grandchild");
    await f.service.issuer({ ...bound, revokeTarget: target }).revoke({ operation: "revoke", issuer: bob,
      grantId: grandchild.id, instanceId: f.scope.instanceId });
    expect(f.registry.readBindings({ actor: carol, scope: f.scope }).bindings).toEqual([]);
    expect(f.registry.owner(f.scope)).toEqual(principal);
  });
  it("genuine invocation and ownership do not supply a missing role gate or combine fragmented bindings", async () => {
    const rule: RegisteredGrantControlRule = { ...grantRule(), root: { mode: "roles", authorityPolicy: policy,
      requiredPolicies: [policy], anyOf: ["manager"] } };
    const f = await readyGrants({ rule });
    const allowed = await evaluate(f.registry, f.binding);
    expect(allowed.decision.effect).toBe("allow");
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.registry.matches(allowed.stamp, context)).toBe(true);
    f.registry.installBinding({ ...f.binding, id: "role-fragment", roles: ["manager"], policies: [] });
    const fragment = f.registry.readBindings({ actor: context.actor, scope: f.scope }).tokens.find((token) => token.bindingId === "role-fragment");
    if (fragment === undefined) throw new Error("Missing fragment control");
    await expect(f.service.issuer({ ...f.bound, basis: fragment }).prepare({ ...f.request,
      authority: { ...f.request.authority, parentGrantId: fragment.bindingId } })).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    f.registry.installBinding({ ...f.binding, id: "complete-controller", roles: ["manager"] });
    const complete = f.registry.readBindings({ actor: context.actor, scope: f.scope }).tokens.find((token) => token.bindingId === "complete-controller");
    if (complete === undefined) throw new Error("Missing complete control");
    const issuer = f.service.issuer({ ...f.bound, basis: complete });
    const prepared = await issuer.prepare({ ...f.request, authority: { ...f.request.authority, parentGrantId: complete.bindingId } });
    const child = issuer.commit(prepared);
    expect((await f.registry.evaluate({ actor: { ...context, actor: bob }, operation: "invoke", bindingId: child.id, policyRef: policy,
      scope: f.scope, route: { origin: f.scope, targets: [f.scope] } })).decision.effect).toBe("allow");
    expect(f.registry.owner(f.scope)).toEqual(principal);
  });

  it.each(["actor", "policy", "role", "depth", "issuer", "scope", "authority", "token"] as const)("rejects %s overreach before external callbacks with unchanged authority", async (dimension) => {
    const f = await readyGrants();
    const allowed = await evaluate(f.registry, f.binding);
    const request = { ...f.request };
    const bound = { ...f.bound };
    if (dimension === "actor") request.actor = { ...bob, principal: { ...bob.principal, domainId: "foreign" } };
    if (dimension === "policy") request.policies = [{ id: "not-admitted", revision: 1 }];
    if (dimension === "role") Object.assign(request, { roles: ["admin"] });
    if (dimension === "depth") request.delegationDepth = 0;
    if (dimension === "issuer") request.issuer = bob;
    if (dimension === "scope") request.scope = { ...f.scope, instanceId: "wrong" };
    if (dimension === "authority") request.authority = { ...request.authority, parentGrantId: "invented" };
    if (dimension === "token") bound.basis = { ...bound.basis };
    await expect(f.service.issuer(bound).prepare(request)).rejects.toThrow();
    expect(f.resolveTarget).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.registry.matches(allowed.stamp, context)).toBe(true);
  });

  it("a revoked basis during target resolution never reaches control approval or installs a child", async () => {
    const started = gate<undefined>();
    const target = gate<ResolvedGrantTarget>();
    const f = await readyGrants({ resolveTarget: () => {
      started.resolve();
      return target.promise;
    } });
    expect((await evaluate(f.registry, f.binding)).decision.effect).toBe("allow");
    const pending = f.service.issuer(f.bound).prepare(f.request);
    const denied = expect(pending).rejects.toThrow();
    await started.promise;
    f.registry.removeBinding({ bindingId: f.binding.id, scope: f.scope, revision: f.binding.revision });
    target.resolve(verifiedTarget());
    await denied;
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
  });

  it("cancelled target and late owned cleanup retain the one shared slot across new handles", async () => {
    const started = gate<undefined>();
    const target = gate<ResolvedGrantTarget>();
    const releasing = gate<undefined>();
    const cleanup = gate<undefined>();
    let first = true;
    const f = await readyGrants({ limits: { maxPendingMutations: 1 }, resolveTarget: (actor) => {
      if (!first) return Promise.resolve({ ...verifiedTarget(), actor });
      first = false;
      started.resolve();
      return target.promise;
    } });
    const cancellation = new AbortController();
    const pending = f.service.issuer({ ...f.bound, signal: cancellation.signal }).prepare(f.request);
    const denied = expect(pending).rejects.toThrow();
    await started.promise;
    cancellation.abort();
    await denied;
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledTimes(1);
    const release = vi.fn(() => {
      releasing.resolve();
      return cleanup.promise;
    });
    target.resolve({ ...verifiedTarget(), release });
    await releasing.promise;
    await expect(f.service.issuer(f.bound).prepare(f.request)).rejects.toThrow();
    expect(f.resolveTarget).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const issuer = f.service.issuer(f.bound);
    const prepared = await issuer.prepare(f.request);
    const child = issuer.commit(prepared);
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings.map((binding) => binding.id)).toEqual([child.id]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a reentrant final clock cannot invalidate caller identity after the last identity guard", async () => {
    let armed = false;
    let identityCurrent = true;
    const f = await readyGrants({ now: () => {
      if (armed) identityCurrent = false;
      return Date.now();
    } });
    const issuer = f.service.issuer({ ...f.bound, isCurrent: () => identityCurrent });
    const prepared = await issuer.prepare(f.request);
    armed = true;
    expect(() => issuer.commit(prepared)).toThrow();
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings).toEqual([]);
  });

  it("copied and twice-used receipts fail, while rollback after commit leaves its successful grant intact", async () => {
    const f = await readyGrants();
    const issuer = f.service.issuer(f.bound);
    const prepared = await issuer.prepare(f.request);
    expect(() => issuer.commit({ ...prepared })).toThrow();
    const child = issuer.commit(prepared);
    expect(() => issuer.commit(prepared)).toThrow();
    issuer.rollback(prepared);
    expect(f.registry.readBindings({ actor: bob, scope: f.scope }).bindings.map((binding) => binding.id)).toEqual([child.id]);
  });

  it("actual bootstrap and ready factory support grant then revoke without conferring ownership", async () => {
    const f = setup();
    const { auth } = f.create();
    const service = f.registry.createGrantService({ sessions: auth, rules: [grantRule()], resolveTarget: (actor) => Promise.resolve({
      actor, validUntil: Date.now() + 30000, isCurrent: () => true, release: () => undefined,
    }) });
    await auth.createSession({ channel: "ahp-session:/grant-service" }, caller());
    const scope = auth.getResource("ahp-session:/grant-service");
    if (scope === undefined) throw new Error("Missing real resource");
    const snapshot = f.registry.readBindings({ actor: context.actor, scope });
    const basis = snapshot.tokens[0];
    if (basis === undefined) throw new Error("Missing actual bootstrap token");
    const bob = { kind: "user" as const, principal: { ...principal, subject: "bob" } };
    const bound = { ...caller(), rule: grantRule().ref, basis, scope };
    const issuer = service.issuer(bound);
    const prepared = await issuer.prepare({ operation: "assign", issuer: context.actor, actor: bob, scope, roles: [], policies: [policy],
      authority: { kind: "delegation", issuer: context.actor, parentGrantId: basis.bindingId }, delegationDepth: 1 });
    const binding = issuer.commit(prepared);
    const bobInput = { actor: { ...context, actor: bob }, operation: "invoke" as const, bindingId: binding.id, policyRef: policy,
      scope, route: { origin: scope, targets: [scope] } };
    expect((await f.registry.evaluate(bobInput)).decision.effect).toBe("allow");
    expect(f.registry.owner(scope)).toEqual(principal);
    const target = f.registry.readBindings({ actor: bob, scope }).tokens[0];
    if (target === undefined) throw new Error("Missing issued child");
    await service.issuer({ ...bound, revokeTarget: target }).revoke({ operation: "revoke", issuer: context.actor, grantId: binding.id, instanceId: scope.instanceId });
    expect((await f.registry.evaluate(bobInput)).decision.effect).toBe("deny");
    expect(f.registry.owner(scope)).toEqual(principal);
    service.dispose();
  });

  it("rejects a mismatched factory before target/control callbacks", () => {
    const first = setup();
    const other = setup();
    const { auth } = other.create();
    const resolveTarget = vi.fn();
    const rule = grantRule();
    const approve = vi.spyOn(rule, "prepare");
    expect(() => first.registry.createGrantService({ sessions: auth, rules: [rule], resolveTarget })).toThrow();
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("P06 actual factory installation freshness", () => {
  it.each([false, true])("binding install then throw compensates only its own installation, replacement=%s", async (replace) => {
    const f = setup();
    const original = f.registry.installBinding.bind(f.registry);
    let observed: ScopedPolicyBinding | undefined;
    f.registry.installBinding = (binding, token) => {
      original(binding, token);
      observed = binding;
      if (replace) {
        f.registry.teardown(binding.scope);
        f.registry.installResource({ resource: binding.scope, owner: principal,
          route: { origin: binding.scope, targets: [binding.scope] }, externalAuthority: "none" });
        original(binding);
      }
      throw new Error("after binding effect");
    };
    const { factory, auth } = f.create();
    await expect(auth.createSession({ channel: "ahp-session:/binding-fault" }, caller())).rejects.toThrow("after binding effect");
    if (observed === undefined) throw new Error("No binding effect");
    expect(factory.listSessionSnapshots()).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    if (replace) {
      expect(f.registry.owner(observed.scope)).toEqual(principal);
      expect((await evaluate(f.registry, observed)).decision.effect).toBe("allow");
    } else expect(f.registry.owner(observed.scope)).toBeUndefined();
  });

  it("late backend failure withdraws only its original bootstrap, not a same-tuple replacement", async () => {
    const started = gate<undefined>();
    const backend = gate<SessionBackend>();
    const f = setup(() => {
      started.resolve();
      return backend.promise;
    });
    const { factory, auth } = f.create();
    const creating = auth.createSession({ channel: "ahp-session:/startup-aba" }, caller());
    await started.promise;
    const binding = f.installed.mock.calls[0]?.[0];
    if (binding === undefined) throw new Error("Missing actual SDK bootstrap");
    expect((await evaluate(f.registry, binding)).decision.effect).toBe("allow");
    f.registry.removeBinding({ bindingId: binding.id, scope: binding.scope, revision: binding.revision });
    f.registry.installBinding(binding);
    const successor = await evaluate(f.registry, binding);
    expect(successor.decision.effect).toBe("allow");
    backend.reject(new Error("late backend failure"));
    await creating;
    expect(factory.getSessionSnapshot(binding.scope.id)?.state.lifecycle).toBe("failed");
    expect(f.registry.matches(successor.stamp, context)).toBe(true);
    expect((await evaluate(f.registry, binding)).decision.effect).toBe("allow");
    expect(f.registry.owner(binding.scope)).toEqual(principal);
  });

  it("stale factory record cannot report or tear down a same-full-ref canonical successor", async () => {
    const f = setup();
    const { factory, auth } = f.create();
    await auth.createSession({ channel: "ahp-session:/resource-aba" }, caller());
    const ref = auth.getResource("ahp-session:/resource-aba");
    if (ref === undefined) throw new Error("Missing actual resource");
    f.registry.teardown(ref);
    const replacementOwner = { ...principal, subject: "bob" };
    f.registry.installResource({ resource: ref, owner: replacementOwner, route: { origin: ref, targets: [ref] }, externalAuthority: "none" });
    expect(auth.getResource(ref.id)).toBeUndefined();
    await factory.dispose();
    expect(f.registry.owner(ref)).toEqual(replacementOwner);
    f.registry.teardown(ref);
  });

  it("install-then-replace-then-throw rollback preserves the replacement resource", async () => {
    const f = setup();
    let replacement: ResourceRef | undefined;
    const original = f.registry.installResource.bind(f.registry);
    const replacementOwner = { ...principal, subject: "bob" };
    f.registry.installResource = (input, token) => {
      original(input, token);
      f.registry.teardown(input.resource);
      original({ ...input, owner: replacementOwner });
      replacement = input.resource;
      throw new Error("after replacement");
    };
    const { factory, auth } = f.create();
    await expect(auth.createSession({ channel: "ahp-session:/attach-aba" }, caller())).rejects.toThrow("after replacement");
    if (replacement === undefined) throw new Error("Replacement was never installed");
    expect(f.registry.owner(replacement)).toEqual(replacementOwner);
    expect(factory.listSessionSnapshots()).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    f.registry.teardown(replacement);
  });
});

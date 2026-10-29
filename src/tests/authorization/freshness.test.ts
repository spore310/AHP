import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createReferenceAuthorizer, type BindingResolver, type ResourceRef, type ScopedPolicyBinding, type SecurityComposition } from "@authorization";
import { createLegacyConnectionIdentityAdapter, createStaticTokenAuthenticator } from "@agents";
import { createAHPServer, type AHPServerHandle, type AHPServerSecurityOptions, type InitialAuthoritySource } from "@websocket";
import { createConnectionSetupAdapter } from "@websocket/helpers/security";
import { FrameLog, responseWithId } from "../websocket/helpers";
import { createSessionTypeCatalogue, createSessionsFactory, type SessionBackend, type SessionProvider, type SessionsFactory } from "@sessions";
import { mockProvider } from "@sessions/mock";
import type { GrantService, GrantServiceOptions, RegisteredGrantControlRule, ResolvedGrantTarget } from "@authorization";
import type { SessionCreationContext } from "@sessions/helpers/creation/types";
import { createToolPolicyFactory } from "@toolPolicy";

const factories: SessionsFactory[] = [];
const services: GrantService[] = [];
const hosts: AHPServerHandle[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
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
const sessionType = { key: "protected", version: 1 };
const principal = { domainId: "local", subject: "alice" };
const context = { actor: { kind: "user" as const, principal }, connectionId: "connection", authRevision: "auth" };
const caller = (): SessionCreationContext => ({ context, connectionId: context.connectionId, connectionGeneration: 1,
  validUntil: Date.now() + 60000, signal: new AbortController().signal, isCurrent: () => true });
const setup = (startSession: SessionProvider["startSession"] = () => Promise.resolve({ dispose: () => undefined }), now = () => Date.now()) => {
  const rules = { admitted: { policies: [policy], namespaces: [] }, mandatory: [] };
  const policies = createToolPolicyFactory({ policies: [{ ...policy, operations: {
    invoke: { actor: { mode: "direct-grant", actors: ["user"] } },
  }, challenge: { required: false } }], bindings: [{ sessionType, providerId: "test", ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now });
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
  limits?: GrantServiceOptions["limits"]; now?: () => number; } = {}) => {
  const f = setup(undefined, options.now);
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
const hostedGrants = (now = () => Date.now(), startSession?: SessionProvider["startSession"]) => {
  const f = setup(startSession, now);
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
  const identity = createLegacyConnectionIdentityAdapter({ domainId: principal.domainId,
    authenticator: createStaticTokenAuthenticator(new Map([["fixture-alice", principal.subject]])) });
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
  const security: AHPServerSecurityOptions = { composition, initialAuthority, now };
  const host = createAHPServer({ host: "127.0.0.1", port: 0, security, sessions: {
    providers: [f.provider], application: { catalogue: f.catalogue, defaultType: sessionType }, creationSecurity: { registry: f.registry, policies: f.policies },
  } });
  hosts.push(host);
  const hostedAuthorization = host.sessions.authorization;
  if (hostedAuthorization === undefined) throw new Error("Missing hosted authorization");
  const auth = hostedAuthorization;
  const resolveTarget = vi.fn((actor: typeof bob) => Promise.resolve({ ...verifiedTarget(), actor }));
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

import { describe, expect, it, vi } from "vitest";

import { createAgentDirectory, createLegacyConnectionIdentityAdapter } from "@agents";
import { createRegistrationFixture } from "./fixtures";
import type { SecurityComposition, TrustedRequestContext, ScopedPolicyBinding, ActorResolutionRequest } from "@authorization";
import { createReferenceAuthorizer } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import { createConnectionSetupAdapter } from "@websocket/helpers/security";
import type { AHPServerSecurityOptions, PreparedInitialScopes } from "@websocket";

const scope = { domainId: "domain", kind: "session", id: "ahp-session:/existing", instanceId: "incarnation" };
const principal = { domainId: "domain", subject: "ada" };
const fence = { connectionId: "reserved", connectionGeneration: 7 };
const request = { handshake: { headers: {} }, fence, authRevision: "revision", signal: new AbortController().signal };
const fixture = (agent = false) => {
  const registrations = new Map([["registered-agent", { principal, generation: 3 }]]);
  const registered = (): boolean => registrations.get("registered-agent")?.principal.subject === principal.subject;
  let current = true;
  let clock = 1000;
  const now = () => clock;
  const actor = agent ? { kind: "agent" as const, principal, agentId: "registered-agent" } : { kind: "user" as const, principal };
  const binding: ScopedPolicyBinding = {
    id: "binding", actor, scope, roles: [], policies: [{ id: "read", revision: 1 }], revision: 1,
    authority: { kind: "host-policy", policy: { id: "read", revision: 1 } },
  };
  const host = createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies: [{
    id: "read", revision: 1, challenge: { required: false }, operations: { invoke: { actor: { mode: "direct-grant", actors: ["user", "agent"] } } },
  }] }), now });
  host.installResource({ resource: scope, owner: principal, route: { origin: scope, targets: [scope] }, externalAuthority: "none" });
  host.installBinding(binding);
  const release = vi.fn();
  const prepare = vi.fn((): Promise<PreparedInitialScopes> => Promise.resolve({ scopes: [{ scope, grantRevision: 4 }], validUntil: 2000, isCurrent: () => current && (!agent || registered()), release }));
  const authenticate = vi.fn(() => Promise.resolve(principal));
  const resolveActor = vi.fn((input: ActorResolutionRequest) => Promise.resolve({ connectionId: input.connectionId, authRevision: input.authRevision, actor, ...(agent && registered() ? { agentGeneration: registrations.get("registered-agent")?.generation } : {}) }));
  const resolveResource = vi.fn(() => Promise.resolve({
    resource: scope, owner: host.owner(scope) ?? principal, operations: ["invoke"], related: [],
    admitted: { policies: binding.policies, namespaces: [] }, mandatory: [],
  }));
  const read = vi.fn(() => Promise.resolve([binding]));
  const grantPrepare = vi.fn(() => Promise.reject(new Error("Must not issue")));
  const grantCommit = vi.fn(() => {
    throw new Error("Must not issue");
  });
  const evaluate = vi.fn(() => Promise.resolve({ effect: "deny" as const, code: "not-an-operation-decision" }));
  const freshness = vi.fn(() => Promise.resolve({ domainId: "domain", revision: 4, invalidated: false }));
  const composition: SecurityComposition = {
    identity: { authenticate }, actors: { resolve: resolveActor }, resources: { resolve: resolveResource }, bindings: { read },
    grants: { prepare: grantPrepare, commit: grantCommit, rollback: vi.fn(), revoke: () => Promise.resolve() },
    policies: { evaluate }, freshness: { current: freshness, invalidate: () => Promise.resolve() },
  };
  const options: AHPServerSecurityOptions = { composition, initialAuthority: { prepare }, now };
  return { options, composition, binding, release, prepare, host, actor, read, resolveResource, grantPrepare, grantCommit, evaluate, freshness, authenticate,
    revoke: () => {
      current = false;
    }, advance: (time: number) => {
      clock = time;
    }, unregister: () => {
      registrations.delete("registered-agent");
    },
  };
};

describe("P04 trusted policy actor/setup", () => {
  it("I02 reads only explicit existing scoped bindings without issuing or installing grants", async () => {
    const r = fixture();
    const setup = await createConnectionSetupAdapter(r.options).prepare(request);
    if (setup === undefined) {
      throw new Error("Expected explicit setup");
    }
    expect(r.read).toHaveBeenCalledExactlyOnceWith({ actor: r.actor, scope, grantRevision: 4 });
    expect(setup.snapshot.scopes[0]?.bindings).toEqual([r.binding]);
    expect(setup.snapshot.context.connectionId).toBe(fence.connectionId);
    expect(setup.snapshot.fence).toEqual(fence);
    expect(setup.snapshot.allowGlobalSequence).toBe(false);
    expect(r.grantPrepare).not.toHaveBeenCalled();
    expect(r.grantCommit).not.toHaveBeenCalled();
    expect(r.evaluate).not.toHaveBeenCalled();
    expect(setup.isCurrent()).toBe(true);
    r.revoke();
    expect(setup.isCurrent()).toBe(false);
    setup.release();
    setup.release();
    expect(r.release).toHaveBeenCalledOnce();
    expect(r.host.owner(scope)).toEqual(principal);
  });

  it("I03 explicit user and independently registered-agent controls do not infer kind from labels or absence", async () => {
    const user = fixture();
    const userSetup = await createConnectionSetupAdapter(user.options).prepare(request);
    expect(userSetup?.snapshot.context.actor.kind).toBe("user");
    const agent = fixture(true);
    const agentSetup = await createConnectionSetupAdapter(agent.options).prepare(request);
    expect(agentSetup?.snapshot.context.actor).toEqual(agent.actor);
    expect(agentSetup?.snapshot.context.agentGeneration).toBe(3);
    agent.unregister();
    expect(agentSetup?.isCurrent()).toBe(false);
    const absent = fixture(true);
    absent.unregister();
    await expect(createConnectionSetupAdapter(absent.options).prepare(request)).rejects.toThrow(/generation/i);
    expect(absent.read).not.toHaveBeenCalled();
    userSetup?.release();
    agentSetup?.release();
  });

  it("I04 legacy bridge calls the exact single authenticator and captures its domain", async () => {
    const authenticate = vi.fn(() => Promise.resolve({ subject: "ada" }));
    const options = { authenticator: { authenticate }, domainId: "domain" };
    const adapter = createLegacyConnectionIdentityAdapter(options);
    options.domainId = "forged";
    expect(await adapter.authenticate({ headers: { authorization: "private" } })).toEqual(principal);
    expect(authenticate).toHaveBeenCalledExactlyOnceWith({ headers: { authorization: "private" } });
  });

  it("I02 empty initial authority does not invent a scope or perform an unscoped read", async () => {
    const r = fixture();
    r.options.initialAuthority.prepare = () => Promise.resolve({ scopes: [], validUntil: 2000, isCurrent: () => true, release: r.release });
    const result = await createConnectionSetupAdapter(r.options).prepare(request);
    expect(result?.snapshot.scopes).toEqual([]);
    expect(r.read).not.toHaveBeenCalled();
    expect(r.resolveResource).not.toHaveBeenCalled();
    result?.release();
  });

  for (const wrong of ["actor", "scope", "incarnation", "expired", "revision", "guard"] as const) {
    it(`I02 rejects ${wrong} setup facts atomically and releases its preparation`, async () => {
      const r = fixture();
      if (wrong === "actor") {
        r.composition.bindings.read = () => Promise.resolve([{ ...r.binding, actor: { kind: "user", principal: { ...principal, subject: "mallory" } } }]);
      } else if (wrong === "scope") {
        r.composition.bindings.read = () => Promise.resolve([{ ...r.binding, scope: { ...scope, instanceId: "other" } }]);
      } else if (wrong === "incarnation") {
        const resolve = r.composition.resources.resolve.bind(r.composition.resources);
        r.composition.resources.resolve = async (input) => ({ ...await resolve(input), resource: { ...scope, instanceId: "other" } });
      } else if (wrong === "expired") {
        r.composition.bindings.read = () => Promise.resolve([{ ...r.binding, expiresAt: new Date(999).toISOString() }]);
      } else if (wrong === "revision") {
        let revision = 4;
        r.composition.freshness.current = () => Promise.resolve({ domainId: "domain", revision: revision++, invalidated: false });
      } else {
        r.revoke();
      }
      await expect(createConnectionSetupAdapter(r.options).prepare(request)).rejects.toThrow();
      expect(r.release).toHaveBeenCalledOnce();
      expect(r.host.owner(scope)).toEqual(principal);
    });
  }

  it("I03 rejects trusted resolver attempts to retarget principal, connection or auth revision", async () => {
    for (const wrong of ["principal", "connection", "revision"]) {
      const r = fixture();
      r.composition.actors.resolve = (input): Promise<TrustedRequestContext> => Promise.resolve({
        connectionId: wrong === "connection" ? "other" : input.connectionId,
        authRevision: wrong === "revision" ? "other" : input.authRevision,
        actor: { kind: "user", principal: wrong === "principal" ? { ...principal, subject: "other" } : principal },
      });
      await expect(createConnectionSetupAdapter(r.options).prepare(request)).rejects.toThrow(/mismatch/i);
      expect(r.prepare).not.toHaveBeenCalled();
    }
  });

  it("I05 captures options and checks stale guards without asynchronous freshness at currentness", async () => {
    const r = fixture();
    const options = { ...r.options, maxInitialScopes: 1, maxInitialBindings: 1 };
    const adapter = createConnectionSetupAdapter(options);
    options.maxInitialScopes = 8;
    options.maxInitialBindings = 8;
    const good = await adapter.prepare(request);
    const calls = r.freshness.mock.calls.length;
    expect(good?.isCurrent()).toBe(true);
    expect(r.freshness.mock.calls).toHaveLength(calls);
    good?.release();
    r.options.initialAuthority.prepare = () => Promise.resolve({ scopes: [{ scope, grantRevision: 4 }, { scope: { ...scope, instanceId: "two" }, grantRevision: 4 }], validUntil: 2000, isCurrent: () => true, release: r.release });
    const limited = createConnectionSetupAdapter({ ...r.options, maxInitialScopes: 1 });
    await expect(limited.prepare(request)).rejects.toThrow(/scopes/i);
  });

  it("I05 old setup release cannot remove a successor directory presence generation", async () => {
    const registrations = createRegistrationFixture();
    const directory = createAgentDirectory({ registrations: registrations.repository, now: () => 1000 });
    const registration = await directory.register({ subject: "ada" }, "registered-agent");
    const r = fixture();
    r.options.initialAuthority.prepare = (input) => {
      const presence = directory.bindPresence(registration.id, { subject: "ada" }, input.fence.connectionId);
      return Promise.resolve({ scopes: [{ scope, grantRevision: 4 }], validUntil: 2000,
        isCurrent: () => directory.getByConnection(input.fence.connectionId)?.generation === presence.generation,
        release: () => {
          directory.releasePresence(presence);
        },
      });
    };
    const adapter = createConnectionSetupAdapter(r.options);
    const old = await adapter.prepare(request);
    expect(old?.isCurrent()).toBe(true);
    old?.release();
    const successor = await adapter.prepare({ ...request, fence: { connectionId: "successor", connectionGeneration: 8 }, authRevision: "new" });
    expect(successor?.isCurrent()).toBe(true);
    old?.release();
    expect(directory.getByConnection("successor")?.generation).toBe(2);
    expect(successor?.isCurrent()).toBe(true);
    expect(old?.isCurrent()).toBe(false);
    successor?.release();
  });

  it("I05 refuses a non-synchronous currentness result instead of treating a Promise as permission", async () => {
    const r = fixture();
    r.options.initialAuthority.prepare = () => {
      const seed = { scopes: [{ scope, grantRevision: 4 }], validUntil: 2000, isCurrent: () => true, release: r.release };
      Reflect.set(seed, "isCurrent", () => Promise.resolve(true));
      return Promise.resolve(seed);
    };
    await expect(createConnectionSetupAdapter(r.options).prepare(request)).rejects.toThrow(/stale/i);
    expect(r.release).toHaveBeenCalledOnce();
    expect(r.read).not.toHaveBeenCalled();
  });

  it("I05 captures the total binding limit before multiple scopes can amplify it", async () => {
    const r = fixture();
    let records = [r.binding];
    r.composition.bindings.read = () => Promise.resolve(records);
    const options = { ...r.options, maxInitialBindings: 1 };
    const adapter = createConnectionSetupAdapter(options);
    const first = await adapter.prepare(request);
    expect(first?.snapshot.scopes[0]?.bindings).toHaveLength(1);
    first?.release();
    options.maxInitialBindings = 8;
    const second = { ...r.binding, id: "second-valid-binding" };
    r.host.installBinding(second);
    records = [r.binding, second];
    await expect(adapter.prepare(request)).rejects.toThrow(/binding limit/i);
    const broader = await createConnectionSetupAdapter({ ...r.options, maxInitialBindings: 2 }).prepare(request);
    expect(broader?.snapshot.scopes[0]?.bindings).toHaveLength(2);
    broader?.release();
  });

  it("I05 expiry and throwing local guards cannot preserve an attached setup", async () => {
    const r = fixture();
    const result = await createConnectionSetupAdapter(r.options).prepare(request);
    expect(result?.isCurrent()).toBe(true);
    r.advance(2000);
    expect(result?.isCurrent()).toBe(false);
    result?.release();
    const throwing = fixture();
    let broken = false;
    throwing.options.initialAuthority.prepare = () => Promise.resolve({ scopes: [{ scope, grantRevision: 4 }], validUntil: 2000,
      isCurrent: () => {
        if (broken) throw new Error("Guard failure");
        return true;
      }, release: () => { throw new Error("Cleanup failure"); },
    });
    const captured = await createConnectionSetupAdapter(throwing.options).prepare(request);
    expect(captured?.isCurrent()).toBe(true);
    broken = true;
    expect(captured?.isCurrent()).toBe(false);
    expect(() => {
      captured?.release();
    }).not.toThrow();
  });

  it("I05 validates setup count/deadline limits and honors cancellation before any reads", async () => {
    for (const key of ["setupDeadlineMs", "maxInitialScopes", "maxInitialBindings", "maxInitialSubscriptions"] as const) {
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, key === "setupDeadlineMs" ? 60001 : 1025]) {
        expect(() => createConnectionSetupAdapter({ ...fixture().options, [key]: value })).toThrow();
      }
      expect(() => createConnectionSetupAdapter({ ...fixture().options, [key]: key === "setupDeadlineMs" ? 60000 : 1024 })).not.toThrow();
    }
    const r = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(createConnectionSetupAdapter(r.options).prepare({ ...request, signal: abort.signal })).rejects.toThrow(/cancelled/i);
    expect(r.authenticate).not.toHaveBeenCalled();
  });
});

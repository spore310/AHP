import { afterEach, describe, expect, it, vi } from "vitest";

import { createReferenceAuthorizer, type ReferenceAuthorizer, type ResourceRef } from "@authorization";
import { createSessionTypeCatalogue, createSessionsFactory, type ApplicationSessionType, type SessionBackend, type SessionCreationSecurityOptions, type SessionProvider, type SessionRegistry, type SessionsFactory } from "@sessions";
import { createInMemorySessionRegistry } from "@sessions/helpers/registry";
import { CREATION_INPUT_BYTES } from "@sessions/helpers/creation/constants";
import { ACTION_TYPE_SESSION_CREATION_FAILED } from "@sessions/constants";
import { mockProvider } from "@sessions/mock";
import type { SessionCreationApproval, SessionCreationContext, SessionCreationFacts, SessionTypePolicyRegistration } from "@sessions/helpers/creation/types";
import { createToolPolicyFactory } from "@toolPolicy";
import { SESSION_TYPE_SELECTOR_KEY, type ToolCatalogue } from "@tools";

const factories: SessionsFactory[] = [];
afterEach(async () => {
  await Promise.all(factories.splice(0).map(async (factory) => factory.dispose()));
});
const gate = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const creator = { id: "creator", revision: 1 };
const reader = { id: "reader", revision: 1 };
const constraint = { id: "required", revision: 1 };
const type = { key: "review", version: 1 };
const rules = { admitted: { policies: [creator, reader], namespaces: [] }, mandatory: [] };
const namespaceRules = { admitted: { policies: [], namespaces: [{ name: "review.namespace", revision: 1 }] }, mandatory: [] };
const compiler = (namespace = false, resolve = () => [creator, reader], mandatory = false) => {
  const definitions = [
    { ...creator, operations: { invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: ["senior"] } } } } }, challenge: { required: false } },
    { ...reader, operations: { invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: ["junior"] } } } } }, challenge: { required: false } },
  ];
  if (mandatory) definitions.push({ ...constraint, operations: { invoke: { actor: { mode: "roles", actors: { user: { anyOf: ["must"] } } } } }, challenge: { required: false } });
  return createToolPolicyFactory({ ...(namespace ? { namespaces: [{ name: "review.namespace", revision: 1, policies: definitions, resolve }] } : { policies: definitions }),
    bindings: [{ sessionType: type, providerId: "finite", ...(namespace ? namespaceRules : rules), mandatory: mandatory ? [constraint] : [] }],
  });
};
const tools: ToolCatalogue = { list: () => [], get: () => undefined, validateInput: () => ({ status: "valid" }), validateOutput: () => ({ status: "schema-not-declared" }) };
const caller = (subject = "alice"): SessionCreationContext => ({ context: {
  actor: { kind: "user", principal: { domainId: "local", subject } }, connectionId: `connection-${subject}`, authRevision: "auth",
}, connectionId: `connection-${subject}`, connectionGeneration: 1, validUntil: Date.now() + 60000, signal: new AbortController().signal, isCurrent: () => true });
const allow = (request: SessionCreationFacts) => ({ effect: "allow" as const, request,
  bootstrap: request.bootstrap === undefined
    ? { kind: "none" as const }
    : { kind: "template" as const, id: request.bootstrap.id, revision: request.bootstrap.revision,
        bindings: request.bootstrap.bindings.map((entry) => ({ key: entry.key, lifetimeMs: 30000 })),
      }, validUntil: Date.now() + 30000, isCurrent: () => true, release: vi.fn(),
});
const capability = (factory: SessionsFactory) => {
  if (factory.authorization === undefined) throw new Error("Missing protected SDK capability");
  return factory.authorization;
};
const fixture = (options: { prepare?: (request: SessionCreationFacts) => Promise<SessionCreationApproval>; backend?: SessionProvider["startSession"]; entries?: number; template?: boolean; registry?: (registry: ReferenceAuthorizer) => ReferenceAuthorizer; limit?: number; deadline?: number;
  registryFactory?: () => SessionRegistry; extraTypes?: readonly ApplicationSessionType[]; limits?: Partial<SessionCreationSecurityOptions>; namespace?: boolean; mandatory?: boolean; now?: () => Date;
} = {}) => {
  const namespaceResolve = vi.fn(() => [creator, reader]);
  const policies = compiler(options.namespace, namespaceResolve, options.mandatory);
  const canonical = createReferenceAuthorizer({ policies, now: Date.now });
  const installed = vi.spyOn(canonical, "installBinding");
  const registry = options.registry?.(canonical) ?? canonical;
  const requests: SessionCreationFacts[] = [];
  const prepare = vi.fn(async ({ request }: { request: SessionCreationFacts; signal: AbortSignal }) => {
    requests.push(request);
    if (options.prepare !== undefined) return options.prepare(request);
    if (request.caller.actor.principal.domainId !== "local" || !["alice", "bob"].includes(request.caller.actor.principal.subject)
      || request.type.key !== "review" || request.type.providerId !== "finite" || request.capability.key !== "create-review") return { effect: "deny" as const, release: vi.fn() };
    return allow(request);
  });
  const parse = vi.fn((config: Readonly<Record<string, unknown>>) => ({ ...config }));
  const registration = {
    definition: { id: "22222222-2222-4222-8222-222222222222", ...type, providerId: "finite", configSchema: { type: "object" as const, properties: {} }, tools: [] },
    enabledForCreation: true,
    config: { schema: { type: "object" as const, properties: {} }, parse },
    policy: { rules: { ...(options.namespace === true ? namespaceRules : rules), mandatory: options.mandatory === true ? [constraint] : [] }, creation: { capability: { key: "create-review", revision: 1 }, prepare },
      ...(options.template === false
        ? {}
        : { creatorBootstrap: { id: "review-creator", revision: 1, bindings: Array.from({ length: options.entries ?? 1 }, (_, index) => ({
            key: `entry-${String(index)}`, purpose: "admitted" as const, roles: ["senior"], policies: [creator], authority: { kind: "host-policy" as const, policy: creator }, maxLifetimeMs: 60000,
          })) } }),
    } satisfies SessionTypePolicyRegistration,
  };
  const start = vi.fn(options.backend ?? (() => Promise.resolve({ dispose: vi.fn() })));
  const provider: SessionProvider = { providerId: "finite", agentInfo: { ...mockProvider.agentInfo, provider: "finite" }, startSession: start };
  const catalogue = createSessionTypeCatalogue({ tools, types: [registration, ...(options.extraTypes ?? [])] });
  const factory = createSessionsFactory({ providers: [provider], application: { catalogue, defaultType: type },
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.registryFactory === undefined ? {} : { registryFactory: options.registryFactory }), creationSecurity: { ...options.limits, registry, policies,
      ...(options.limit === undefined ? {} : { maxCreationInputBytes: options.limit }), ...(options.deadline === undefined ? {} : { prepareDeadlineMs: options.deadline }),
    } });
  factories.push(factory);
  const events: string[] = [];
  factory.onCatalogueNotification((event) => {
    events.push(event.method);
  });
  factory.onSessionEnvelope((event) => {
    events.push(event.action.type);
  });
  return { factory, auth: capability(factory), registry, canonical, policies, requests, prepare, start, events, registration, provider, installed, parse, catalogue, namespaceResolve };
};
const installedFor = (f: ReturnType<typeof fixture>, ref: ResourceRef) => {
  const grant = f.installed.mock.calls.map(([binding]) => binding).find((binding) => binding.scope.instanceId === ref.instanceId);
  if (grant === undefined) throw new Error("Missing genuine materialized bootstrap");
  return grant;
};
const evaluate = (registry: ReferenceAuthorizer, scope: ResourceRef, bindingId: string, subject = "alice", policyRef = creator) => registry.evaluate({
  actor: caller(subject).context, operation: "invoke", scope, route: { origin: scope, targets: [scope] }, bindingId, policyRef,
});

describe("P05 protected creation", () => {
  it("S02 exact capability approval commits immutable actual owner/bootstrap without native cursor permission", async () => {
    const f = fixture();
    await f.auth.createSession({ channel: "ahp-session:/approved", owner: "mallory", role: "admin" }, caller());
    const ref = f.auth.getResource("ahp-session:/approved");
    expect(ref).toBeDefined();
    if (ref === undefined) throw new Error("Missing committed ref");
    expect(f.registry.owner(ref)).toEqual({ domainId: "local", subject: "alice" });
    expect(f.requests[0]?.candidate).toEqual(ref);
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.events.indexOf("root/sessionAdded")).toBeLessThan(f.events.indexOf("session/ready"));
    expect(Object.isFrozen(f.requests[0])).toBe(true);
  });

  it("S02 protected legacy context-free create cannot bypass approval", async () => {
    const f = fixture();
    await expect(f.factory.createSession({ channel: "ahp-session:/bypass" })).rejects.toThrow();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.factory.listSessionSnapshots()).toEqual([]);
  });

  for (const kind of ["deny", "copy", "extra", "none", "expired", "promise-current"] as const) {
    it(`S02 ${kind} approval never attaches owner/record/backend`, async () => {
      const f = fixture({ prepare: (request) => {
        if (kind === "deny") return Promise.resolve({ effect: "deny", release: vi.fn() });
        const approval = allow(request);
        if (kind === "copy") Reflect.set(approval, "request", structuredClone(request));
        if (kind === "extra") Reflect.set(approval, "owner", "mallory");
        if (kind === "none") Reflect.set(approval, "bootstrap", { kind: "none" });
        if (kind === "expired") Reflect.set(approval, "validUntil", Date.now() - 1);
        if (kind === "promise-current") Reflect.set(approval, "isCurrent", () => Promise.resolve(true));
        return Promise.resolve(approval);
      } });
      await expect(f.auth.createSession({ channel: "ahp-session:/rejected" }, caller())).rejects.toThrow();
      expect(f.auth.getResource("ahp-session:/rejected")).toBeUndefined();
      expect(f.factory.listSessionSnapshots()).toEqual([]);
      expect(f.start).not.toHaveBeenCalled();
      expect(f.events).toEqual([]);
    });
  }

  it("S02 optional no-template still requires explicit none approval", async () => {
    const f = fixture({ template: false });
    await f.auth.createSession({ channel: "ahp-session:/none" }, caller());
    expect(f.auth.getResource("ahp-session:/none")).toBeDefined();
  });

  it("S03 observers see the already installed canonical owner at first publication", async () => {
    const f = fixture();
    const owners: unknown[] = [];
    f.factory.onCatalogueNotification((event) => {
      if (event.method !== "root/sessionAdded") return;
      const ref = f.auth.getResource(event.params.summary.resource);
      owners.push(ref === undefined ? undefined : f.registry.owner(ref));
    });
    await f.auth.createSession({ channel: "ahp-session:/atomic" }, caller());
    expect(owners).toEqual([{ domainId: "local", subject: "alice" }]);
  });

  it("S03 second bootstrap install failure rolls back exactly before publication and permits URI reuse", async () => {
    let count = 0;
    const f = fixture({ entries: 2, registry: (registry) => ({ ...registry, installBinding: (binding, installation) => {
      count += 1;
      if (count === 2) throw new Error("second install fault");
      registry.installBinding(binding, installation);
    } }) });
    await expect(f.auth.createSession({ channel: "ahp-session:/rollback" }, caller())).rejects.toThrow("second install");
    expect(f.events).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    const failed = f.requests[0]?.candidate;
    if (failed === undefined) throw new Error("Missing candidate");
    expect(f.registry.owner(failed)).toBeUndefined();
    await f.auth.createSession({ channel: "ahp-session:/rollback" }, caller("bob"));
    const ref = f.auth.getResource("ahp-session:/rollback");
    if (ref === undefined) throw new Error("Missing successor");
    expect(ref.instanceId).not.toBe(failed.instanceId);
    expect(f.registry.owner(ref)?.subject).toBe("bob");
  });

  it("S04 one invisible reservation rejects concurrent same-URI creation and cancellation releases late results", async () => {
    const pending = gate<SessionCreationApproval>();
    const entered = gate<SessionCreationFacts>();
    const f = fixture({ prepare: (request) => {
      entered.resolve(request);
      return pending.promise;
    } });
    const abort = new AbortController();
    const first = f.auth.createSession({ channel: "ahp-session:/race" }, { ...caller(), signal: abort.signal });
    const request = await entered.promise;
    expect(f.auth.getResource(request.candidate.id)).toBeUndefined();
    expect(f.factory.listSessionSnapshots()).toEqual([]);
    await expect(f.auth.createSession({ channel: request.candidate.id }, caller("bob"))).rejects.toThrow();
    abort.abort();
    await expect(first).rejects.toThrow();
    const late = allow(request);
    pending.resolve(late);
    await vi.waitFor(() => {
      expect(late.release).toHaveBeenCalledOnce();
    });
    expect(f.start).not.toHaveBeenCalled();
    expect(f.registry.owner(request.candidate)).toBeUndefined();
  });

  it("S02 URI512 is usable and URI513 is rejected before approval or effects", async () => {
    const f = fixture();
    const atLimit = `ahp-session:/${"a".repeat(512 - "ahp-session:/".length)}`;
    await f.auth.createSession({ channel: atLimit }, caller());
    const count = f.prepare.mock.calls.length;
    await expect(f.auth.createSession({ channel: `${atLimit}b` }, caller())).rejects.toThrow();
    expect(f.prepare).toHaveBeenCalledTimes(count);
    expect(f.factory.listSessionSnapshots()).toHaveLength(1);
  });

  it("S02 unknown header/provider and over-budget input never call approval", async () => {
    const f = fixture({ limit: 256 });
    for (const params of [{ channel: "ahp-session:/unknown", config: { [SESSION_TYPE_SELECTOR_KEY]: "missing" } },
      { channel: "ahp-session:/wrong", provider: "other" }, { channel: "ahp-session:/large", config: { data: "x".repeat(257) } }]) {
      await expect(f.auth.createSession(params, caller())).rejects.toThrow();
    }
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });

  it("S01 senior and junior evaluate their own complete bindings while canonical owner stays senior", async () => {
    const f = fixture();
    const uri = "ahp-session:/distinct";
    await f.auth.createSession({ channel: uri }, caller());
    const ref = f.auth.getResource(uri);
    if (ref === undefined) throw new Error("Missing scope");
    const senior = installedFor(f, ref);
    f.registry.installBinding({ id: "fixture-junior", actor: caller("bob").context.actor, scope: ref, roles: ["junior"], policies: [reader], authority: { kind: "host-policy", policy: reader }, revision: 1 });
    expect((await evaluate(f.registry, ref, senior.id)).decision.effect).toBe("allow");
    expect((await evaluate(f.registry, ref, "fixture-junior", "bob", reader)).decision.effect).toBe("allow");
    expect((await evaluate(f.registry, ref, senior.id, "bob")).decision.effect).toBe("deny");
    expect((await evaluate(f.registry, ref, "fixture-junior", "bob", creator)).decision.effect).toBe("deny");
    expect(f.registry.owner(ref)).toEqual(caller().context.actor.principal);
  });

  it("P05-1 mismatched equivalent or different-semantics compilers fail before allocation/admissions and preserve currentness", async () => {
    const f = fixture();
    await f.auth.createSession({ channel: "ahp-session:/prior" }, caller());
    const ref = f.auth.getResource("ahp-session:/prior");
    if (ref === undefined) throw new Error("Missing current scope");
    const before = await evaluate(f.registry, ref, installedFor(f, ref).id);
    expect(before.decision.effect).toBe("allow");
    const allocate = vi.fn(createInMemorySessionRegistry);
    const admissions = vi.spyOn(f.registry, "installAdmission");
    const other = createToolPolicyFactory({ policies: [creator, reader].map((policy) => ({ ...policy,
      operations: { invoke: { actor: { mode: "direct-grant" as const, actors: ["agent" as const] } } }, challenge: { required: false },
    })), bindings: [{ sessionType: type, providerId: "finite", ...rules }] });
    for (const policies of [compiler(), other]) expect(() => createSessionsFactory({ providers: [f.provider], registryFactory: allocate,
      application: { catalogue: f.catalogue, defaultType: type }, creationSecurity: { registry: f.registry, policies },
    })).toThrow(/compiler identity/);
    expect(allocate).not.toHaveBeenCalled();
    expect(admissions).not.toHaveBeenCalled();
    expect(f.registry.matches(before.stamp, caller().context)).toBe(true);
  });

  it("S02 global role/filter and policy registration without security are rejected before allocation", () => {
    const f = fixture();
    const allocate = vi.fn(createInMemorySessionRegistry);
    for (const application of [{ catalogue: f.catalogue, role: "admin" as const }, { catalogue: f.catalogue, authorizedTools: new Map() }]) {
      expect(() => createSessionsFactory({ providers: [f.provider], registryFactory: allocate, application, creationSecurity: { registry: f.registry, policies: f.policies } })).toThrow();
    }
    expect(() => createSessionsFactory({ providers: [f.provider], registryFactory: allocate, application: { catalogue: f.catalogue } })).toThrow(/require protected/);
    expect(allocate).not.toHaveBeenCalled();
  });

  it("S02 invoke allow cannot substitute for a later denied creation capability", async () => {
    let permitted = true;
    const f = fixture({ prepare: (request) => Promise.resolve(permitted ? allow(request) : { effect: "deny", release: vi.fn() }) });
    await f.auth.createSession({ channel: "ahp-session:/existing-invoke" }, caller());
    const ref = f.auth.getResource("ahp-session:/existing-invoke");
    if (ref === undefined) throw new Error("Missing prior scope");
    expect((await evaluate(f.registry, ref, installedFor(f, ref).id)).decision.effect).toBe("allow");
    permitted = false;
    await expect(f.auth.createSession({ channel: "ahp-session:/no-create" }, caller())).rejects.toThrow();
    expect(f.auth.getResource("ahp-session:/no-create")).toBeUndefined();
    expect(f.start).toHaveBeenCalledOnce();
  });

  it("S02 parser/provider/callback/template mutation after capture cannot widen or reroute creation", async () => {
    const entered = gate<SessionCreationFacts>();
    const parked = gate<SessionCreationApproval>();
    const f = fixture({ prepare: (request) => {
      entered.resolve(request);
      return parked.promise;
    } });
    const replacement = vi.fn(() => Promise.resolve({ dispose: vi.fn() }));
    const changedPrepare = vi.fn(() => Promise.resolve({ effect: "deny" as const, release: vi.fn() }));
    const changedParse = vi.fn(() => ({ promoted: true }));
    Reflect.set(f.provider, "startSession", replacement);
    Reflect.set(f.registration.config, "parse", changedParse);
    Reflect.set(f.registration.policy.creation, "prepare", changedPrepare);
    Reflect.set(f.registration.definition, "key", "forged");
    const sourceTemplate = f.registration.policy.creatorBootstrap;
    if (sourceTemplate === undefined) throw new Error("Missing source template");
    sourceTemplate.bindings[0]?.roles.push("admin");
    const raw = { channel: "ahp-session:/captured", config: { value: "original" } };
    const creating = f.auth.createSession(raw, caller());
    const request = await entered.promise;
    raw.config.value = "mutated";
    expect(request.type.key).toBe("review");
    expect(request.config).toEqual({ value: "original" });
    expect(request.bootstrap?.bindings[0]?.roles).toEqual(["senior"]);
    parked.resolve(allow(request));
    await creating;
    const ref = f.auth.getResource(raw.channel);
    if (ref === undefined) throw new Error("Missing captured resource");
    expect(installedFor(f, ref).roles).toEqual(["senior"]);
    expect(replacement).not.toHaveBeenCalled();
    expect(changedPrepare).not.toHaveBeenCalled();
    expect(changedParse).not.toHaveBeenCalled();
    expect(f.parse).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.catalogue.list())).not.toMatch(/creatorBootstrap|prepare|create-review/);
  });

  it("S02 malformed template approval keys and lifetimes never attach", async () => {
    for (const invalid of ["wrong-id", "wrong-revision", "missing", "extra-key", "duplicate", "too-long", "nonpositive", "extra-role"] as const) {
      const f = fixture({ prepare: (request) => {
        const result = allow(request);
        if (result.bootstrap.kind !== "template") throw new Error("Invalid positive fixture");
        const entries = result.bootstrap.bindings.map((entry) => ({ ...entry }));
        if (invalid === "wrong-id") Reflect.set(result.bootstrap, "id", "other");
        if (invalid === "wrong-revision") Reflect.set(result.bootstrap, "revision", 2);
        if (invalid === "missing") entries.length = 0;
        if (invalid === "extra-key") entries.push({ key: "other", lifetimeMs: 100 });
        if (invalid === "duplicate" && entries[0] !== undefined) entries.push(entries[0]);
        if (invalid === "too-long" && entries[0] !== undefined) entries[0].lifetimeMs = 60001;
        if (invalid === "nonpositive" && entries[0] !== undefined) entries[0].lifetimeMs = 0;
        if (invalid === "extra-role" && entries[0] !== undefined) Reflect.set(entries[0], "roles", ["admin"]);
        Reflect.set(result.bootstrap, "bindings", entries);
        return Promise.resolve(result);
      } });
      await expect(f.auth.createSession({ channel: `ahp-session:/${invalid}` }, caller())).rejects.toThrow();
      expect(f.factory.listSessionSnapshots()).toEqual([]);
      expect(f.start).not.toHaveBeenCalled();
    }
  });

  it("S02 1MiB exact JSON input is accepted; one over and larger configured ceilings reject", async () => {
    const f = fixture();
    const base = { channel: "ahp-session:/byte-limit", config: { text: "" } };
    const overhead = Buffer.byteLength(JSON.stringify(base));
    base.config.text = "x".repeat(CREATION_INPUT_BYTES - overhead);
    await f.auth.createSession(base, caller());
    const parseCount = f.parse.mock.calls.length;
    base.config.text += "x";
    await expect(f.auth.createSession(base, caller())).rejects.toThrow();
    expect(f.parse).toHaveBeenCalledTimes(parseCount);
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(() => fixture({ limit: CREATION_INPUT_BYTES + 1 })).toThrow(/creation limit/);
  });

  for (const mode of ["abort", "timeout", "dispose"] as const) {
    for (const late of ["allow", "reject"] as const) {
      it(`S04 ${mode} cancels an ignored preparation; late ${late} cannot touch a same-URI successor`, async () => {
        const first = gate<SessionCreationApproval>();
        const entered = gate<SessionCreationFacts>();
        let count = 0;
        const f = fixture({ deadline: 30, prepare: (request) => {
          count += 1;
          if (count === 1) {
            entered.resolve(request);
            return first.promise;
          }
          return Promise.resolve(allow(request));
        } });
        const signal = new AbortController();
        const operation = f.auth.createSession({ channel: "ahp-session:/same" }, { ...caller(), signal: signal.signal }).then(() => "created", () => "cancelled");
        const old = await entered.promise;
        if (mode === "abort") signal.abort();
        if (mode === "dispose") await f.factory.dispose();
        expect(await operation).toBe("cancelled");
        await f.auth.createSession({ channel: old.candidate.id }, caller("bob"));
        const successor = f.auth.getResource(old.candidate.id);
        if (successor === undefined) throw new Error("Missing successor");
        expect(successor.instanceId).not.toBe(old.candidate.instanceId);
        const decision = await evaluate(f.registry, successor, installedFor(f, successor).id, "bob");
        expect(decision.decision.effect).toBe("allow");
        const events = f.events.length;
        const result = allow(old);
        if (late === "allow") first.resolve(result);
        else first.reject(new Error("late ignored rejection"));
        if (late === "allow") await vi.waitFor(() => {
          expect(result.release).toHaveBeenCalledOnce();
        });
        else await Promise.resolve();
        expect(f.auth.getResource(old.candidate.id)).toEqual(successor);
        expect(f.registry.owner(successor)?.subject).toBe("bob");
        expect(f.registry.matches(decision.stamp, caller("bob").context)).toBe(true);
        expect(f.registry.owner(old.candidate)).toBeUndefined();
        expect(f.events).toHaveLength(events);
      });
    }
  }

  it("S04 reentrant final guard cannot attach after synchronously disposing its factory", async () => {
    let dispose = () => Promise.resolve();
    const f = fixture({ prepare: (request) => {
      const approval = allow(request);
      Reflect.set(approval, "isCurrent", () => {
        void dispose();
        return true;
      });
      return Promise.resolve(approval);
    } });
    dispose = () => f.factory.dispose();
    await expect(f.auth.createSession({ channel: "ahp-session:/reentrant" }, caller())).rejects.toThrow();
    expect(f.factory.listSessionSnapshots()).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });

  it("S04 stale backend readiness cannot publish or clear a different-owner same-URI successor", async () => {
    const started = gate<undefined>();
    const backend = gate<SessionBackend>();
    let starts = 0;
    const f = fixture({ backend: () => {
      starts += 1;
      if (starts === 1) {
        started.resolve(undefined);
        return backend.promise;
      }
      return Promise.resolve({ dispose: vi.fn() });
    } });
    const oldCreate = f.auth.createSession({ channel: "ahp-session:/backend-race" }, caller());
    await started.promise;
    const old = f.auth.getResource("ahp-session:/backend-race");
    if (old === undefined) throw new Error("Missing old resource");
    expect(await f.auth.disposeSession(old)).toBe(true);
    await f.auth.createSession({ channel: old.id }, caller("bob"));
    const next = f.auth.getResource(old.id);
    if (next === undefined) throw new Error("Missing next resource");
    const decision = await evaluate(f.registry, next, installedFor(f, next).id, "bob");
    const count = f.events.length;
    const release = vi.fn();
    backend.resolve({ dispose: release });
    await oldCreate;
    expect(release).toHaveBeenCalledOnce();
    expect(f.events).toHaveLength(count);
    expect(f.registry.matches(decision.stamp, caller("bob").context)).toBe(true);
    expect(await f.auth.disposeSession(old)).toBe(false);
    expect(f.registry.owner(next)?.subject).toBe("bob");
  });

  it("S05 failed backend retains owner and inspectable record, invalidating bootstrap before failure publication", async () => {
    const started = gate<undefined>();
    const backend = gate<SessionBackend>();
    const f = fixture({ backend: () => {
      started.resolve(undefined);
      return backend.promise;
    } });
    const creating = f.auth.createSession({ channel: "ahp-session:/failed" }, caller());
    await started.promise;
    const ref = f.auth.getResource("ahp-session:/failed");
    if (ref === undefined) throw new Error("Missing attached failed candidate");
    const bootstrap = installedFor(f, ref);
    const before = await evaluate(f.registry, ref, bootstrap.id);
    expect(before.decision.effect).toBe("allow");
    const observations: unknown[] = [];
    f.factory.onSessionEnvelope((event) => {
      if (event.action.type === ACTION_TYPE_SESSION_CREATION_FAILED) observations.push({ owner: f.registry.owner(ref), current: f.registry.matches(before.stamp, caller().context) });
    });
    backend.reject(new Error("private backend failure"));
    await creating;
    expect(observations).toEqual([{ owner: caller().context.actor.principal, current: false }]);
    expect(f.factory.getSessionSnapshot(ref.id)?.state.lifecycle).toBe("failed");
    expect(f.auth.getResource(ref.id)).toEqual(ref);
    expect((await evaluate(f.registry, ref, bootstrap.id)).decision.effect).toBe("deny");
    expect(f.registry.owner(ref)).toEqual(caller().context.actor.principal);
  });

  it("S05 expected disposal removes canonical owner immediately but retains an owner-free settle exclusion until failure completes", async () => {
    const disposal = gate<undefined>();
    const f = fixture({ backend: () => Promise.resolve({ dispose: () => disposal.promise }) });
    const uri = "ahp-session:/settling";
    await f.auth.createSession({ channel: uri }, caller());
    const ref = f.auth.getResource(uri);
    if (ref === undefined) throw new Error("Missing attached resource");
    const mutableExpected = { ...ref };
    const disposing = f.auth.disposeSession(mutableExpected);
    mutableExpected.id = "ahp-session:/retarget-attempt";
    expect(f.auth.getResource(uri)).toBeUndefined();
    expect(f.registry.owner(ref)).toBeUndefined();
    expect(f.auth.isSettling(uri)).toBe(true);
    await expect(f.auth.createSession({ channel: uri }, caller("bob"))).rejects.toThrow();
    disposal.reject(new Error("private disposal detail"));
    await expect(disposing).rejects.toThrow("failed to dispose");
    expect(f.auth.isSettling(uri)).toBe(false);
    expect(await f.auth.disposeSession(ref)).toBe(false);
  });

  it("S05 unexpected bootstrap withdrawal failure is surfaced without publishing a false cleanup/failure", async () => {
    const f = fixture({ backend: () => Promise.reject(new Error("backend")), registry: (registry) => ({ ...registry, removeInstalledBinding: () => {
      throw new Error("withdraw fault");
    } }) });
    await expect(f.auth.createSession({ channel: "ahp-session:/withdraw-fault" }, caller())).rejects.toThrow("withdraw fault");
    expect(f.events).not.toContain("session/creationFailed");
    const ref = f.auth.getResource("ahp-session:/withdraw-fault");
    if (ref === undefined) throw new Error("Missing quarantined record");
    expect(f.registry.owner(ref)?.subject).toBe("alice");
    expect(f.factory.getSessionSnapshot(ref.id)?.state.lifecycle).toBe("creating");
  });

  it("S02 namespace closure is an admission ceiling, never default creation approval or resolver invocation", async () => {
    const denied = fixture({ namespace: true, prepare: () => Promise.resolve({ effect: "deny", release: vi.fn() }) });
    await expect(denied.auth.createSession({ channel: "ahp-session:/namespace-denied" }, caller())).rejects.toThrow();
    expect(denied.prepare).toHaveBeenCalledOnce();
    expect(denied.namespaceResolve).not.toHaveBeenCalled();
    expect(denied.factory.listSessionSnapshots()).toEqual([]);
    const positive = fixture({ namespace: true });
    await positive.auth.createSession({ channel: "ahp-session:/namespace-approved" }, caller());
    const ref = positive.auth.getResource("ahp-session:/namespace-approved");
    if (ref === undefined) throw new Error("Missing namespace admitted resource");
    expect((await evaluate(positive.registry, ref, installedFor(positive, ref).id)).decision.effect).toBe("allow");
    expect(positive.namespaceResolve).not.toHaveBeenCalled();
  });

  it("S02 disabled, ambiguous enabled revisions, and policy-free registered types cannot reach approval", async () => {
    const base = { definition: { id: "33333333-3333-4333-8333-333333333333", key: "disabled", version: 1, providerId: "finite", configSchema: { type: "object" as const, properties: {} }, tools: [] },
      config: { schema: { type: "object" as const, properties: {} }, parse: () => ({}) }, enabledForCreation: false,
    };
    const other = { ...base, definition: { ...base.definition, id: "44444444-4444-4444-8444-444444444444", key: "no-policy" }, enabledForCreation: true };
    const newer = { ...base, definition: { ...base.definition, id: "55555555-5555-4555-8555-555555555555", key: "review", version: 2 }, enabledForCreation: true };
    const f = fixture({ extraTypes: [base, other, newer] });
    for (const key of ["disabled", "no-policy", "review", "review@2"]) {
      await expect(f.auth.createSession({ channel: `ahp-session:/${key}`, config: { [SESSION_TYPE_SELECTOR_KEY]: key } }, caller())).rejects.toThrow();
    }
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    // Exact configured default still selects v1, never inferred latest/ambiguous v2.
    await f.auth.createSession({ channel: "ahp-session:/exact-default" }, caller());
    expect(f.requests[0]?.type.version).toBe(1);
  });

  for (const fault of ["record", "resource"] as const) {
    it(`S03 ${fault} attach fault has no publication/backend/owner and releases the URI`, async () => {
      const store = createInMemorySessionRegistry();
      let failed = false;
      const add = store.add.bind(store);
      const f = fixture({ registryFactory: () => ({ ...store, add: (record) => {
        add(record);
        if (fault === "record" && !failed) {
          failed = true;
          throw new Error("record attach fault");
        }
      } }), registry: (registry) => ({ ...registry, installResource: (resource, installation) => {
        registry.installResource(resource, installation);
        if (fault === "resource" && !failed) {
          failed = true;
          throw new Error("resource attach fault");
        }
      } }) });
      await expect(f.auth.createSession({ channel: "ahp-session:/fault" }, caller())).rejects.toThrow(/attach fault/);
      const first = f.requests[0];
      if (first === undefined) throw new Error("Missing attempted attach");
      expect(f.registry.owner(first.candidate)).toBeUndefined();
      expect(f.factory.listSessionSnapshots()).toEqual([]);
      expect(f.events).toEqual([]);
      expect(f.start).not.toHaveBeenCalled();
      await f.auth.createSession({ channel: first.candidate.id }, caller("bob"));
      expect(f.auth.getResource(first.candidate.id)?.instanceId).not.toBe(first.candidate.instanceId);
    });
  }

  it("S03 preexisting full-ref owner collision denies before approval and never tears down the incumbent", async () => {
    let collision: ResourceRef | undefined;
    const teardown = vi.fn();
    const f = fixture({ registry: (registry) => ({ ...registry, owner: (ref) => {
      // Controlled nonce-collision preload at the authoritative lookup boundary.
      collision = ref;
      registry.installResource({ resource: ref, owner: caller("bob").context.actor.principal, route: { origin: ref, targets: [ref] }, externalAuthority: "none" });
      return registry.owner(ref);
    }, teardownInstalledResource: teardown }) });
    await expect(f.auth.createSession({ channel: "ahp-session:/collision" }, caller())).rejects.toThrow();
    if (collision === undefined) throw new Error("Missing collision probe");
    expect(f.canonical.owner(collision)?.subject).toBe("bob");
    expect(teardown).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });

  it("S04 expected-instance pending disposal cancels just that invisible reservation", async () => {
    const entered = gate<SessionCreationFacts>();
    const parked = gate<SessionCreationApproval>();
    const f = fixture({ prepare: (request) => {
      entered.resolve(request);
      return parked.promise;
    } });
    const pending = f.auth.createSession({ channel: "ahp-session:/pending-dispose" }, caller()).then(() => "created", () => "cancelled");
    const request = await entered.promise;
    expect(await f.auth.disposeSession({ ...request.candidate, instanceId: "wrong" })).toBe(false);
    expect(await f.auth.disposeSession(request.candidate)).toBe(true);
    expect(await pending).toBe("cancelled");
    const result = allow(request);
    parked.resolve(result);
    await vi.waitFor(() => {
      expect(result.release).toHaveBeenCalledOnce();
    });
    expect(f.events).toEqual([]);
    expect(f.registry.owner(request.candidate)).toBeUndefined();
  });

  it("S04 pending capacity rejects before a second approval and context-fence/Promise guards fail closed", async () => {
    const entered = gate<SessionCreationFacts>();
    const parked = gate<SessionCreationApproval>();
    const f = fixture({ limits: { maxPendingCreates: 1 }, prepare: (request) => {
      entered.resolve(request);
      return parked.promise;
    } });
    const pending = f.auth.createSession({ channel: "ahp-session:/capacity-one" }, caller()).then(() => "created", () => "cancelled");
    const request = await entered.promise;
    await expect(f.auth.createSession({ channel: "ahp-session:/capacity-two" }, caller())).rejects.toThrow();
    expect(f.prepare).toHaveBeenCalledOnce();
    await f.factory.dispose();
    expect(await pending).toBe("cancelled");
    parked.resolve(allow(request));
    for (const bad of [{ ...caller(), connectionId: "mismatch" }, { ...caller(), connectionGeneration: 0 },
      { ...caller(), validUntil: Date.now() - 1 }, { ...caller(), isCurrent: () => false }]) {
      await expect(f.auth.createSession({ channel: "ahp-session:/bad-fence" }, bad)).rejects.toThrow();
    }
    const promised = caller();
    Reflect.set(promised, "isCurrent", () => Promise.resolve(true));
    await expect(f.auth.createSession({ channel: "ahp-session:/promised" }, promised)).rejects.toThrow();
    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it("S02 approval guard mutation cannot replace its captured release callback", async () => {
    const original = vi.fn();
    const replacement = vi.fn();
    const f = fixture({ prepare: (request) => {
      const result = allow(request);
      Reflect.set(result, "release", original);
      Reflect.set(result, "isCurrent", () => {
        Reflect.set(result, "release", replacement);
        return true;
      });
      return Promise.resolve(result);
    } });
    await f.auth.createSession({ channel: "ahp-session:/release-capture" }, caller());
    expect(original).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("S04 same-subject backend rejection cannot mark a same-URI successor failed or stale", async () => {
    const started = gate<undefined>();
    const backend = gate<SessionBackend>();
    let starts = 0;
    const f = fixture({ backend: () => {
      starts += 1;
      if (starts === 1) {
        started.resolve(undefined);
        return backend.promise;
      }
      return Promise.resolve({ dispose: vi.fn() });
    } });
    const old = f.auth.createSession({ channel: "ahp-session:/same-owner" }, caller());
    await started.promise;
    const ref = f.auth.getResource("ahp-session:/same-owner");
    if (ref === undefined) throw new Error("Missing old instance");
    await f.auth.disposeSession(ref);
    await f.auth.createSession({ channel: ref.id }, caller());
    const successor = f.auth.getResource(ref.id);
    if (successor === undefined) throw new Error("Missing successor");
    const decision = await evaluate(f.registry, successor, installedFor(f, successor).id);
    const eventCount = f.events.length;
    backend.reject(new Error("old backend rejection"));
    await old;
    expect(f.factory.getSessionSnapshot(ref.id)?.state.lifecycle).toBe("ready");
    expect(f.events).toHaveLength(eventCount);
    expect(f.registry.matches(decision.stamp, caller().context)).toBe(true);
    expect(await f.auth.disposeSession(ref)).toBe(false);
  });

  it("S04 reentrant backend cleanup cannot clear the active global disposal barrier", async () => {
    const release = gate<undefined>();
    let reenter = () => Promise.resolve();
    let calls = 0;
    const f = fixture({ backend: () => Promise.resolve({ dispose: () => {
      calls += 1;
      if (calls === 1) void reenter();
      return release.promise;
    } }) });
    reenter = () => f.factory.dispose();
    await f.auth.createSession({ channel: "ahp-session:/before-shutdown" }, caller());
    const disposing = f.factory.dispose();
    await Promise.resolve();
    await Promise.resolve();
    try {
      await expect(f.auth.createSession({ channel: "ahp-session:/during-shutdown" }, caller())).rejects.toThrow();
      expect(f.auth.getResource("ahp-session:/during-shutdown")).toBeUndefined();
      expect(f.prepare).toHaveBeenCalledOnce();
    } finally {
      release.resolve(undefined);
      await disposing;
    }
  });

  it("S02 caller generation is captured before callbacks and cannot be retargeted by source-container mutation", async () => {
    const f = fixture();
    const context = caller();
    Reflect.set(context, "isCurrent", () => {
      Reflect.set(context, "connectionGeneration", 77);
      return true;
    });
    await f.auth.createSession({ channel: "ahp-session:/captured-fence" }, context);
    expect(f.requests[0]?.connectionGeneration).toBe(1);
    expect(f.requests[0]?.caller.connectionId).toBe("connection-alice");
  });

  it("S02 an actual previously accepted SDK approval cannot be replayed for another attempt", async () => {
    let issued: SessionCreationApproval | undefined;
    const f = fixture({ prepare: (request) => {
      issued ??= allow(request);
      return Promise.resolve(issued);
    } });
    await f.auth.createSession({ channel: "ahp-session:/original-approval" }, caller());
    const ref = f.auth.getResource("ahp-session:/original-approval");
    if (ref === undefined) throw new Error("Missing legitimate original creation");
    const before = await evaluate(f.registry, ref, installedFor(f, ref).id);
    expect(before.decision.effect).toBe("allow");
    await expect(f.auth.createSession({ channel: "ahp-session:/replayed-approval" }, caller())).rejects.toThrow();
    expect(f.auth.getResource("ahp-session:/replayed-approval")).toBeUndefined();
    expect(f.registry.matches(before.stamp, caller().context)).toBe(true);
    expect(f.registry.owner(ref)?.subject).toBe("alice");
    expect(f.start).toHaveBeenCalledOnce();
  });

  it("S05 settling capacity denies before deleting a different live resource or calling its backend", async () => {
    const release = gate<undefined>();
    const secondDispose = vi.fn();
    const f = fixture({ limits: { maxSettlingSessions: 1 }, backend: (input) => Promise.resolve({
      dispose: input.sessionUri.endsWith("/one") ? () => release.promise : secondDispose,
    }) });
    await f.auth.createSession({ channel: "ahp-session:/one" }, caller());
    await f.auth.createSession({ channel: "ahp-session:/two" }, caller());
    const one = f.auth.getResource("ahp-session:/one");
    const two = f.auth.getResource("ahp-session:/two");
    if (one === undefined || two === undefined) throw new Error("Missing valid capacity fixtures");
    const disposing = f.auth.disposeSession(one);
    const before = await evaluate(f.registry, two, installedFor(f, two).id);
    expect(before.decision.effect).toBe("allow");
    try {
      await expect(f.auth.disposeSession(two)).rejects.toThrow();
      expect(f.auth.getResource(two.id)).toEqual(two);
      expect(f.registry.owner(two)?.subject).toBe("alice");
      expect(f.registry.matches(before.stamp, caller().context)).toBe(true);
      expect(secondDispose).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      await disposing;
    }
    expect(f.auth.isSettling(one.id)).toBe(false);
    expect(await f.auth.disposeSession(two)).toBe(true);
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it("S02 delayed approval cannot extend bootstrap expiry calculated from preparation time", async () => {
    let clock = Date.now();
    const entered = gate<SessionCreationFacts>();
    const approval = gate<SessionCreationApproval>();
    const f = fixture({ now: () => new Date(clock), prepare: (request) => {
      entered.resolve(request);
      return approval.promise;
    } });
    const creating = f.auth.createSession({ channel: "ahp-session:/binding-expired" }, caller());
    const request = await entered.promise;
    const result = allow(request);
    if (result.bootstrap.kind !== "template") throw new Error("Missing positive template fixture");
    const entry = result.bootstrap.bindings[0];
    if (entry === undefined) throw new Error("Missing complete bootstrap entry");
    entry.lifetimeMs = 1;
    clock += 100;
    approval.resolve(result);
    await expect(creating).rejects.toThrow();
    expect(result.release).toHaveBeenCalledOnce();
    expect(f.registry.owner(request.candidate)).toBeUndefined();
    expect(f.factory.listSessionSnapshots()).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
  });

  it("S02 attached admission retains mandatory restrictions and never promotes them into alternatives", async () => {
    const f = fixture({ mandatory: true });
    await f.auth.createSession({ channel: "ahp-session:/mandatory" }, caller());
    const ref = f.auth.getResource("ahp-session:/mandatory");
    if (ref === undefined) throw new Error("Missing mandatory-linked resource");
    const grant = installedFor(f, ref);
    expect((await evaluate(f.registry, ref, grant.id)).decision.effect).toBe("deny");
    f.registry.installBinding({ id: "test-required", actor: caller().context.actor, scope: ref, roles: ["must"], policies: [constraint], authority: { kind: "host-policy", policy: constraint }, revision: 1 });
    const route = { origin: ref, targets: [ref] };
    const mandatoryBindings = [{ resource: ref, policyRef: constraint, bindingId: "test-required" }];
    expect((await f.registry.evaluate({ actor: caller().context, scope: ref, route, operation: "invoke", bindingId: grant.id, policyRef: creator, mandatoryBindings })).decision.effect).toBe("allow");
    expect((await f.registry.evaluate({ actor: caller().context, scope: ref, route, operation: "invoke", bindingId: "test-required", policyRef: constraint, mandatoryBindings })).decision.effect).toBe("deny");
  });
});

const flushPreparationSettlement = () => new Promise<void>((resolve) => {
  setImmediate(resolve);
});

describe("P05 correction draining preparation capacity", () => {
  for (const cause of ["abort", "timeout", "dispose"] as const) {
    for (const settlement of ["never", "allow", "reject"] as const) {
      it(`P1 max1 ${cause} retains actual unsettled work across reuse until ${settlement}`, async () => {
        const first = gate<SessionCreationApproval>();
        const entered = gate<SessionCreationFacts>();
        let count = 0;
        const f = fixture({ limits: { maxPendingCreates: 1 }, deadline: 25, prepare: (request) => {
          count += 1;
          if (count === 1) {
            entered.resolve(request);
            return first.promise; // Really ignores cancellation; never settles in the never case.
          }
          return Promise.resolve(allow(request));
        } });
        const signal = new AbortController();
        const operation = f.auth.createSession({ channel: "ahp-session:/draining" }, { ...caller(), signal: signal.signal }).then(() => "created", () => "cancelled");
        const request = await entered.promise;
        if (cause === "abort") signal.abort();
        if (cause === "dispose") await f.factory.dispose();
        expect(await operation).toBe("cancelled");
        expect(f.auth.getResource(request.candidate.id)).toBeUndefined();
        for (const channel of [request.candidate.id, "ahp-session:/second", "ahp-session:/third"]) {
          await expect(f.auth.createSession({ channel }, caller("bob"))).rejects.toThrow();
        }
        await f.factory.dispose(); // Prompt, but must not erase occupied work on reuse.
        await expect(f.auth.createSession({ channel: "ahp-session:/after-reuse" }, caller("bob"))).rejects.toThrow();
        expect(f.prepare).toHaveBeenCalledOnce();
        expect(f.start).not.toHaveBeenCalled();
        expect(f.registry.owner(request.candidate)).toBeUndefined();
        if (settlement === "never") return;
        const late = allow(request);
        if (settlement === "allow") first.resolve(late);
        else first.reject(new Error("late draining rejection"));
        await flushPreparationSettlement();
        if (settlement === "allow") expect(late.release).toHaveBeenCalledOnce();
        await f.auth.createSession({ channel: request.candidate.id }, caller("bob"));
        const next = f.auth.getResource(request.candidate.id);
        if (next === undefined) throw new Error("Settlement did not release legitimate capacity");
        expect(f.registry.owner(next)?.subject).toBe("bob");
        expect(f.prepare).toHaveBeenCalledTimes(2);
        expect(f.registry.owner(request.candidate)).toBeUndefined();
      });
    }
  }

  it("P1 URI release is distinct from draining occupancy when another real slot is available", async () => {
    const first = gate<SessionCreationApproval>();
    const entered = gate<SessionCreationFacts>();
    let count = 0;
    const f = fixture({ limits: { maxPendingCreates: 2 }, prepare: (request) => {
      count += 1;
      if (count === 1) {
        entered.resolve(request);
        return first.promise;
      }
      return Promise.resolve(allow(request));
    } });
    const signal = new AbortController();
    const old = f.auth.createSession({ channel: "ahp-session:/released-uri" }, { ...caller(), signal: signal.signal }).then(() => "created", () => "cancelled");
    const request = await entered.promise;
    signal.abort();
    expect(await old).toBe("cancelled");
    await f.auth.createSession({ channel: request.candidate.id }, caller("bob"));
    const next = f.auth.getResource(request.candidate.id);
    if (next === undefined) throw new Error("URI reservation was not released");
    const before = await evaluate(f.registry, next, installedFor(f, next).id, "bob");
    expect(before.decision.effect).toBe("allow");
    const late = allow(request);
    first.resolve(late);
    await flushPreparationSettlement();
    expect(late.release).toHaveBeenCalledOnce();
    expect(f.registry.matches(before.stamp, caller("bob").context)).toBe(true);
    expect(f.auth.getResource(next.id)).toEqual(next);
  });
});

describe("P05 correction atomic constructor admissions", () => {
  for (const remaining of ["review", "second"] as const) {
    it(`P2 cap1/two types leaves the valid old stamp and slot for ${remaining} intact`, async () => {
      const entries = [type, { key: "second", version: 1 }];
      const policies = createToolPolicyFactory({ policies: [creator, reader].map((ref) => ({ ...ref,
        operations: { invoke: { actor: { mode: "roles" as const, actors: { user: { anyOf: ["senior"] } } } } }, challenge: { required: false },
      })), bindings: entries.map((sessionType) => ({ sessionType, providerId: "finite", ...rules })) });
      const registry = createReferenceAuthorizer({ policies, now: Date.now, caps: { maxAdmissions: 1 } });
      const old: ResourceRef = { domainId: "local", kind: "session", id: "ahp-session:/preexisting", instanceId: "prior" };
      registry.installResource({ resource: old, owner: caller().context.actor.principal, route: { origin: old, targets: [old] }, externalAuthority: "none" });
      registry.installBinding({ id: "prior", actor: caller().context.actor, scope: old, roles: ["senior"], policies: [creator], authority: { kind: "host-policy", policy: creator }, revision: 1 });
      const before = await evaluate(registry, old, "prior");
      expect(before.decision.effect).toBe("allow");
      const prepare = vi.fn(() => Promise.resolve({ effect: "deny" as const, release: vi.fn() }));
      const catalogue = createSessionTypeCatalogue({ tools, types: entries.map((entry, index) => ({
        definition: { id: index === 0 ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333", ...entry, providerId: "finite", configSchema: { type: "object", properties: {} }, tools: [] },
        config: { schema: { type: "object", properties: {} }, parse: () => ({}) }, enabledForCreation: true,
        policy: { rules, creation: { capability: { key: "create", revision: 1 }, prepare } },
      })) });
      const allocate = vi.fn(createInMemorySessionRegistry);
      const start = vi.fn(() => Promise.resolve({ dispose: vi.fn() }));
      expect(() => createSessionsFactory({ providers: [{ ...mockProvider, providerId: "finite", startSession: start }], registryFactory: allocate,
        application: { catalogue, defaultType: type }, creationSecurity: { registry, policies },
      })).toThrow(/admission limit/);
      expect(registry.matches(before.stamp, caller().context)).toBe(true);
      expect(allocate).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      registry.installAdmission({ sessionType: { key: remaining, version: 1 }, providerId: "finite" });
      const after = await evaluate(registry, old, "prior");
      expect(after.stamp.epoch).toBe(before.stamp.epoch + 1);
      expect(after.decision.effect).toBe("allow");
    });
  }
});

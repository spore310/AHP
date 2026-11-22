import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionsFactory, createSessionTypeCatalogue, type SessionCreationApproval, type SessionCreationFacts } from "@sessions";
import { mockProvider } from "@sessions/mock";
import * as publicWebsocket from "@websocket";
import { createAHPBinding, createAHPServer, createWebSocketServer, type WebSocketServerHandle } from "@websocket";
import { FrameLog, responseWithId } from "./helpers";
import { createLegacyConnectionIdentityAdapter, createStaticTokenAuthenticator } from "@agents";
import { createReferenceAuthorizer, type SecurityComposition, type ActorResolutionRequest } from "@authorization";
import { createToolPolicyFactory } from "@toolPolicy";
import type { AHPServerSecurityOptions, ConnectionFence, PreparedInitialScopes, WebSocketConnectionContext } from "@websocket";
import { createMemoryPersistenceFixture } from "../persistence/conformance/helpers";

const servers: WebSocketServerHandle[] = [];
const sockets: WebSocket[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});
const connect = async (server: WebSocketServerHandle, token?: string) => {
  servers.push(server);
  const address = await server.start();
  const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`, token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } });
  sockets.push(socket);
  const frames = new FrameLog(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let id = 0;
  return { socket, frames, rpc: async (method: string, params: unknown) => {
    id += 1;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return frames.waitFor(responseWithId(id));
  } };
};
const initialize = { channel: "ahp-root://", clientId: "spoofed-admin", protocolVersions: ["1.0.0"] };

const gate = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const signal = () => {
  const event = gate<undefined>();
  return { promise: event.promise, resolve: () => {
    event.resolve(undefined);
  } };
};
const onClosed = (socket: WebSocket): Promise<void> => {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", () => {
      resolve();
    });
  });
};
const setupFixture = () => {
  const principal = { domainId: "domain", subject: "ada" };
  const scope = { domainId: "domain", kind: "session", id: "ahp-session:/secret", instanceId: "existing" };
  const policy = { id: "read", revision: 1 };
  const actor = { kind: "user" as const, principal };
  const binding = { id: "existing", actor, scope, roles: [], policies: [policy], revision: 1, authority: { kind: "host-policy" as const, policy } };
  const reference = createReferenceAuthorizer({ policies: createToolPolicyFactory({ policies: [{
    ...policy, operations: { invoke: { actor: { mode: "direct-grant", actors: ["user"] } } }, challenge: { required: false },
  }] }), now: Date.now });
  reference.installResource({ resource: scope, owner: principal, route: { origin: scope, targets: [scope] }, externalAuthority: "none" });
  reference.installBinding(binding);
  const release = vi.fn();
  let current = true;
  const fences: ConnectionFence[] = [];
  // This finite trusted fixture explicitly approves host-wide cursor metadata, never resource/tool disclosure.
  const seed = (): PreparedInitialScopes => ({ scopes: [{ scope, grantRevision: 8 }], allowGlobalSequence: true, validUntil: Date.now() + 60000, isCurrent: () => current, release });
  const authenticate = vi.fn(() => Promise.resolve(principal));
  const resolveActor = vi.fn((input: ActorResolutionRequest) => Promise.resolve({ actor: { kind: "user" as const, principal: input.principal }, connectionId: input.connectionId, authRevision: input.authRevision }));
  const read = vi.fn(() => Promise.resolve([binding]));
  const resolveResource = vi.fn(() => Promise.resolve({ resource: scope, owner: principal, operations: ["invoke"], related: [], admitted: { policies: [policy], namespaces: [] }, mandatory: [] }));
  const freshness = vi.fn(() => Promise.resolve({ domainId: "domain", revision: 8, invalidated: false }));
  const grantPrepare = vi.fn(() => Promise.reject(new Error("No issuance")));
  const grantCommit = vi.fn(() => {
    throw new Error("No issuance");
  });
  const composition: SecurityComposition = {
    identity: { authenticate }, actors: { resolve: resolveActor }, bindings: { read }, resources: { resolve: resolveResource },
    freshness: { current: freshness, invalidate: () => Promise.resolve() },
    grants: { prepare: grantPrepare, commit: grantCommit, rollback: vi.fn(), revoke: () => Promise.resolve() },
    policies: { evaluate: () => Promise.resolve({ effect: "deny", code: "no-operation-admission" }) },
  };
  const options: AHPServerSecurityOptions = { composition, initialAuthority: { prepare: (input) => {
    fences.push(input.fence);
    return Promise.resolve(seed());
  } } };
  return { options, composition, binding, seed, release, fences, read, grantPrepare, grantCommit, freshness, resolveActor,
    revoke: () => {
      current = false;
    },
  };
};

const sequenceHarness = async (mode: "none" | "missing" | "false" | "true" | "invalid-identity" | "malformed", malformed?: unknown) => {
  const r = setupFixture();
  let clock = Date.now();
  const seed = { ...r.seed(), validUntil: clock + 10000 };
  if (mode === "missing") Reflect.deleteProperty(seed, "allowGlobalSequence");
  if (mode === "false") Reflect.set(seed, "allowGlobalSequence", false);
  if (mode === "malformed") Reflect.set(seed, "allowGlobalSequence", malformed);
  if (mode === "invalid-identity") r.composition.identity.authenticate = () => Promise.resolve(undefined);
  r.options.initialAuthority.prepare = () => Promise.resolve(seed);
  const factory = createSessionsFactory({ providers: [mockProvider] });
  await factory.createSession({ channel: "ahp-session:/hidden-before-cursor" });
  const expected = factory.getCurrentServerSeq();
  expect(expected).toBeGreaterThan(0);
  const getter = vi.spyOn(factory, "getCurrentServerSeq");
  const binding = createAHPBinding(factory);
  cleanups.push(async () => {
    binding.dispose();
    await factory.dispose();
  });
  const contexts: WebSocketConnectionContext[] = [];
  const attached = signal();
  const { createConnectionSetupAdapter } = await import("@websocket/helpers/security");
  const server = createWebSocketServer({ host: "127.0.0.1", port: 0,
    ...(mode === "none" ? {} : { connectionSetup: createConnectionSetupAdapter({ ...r.options, now: () => clock }) }),
    handlers: binding.handlers,
    beforeDispatch: (dispatch) => { binding.beforeDispatch(dispatch); },
    onConnection: (context) => {
      binding.onConnection(context);
      contexts.push(context);
      attached.resolve();
    },
  });
  const client = await connect(server);
  return { r, seed, factory, expected, getter, server, client, contexts, attached,
    expire: () => { clock += 10001; },
  };
};

describe("P04 explicit global sequence permission", () => {
  for (const mode of ["none", "missing", "false", "invalid-identity"] as const) {
    it(`sequence ${mode} denies before the real getter and wire approval cannot create readiness`, async () => {
      const h = await sequenceHarness(mode);
      await h.attached.promise;
      expect(await h.client.rpc("initialize", { ...initialize, allowGlobalSequence: true,
        kind: "user", role: "admin", clientInfo: { allowGlobalSequence: true }, capabilities: { allowGlobalSequence: true },
      })).toMatchObject({ error: { code: -32600 } });
      expect(await h.client.rpc("initialize", initialize)).toMatchObject({ error: { code: -32600 } });
      expect(await h.client.rpc("ping", { channel: "ahp-root://" })).toMatchObject({ error: { code: -32600 } });
      expect(h.getter).not.toHaveBeenCalled();
    });
  }

  it("sequence explicit permission on the real public host returns the exact advancing canonical cursor and no snapshots", async () => {
    const r = setupFixture();
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: r.options });
    await host.sessions.createSession({ channel: "ahp-session:/hidden-one" });
    const initial = host.sessions.getCurrentServerSeq();
    expect(initial).toBeGreaterThan(0);
    const first = await connect(host);
    expect(await first.rpc("initialize", initialize)).toEqual({ jsonrpc: "2.0", id: 1,
      result: { serverSeq: initial, snapshots: [], protocolVersion: "1.0.0" },
    });
    expect(await first.rpc("ping", { channel: "ahp-root://" })).toMatchObject({ result: null });
    expect(await first.rpc("subscribe", { channel: "ahp-root://" })).toMatchObject({ error: { code: -32600 } });
    expect(await first.rpc("x-ahp/tools/call", {})).toMatchObject({ error: { code: -32600 } });
    await host.sessions.createSession({ channel: "ahp-session:/hidden-two" });
    const advanced = host.sessions.getCurrentServerSeq();
    expect(advanced).toBeGreaterThan(initial);
    const second = await connect(host);
    expect(await second.rpc("initialize", initialize)).toEqual({ jsonrpc: "2.0", id: 1,
      result: { serverSeq: advanced, snapshots: [], protocolVersion: "1.0.0" },
    });
  });

  it("sequence permission is captured once and producer mutation cannot widen false", async () => {
    const h = await sequenceHarness("false");
    await h.attached.promise;
    expect(h.contexts[0]?.security?.allowGlobalSequence).toBe(false);
    Reflect.set(h.seed, "allowGlobalSequence", true);
    expect(await h.client.rpc("initialize", initialize)).toMatchObject({ error: { code: -32600 } });
    expect(h.contexts[0]?.security?.allowGlobalSequence).toBe(false);
    expect(h.getter).not.toHaveBeenCalled();
  });

  for (const cause of ["revoked", "expired"] as const) {
    it(`sequence ${cause} permission never enters the kernel or reads its cursor`, async () => {
      const h = await sequenceHarness("true");
      await h.attached.promise;
      expect(h.contexts[0]?.isSecurityCurrent?.()).toBe(true);
      if (cause === "revoked") h.r.revoke();
      else h.expire();
      const closed = onClosed(h.client.socket);
      h.client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 77, method: "initialize", params: initialize }));
      await closed;
      expect(h.client.frames.frames).toEqual([]);
      expect(h.getter).not.toHaveBeenCalled();
    });
  }

  for (const [kind, malformed] of [["string", "true"], ["number", 1], ["null", null], ["promise", Promise.resolve(true)]] as const) {
    it(`sequence malformed ${kind} approval cannot authorize a native handshake`, async () => {
      const h = await sequenceHarness("malformed", malformed);
      const result = Promise.race([
        onClosed(h.client.socket).then(() => "closed"),
        new Promise<string>((resolve) => {
          h.client.socket.once("message", () => {
            resolve("reply");
          });
        }),
      ]);
      h.client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 77, method: "initialize", params: initialize }));
      expect(await result).toBe("closed");
      expect(h.getter).not.toHaveBeenCalled();
      expect(h.r.release).toHaveBeenCalledOnce();
      expect(h.r.read).not.toHaveBeenCalled();
    });
  }
});

describe("P04 public initialization boundary", () => {
  it("I01 public no-config host denies initialize after real mutations rather than leaking the global cursor", async () => {
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] } });
    await host.sessions.createSession({ channel: "ahp-session:/private-before-anonymous" });
    expect(host.sessions.getCurrentServerSeq()).toBeGreaterThan(0);
    const client = await connect(host);
    expect(await client.rpc("initialize", { ...initialize, allowGlobalSequence: true })).toMatchObject({ error: { code: -32600 } });
    expect(await client.rpc("ping", { channel: "ahp-root://" })).toMatchObject({ error: { code: -32600 } });
    for (const method of ["subscribe", "subscribe", "listSessions", "createSession", "disposeSession", "x-ahp/tools/call"]) {
      expect(await client.rpc(method, { channel: "ahp-root://" })).toMatchObject({ error: { code: -32600 } });
    }
    expect(host.sessions.listSessionSnapshots()).toHaveLength(1);
  });

  it("I01 public facade rejects protected initial subscriptions before getters and side effects", async () => {
    const factory = createSessionsFactory({ providers: [mockProvider] });
    const snapshot = vi.spyOn(factory, "getSessionSnapshot");
    const list = vi.spyOn(factory, "listSessionSnapshots");
    const create = vi.spyOn(factory, "createSession");
    const binding = createAHPBinding(factory);
    const client = await connect(createWebSocketServer({ host: "127.0.0.1", port: 0,
      handlers: binding.handlers,
      onConnection: (context) => {
        binding.onConnection(context);
      },
      beforeDispatch: (dispatch) => {
        binding.beforeDispatch(dispatch);
      },
    }));
    expect(await client.rpc("initialize", { ...initialize, initialSubscriptions: ["ahp-root://", "ahp-session:/secret"] })).toMatchObject({ error: { code: -32600 } });
    expect(snapshot).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(await client.rpc("initialize", initialize)).toMatchObject({ error: { code: -32600 } });
    binding.dispose();
    await factory.dispose();
  });

  it("I01 supported exports provide no raw kernel or unsafe constructor", () => {
    expect(Object.keys(publicWebsocket).some((name) => /kernel|unsafe|raw/i.test(name))).toBe(false);
    expect(publicWebsocket.createAHPConnectionModule).toBe(createAHPBinding);
  });

  it("I02 real public host completes scoped security setup without persistence and still denies protected disclosure", async () => {
    const r = setupFixture();
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: r.options });
    const client = await connect(host);
    expect(await client.rpc("initialize", { ...initialize, initialSubscriptions: ["ahp-root://"] })).toMatchObject({ error: { code: -32600 } });
    expect(await client.rpc("initialize", { ...initialize, kind: "admin", role: "admin" })).toMatchObject({ result: { snapshots: [] } });
    expect(r.read).toHaveBeenCalledExactlyOnceWith({ actor: r.binding.actor, scope: r.binding.scope, grantRevision: 8 });
    expect(r.grantPrepare).not.toHaveBeenCalled();
    expect(r.grantCommit).not.toHaveBeenCalled();
    for (const method of ["subscribe", "subscribe", "listSessions", "createSession", "disposeSession", "x-ahp/tools/call"]) {
      expect(await client.rpc(method, { channel: "ahp-session:/secret" })).toMatchObject({ error: { code: -32600 } });
    }
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "dispatchAction", params: { channel: "ahp-session:/secret", clientSeq: 1, action: { type: "session/titleChanged", title: "forged" } } }));
    expect(await client.rpc("ping", { channel: "ahp-root://" })).toMatchObject({ result: null });
    expect(host.sessions.listSessionSnapshots()).toEqual([]);
  });

  for (const stage of ["identity", "authority"] as const) {
    it(`I01 parks ${stage} before immediate protected initialSubscriptions and later permits only safe setup`, async () => {
      const r = setupFixture();
      const entered = signal();
      const parked = signal();
      if (stage === "identity") {
        r.composition.identity.authenticate = async () => {
          entered.resolve();
          await parked.promise;
          return r.binding.actor.principal;
        };
      } else {
        r.options.initialAuthority.prepare = async () => {
          entered.resolve();
          await parked.promise;
          return r.seed();
        };
      }
      const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: r.options });
      const client = await connect(host);
      const pending = client.rpc("initialize", { ...initialize, initialSubscriptions: ["ahp-root://"] });
      await entered.promise;
      expect(client.frames.frames).toEqual([]);
      expect(r.read).not.toHaveBeenCalled();
      expect(host.sessions.listSessionSnapshots()).toEqual([]);
      parked.resolve();
      expect(await pending).toMatchObject({ error: { code: -32600 } });
      expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    });
  }

  it("I01 counts subscription selectors before deduplication and retains successful-reply initialization semantics", async () => {
    const r = setupFixture();
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: { ...r.options, maxInitialSubscriptions: 1 } });
    const client = await connect(host);
    expect(await client.rpc("initialize", { ...initialize, initialSubscriptions: ["ahp-root://", "ahp-root://"] })).toMatchObject({ error: { code: -32602 } });
    expect(await client.rpc("initialize", { ...initialize, initialSubscriptions: ["ahp-root://"] })).toMatchObject({ error: { code: -32600 } });
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await client.rpc("initialize", initialize)).toMatchObject({ error: { code: -32600 } });
  });

  for (const stage of ["identity", "actor", "authority", "resource", "bindings", "freshness"] as const) {
    for (const ending of ["timeout", "disconnect"] as const) {
      it(`I05 bounds ${stage} setup, observes late rejection, and never attaches after ${ending}`, async () => {
        const r = setupFixture();
        const entered = signal();
        const parked = gate<never>();
        const block = () => {
          entered.resolve();
          return parked.promise;
        };
        if (stage === "identity") r.composition.identity.authenticate = block;
        if (stage === "actor") r.composition.actors.resolve = block;
        if (stage === "authority") r.options.initialAuthority.prepare = block;
        if (stage === "resource") r.composition.resources.resolve = block;
        if (stage === "bindings") r.composition.bindings.read = block;
        if (stage === "freshness") r.composition.freshness.current = block;
        const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: { ...r.options, setupDeadlineMs: ending === "timeout" ? 20 : 5000 } });
        const client = await connect(host);
        const closed = onClosed(client.socket);
        await entered.promise;
        client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 77, method: "initialize", params: initialize }));
        if (ending === "disconnect") {
          client.socket.terminate();
        }
        await closed;
        expect(client.frames.frames).toEqual([]);
        parked.reject(new Error("Late adapter rejection"));
        await host.stop();
        expect(host.sessions.listSessionSnapshots()).toEqual([]);
      });
    }
  }

  it("I05 disconnect/stop while authority is pending releases a late preparation exactly once", async () => {
    const r = setupFixture();
    const entered = signal();
    const parked = gate<PreparedInitialScopes>();
    r.options.initialAuthority.prepare = async () => {
      entered.resolve();
      return parked.promise;
    };
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: r.options });
    const client = await connect(host);
    await entered.promise;
    const closed = onClosed(client.socket);
    client.socket.terminate();
    await closed;
    await host.stop();
    parked.resolve(r.seed());
    await vi.waitFor(() => {
      expect(r.release).toHaveBeenCalledOnce();
    });
    expect(r.read).not.toHaveBeenCalled();
    expect(client.frames.frames).toEqual([]);
  });

  it("I05 reconnect uses a different actual connection generation and auth revision", async () => {
    const r = setupFixture();
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: r.options });
    const first = await connect(host);
    expect(await first.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const closed = onClosed(first.socket);
    first.socket.terminate();
    await closed;
    const second = await connect(host);
    expect(await second.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const [before, after] = r.fences;
    if (before === undefined || after === undefined) throw new Error("Missing actual fences");
    expect(after.connectionId).not.toBe(before.connectionId);
    expect(after.connectionGeneration).toBeGreaterThan(before.connectionGeneration);
    const calls = r.resolveActor.mock.calls;
    expect(calls[0]?.[0].authRevision).not.toBe(calls[1]?.[0].authRevision);
  });

  it("I05 transport checks currentness immediately at attach and after attachment without async freshness", async () => {
    const r = setupFixture();
    const contexts: WebSocketConnectionContext[] = [];
    const { createConnectionSetupAdapter } = await import("@websocket/helpers/security");
    const adapter = createConnectionSetupAdapter(r.options);
    const client = await connect(createWebSocketServer({ host: "127.0.0.1", port: 0, connectionSetup: adapter,
      handlers: { inspect: (_params, context) => ({ current: context.isSecurityCurrent?.() === true }) },
      onConnection: (context) => {
        contexts.push(context);
      },
    }));
    expect(await client.rpc("inspect", {})).toMatchObject({ result: { current: true } });
    expect(contexts[0]?.security?.context.connectionId).toBe(contexts[0]?.connectionId);
    expect(contexts[0]?.security?.fence.connectionGeneration).toBe(contexts[0]?.connectionGeneration);
    const reads = r.freshness.mock.calls.length;
    r.revoke();
    expect(contexts[0]?.isSecurityCurrent?.()).toBe(false);
    const closed = onClosed(client.socket);
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "inspect", params: {} }));
    await closed;
    expect(client.frames.frames.filter(responseWithId(99))).toEqual([]);
    expect(r.freshness.mock.calls).toHaveLength(reads);
  });

  it("I05 revocation after preparation but before final attachment prevents onConnection effects", async () => {
    const r = setupFixture();
    const { createConnectionSetupAdapter } = await import("@websocket/helpers/security");
    const adapter = createConnectionSetupAdapter(r.options);
    let attached = 0;
    const client = await connect(createWebSocketServer({ host: "127.0.0.1", port: 0,
      connectionSetup: { prepare: async (input) => {
        const result = await adapter.prepare(input);
        expect(result?.isCurrent()).toBe(true);
        r.revoke();
        return result;
      } },
      onConnection: (context) => {
        attached += 1;
        context.close();
      },
    }));
    await onClosed(client.socket);
    expect(attached).toBe(0);
    expect(r.read).toHaveBeenCalledOnce();
    expect(r.release).toHaveBeenCalledOnce();
  });

  for (const wrong of ["connection", "generation"] as const) {
    it(`I05 transport refuses a prepared ${wrong} fence belonging to another attachment`, async () => {
      const r = setupFixture();
      const { createConnectionSetupAdapter } = await import("@websocket/helpers/security");
      const adapter = createConnectionSetupAdapter(r.options);
      let attached = 0;
      const client = await connect(createWebSocketServer({ host: "127.0.0.1", port: 0,
        connectionSetup: { prepare: async (input) => {
          const result = await adapter.prepare(input);
          if (result === undefined) throw new Error("Missing real control setup");
          return { ...result, snapshot: { ...result.snapshot,
            fence: { ...input.fence, ...(wrong === "connection" ? { connectionId: "other" } : { connectionGeneration: input.fence.connectionGeneration + 1 }) },
          } };
        } },
        onConnection: (context) => {
          attached += 1;
          context.close();
        },
      }));
      await onClosed(client.socket);
      expect(attached).toBe(0);
      expect(r.release).toHaveBeenCalledOnce();
    });
  }

  it("I04 real public host invokes one exact legacy bridge and preserves work principals despite spoofed client labels", async () => {
    const r = setupFixture();
    const memory = createMemoryPersistenceFixture();
    const base = createStaticTokenAuthenticator(new Map([["ada-token", "ada"], ["bob-token", "bob"]]));
    const authenticate = vi.fn(base.authenticate.bind(base));
    const authenticator = { authenticate };
    const identity = createLegacyConnectionIdentityAdapter({ authenticator, domainId: "domain" });
    r.options.initialAuthority.prepare = () => Promise.resolve({ scopes: [], allowGlobalSequence: true, validUntil: Date.now() + 60000, isCurrent: () => true, release: r.release });
    const get = vi.spyOn(memory.provider.work, "get");
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: { ...r.options, composition: { ...r.composition, identity }, workDomainId: "domain" },
      agentWork: { authenticator, registrations: memory.provider.registrations, work: memory.provider.work, allowedKinds: new Set(["test.kind"]), dispose: () => memory.provider.dispose() },
    });
    for (const subject of ["ada", "bob"]) {
      const client = await connect(host, `${subject}-token`);
      expect(await client.rpc("initialize", { ...initialize, clientId: "same-admin", kind: "user", role: "admin" })).toMatchObject({ result: { snapshots: [] } });
      expect(await client.rpc("x-ahp/work/get", { version: 1, workId: "11111111-1111-4111-8111-111111111111" })).toMatchObject({ result: { version: 1, work: null } });
      expect(get).toHaveBeenLastCalledWith({ workId: "11111111-1111-4111-8111-111111111111", principalSubject: subject });
    }
    expect(authenticate).toHaveBeenCalledTimes(2);
    const bad = await connect(host, "bad-token");
    expect(await bad.rpc("initialize", initialize)).toMatchObject({ error: { code: -32600 } });
    expect(await bad.rpc("x-ahp/work/get", { version: 1, workId: "11111111-1111-4111-8111-111111111111" })).toMatchObject({ error: { code: -32600 } });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("I05 revocation during a real deferred work read prevents protected result egress at the final send", async () => {
    const r = setupFixture();
    const memory = createMemoryPersistenceFixture();
    const authenticator = createStaticTokenAuthenticator(new Map([["token", "ada"]]));
    const identity = createLegacyConnectionIdentityAdapter({ authenticator, domainId: "domain" });
    const created = await memory.provider.work.submit({ session: {
      sessionUri: "ahp-session:/owned", ownerPrincipalSubject: "ada", providerId: "mock",
      createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), lastServerSeq: 0, durableState: {},
    }, requestKey: "private", kind: "test.kind", input: { secret: "private-sentinel" } });
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] },
      security: { ...r.options, composition: { ...r.composition, identity }, workDomainId: "domain" },
      agentWork: { authenticator, registrations: memory.provider.registrations, work: memory.provider.work, allowedKinds: new Set(["test.kind"]), dispose: () => memory.provider.dispose() },
    });
    const client = await connect(host, "token");
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await client.rpc("x-ahp/work/get", { version: 1, workId: created.id })).toMatchObject({ result: { work: { input: { secret: "private-sentinel" } } } });
    const entered = signal();
    const parked = signal();
    const original = memory.provider.work.get.bind(memory.provider.work);
    vi.spyOn(memory.provider.work, "get").mockImplementation(async (query) => {
      entered.resolve();
      await parked.promise;
      return original(query);
    });
    const outcome = Promise.race([
      onClosed(client.socket).then(() => "closed"),
      new Promise<string>((resolve) => {
        client.socket.once("message", () => {
          resolve("reply");
        });
      }),
    ]);
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "x-ahp/work/get", params: { version: 1, workId: created.id } }));
    await entered.promise;
    r.revoke();
    parked.resolve();
    expect(await outcome).toBe("closed");
    expect(client.frames.frames.filter(responseWithId(99))).toEqual([]);
  });

  it("I04 a thrown identity failure closes only that socket and the real host accepts the next valid setup", async () => {
    const r = setupFixture();
    let fail = true;
    r.composition.identity.authenticate = () => fail ? Promise.reject(new Error("Private credential failure")) : Promise.resolve(r.binding.actor.principal);
    const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, security: r.options });
    const failed = await connect(host);
    await onClosed(failed.socket);
    expect(failed.frames.frames).toEqual([]);
    fail = false;
    const good = await connect(host);
    expect(await good.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await good.rpc("ping", { channel: "ahp-root://" })).toMatchObject({ result: null });
  });

  it("I04 rejects conflicting bridge sources and incompatible durable domains before authentication", () => {
    const r = setupFixture();
    const memory = createMemoryPersistenceFixture();
    const authenticator = createStaticTokenAuthenticator(new Map([["token", "ada"]]));
    const agentWork = { authenticator, registrations: memory.provider.registrations, work: memory.provider.work, allowedKinds: new Set(["test.kind"]) };
    expect(() => createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, agentWork, security: r.options })).toThrow(/conflicting/i);
    const identity = createLegacyConnectionIdentityAdapter({ authenticator, domainId: "domain" });
    expect(() => createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, agentWork, security: { ...r.options, composition: { ...r.composition, identity }, workDomainId: "other" } })).toThrow(/conflicting/i);
    expect(() => createAHPServer({ host: "127.0.0.1", port: 0, sessions: { providers: [mockProvider] }, agentWork, security: { ...r.options, composition: { ...r.composition, identity: { ...identity } }, workDomainId: "domain" } })).toThrow(/conflicting/i);
    expect(() => createWebSocketServer({ host: "127.0.0.1", port: 0, authenticator, connectionSetup: { prepare: () => Promise.resolve(undefined) } })).toThrow(/conflicting/i);
  });
});

const publicCreationFixture = (options: { cursor?: boolean | "missing"; deny?: boolean; parked?: Promise<void>; backend?: typeof mockProvider.startSession; allowOtherDomain?: boolean } = {}) => {
  const r = setupFixture();
  const authenticator = createStaticTokenAuthenticator(new Map([["ada-token", "ada"], ["bob-token", "bob"]]));
  const identity = createLegacyConnectionIdentityAdapter({ authenticator, domainId: "domain" });
  const fences: ConnectionFence[] = [];
  r.options.initialAuthority.prepare = (input) => {
    fences.push(input.fence);
    const seed = { ...r.seed(), scopes: [] };
    if (options.cursor === "missing") Reflect.deleteProperty(seed, "allowGlobalSequence");
    else Reflect.set(seed, "allowGlobalSequence", options.cursor ?? true);
    return Promise.resolve(seed);
  };
  const creator = { id: "session.creator", revision: 1 };
  const reader = { id: "session.reader", revision: 1 };
  const rules = { admitted: { policies: [creator, reader], namespaces: [] }, mandatory: [] };
  const policies = createToolPolicyFactory({ policies: [
    { ...creator, operations: { invoke: { actor: { mode: "roles", actors: { user: { anyOf: ["senior"] } } } } }, challenge: { required: false } },
    { ...reader, operations: { invoke: { actor: { mode: "roles", actors: { user: { anyOf: ["junior"] } } } } }, challenge: { required: false } },
  ], bindings: [{ sessionType: { key: "review", version: 1 }, providerId: "mock", ...rules }] });
  const registry = createReferenceAuthorizer({ policies, now: Date.now });
  const installed = vi.spyOn(registry, "installBinding");
  const requests: SessionCreationFacts[] = [];
  const entered = signal();
  const release = vi.fn();
  const prepare = vi.fn(async ({ request }: { request: SessionCreationFacts; signal: AbortSignal }): Promise<SessionCreationApproval> => {
    requests.push(request);
    entered.resolve();
    await options.parked;
    // Finite application capability: one verified creator and exact registered type/provider/capability.
    if (options.deny === true || request.caller.actor.kind !== "user" || (request.caller.actor.principal.domainId !== "domain" && !(options.allowOtherDomain === true && request.caller.actor.principal.domainId === "other"))
      || request.caller.actor.principal.subject !== "ada" || request.type.key !== "review" || request.type.version !== 1
      || request.type.providerId !== "mock" || request.capability.key !== "review.create" || request.capability.revision !== 1) return { effect: "deny", release };
    return { effect: "allow", request, bootstrap: { kind: "template", id: "review.bootstrap", revision: 1,
      bindings: [{ key: "creator", lifetimeMs: 30000 }],
    }, validUntil: Date.now() + 30000, isCurrent: () => true, release };
  });
  const catalogue = createSessionTypeCatalogue({ tools: { list: () => [], get: () => undefined, validateInput: () => ({ status: "valid" }), validateOutput: () => ({ status: "schema-not-declared" }) },
    types: [{ definition: { id: "22222222-2222-4222-8222-222222222222", key: "review", version: 1, providerId: "mock", configSchema: { type: "object", properties: {} }, tools: [] },
      config: { schema: { type: "object", properties: {} }, parse: () => ({}) }, enabledForCreation: true,
      policy: { rules, creatorBootstrap: { id: "review.bootstrap", revision: 1, bindings: [{ key: "creator", purpose: "admitted", roles: ["senior"], policies: [creator], authority: { kind: "host-policy", policy: creator }, maxLifetimeMs: 60000 }] },
        creation: { capability: { key: "review.create", revision: 1 }, prepare },
      },
    }],
  });
  const memory = createMemoryPersistenceFixture();
  const start = vi.fn(options.backend ?? mockProvider.startSession.bind(mockProvider));
  const sessionOptions = { providers: [{ ...mockProvider, startSession: start }], application: { catalogue, defaultType: { key: "review", version: 1 } }, creationSecurity: { registry, policies } };
  const securityOptions = { ...r.options, composition: { ...r.composition, identity }, workDomainId: "domain" };
  const host = createAHPServer({ host: "127.0.0.1", port: 0,
    sessions: sessionOptions,
    security: securityOptions,
    agentWork: { authenticator, registrations: memory.provider.registrations, work: memory.provider.work, allowedKinds: new Set(["test.kind"]), dispose: () => memory.provider.dispose() },
  });
  return { host, registry, policies, prepare, requests, entered, release, start, installed, memory, r, reader, sessionOptions, securityOptions, fences };
};

describe("P05 real public create-only boundary", () => {
  it("S05 initialized current cursor plus separate finite creation approval returns null, never a snapshot/tool", async () => {
    const f = publicCreationFixture();
    const client = await connect(f.host, "ada-token");
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await client.rpc("createSession", { channel: "ahp-session:/public-created", owner: "bob", role: "admin", bootstrap: { roles: ["admin"] } })).toEqual({ jsonrpc: "2.0", id: 2, result: null });
    const ref = f.host.sessions.authorization?.getResource("ahp-session:/public-created");
    if (ref === undefined) throw new Error("Missing public created resource");
    expect(f.registry.owner(ref)).toEqual({ domainId: "domain", subject: "ada" });
    expect(f.installed.mock.calls[0]?.[0]).toMatchObject({ actor: { kind: "user", principal: { subject: "ada" } }, roles: ["senior"], scope: ref });
    expect(f.start).toHaveBeenCalledOnce();
    for (const method of ["subscribe", "listSessions", "disposeSession", "x-ahp/tools/call"]) expect(await client.rpc(method, { channel: ref.id })).toMatchObject({ error: { code: -32600 } });
    expect(client.frames.frames.some((frame) => typeof frame === "object" && frame !== null && "method" in frame && frame.method === "action")).toBe(false);
  });

  it("S02 live setup before initialize cannot invoke creation or reserve a URI", async () => {
    const f = publicCreationFixture();
    const client = await connect(f.host, "ada-token");
    expect(await client.rpc("createSession", { channel: "ahp-session:/before-init", allowGlobalSequence: true })).toMatchObject({ error: { code: -32600 } });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.host.sessions.listSessionSnapshots()).toEqual([]);
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await client.rpc("createSession", { channel: "ahp-session:/before-init" })).toMatchObject({ result: null });
  });

  for (const cursor of [false, "missing"] as const) {
    it(`S02 ${String(cursor)} cursor approval and wire claims cannot initialize or reach creation`, async () => {
      const f = publicCreationFixture({ cursor });
      const client = await connect(f.host, "ada-token");
      expect(await client.rpc("initialize", { ...initialize, allowGlobalSequence: true })).toMatchObject({ error: { code: -32600 } });
      expect(await client.rpc("createSession", { channel: "ahp-session:/false-cursor", allowGlobalSequence: true, actor: { subject: "ada" } })).toMatchObject({ error: { code: -32600 } });
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.start).not.toHaveBeenCalled();
      expect(f.host.sessions.listSessionSnapshots()).toEqual([]);
    });
  }

  it("S02 native initialization and invoke declarations never substitute for explicit creation approval", async () => {
    const f = publicCreationFixture({ deny: true });
    const client = await connect(f.host, "ada-token");
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await client.rpc("createSession", { channel: "ahp-session:/denied", role: "senior", policies: [{ id: "session.creator", revision: 1 }] })).toMatchObject({ error: { code: -32600 } });
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.host.sessions.listSessionSnapshots()).toEqual([]);
  });

  it("S01 canonical owner projection keeps junior work identity distinct from the creator", async () => {
    const f = publicCreationFixture();
    const alice = await connect(f.host, "ada-token");
    expect(await alice.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const uri = "ahp-session:/canonical-work";
    expect(await alice.rpc("createSession", { channel: uri })).toMatchObject({ result: null });
    const ref = f.host.sessions.authorization?.getResource(uri);
    if (ref === undefined) throw new Error("Missing canonical resource");
    // Explicit test-only participant fixture after ready: not a P05 participant issuer.
    const bob = { kind: "user" as const, principal: { domainId: "domain", subject: "bob" } };
    f.registry.installBinding({ id: "test-junior", actor: bob, scope: ref, roles: ["junior"], policies: [f.reader], authority: { kind: "host-policy", policy: f.reader }, revision: 1 });
    expect((await f.registry.evaluate({ actor: { actor: bob, connectionId: "bob-test", authRevision: "verified" }, operation: "invoke", bindingId: "test-junior", policyRef: f.reader, scope: ref, route: { origin: ref, targets: [ref] } })).decision.effect).toBe("allow");
    const junior = await connect(f.host, "bob-token");
    expect(await junior.rpc("initialize", { ...initialize, clientId: "ada", role: "senior" })).toMatchObject({ result: { snapshots: [] } });
    const submit = vi.spyOn(f.memory.provider.work, "submit");
    expect(await junior.rpc("x-ahp/work/submit", { version: 1, sessionUri: uri, requestKey: "bob-request", kind: "test.kind", input: {} })).toMatchObject({ error: { code: -32602 } });
    expect(submit).not.toHaveBeenCalled();
    expect(await alice.rpc("x-ahp/work/submit", { version: 1, sessionUri: uri, requestKey: "ada-request", kind: "test.kind", input: {} })).toMatchObject({ result: { version: 1 } });
    expect(submit.mock.calls[0]?.[0].session.ownerPrincipalSubject).toBe("ada");
    expect(f.registry.owner(ref)?.subject).toBe("ada");
  });

  it("S04 disconnect and stop reject parked creation promptly and release late approval without attach", async () => {
    const parked = signal();
    const f = publicCreationFixture({ parked: parked.promise });
    const client = await connect(f.host, "ada-token");
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const enteredOrDenied = Promise.race([f.entered.promise.then(() => "entered"), new Promise<string>((resolve) => {
      client.socket.once("message", () => {
        resolve("reply");
      });
    })]);
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "createSession", params: { channel: "ahp-session:/stopped-approval" } }));
    expect(await enteredOrDenied).toBe("entered");
    await f.host.stop();
    parked.resolve();
    await vi.waitFor(() => {
      expect(f.release).toHaveBeenCalledOnce();
    });
    const request = f.requests[0];
    if (request === undefined) throw new Error("Missing attempted request");
    expect(f.registry.owner(request.candidate)).toBeUndefined();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.host.sessions.listSessionSnapshots()).toEqual([]);
    expect(() => f.host.sessions.authorization?.getResource(request.candidate.id)).toThrow(/shutdown/);
  });

  it("P05-2 a different connection cannot borrow an initialized fence through JSON claims", async () => {
    const f = publicCreationFixture();
    const first = await connect(f.host, "ada-token");
    expect(await first.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const old = f.fences[0];
    if (old === undefined) throw new Error("Missing actual fence");
    const second = await connect(f.host, "ada-token");
    expect(await second.rpc("createSession", { channel: "ahp-session:/borrowed", connectionId: old.connectionId, connectionGeneration: old.connectionGeneration,
      actor: { kind: "user", principal: { domainId: "domain", subject: "ada" } }, allowGlobalSequence: true, isCurrent: true,
    })).toMatchObject({ error: { code: -32600 } });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(await second.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    expect(await second.rpc("createSession", { channel: "ahp-session:/borrowed" })).toMatchObject({ result: null });
    expect(f.requests[0]?.caller.connectionId).toBe(f.fences[1]?.connectionId);
    expect(f.requests[0]?.connectionGeneration).toBe(f.fences[1]?.connectionGeneration);
    expect(f.requests[0]?.caller.connectionId).not.toBe(old.connectionId);
  });

  it("P05-2 revocation between native initialize and its reply prevents readiness and queued creation", async () => {
    const f = publicCreationFixture();
    servers.push(f.host);
    const factory = createSessionsFactory(f.sessionOptions);
    const getter = vi.spyOn(factory, "getCurrentServerSeq");
    const binding = createAHPBinding(factory);
    cleanups.push(async () => {
      binding.dispose();
      await factory.dispose();
    });
    const { createConnectionSetupAdapter } = await import("@websocket/helpers/security");
    const client = await connect(createWebSocketServer({ host: "127.0.0.1", port: 0, connectionSetup: createConnectionSetupAdapter(f.securityOptions),
      handlers: binding.handlers,
      onConnection: (context) => { binding.onConnection(context); },
      beforeDispatch: (dispatch) => {
        binding.beforeDispatch(dispatch);
        if (dispatch.method === "initialize") queueMicrotask(() => {
          f.r.revoke();
        });
      },
    }), "ada-token");
    const closed = onClosed(client.socket);
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 81, method: "initialize", params: initialize }));
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 82, method: "createSession", params: { channel: "ahp-session:/failed-reply" } }));
    await closed;
    expect(getter).toHaveBeenCalledOnce();
    expect(client.frames.frames).toEqual([]);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(factory.listSessionSnapshots()).toEqual([]);
  });

  it("S04 creation approval returning after setup revocation cannot attach or enqueue success", async () => {
    const parked = signal();
    const f = publicCreationFixture({ parked: parked.promise });
    const client = await connect(f.host, "ada-token");
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const closed = onClosed(client.socket);
    client.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 91, method: "createSession", params: { channel: "ahp-session:/revoked-create" } }));
    await f.entered.promise;
    f.r.revoke();
    parked.resolve();
    await closed;
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.host.sessions.listSessionSnapshots()).toEqual([]);
    expect(f.start).not.toHaveBeenCalled();
    expect(client.frames.frames.filter(responseWithId(91))).toEqual([]);
  });

  it("S01 identical subject in another domain cannot project into the configured legacy work domain", async () => {
    const f = publicCreationFixture({ allowOtherDomain: true });
    const client = await connect(f.host, "ada-token");
    expect(await client.rpc("initialize", initialize)).toMatchObject({ result: { snapshots: [] } });
    const auth = f.host.sessions.authorization;
    if (auth === undefined) throw new Error("Missing protected capability");
    const uri = "ahp-session:/other-domain";
    // Explicit trusted in-process IAM fixture for a second verified domain; no native cursor requirement.
    await auth.createSession({ channel: uri }, { context: { actor: { kind: "user", principal: { domainId: "other", subject: "ada" } }, connectionId: "trusted-other", authRevision: "other-iam" },
      connectionId: "trusted-other", connectionGeneration: 1, validUntil: Date.now() + 60000, signal: new AbortController().signal, isCurrent: () => true,
    });
    const ref = auth.getResource(uri);
    if (ref === undefined) throw new Error("Missing other-domain resource");
    expect(f.registry.owner(ref)).toEqual({ domainId: "other", subject: "ada" });
    const submit = vi.spyOn(f.memory.provider.work, "submit");
    expect(await client.rpc("x-ahp/work/submit", { version: 1, sessionUri: uri, requestKey: "domain-collision", kind: "test.kind", input: {} })).toMatchObject({ error: { code: -32602 } });
    expect(submit).not.toHaveBeenCalled();
  });
});

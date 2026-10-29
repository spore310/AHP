import { afterEach, describe, expect, it, vi } from "vitest";
import type { AhpTransport } from "@microsoft/agent-host-protocol/client";
import { connectToolClient, type ToolClient } from "@toolClient";
import type { AHPServerHandle, WebSocketConnectionContext } from "@websocket";
import { createToolPolicyHost, connectPolicyTransport, toolPolicyChannel as channel } from "./toolPolicyFixture";
import { contract } from "../toolExecution/fixtures";
import { createSessionsFactory } from "@sessions";
import type { SessionsFactory } from "@sessions";
import { createMockProvider } from "@sessions/mock";
import { createActionSequence } from "@sessions/helpers/sequence";
import { createWebSocketServer } from "@websocket";
import WebSocket from "ws";
import { FrameLog, responseWithId } from "./helpers";

// Internal guarded execution proof; shared-view/public SDK acceptance belongs to P12.
const capturedContexts = vi.hoisted(() => new Map<string, WebSocketConnectionContext>());
const capturedFactories = vi.hoisted(() => new Set<SessionsFactory>());
vi.mock("@websocket/helpers/ahp", async () => {
  const { createAHPKernel } = await import("@websocket/helpers/ahp/helpers/kernel/helpers");
  return { createAHPBinding: (...args: Parameters<typeof createAHPKernel>) => {
    capturedFactories.add(args[0]);
    const kernel = createAHPKernel(...args);
    return { ...kernel, onConnection: (context: WebSocketConnectionContext) => {
      capturedContexts.set(context.connectionId, context);
      kernel.onConnection(context);
    } };
  } };
});
const hosts: AHPServerHandle[] = [];
const clients: ToolClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});
const gate = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const setup = async (options: Parameters<typeof createToolPolicyHost>[1] = {}) => {
  const f = await createToolPolicyHost([contract], options);
  hosts.push(f.host);
  const address = await f.host.start();
  const url = "ws://127.0.0.1:" + String(address.port) + "/capacity";
  const connect = async (token = "fixture", clientId = token) => {
    const inner = await connectPolicyTransport(url, token);
    const frames: string[] = [];
    const transport: AhpTransport = { send: (message) => {
      inner.send(typeof message === "string" ? message : JSON.stringify(message));
    }, close: () => inner.close(), recv: async () => {
      const frame = await inner.recv();
      if (frame?.kind === "text") frames.push(frame.text);
      return frame;
    } };
    const client = await connectToolClient({ transport, ownership: "owned" }, { clientId, protocolVersions: ["1.0.0"] });
    clients.push(client);
    await client.client.subscribe(channel);
    return { client, frames, transport };
  };
  return { ...f, connect, url };
};

describe("P09 guarded client wire admission", () => {
  it("T03 a final proof clock cannot close the advertiser and still commit its advertisement", async () => {
    let inVeto = false;
    let closed = false;
    const f = await setup({ registryNow: () => {
      if (inVeto && !closed) {
        closed = true;
        context?.close();
      }
      return Date.now();
    } });
    const advertiser = await f.connect();
    const record = [...f.contexts.values()][0];
    const context = record === undefined ? undefined : capturedContexts.get(record.context.connectionId);
    const factory = [...capturedFactories].find((candidate) => candidate.authorization?.usesRegistry(f.registry));
    if (factory === undefined || context === undefined) throw new Error("Missing actual binding inputs");
    const before = f.host.sessions.getSessionSnapshot(channel);
    const dispatch = factory.dispatchAction.bind(factory);
    vi.spyOn(factory, "dispatchAction").mockImplementation((params) => {
      inVeto = true;
      try {
        return dispatch(params);
      } finally {
        inVeto = false;
      }
    });
    await expect(advertiser.client.joinSession(channel, [{ definition: contract, execute: () => ({ value: "forbidden" }) }])).rejects.toThrow();
    expect(closed).toBe(true);
    expect(f.host.sessions.getSessionSnapshot(channel)).toEqual(before);
  });
  for (const boundary of ["invoke", "result"] as const) {
    it("T05 revocation inside the final setup send check prevents " + boundary + " disclosure", async () => {
      let inSend = false;
      let revoked = false;
      const f = await setup({ roles: { caller: ["invoke"], executor: ["advertise", "execute"] }, onSecurityCheck: () => {
        if (!inSend || revoked) return;
        revoked = true;
        const scope = f.host.sessions.authorization?.getResource(channel);
        if (scope === undefined) throw new Error("Missing scope");
        f.registry.removeBinding({ bindingId: "fixture-grant-caller", scope, revision: 1 });
      } });
      const caller = await f.connect("caller");
      const executor = await f.connect("executor");
      const execute = vi.fn(() => ({ value: "final-result-canary" }));
      await executor.client.joinSession(channel, [{ definition: contract, execute }]);
      const subject = boundary === "invoke" ? "executor" : "caller";
      const record = [...f.contexts.values()].find((entry) => entry.context.actor.principal.subject === subject);
      const context = record === undefined ? undefined : capturedContexts.get(record.context.connectionId);
      if (context === undefined) throw new Error("Missing actual transport context");
      const original = context.send.bind(context);
      vi.spyOn(context, "send").mockImplementation((...args) => {
        const message = args[0];
        inSend = boundary === "invoke"
          ? "method" in message && message.method === "x-ahp/tools/invoke"
          : "result" in message && JSON.stringify(message.result).includes("final-result-canary");
        try {
          return original(...args);
        } finally {
          inSend = false;
        }
      });
      await expect(caller.client.callTool(channel, contract, { path: "final-input-canary" })).rejects.toThrow();
      expect(revoked).toBe(true);
      expect(execute).toHaveBeenCalledTimes(boundary === "invoke" ? 0 : 1);
      expect((boundary === "invoke" ? executor.frames : caller.frames).join("")).not.toContain(boundary === "invoke" ? "final-input-canary" : "final-result-canary");
    });
  }
  it("T01 subscribed caller without invoke is denied before executor send", async () => {
    const f = await setup({ roles: { caller: [], executor: ["advertise", "execute"] } });
    const caller = await f.connect("caller", "claimed-admin");
    const executor = await f.connect("executor");
    const execute = vi.fn(() => ({ value: "forbidden" }));
    await executor.client.joinSession(channel, [{ definition: contract, execute }]);
    const offset = executor.frames.length;
    await expect(caller.client.callTool(channel, contract, { path: "secret-input-canary" })).rejects.toThrow();
    await executor.client.client.ping();
    expect(execute).not.toHaveBeenCalled();
    expect(executor.frames.slice(offset).join("")).not.toContain("secret-input-canary");
  });

  it("T02 invoke-only and advertise-only clients cannot activate an executor", async () => {
    const f = await setup({ roles: { invoker: ["invoke"], advertiser: ["advertise"], receiver: ["execute"] } });
    for (const actor of ["invoker", "advertiser", "receiver"]) {
      const { client } = await f.connect(actor);
      await expect(client.joinSession(channel, [{ definition: contract, execute: () => ({ value: "forbidden" }) }])).rejects.toThrow();
    }
    expect(f.host.sessions.getSessionSnapshot(channel)?.state.activeClients).toEqual([]);
  });

  for (const invalidation of ["revoke", "disconnect", "rebind"] as const) {
    it("T03 " + invalidation + " during policy evaluation prevents advertisement reduction", async () => {
      const entered = gate<undefined>();
      const release = gate<"allow">();
      let armed = false;
      const f = await setup({ permission: () => {
        if (!armed) return Promise.resolve("allow");
        entered.resolve(undefined);
        return release.promise;
      } });
      const advertiser = await f.connect();
      const observer = await f.connect("fixture", "observer");
      const before = f.host.sessions.getSessionSnapshot(channel);
      armed = true;
      const joining = expect(advertiser.client.joinSession(channel, [{ definition: contract, execute: () => ({ value: "forbidden" }) }])).rejects.toThrow();
      await entered.promise;
      const record = [...f.contexts.values()][0];
      if (record === undefined) throw new Error("Missing actual security context");
      if (invalidation === "revoke") {
        const scope = f.host.sessions.authorization?.getResource(channel);
        if (scope === undefined) throw new Error("Missing resource");
        f.registry.removeBinding({ bindingId: "fixture-grant-fixture", scope, revision: 1 });
      } else if (invalidation === "disconnect") {
        await advertiser.client.shutdown();
        await record.released;
      } else {
        const tuple = record.tuples[0];
        if (tuple?.executor === undefined) throw new Error("Missing exact executor");
        f.registry.removeExecutorAssignment(tuple);
        f.registry.installExecutorAssignment({ ...tuple, executor: { ...tuple.executor, generation: tuple.executor.generation + 1 } });
      }
      armed = false;
      release.resolve("allow");
      await joining;
      await observer.client.client.ping();
      expect(f.host.sessions.getSessionSnapshot(channel)).toEqual(before);
    });
  }

  it("T04 two independently admitted executors deny without selecting either", async () => {
    const f = await setup();
    const caller = await f.connect("fixture", "caller");
    const a = await f.connect("fixture", "a");
    const b = await f.connect("fixture", "b");
    const executeA = vi.fn(() => ({ value: "a" }));
    const executeB = vi.fn(() => ({ value: "b" }));
    await a.client.joinSession(channel, [{ definition: contract, execute: executeA }]);
    await b.client.joinSession(channel, [{ definition: contract, execute: executeB }]);
    await expect(caller.client.callTool(channel, contract, { path: "ambiguous" })).rejects.toThrow();
    expect(executeA).not.toHaveBeenCalled();
    expect(executeB).not.toHaveBeenCalled();
  });

  it("T04 canonical empty metadata invalidates a previously admitted broker executor", async () => {
    const f = await setup();
    const caller = await f.connect("fixture", "caller");
    const executor = await f.connect("fixture", "executor");
    const execute = vi.fn(() => ({ value: "stale-canonical-row" }));
    await executor.client.joinSession(channel, [{ definition: contract, execute }]);
    f.host.sessions.dispatchAction({ channel, clientId: "executor", clientSeq: 99,
      action: { type: "session/activeClientSet", activeClient: { clientId: "executor", tools: [] } } });
    await expect(caller.client.callTool(channel, contract, { path: "removed" })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("T04 nested canonical removal during advertisement fanout prevents later broker activation", async () => {
    const f = await setup();
    const caller = await f.connect("fixture", "caller");
    const executor = await f.connect("fixture", "executor");
    const execute = vi.fn(() => ({ value: "stale-activation" }));
    let replaced = false;
    const unsubscribe = f.host.sessions.onSessionEnvelope((envelope) => {
      if (replaced || envelope.channel !== channel) return;
      replaced = true;
      f.host.sessions.dispatchAction({ channel, clientId: "executor", clientSeq: 99,
        action: { type: "session/activeClientSet", activeClient: { clientId: "executor", tools: [] } } });
    });
    await executor.client.joinSession(channel, [{ definition: contract, execute }]);
    unsubscribe();
    expect(replaced).toBe(true);
    expect(f.host.sessions.getSessionSnapshot(channel)?.state.activeClients[0]?.tools).toEqual([]);
    await expect(caller.client.callTool(channel, contract, { path: "removed-during-fanout" })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("T02 a same-ID invoke-only connection cannot clear another executor's canonical row", async () => {
    const f = await setup({ roles: { caller: ["invoke"], executor: ["advertise", "execute"] } });
    const executor = await f.connect("executor", "shared-id");
    await executor.client.joinSession(channel, [{ definition: contract, execute: () => ({ value: "ok" }) }]);
    const caller = await f.connect("caller", "shared-id");
    const before = f.host.sessions.getSessionSnapshot(channel);
    await expect(caller.client.joinSession(channel, [])).rejects.toThrow();
    expect(f.host.sessions.getSessionSnapshot(channel)).toEqual(before);
  });

  it("T05 distinct authenticated caller/executor receive only their private payloads", async () => {
    const f = await setup({ roles: { caller: ["invoke"], executor: ["advertise", "execute"], observer: [] } });
    const caller = await f.connect("caller");
    const executor = await f.connect("executor");
    const observer = await f.connect("observer");
    const execute = vi.fn(() => ({ value: "private-result-canary" }));
    await executor.client.joinSession(channel, [{ definition: contract, execute }]);
    const offset = observer.frames.length;
    await expect(caller.client.callTool(channel, contract, { path: "private-argument-canary" })).resolves.toEqual({ value: "private-result-canary" });
    await observer.client.client.ping();
    expect(execute).toHaveBeenCalledOnce();
    expect(observer.frames.slice(offset).join("")).not.toContain("private-argument-canary");
    expect(observer.frames.slice(offset).join("")).not.toContain("private-result-canary");
    const facts = [...f.contexts.values()];
    expect(facts.map((entry) => entry.context.actor.principal.subject)).toEqual(["caller", "executor", "observer"]);
    expect(new Set(facts.map((entry) => entry.fence.connectionGeneration)).size).toBe(3);
  });

  it("T05 revoked caller cannot receive a completed remote result", async () => {
    const f = await setup({ roles: { caller: ["invoke"], executor: ["advertise", "execute"] } });
    const caller = await f.connect("caller");
    const executor = await f.connect("executor");
    const entered = gate<undefined>();
    const finish = gate<{ value: string }>();
    await executor.client.joinSession(channel, [{ definition: contract, execute: () => {
      entered.resolve(undefined);
      return finish.promise;
    } }]);
    const result = expect(caller.client.callTool(channel, contract, { path: "allowed-before-revoke" })).rejects.toThrow();
    await entered.promise;
    const scope = f.host.sessions.authorization?.getResource(channel);
    if (scope === undefined) throw new Error("Missing scope");
    f.registry.removeBinding({ bindingId: "fixture-grant-caller", scope, revision: 1 });
    finish.resolve({ value: "revoked-result-canary" });
    await result;
    await caller.client.client.ping();
    expect(caller.frames.join("")).not.toContain("revoked-result-canary");
  });

  it("T06 shutdown reports unresolved remote draining without pretending termination", async () => {
    const f = await setup();
    const { client } = await f.connect();
    const entered = gate<undefined>();
    const never = gate<{ value: string }>();
    await client.joinSession(channel, [{ definition: contract, execute: () => {
      entered.resolve(undefined);
      return never.promise;
    } }]);
    const result = expect(client.callTool(channel, contract, { path: "parked" })).rejects.toThrow();
    await entered.promise;
    await f.host.stop();
    await result;
    expect(f.host.toolExecutionStats()).toMatchObject({ active: 1, draining: 1 });
    never.resolve({ value: "settled-only-on-disconnected-client" });
    expect(f.host.toolExecutionStats().draining).toBe(1);
  });
});

describe("P09 canonical reducer veto", () => {
  it("consumes a rejecting malformed async veto without reducing state", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()] });
    await factory.createSession({ channel });
    const before = factory.getSessionSnapshot(channel);
    const result = factory.dispatchAction({ channel, clientId: "owner", clientSeq: 1,
      action: { type: "session/activeClientSet", activeClient: { clientId: "owner", tools: [] } },
      admission: () => Promise.reject(new Error("private-veto-error")) as unknown as boolean });
    expect(result.rejectionReason).toBeDefined();
    expect(factory.getSessionSnapshot(channel)).toEqual(before);
    await factory.dispose();
  });
  it("rejects an outer action after cross-session reentrant publication", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()] });
    const other = "ahp-session:/other";
    await factory.createSession({ channel });
    await factory.createSession({ channel: other });
    const before = factory.getSessionSnapshot(channel);
    const sequences: number[] = [];
    factory.onSessionEnvelope((envelope) => {
      sequences.push(envelope.serverSeq);
    });
    const action = { type: "session/activeClientSet", activeClient: { clientId: "owner", tools: [] } };
    const result = factory.dispatchAction({ channel, clientId: "owner", clientSeq: 1, action,
      admission: () => {
        factory.dispatchAction({ channel: other, clientId: "owner", clientSeq: 1, action });
        return true;
      } });
    expect(result.rejectionReason).toBeDefined();
    expect(sequences).toHaveLength(1);
    expect(factory.getSessionSnapshot(channel)).toEqual(before);
    expect(result.serverSeq).toBeGreaterThan(sequences[0] ?? 0);
    await factory.dispose();
  });
  it("rejects an outer action after same-record reentrant reduction without sequence regression", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()] });
    await factory.createSession({ channel });
    const sequences: number[] = [];
    factory.onSessionEnvelope((envelope) => {
      sequences.push(envelope.serverSeq);
    });
    const nested = { channel, clientId: "owner", clientSeq: 2,
      action: { type: "session/activeClientSet", activeClient: { clientId: "nested", tools: [] } } };
    const result = factory.dispatchAction({ channel, clientId: "owner", clientSeq: 1,
      action: { type: "session/activeClientSet", activeClient: { clientId: "outer", tools: [] } },
      admission: () => {
        factory.dispatchAction(nested);
        return true;
      } });
    expect(result.rejectionReason).toBeDefined();
    expect(sequences).toHaveLength(1);
    expect(result.serverSeq).toBeGreaterThan(sequences[0] ?? 0);
    expect(factory.getSessionSnapshot(channel)?.state.activeClients.map((client) => client.clientId)).toEqual(["nested"]);
    await factory.dispose();
  });
  for (const value of [false, "truthy", Promise.resolve(true)] as const) {
    it("requires exact synchronous true for " + (typeof value === "object" ? "Promise" : String(value)), async () => {
      const factory = createSessionsFactory({ providers: [createMockProvider()] });
      await factory.createSession({ channel });
      const before = factory.getSessionSnapshot(channel);
      const result = factory.dispatchAction({ channel, clientId: "owner", clientSeq: 1,
        action: { type: "session/activeClientSet", activeClient: { clientId: "owner", tools: [] } }, admission: () => value as boolean });
      expect(result.rejectionReason).toBeDefined();
      expect(factory.getSessionSnapshot(channel)).toEqual(before);
      await factory.dispose();
    });
  }
  for (const hook of ["clock", "sequence", "veto"] as const) {
    it("rechecks record ownership after reentrant " + hook, async () => {
      let armed = false;
      let disposal: Promise<void> | undefined;
      const sequence = createActionSequence();
      const remove = () => {
        if (armed) {
          armed = false;
          disposal = factory.disposeSession({ channel });
        }
      };
      const factory = createSessionsFactory({ providers: [createMockProvider()],
        now: () => {
          if (hook === "clock") remove();
          return new Date();
        },
        sequence: { current: sequence.current.bind(sequence), next: () => {
          if (hook === "sequence") remove();
          return sequence.next();
        } } });
      await factory.createSession({ channel });
      armed = true;
      const result = factory.dispatchAction({ channel, clientId: "owner", clientSeq: 1,
        action: { type: "session/activeClientSet", activeClient: { clientId: "owner", tools: [] } }, admission: () => {
          if (hook === "veto") remove();
          return true;
        } });
      expect(result.rejectionReason).toBeDefined();
      expect(factory.getSessionSnapshot(channel)).toBeUndefined();
      await disposal;
      await factory.dispose();
    });
  }
});

describe("P09 actual transport malformed admission", () => {
  for (const boundary of ["message", "reply"] as const) {
    it("consumes a rejecting async " + boundary + " veto without disclosure", async () => {
      const server = createWebSocketServer({ host: "127.0.0.1", port: 0, handlers: {
        protected: (_params, context, invocation) => {
          const guard = () => Promise.reject(new Error("private-guard-error")) as unknown as boolean;
          if (boundary === "message") {
            expect(context.send({ jsonrpc: "2.0", method: "private-canary", params: {} }, guard)).toBe(false);
            return null;
          }
          invocation.guardReply?.(guard);
          return { value: "private-canary" };
        }, ping: () => null,
      } });
      const address = await server.start();
      const socket = new WebSocket("ws://127.0.0.1:" + String(address.port) + "/");
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        const frames = new FrameLog(socket);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "protected", params: {} }));
        const response = await frames.waitFor(responseWithId(1));
        expect(response).toMatchObject(boundary === "reply" ? { error: { code: -32602 } } : { result: null });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping", params: {} }));
        await frames.waitFor(responseWithId(2));
        expect(JSON.stringify(frames.frames)).not.toContain("private-canary");
        expect(JSON.stringify(frames.frames)).not.toContain("private-guard-error");
      } finally {
        socket.terminate();
        await server.stop();
      }
    });
  }
});

import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AHPServerHandle, WebSocketConnectionContext } from "@websocket";
import { createToolPolicyHost, connectPolicyTransport, toolPolicyChannel as channel } from "./toolPolicyFixture";
import { connectToolClient, type ToolClient, type ToolInvocationContext } from "@tool/client";
import { FrameLog, responseWithId } from "./helpers";
import { contract } from "../tool/execution/fixtures";
import { parseToolWire, toolAssignedReplySchema, toolAdvertiseReplySchema, toolDispatchReplySchema, toolInvokeSchema, toolStatusReplySchema } from "@tool/protocol";

// Real supported public binding. No kernel substitution or policy mocks.
const restrictions = vi.hoisted((): { adapter?: import("@websocket/helpers/ahp/types").AHPBindingOptions["prepareToolWork"] } => ({}));
const contexts = vi.hoisted(() => new Map<string, WebSocketConnectionContext>());
vi.mock("@websocket/helpers/ahp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@websocket/helpers/ahp")>();
  return { ...actual, createAHPBinding: (...args: Parameters<typeof actual.createAHPBinding>) => {
    const binding = restrictions.adapter === undefined
      ? actual.createAHPBinding(...args)
      : actual.createAHPBinding(args[0], args[1], { ...args[2], prepareToolWork: restrictions.adapter });
    return { ...binding, onConnection: (context: WebSocketConnectionContext) => {
      contexts.set(context.connectionId, context);
      binding.onConnection(context);
    } };
  } };
});
const hosts: AHPServerHandle[] = [];
const sockets: WebSocket[] = [];
const clients: ToolClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  delete restrictions.adapter;
  vi.restoreAllMocks();
});

it("denies a call when two current executor advertisements match the contract", async () => {
  const subjects = ["caller", "first-executor", "second-executor"];
  const f = await createToolPolicyHost([contract], {
    protectedViews: true,
    toolDiscovery: subjects,
    roles: { "caller": ["discover", "invoke"],
      "first-executor": ["discover", "advertise", "execute"],
      "second-executor": ["discover", "advertise", "execute"] },
  });
  hosts.push(f.host);
  const address = await f.host.start();
  const connect = async (subject: string) => {
    const transport = await connectPolicyTransport(`ws://127.0.0.1:${String(address.port)}/capacity`, subject);
    const client = await connectToolClient({ transport, ownership: "owned" }, { clientId: subject, protocolVersions: ["1.0.0"] });
    clients.push(client);
    return client;
  };
  const caller = await connect("caller");
  const first = await connect("first-executor");
  const second = await connect("second-executor");
  await caller.connection.protocol.subscribe(channel);
  const executeFirst = vi.fn(() => ({ value: "first" }));
  const executeSecond = vi.fn(() => ({ value: "second" }));
  await first.joinSession(channel, [{ definition: contract, execute: executeFirst }]);
  await second.joinSession(channel, [{ definition: contract, execute: executeSecond }]);
  const selector = { id: contract.id, key: contract.key, version: contract.version };
  await expect(caller.dispatchTool(channel, selector, { path: "same-contract" })).resolves.toMatchObject({ status: "denied" });
  expect(executeFirst).not.toHaveBeenCalled();
  expect(executeSecond).not.toHaveBeenCalled();
});

it.each(["completed", "cancelled", "revoked", "work-scoped"] as const)("W04/W05 public SDK local execution has a %s result without releasing forbidden output", async (outcome) => {
  const work = { workId: "bbbbbbbb-aaaa-4444-8888-eeeeeeeeeeee", attempt: 1, leaseToken: "aaaaaaaa-bbbb-4444-8888-eeeeeeeeeeee" };
  let current = true;
  const release = vi.fn();
  if (outcome === "work-scoped") {
    restrictions.adapter = (connection, caller, execution, route, input) => {
      expect(connection.security?.context).toEqual(caller);
      expect(caller.actor.principal.subject).toBe("caller");
      expect(execution).toEqual(work);
      expect(route.origin.id).toBe(channel);
      expect(input).toEqual({ path: "SDK-INPUT-CANARY" });
      return Promise.resolve({ current: () => current, fence: () => current, release });
    };
  }
  const f = await createToolPolicyHost([contract], { protectedViews: true, toolDiscovery: ["caller", "executor"],
    roles: { caller: ["discover", "invoke"], executor: ["discover", "advertise", "execute"] } });
  hosts.push(f.host);
  const address = await f.host.start();
  const incoming = new Map<string, string[]>();
  const connect = async (token: string) => {
    const inner = await connectPolicyTransport("ws://127.0.0.1:" + String(address.port) + "/capacity", token);
    const frames: string[] = [];
    incoming.set(token, frames);
    const transport = { send: inner.send.bind(inner), close: inner.close.bind(inner), recv: async () => {
      const frame = await inner.recv();
      if (frame?.kind === "text") frames.push(frame.text);
      return frame;
    } };
    const client = await connectToolClient({ transport, ownership: "owned" }, { clientId: token, protocolVersions: ["1.0.0"] });
    clients.push(client);
    return client;
  };
  const caller = await connect("caller"), executor = await connect("executor");
  await caller.connection.protocol.subscribe(channel);
  const entered = Promise.withResolvers<ToolInvocationContext>();
  const finish = Promise.withResolvers<{ value: string }>();
  const execute = vi.fn((input: unknown, context: ToolInvocationContext) => {
    expect(input).toEqual({ path: "SDK-INPUT-CANARY" });
    expect(context.contract).toEqual({ id: contract.id, key: contract.key, version: contract.version });
    expect(context.route.origin).toEqual(f.host.sessions.authorization?.getResource(channel));
    expect(context.signal.aborted).toBe(false);
    entered.resolve(context);
    return outcome === "completed" ? { value: "SDK-RESULT-CANARY" } : finish.promise;
  });
  await executor.joinSession(channel, [{ definition: contract, execute }]);
  if (outcome === "completed") {
    const selector = { id: contract.id, key: contract.key, version: contract.version };
    await expect(caller.dispatchTool(channel, selector, { path: "SDK-INPUT-CANARY" }, { work })).resolves.toMatchObject({ status: "denied" });
    await expect(caller.callTool(channel, contract, { path: "SDK-INPUT-CANARY" }, { work })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    await expect(caller.callTool(channel, contract, { path: "SDK-INPUT-CANARY" })).resolves.toEqual({ value: "SDK-RESULT-CANARY" });
  } else {
    const receipt = await caller.dispatchTool(channel, { id: contract.id, key: contract.key, version: contract.version }, { path: "SDK-INPUT-CANARY" }, outcome === "work-scoped" ? { work } : undefined);
    if (receipt.status !== "accepted") throw new Error("Missing SDK receipt");
    const context = await entered.promise;
    if (outcome === "cancelled") {
      expect(await caller.cancelTool(receipt.callId)).toMatchObject({ status: "draining" });
      await executor.connection.protocol.ping();
      expect(context.signal.aborted).toBe(true);
      expect(await caller.statusTool(receipt.callId)).toMatchObject({ status: "draining" });
    } else if (outcome === "work-scoped") {
      expect(JSON.stringify(context)).not.toContain(work.leaseToken);
      expect(incoming.get("executor")?.join("")).not.toContain(work.leaseToken);
      current = false;
    } else {
      const scope = f.host.sessions.authorization?.getResource(channel);
      if (scope === undefined) throw new Error("Missing scope");
      f.registry.removeBinding({ bindingId: "fixture-grant-caller", scope, revision: 1 });
    }
    finish.resolve({ value: "SDK-FORBIDDEN-LATE-RESULT" });
    await finish.promise;
    await executor.connection.protocol.ping();
    if (outcome === "cancelled") {
      await vi.waitFor(async () => {
        expect(await caller.statusTool(receipt.callId)).toMatchObject({ status: "cancelled" });
      });
    } else if (outcome === "work-scoped") {
      expect(await caller.statusTool(receipt.callId)).toMatchObject({ status: "unavailable" });
      await caller.shutdown();
      await vi.waitFor(() => {
        expect(release).toHaveBeenCalledOnce();
      });
    } else {
      // Revoking the binding also revokes native resource-read access; P10 closes that view.
      await vi.waitFor(() => {
        expect([...f.contexts.values()].some((entry) => entry.context.actor.principal.subject === "caller")).toBe(false);
      });
      await expect(caller.statusTool(receipt.callId)).rejects.toThrow("closed");
    }
    expect(incoming.get("caller")?.join("")).not.toContain("SDK-FORBIDDEN-LATE-RESULT");
  }
  expect(execute).toHaveBeenCalledOnce();
});
function result(frame: unknown): unknown {
  if (typeof frame !== "object" || frame === null || !("result" in frame)) throw new Error("Expected successful private response: " + JSON.stringify(frame));
  return frame.result;
}
const setup = async (options: Parameters<typeof createToolPolicyHost>[1] = {}) => {
  const f = await createToolPolicyHost([{ ...contract, description: "PRIVATE-DESCRIPTOR-CANARY" }], { protectedViews: true,
    toolDiscovery: ["caller", "executor"], roles: { caller: ["discover", "invoke"], executor: ["discover", "advertise", "execute"], observer: ["discover"] }, ...options });
  hosts.push(f.host);
  const address = await f.host.start();
  const connect = async (token: string) => {
    const socket = new WebSocket("ws://127.0.0.1:" + String(address.port) + "/capacity", "r5-" + token);
    sockets.push(socket);
    const frames = new FrameLog(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let id = 0;
    const request = (method: string, params: unknown) => {
      const next = ++id;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: next, method, params }));
      return frames.waitFor(responseWithId(next));
    };
    await request("initialize", { channel: "ahp-root://", clientId: token, protocolVersions: ["1.0.0"], initialSubscriptions: [] });
    return { socket, frames, request };
  };
  return { ...f, connect };
};

it("W01 negotiates without inventory and rejects old versions, old calls and authority-bearing selectors", async () => {
  const f = await setup();
  const caller = await f.connect("caller");
  expect(await caller.request("x-ahp/tools/assigned", { version: 1, channel })).toHaveProperty("error");
  expect(await caller.request("x-ahp/tools/capabilities", { version: 2 })).toHaveProperty("error");
  expect(result(await caller.request("x-ahp/tools/capabilities", { version: 1 }))).toEqual({ version: 1, assignments: true, dispatch: true, continuation: false });
  expect(JSON.stringify(caller.frames.frames)).not.toContain("PRIVATE-DESCRIPTOR-CANARY");
  expect(await caller.request("x-ahp/tools/call", { channel, key: contract.key, version: contract.version, input: {} })).toMatchObject({ error: { code: -32601 } });
  expect(await caller.request("x-ahp/tools/assigned", { version: 1, channel, roles: ["admin"] })).toHaveProperty("error");
  expect(caller.frames.frames.some((frame) => JSON.stringify(frame).includes("\"method\":\"x-ahp/tools/invoke\""))).toBe(false);
});

it("W02/W03/W04 privately advertises, returns a prompt receipt and scopes exact completions/results while control traffic proceeds", async () => {
  const f = await setup();
  const caller = await f.connect("caller"), executor = await f.connect("executor"), observer = await f.connect("observer");
  for (const peer of [caller, executor, observer]) {
    await peer.request("x-ahp/tools/capabilities", { version: 1 });
    await peer.request("subscribe", { channel });
  }
  const hidden = parseToolWire(toolAssignedReplySchema, result(await observer.request("x-ahp/tools/assigned", { version: 1, channel })));
  expect(hidden.tools).toEqual([]);
  const assigned = parseToolWire(toolAssignedReplySchema, result(await executor.request("x-ahp/tools/assigned", { version: 1, channel })));
  expect(assigned.tools).toHaveLength(1);
  expect(assigned.tools[0]?.purposes).toEqual(["discover", "advertise", "execute"]);
  const selector = { id: contract.id, key: contract.key, version: contract.version };
  const ack = parseToolWire(toolAdvertiseReplySchema, result(await executor.request("x-ahp/tools/advertise", {
    version: 1, channel, viewRevision: assigned.viewRevision, contracts: [selector],
  })));
  expect(ack.tools).toEqual(assigned.tools);
  expect(ack.resource).toEqual(f.host.sessions.authorization?.getResource(channel));
  const receipt = parseToolWire(toolDispatchReplySchema, result(await caller.request("x-ahp/tools/dispatch", {
    version: 1, channel, contract: selector, input: { path: "PRIVATE-ARGUMENT-CANARY" },
  })));
  if (receipt.status !== "accepted") throw new Error("Expected admitted call");
  const frame = await executor.frames.waitFor((value) => typeof value === "object" && value !== null && "method" in value && value.method === "x-ahp/tools/invoke");
  if (typeof frame !== "object" || frame === null || !("params" in frame)) throw new Error("Missing invoke");
  const invoke = parseToolWire(toolInvokeSchema, frame.params);
  expect(invoke.advertisementId).toBe(ack.advertisementId);
  expect(invoke.connection).toEqual(ack.connection);
  expect(invoke.execution).toEqual(ack.tools[0]?.execution);
  expect(invoke.route).toEqual({ origin: ack.resource, targets: [ack.resource] });
  expect(invoke.input).toEqual({ path: "PRIVATE-ARGUMENT-CANARY" });
  expect(await caller.request("ping", { channel: "ahp-root://" })).not.toHaveProperty("error");
  expect(result(await observer.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toEqual({ version: 1, status: "unavailable" });
  expect(result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "running" });
  const { input: _input, ...correlation } = invoke;
  expect(_input).toBeDefined();
  for (const invalid of [
    { callId: invoke.callId, channel, key: contract.key, version: contract.version, output: { value: "UNVERSIONED-RESULT" } },
    { ...correlation, version: 2, output: { value: "WRONG-WIRE-VERSION" } },
    { ...correlation, advertisementId: crypto.randomUUID(), output: { value: "UNOWNED-ADVERTISEMENT" } },
  ]) {
    executor.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: invalid }));
    await executor.request("ping", { channel: "ahp-root://" });
    expect(result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "running" });
  }
  observer.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: { ...correlation, output: { value: "FORGED-COMPLETION" } } }));
  await observer.request("ping", { channel: "ahp-root://" });
  expect(result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "running" });
  executor.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: { ...correlation, output: { value: "PRIVATE-RESULT-CANARY" } } }));
  await vi.waitFor(async () => {
    const status = parseToolWire(toolStatusReplySchema, result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId })));
    expect(status).toEqual({ version: 1, callId: receipt.callId, status: "completed", output: { value: "PRIVATE-RESULT-CANARY" } });
  });
  const wire = JSON.stringify(observer.frames.frames);
  for (const canary of ["PRIVATE-DESCRIPTOR-CANARY", "PRIVATE-ARGUMENT-CANARY", "PRIVATE-RESULT-CANARY"]) expect(wire).not.toContain(canary);
});

it("W04 final status admission suppresses output when a later setup callback crosses retention TTL", async () => {
  const base = Date.now();
  let time = base;
  let advance = false;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  const f = await setup({ registryNow: () => base, securityNow: () => base, onSecurityCheck: () => {
    if (advance) time = base + 60_001;
  } });
  const caller = await f.connect("caller"), executor = await f.connect("executor");
  for (const peer of [caller, executor]) {
    await peer.request("x-ahp/tools/capabilities", { version: 1 });
    await peer.request("subscribe", { channel });
  }
  const assigned = parseToolWire(toolAssignedReplySchema, result(await executor.request("x-ahp/tools/assigned", { version: 1, channel })));
  const selector = { id: contract.id, key: contract.key, version: contract.version };
  await executor.request("x-ahp/tools/advertise", { version: 1, channel, viewRevision: assigned.viewRevision, contracts: [selector] });
  const receipt = parseToolWire(toolDispatchReplySchema, result(await caller.request("x-ahp/tools/dispatch", { version: 1, channel, contract: selector, input: { path: "retained" } })));
  if (receipt.status !== "accepted") throw new Error("Missing receipt");
  const frame = await executor.frames.waitFor((value) => typeof value === "object" && value !== null && "method" in value && value.method === "x-ahp/tools/invoke");
  if (typeof frame !== "object" || frame === null || !("params" in frame)) throw new Error("Missing invocation");
  const { input, ...correlation } = parseToolWire(toolInvokeSchema, frame.params);
  expect(input).toEqual({ path: "retained" });
  executor.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: { ...correlation, output: { value: "EXPIRING-RESULT-CANARY" } } }));
  await vi.waitFor(async () => {
    expect(result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "completed" });
  });
  const callerId = [...f.contexts.values()].find((entry) => entry.context.actor.principal.subject === "caller")?.context.connectionId;
  const context = callerId === undefined ? undefined : contexts.get(callerId);
  if (context === undefined) throw new Error("Missing actual caller context");
  const send = context.send.bind(context);
  context.send = (message, admission) => {
    const completed = "result" in message && typeof message.result === "object" && message.result !== null
      && "status" in message.result && message.result.status === "completed";
    return send(message, admission === undefined
      ? undefined
      : () => {
          if (completed) advance = true;
          return admission();
        });
  };
  time = base + 59_999;
  const from = caller.frames.frames.length;
  expect(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId })).toHaveProperty("error");
  expect(advance).toBe(true);
  expect(JSON.stringify(caller.frames.frames.slice(from))).not.toContain("EXPIRING-RESULT-CANARY");
});

it("W03 cancellation signals only the selected executor and keeps work draining until exact completion", async () => {
  const f = await setup();
  const caller = await f.connect("caller"), executor = await f.connect("executor"), observer = await f.connect("observer");
  for (const peer of [caller, executor, observer]) {
    await peer.request("x-ahp/tools/capabilities", { version: 1 });
    await peer.request("subscribe", { channel });
  }
  const assigned = parseToolWire(toolAssignedReplySchema, result(await executor.request("x-ahp/tools/assigned", { version: 1, channel })));
  const selector = { id: contract.id, key: contract.key, version: contract.version };
  await executor.request("x-ahp/tools/advertise", { version: 1, channel, viewRevision: assigned.viewRevision, contracts: [selector] });
  const receipt = parseToolWire(toolDispatchReplySchema, result(await caller.request("x-ahp/tools/dispatch", { version: 1, channel, contract: selector, input: { path: "CANCEL-INPUT-CANARY" } })));
  if (receipt.status !== "accepted") throw new Error("Missing receipt");
  const frame = await executor.frames.waitFor((value) => typeof value === "object" && value !== null && "method" in value && value.method === "x-ahp/tools/invoke");
  if (typeof frame !== "object" || frame === null || !("params" in frame)) throw new Error("Missing invocation");
  const { input, ...correlation } = parseToolWire(toolInvokeSchema, frame.params);
  expect(input).toEqual({ path: "CANCEL-INPUT-CANARY" });
  expect(result(await observer.request("x-ahp/tools/cancel", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "unavailable" });
  expect(result(await caller.request("x-ahp/tools/cancel", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "draining" });
  await executor.request("ping", { channel: "ahp-root://" });
  const cancellations = executor.frames.frames.filter((value) => typeof value === "object" && value !== null && "method" in value && value.method === "x-ahp/tools/cancel");
  expect(cancellations).toEqual([{ jsonrpc: "2.0", method: "x-ahp/tools/cancel", params: correlation }]);
  expect(result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "draining" });
  executor.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: { ...correlation, output: { value: "LATE-CANCEL-RESULT" } } }));
  await vi.waitFor(async () => {
    expect(result(await caller.request("x-ahp/tools/status", { version: 1, callId: receipt.callId }))).toMatchObject({ status: "cancelled" });
  });
  expect(JSON.stringify(observer.frames.frames)).not.toContain(receipt.callId);
  expect(JSON.stringify(caller.frames.frames)).not.toContain("LATE-CANCEL-RESULT");
});

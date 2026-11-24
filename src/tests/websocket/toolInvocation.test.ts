import { afterEach, describe, expect, it, vi } from "vitest";

import { parseUnknownJson } from "@jsonrpc";
import { toolAssignedReplySchema } from "@tool/protocol";
import { connectToolClient, type ToolClient } from "@tool/client";
import { defineToolContract, toAhpToolDefinition } from "@tool";
import { type AHPServerHandle } from "@websocket";

import { createToolPolicyHost, connectPolicyTransport } from "./toolPolicyFixture";

const definition = defineToolContract({
  id: "11111111-1111-4111-8111-111111111111", key: "test.echo", version: 2, name: "echo",
  schemaDialect: "draft-07",
  inputSchema: {
    type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false,
  },
  outputSchema: {
    type: "object", properties: { result: { type: "string" } }, required: ["result"], additionalProperties: false,
  },
});
const hosts: AHPServerHandle[] = [];
const clients: Array<{ shutdown(): Promise<void> }> = [];
const channel = "ahp-session:/capacity";
const ref = { key: definition.key, version: definition.version };

it("preserves all 64 tools supported by the canonical session type and rejects 129 without replacing them", async () => {
  const count = 64;
  const definitions = Array.from({ length: count }, (_, index) => defineToolContract({ ...definition,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, key: `test.capacity${String(index)}`, name: `capacity${String(index)}` }));
  const { host, url, caller } = await fixture(definitions);
  const executor = await openToolClient(url, "executor");
  const handlers = definitions.map((definition) => ({ definition, execute: vi.fn(() => ({ result: definition.key })) }));
  await executor.joinSession(channel, handlers);
  const last = definitions.at(-1);
  if (last === undefined) throw new Error("Missing boundary contract");
  await expect(caller.callTool(channel, last, { text: "boundary" })).resolves.toEqual({ result: last.key });
  expect(handlers.at(-1)?.execute).toHaveBeenCalledOnce();
  for (const handler of handlers.slice(0, -1)) expect(handler.execute).not.toHaveBeenCalled();
  const before = host.sessions.getSessionSnapshot(channel);
  if (before === undefined) throw new Error("Missing canonical session");
  const view = await executor.connection.rpc.request("x-ahp/tools/assigned", { version: 1, channel });
  const { viewRevision } = toolAssignedReplySchema.parse(view);
  await expect(executor.connection.rpc.request("x-ahp/tools/advertise", { version: 1, channel, viewRevision,
    contracts: Array.from({ length: 129 }, () => ({ id: last.id, key: last.key, version: last.version })) })).rejects.toThrow();
  expect(host.sessions.getSessionSnapshot(channel)?.state.activeClients).toEqual(before.state.activeClients);
  await expect(caller.callTool(channel, last, { text: "retained" })).resolves.toEqual({ result: last.key });
  expect(handlers.at(-1)?.execute).toHaveBeenCalledTimes(2);
}, 10_000);

it.each([65, 128])("preserves the existing session-type rejection of %i tools", async (count) => {
  const definitions = Array.from({ length: count }, (_, index) => defineToolContract({ ...definition,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, key: `test.capacity${String(index)}`, name: `capacity${String(index)}` }));
  await expect(createToolPolicyHost(definitions)).rejects.toThrow("Session type has too many tools");
});

async function fixture(definitions = [definition]) {
  const { host, recreate } = await createToolPolicyHost(definitions, {
    protectedViews: true, roles: { fixture: ["discover", "invoke", "advertise", "execute"], observer: ["discover"] },
    toolDiscovery: ["fixture"], assignment: (subject) => subject === "fixture", registryCaps: { maxToolAssignments: 256 },
  });
  hosts.push(host);
  const address = await host.start();
  const url = "ws://127.0.0.1:" + String(address.port) + "/capacity";
  const caller = await openToolClient(url, "caller");
  await caller.connection.protocol.subscribe(channel);
  return { host, url, caller, recreate };
}

async function openToolClient(url: string, clientId: string, subject = "fixture"): Promise<ToolClient> {
  const client = await connectToolClient({ transport: await connectPolicyTransport(url, subject), ownership: "owned" }, { clientId, protocolVersions: ["1.0.0"] });
  clients.push(client);
  return client;
}

function textInput(input: unknown): string {
  if (typeof input !== "object" || input === null || !("text" in input) || typeof input.text !== "string") {
    throw new Error("Invalid echo input");
  }
  return input.text;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

describe("end-to-end client tool capacity", () => {
  it("executes contract version 2 over a private V1 invocation while native metadata stays independent", async () => {
    const { host, url, caller } = await fixture();
    const inner = await connectPolicyTransport(url);
    const frames: unknown[] = [];
    const transport = { send: inner.send.bind(inner), close: inner.close.bind(inner), async recv() {
      const frame = await inner.recv();
      if (frame?.kind === "text") frames.push(parseUnknownJson(frame.text));
      return frame;
    } };
    const executor = await connectToolClient({ transport, ownership: "owned" }, { clientId: "executor", protocolVersions: ["1.0.0"] });
    clients.push(executor);
    const execute = vi.fn((_input: unknown, invocation: import("@tool/client").ToolInvocationContext) => {
      expect(invocation.version).toBe(2);
      expect(invocation.contract.version).toBe(2);
      return { result: "private" };
    });
    await host.sessions.dispatchAction({ channel, clientId: "executor", clientSeq: 1, action: { type: "session/activeClientSet",
      activeClient: { clientId: "executor", tools: [toAhpToolDefinition(definition)] } } });
    await expect(caller.callTool(channel, ref, { text: "metadata-only" })).rejects.toThrow();
    const before = host.sessions.getSessionSnapshot(channel);
    await executor.joinSession(channel, [{ definition, execute }]);
    await expect(caller.callTool(channel, ref, { text: "private-input" })).resolves.toEqual({ result: "private" });
    expect(execute).toHaveBeenCalledOnce();
    const invocations = frames.filter((frame) => frame && typeof frame === "object" && "method" in frame && frame.method === "x-ahp/tools/invoke");
    expect(invocations).toMatchObject([{ jsonrpc: "2.0", params: { version: 1, contract: { id: definition.id, version: 2 } } }]);
    expect(host.sessions.getSessionSnapshot(channel)).toEqual(before);
  });
  it("denies invalid input, unassigned tools and outsider calls without executing; rejects invalid output", async () => {
    const { url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    const outsider = await openToolClient(url, "outsider");
    let executions = 0;
    await executor.joinSession(channel, [{ definition, execute: (input) => {
      executions += 1;
      return textInput(input) === "wrong-output" ? { result: 42 } : { result: "ok" };
    } }]);
    await executor.connection.protocol.ping();
    await expect(caller.callTool(channel, ref, { text: 3 })).rejects.toThrow();
    await expect(caller.callTool(channel, { key: "test.not-assigned", version: 1 }, {})).rejects.toThrow();
    await expect(outsider.callTool(channel, ref, { text: "outsider" })).rejects.toThrow();
    expect(executions).toBe(0);
    await expect(caller.callTool(channel, ref, { text: "wrong-output" })).rejects.toThrow();
    expect(executions).toBe(1);
  });

  it("keeps the eligible executor available when another connection uses the same label", async () => {
    const { url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    const execute = vi.fn(() => ({ result: "ok" }));
    await executor.joinSession(channel, [{ definition, execute }]);
    await executor.connection.protocol.ping();
    await openToolClient(url, "executor", "observer");
    await expect(caller.callTool(channel, ref, { text: "hello" })).resolves.toEqual({ result: "ok" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not inherit stale advertisements on a replacement connection", async () => {
    const { host, url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    const execute = vi.fn(() => ({ result: "ok" }));
    await executor.joinSession(channel, [{ definition, execute }]);
    await executor.connection.protocol.ping();
    await executor.shutdown();
    const replacement = await openToolClient(url, "executor");
    await replacement.connection.protocol.subscribe(channel);
    // No accepted advertisement on this new socket.
    expect(host.sessions.getSessionSnapshot(channel)?.state.activeClients.some((active) => active.clientId === "executor"))
      .toBe(false);
    await expect(caller.callTool(channel, ref, { text: "stale" })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("settles an in-flight call on executor disconnect and on session removal/URI reuse", async () => {
    const { host, url, caller, recreate } = await fixture();
    const executor = await openToolClient(url, "executor");
    const started = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<{ result: string }>();
    await executor.joinSession(channel, [{ definition, execute: () => {
      started.resolve(undefined);
      return finish.promise;
    } }]);
    await executor.connection.protocol.ping();
    const result = expect(caller.callTool(channel, ref, { text: "pending" })).rejects.toThrow();
    await started.promise;
    await executor.shutdown();
    await result;
    finish.resolve({ result: "too-late" });

    const second = await openToolClient(url, "second");
    const nextStarted = Promise.withResolvers<undefined>();
    const nextFinish = Promise.withResolvers<{ result: string }>();
    await second.joinSession(channel, [{ definition, execute: () => {
      nextStarted.resolve(undefined);
      return nextFinish.promise;
    } }]);
    await second.connection.protocol.ping();
    const nextResult = expect(caller.callTool(channel, ref, { text: "old-generation" })).rejects.toThrow();
    await nextStarted.promise;
    const original = host.sessions.authorization?.getResource(channel);
    if (!original) throw new Error("Missing session");
    await host.sessions.authorization?.disposeSession(original);
    await nextResult;
    await recreate();
    const recreated = host.sessions.getSessionSnapshot(channel);
    nextFinish.resolve({ result: "old-generation-output" });
    const replacement = await openToolClient(url, "replacement");
    await replacement.joinSession(channel, [{ definition, execute: () => ({ result: "new-generation" }) }]);
    await expect(replacement.callTool(channel, ref, { text: "new" })).resolves.toEqual({ result: "new-generation" });
    expect(recreated?.state).toBeDefined();
    expect(host.sessions.authorization?.getResource(channel)?.instanceId).not.toBe(original.instanceId);
    expect(host.sessions.getSessionSnapshot(channel)).toEqual(recreated);
  });

  it("settles a deferred self-call when the host stops", async () => {
    const { host, caller } = await fixture();
    const started = Promise.withResolvers<undefined>();
    const neverFinish = Promise.withResolvers<{ result: string }>();
    await caller.joinSession(channel, [{ definition, execute: () => {
      started.resolve(undefined);
      return neverFinish.promise;
    } }]);
    const pending = caller.callTool(channel, ref, { text: "stop" });
    const rejected = expect(pending).rejects.toThrow();
    await started.promise;
    await host.stop();
    await rejected;
  });

  it("correlates concurrent self-calls while native requests continue to complete", async () => {
    const { caller: self } = await fixture();
    const bothStarted = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    let executions = 0;
    await self.joinSession(channel, [{ definition, execute: async (input) => {
      executions += 1;
      if (executions === 2) bothStarted.resolve(undefined);
      await finish.promise;
      return { result: textInput(input) };
    } }]);
    await self.connection.protocol.ping();
    const first = self.callTool(channel, ref, { text: "first" });
    const second = self.callTool(channel, ref, { text: "second" });
    await bothStarted.promise;
    await self.connection.protocol.ping();
    finish.resolve(undefined);
    expect(await Promise.all([first, second])).toEqual([{ result: "first" }, { result: "second" }]);
    expect(executions).toBe(2);
  });

  it("bounds simultaneous calls and releases capacity after their real results", async () => {
    const { url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    const allStarted = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    let executions = 0;
    await executor.joinSession(channel, [{ definition, execute: async () => {
      executions += 1;
      if (executions === 64) allStarted.resolve(undefined);
      await finish.promise;
      return { result: "bounded" };
    } }]);
    const calls = Array.from({ length: 65 }, () => caller.callTool(channel, ref, { text: "concurrent" }));
    // Observe every rejection immediately, including cleanup on a failed test.
    const results = Promise.all(calls.map((call) => call.then(
      () => true,
      () => false,
    )));
    await allStarted.promise;
    await expect(calls[64]).rejects.toThrow();
    expect(executions).toBe(64);
    finish.resolve(undefined);
    const completed = await results;
    expect(completed.filter(Boolean)).toHaveLength(64);
    expect(completed.filter((ok) => !ok)).toHaveLength(1);
    await expect(caller.callTool(channel, ref, { text: "after-capacity-release" }))
      .resolves.toEqual({ result: "bounded" });
    expect(executions).toBe(65);
  });

  it("acknowledges a valid multi-tool list larger than one definition's byte budget", async () => {
    const first = defineToolContract({ ...definition, description: "a".repeat(36 * 1024) });
    const second = defineToolContract({
      ...definition, id: "11111111-1111-4111-8111-111111111112", key: "test.second", name: "second",
      description: "b".repeat(36 * 1024),
    });
    const { url, caller } = await fixture([first, second]);
    const executor = await openToolClient(url, "executor");
    await executor.joinSession(channel, [first, second].map((contract) => ({
      definition: contract, execute: () => ({ result: "large-manifest" }),
    })));
    await expect(caller.callTool(channel, ref, { text: "large" })).resolves.toEqual({ result: "large-manifest" });
  }, 10_000);

  it("allows an empty acknowledged registration to remove execution availability", async () => {
    const { url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    await executor.joinSession(channel, [{ definition, execute: () => ({ result: "ok" }) }]);
    await executor.connection.protocol.ping();
    await expect(caller.callTool(channel, ref, { text: "before" })).resolves.toEqual({ result: "ok" });
    await executor.joinSession(channel, []);
    await expect(caller.callTool(channel, ref, { text: "after" })).rejects.toThrow();
  });
});

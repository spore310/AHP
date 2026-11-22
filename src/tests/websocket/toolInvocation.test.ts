import type { ActionEnvelope } from "@microsoft/agent-host-protocol";
import { AhpClient, type AhpTransport } from "@microsoft/agent-host-protocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseUnknownJson } from "@jsonrpc";
import { ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET } from "@sessions/constants";
import { connectToolClient, type ToolClient } from "./legacyToolClient";
import { defineToolContract, toAhpToolDefinition } from "@tools";
import { type AHPServerHandle } from "@websocket";

import { createToolPolicyHost, connectPolicyTransport } from "./toolPolicyFixture";

// INTERNAL canonical broker/correlation compatibility; no public-host authorization claim.
vi.mock("@websocket/helpers/ahp", async () => ({
  createAHPBinding: (await import("@websocket/helpers/ahp/helpers/kernel/helpers")).createAHPKernel,
}));

const definition = defineToolContract({
  id: "11111111-1111-4111-8111-111111111111", key: "test.echo", version: 1, name: "echo",
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
  executor.client.dispatch(channel, { type: ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET,
    activeClient: { clientId: "executor", tools: Array.from({ length: 129 }, (_, index) => toAhpToolDefinition(definitions[index % count] ?? last)) } });
  await executor.client.ping();
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
  const { host, recreate } = await createToolPolicyHost(definitions);
  hosts.push(host);
  const address = await host.start();
  const url = "ws://127.0.0.1:" + String(address.port) + "/capacity";
  const caller = await openToolClient(url, "caller");
  await caller.client.subscribe(channel);
  return { host, url, caller, recreate };
}

async function openToolClient(url: string, clientId: string): Promise<ToolClient> {
  const client = await connectToolClient({ transport: await connectPolicyTransport(url), ownership: "owned" }, { clientId, protocolVersions: ["1.0.0"] });
  clients.push(client);
  return client;
}

/** Observe actual frames, including extension frames an ordinary SDK would ignore. */
async function openObserver(url: string, clientId = "observer") {
  const inner = await connectPolicyTransport(url);
  const frames: unknown[] = [];
  const transport: AhpTransport = {
    send: (message) => {
      inner.send(typeof message === "string" ? message : JSON.stringify(message));
    },
    recv: async () => {
      const frame = await inner.recv();
      if (frame?.kind === "text") frames.push(parseUnknownJson(frame.text));
      return frame;
    },
    close: () => inner.close(),
  };
  const client = new AhpClient(transport);
  clients.push(client);
  client.connect();
  await client.initialize({ clientId, protocolVersions: ["1.0.0"], initialSubscriptions: ["ahp-root://"] });
  return { client, transport, frames };
}

function textInput(input: unknown): string {
  if (typeof input !== "object" || input === null || !("text" in input) || typeof input.text !== "string") {
    throw new Error("Invalid echo input");
  }
  return input.text;
}

function method(frame: unknown, name: string): boolean {
  return typeof frame === "object" && frame !== null && "method" in frame && frame.method === name;
}

async function nextAction(client: AhpClient, dispatch: () => void): Promise<ActionEnvelope> {
  const events = client.events();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    dispatch();
    return await Promise.race([
      (async () => {
        for await (const entry of events) {
          if (entry.channel === channel && entry.event.type === "action") return entry.event.params;
        }
        throw new Error("Action stream closed");
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Action acknowledgement missing"));
        }, 1_500);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await events.return?.();
  }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
});

describe("end-to-end client tool capacity", () => {
  it("lists matching full schemas to two SDK subscribers, advertises, executes locally and keeps payloads private", async () => {
    const { host, url, caller } = await fixture();
    const observer = await openObserver(url);
    const creatorSnapshot = await caller.client.subscribe(channel);
    const observerSnapshot = await observer.client.subscribe(channel);
    expect(observerSnapshot.result.snapshot).toEqual(creatorSnapshot.result.snapshot);
    expect(observerSnapshot.result.snapshot).toMatchObject({
      resource: channel,
      state: {
        activeClients: [],
        _meta: { "x-ahp-application": {
          schemaVersion: 1, sessionType: { key: "test.echo-session", version: 1 },
          toolContracts: [{ id: definition.id, key: definition.key, version: 1,
            definition: { name: definition.name, inputSchema: definition.inputSchema, outputSchema: definition.outputSchema } }],
        } },
      },
    });
    expect(host.sessions.getSessionSnapshot(channel)?.state.serverTools).toBeUndefined();
    const executor = await openToolClient(url, "executor");
    let executions = 0;
    let joined: Promise<void> = Promise.resolve();
    const advertisementStart = observer.frames.length;
    const accepted = await nextAction(observer.client, () => {
      joined = executor.joinSession(channel, [{ definition, execute: (input) => {
        executions += 1;
        return { result: `private-result:${textInput(input)}` };
      } }]);
    });
    await joined;
    await observer.client.ping();
    expect(observer.frames.slice(advertisementStart).filter((frame) => method(frame, "action"))).toHaveLength(1);
    expect(accepted.rejectionReason).toBeUndefined();
    expect(accepted.action).toMatchObject({
      type: "session/activeClientSet", activeClient: { clientId: "executor", tools: [toAhpToolDefinition(definition)] },
    });
    const start = observer.frames.length;
    const before = host.sessions.getSessionSnapshot(channel);
    await expect(caller.callTool(channel, ref, { text: "private-input" }))
      .resolves.toEqual({ result: "private-result:private-input" });
    await observer.client.ping();
    // Causal barrier, not a silence timeout.
    expect(executions).toBe(1);
    expect(host.sessions.getSessionSnapshot(channel)).toEqual(before);
    expect(observer.frames.slice(start).some((frame) => method(frame, "x-ahp/tools/invoke"))).toBe(false);
    expect(JSON.stringify(observer.frames.slice(start))).not.toContain("private-input");
    expect(JSON.stringify(observer.frames.slice(start))).not.toContain("private-result");
  });

  it("rejects a wire-schema change privately even for an unsubscribed same-ID sender", async () => {
    const { host, url } = await fixture();
    const owner = await openObserver(url, "same-id");
    const other = await openObserver(url, "same-id");
    await other.client.subscribe(channel);
    const before = host.sessions.getSessionSnapshot(channel);
    const otherStart = other.frames.length;
    const descriptor = toAhpToolDefinition(definition);
    const rejection = await nextAction(owner.client, () => {
      owner.client.dispatch(channel, {
        type: ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET,
        activeClient: { clientId: "same-id", tools: [{
          ...descriptor, inputSchema: { ...descriptor.inputSchema, type: "object", ...{ additionalProperties: true } },
        }] },
      });
    });
    expect(rejection.rejectionReason).toBeDefined();
    expect(rejection.origin?.clientId).toBe("same-id");
    await other.client.ping();
    expect(other.frames.slice(otherStart).filter((frame) => method(frame, "action"))).toEqual([]);
    expect(host.sessions.getSessionSnapshot(channel)).toEqual(before);
  });

  it("denies invalid input, unassigned tools and outsider calls without executing; rejects invalid output", async () => {
    const { url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    let executions = 0;
    await executor.joinSession(channel, [{ definition, execute: (input) => {
      executions += 1;
      return textInput(input) === "wrong-output" ? { result: 42 } : { result: "ok" };
    } }]);
    await executor.client.ping();
    await expect(caller.callTool(channel, ref, { text: 3 })).rejects.toThrow();
    await expect(caller.callTool(channel, { key: "test.not-assigned", version: 1 }, {})).rejects.toThrow();
    const outsider = await openToolClient(url, "outsider");
    await expect(outsider.callTool(channel, ref, { text: "outsider" })).rejects.toThrow();
    expect(executions).toBe(0);
    await expect(caller.callTool(channel, ref, { text: "wrong-output" })).rejects.toThrow();
    expect(executions).toBe(1);
  });

  it("rejects forged results from another connection while accepting the exact executor result", async () => {
    const { url, caller } = await fixture();
    const attacker = await openObserver(url, "attacker");
    const executor = await openToolClient(url, "executor");
    await executor.joinSession(channel, [{ definition, execute: async (_input, invocation) => {
      await attacker.transport.send({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: {
        ...invocation, output: { result: "forged" },
      } });
      await attacker.client.ping();
      // Proves the forged completion was processed before the real one.
      return { result: "real-executor" };
    } }]);
    await executor.client.ping();
    await expect(caller.callTool(channel, ref, { text: "hello" })).resolves.toEqual({ result: "real-executor" });
  });

  it("does not inherit stale advertisements or route to ambiguous claimed IDs", async () => {
    const { host, url, caller } = await fixture();
    const executor = await openToolClient(url, "executor");
    let executions = 0;
    await executor.joinSession(channel, [{ definition, execute: () => {
      executions += 1;
      return { result: "ok" };
    } }]);
    await executor.client.ping();
    const duplicate = await openToolClient(url, "executor");
    // Not subscribed; still identity-ambiguous.
    await expect(caller.callTool(channel, ref, { text: "ambiguous" })).rejects.toThrow();
    expect(executions).toBe(0);
    await duplicate.shutdown();
    await executor.shutdown();
    const replacement = await openToolClient(url, "executor");
    await replacement.client.subscribe(channel);
    // No accepted advertisement on this new socket.
    expect(host.sessions.getSessionSnapshot(channel)?.state.activeClients.some((active) => active.clientId === "executor"))
      .toBe(true);
    // Presence is deliberately still stale; execution ownership is not.
    await expect(caller.callTool(channel, ref, { text: "stale" })).rejects.toThrow();
    expect(executions).toBe(0);
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
    await executor.client.ping();
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
    await second.client.ping();
    const nextResult = expect(caller.callTool(channel, ref, { text: "old-generation" })).rejects.toThrow();
    await nextStarted.promise;
    await host.sessions.disposeSession({ channel });
    await nextResult;
    await recreate();
    const recreated = host.sessions.getSessionSnapshot(channel);
    nextFinish.resolve({ result: "old-generation-output" });
    await second.client.ping();
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

  it("supports concurrent self-calls while ordinary SDK requests remain ordered", async () => {
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
    await self.client.ping();
    const first = self.callTool(channel, ref, { text: "first" });
    const second = self.callTool(channel, ref, { text: "second" });
    let pingResolved = false;
    const ping = self.client.ping().then(() => {
      pingResolved = true;
    });
    await bothStarted.promise;
    expect(pingResolved).toBe(false);
    finish.resolve(undefined);
    const results = await Promise.all([first, second, ping]);
    expect(results.slice(0, 2)).toEqual([{ result: "first" }, { result: "second" }]);
    expect(pingResolved).toBe(true);
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
    await executor.client.ping();
    await expect(caller.callTool(channel, ref, { text: "before" })).resolves.toEqual({ result: "ok" });
    await executor.joinSession(channel, []);
    await expect(caller.callTool(channel, ref, { text: "after" })).rejects.toThrow();
  });
});

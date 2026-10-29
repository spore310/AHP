import type { AhpTransport, TransportFrame } from "@microsoft/agent-host-protocol/client";
import type { ProtocolMessage } from "@microsoft/agent-host-protocol";
import { afterEach, expect, it, vi } from "vitest";

import { ToolInvocationTransport } from "@toolClient/transport";
import { connectToolClient as legacyConnect } from "@toolClient";
import { connectToolClient } from "@toolExecution/client";
import { ToolInvocationTransport as NewTransport } from "@toolExecution/client/transport";
import { parseUnknownJson } from "@jsonrpc";
import type { ToolContractDefinition } from "@tools/types";

vi.mock("@microsoft/agent-host-protocol/ws", () => {
  throw new Error("Default socket eagerly evaluated");
});
vi.mock("@microsoft/agent-host-protocol/hosts", () => {
  throw new Error("SDK host evaluated");
});
vi.mock("@sessions", () => {
  throw new Error("Session barrel evaluated");
});
vi.mock("@tools", () => {
  throw new Error("Catalogue barrel evaluated");
});
vi.mock("@websocket", () => {
  throw new Error("Server evaluated");
});
vi.mock("@application", () => {
  throw new Error("Application evaluated");
});
vi.mock("@persistence", () => {
  throw new Error("Persistence evaluated");
});
vi.mock("ws", () => {
  throw new Error("Node socket evaluated");
});
vi.mock("pg", () => {
  throw new Error("Database evaluated");
});

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  vi.useRealTimers();
});

const channel = "ahp-session:/boundary";
const definition: ToolContractDefinition = {
  id: "11111111-1111-4111-8111-111111111111", key: "test.echo", version: 1,
  name: "echo", schemaDialect: "draft-07", inputSchema: { type: "object" },
};
const options = { clientId: "boundary-client", protocolVersions: ["1.0.0"] };

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected fixture object");
  return value as Record<string, unknown>;
}

function frame(message: unknown, kind: TransportFrame["kind"] = "text"): TransportFrame {
  if (kind === "parsed") return { kind, message: message as ProtocolMessage };
  const text = JSON.stringify(message);
  return kind === "text" ? { kind, text } : { kind, data: new TextEncoder().encode(text) };
}

/** One exclusive logical endpoint; retiring it releases the pending reader. */
class Endpoint implements AhpTransport {
  readonly sent: Record<string, unknown>[] = [];
  readonly incoming: TransportFrame[] = [];
  readonly readers: Array<ReturnType<typeof Promise.withResolvers<TransportFrame | null>>> = [];
  close = vi.fn(() => {
    this.retire();
  });

  readonly detach = vi.fn<() => void | Promise<void>>(() => {
    this.retire();
  });

  retired = false;
  onSend: (message: Record<string, unknown>) => void = () => undefined;

  send(message: Parameters<AhpTransport["send"]>[0]): void {
    if (this.retired) throw new Error("Endpoint retired");
    const parsed = record(typeof message === "string" ? parseUnknownJson(message) : message);
    this.sent.push(parsed);
    this.onSend(parsed);
  }

  recv(): Promise<TransportFrame | null> {
    if (this.retired) return Promise.resolve(null);
    const next = this.incoming.shift();
    if (next !== undefined) return Promise.resolve(next);
    const read = Promise.withResolvers<TransportFrame | null>();
    this.readers.push(read);
    return read.promise;
  }

  push(message: unknown, kind: TransportFrame["kind"] = "text"): void {
    this.pushFrame(frame(message, kind));
  }

  pushFrame(next: TransportFrame): void {
    if (this.retired) throw new Error("Cannot route to retired endpoint");
    const read = this.readers.shift();
    if (read === undefined) this.incoming.push(next);
    else read.resolve(next);
  }

  retire(): void {
    this.retired = true;
    this.incoming.length = 0;
    for (const read of this.readers.splice(0)) read.resolve(null);
  }
}

function script(endpoint: Endpoint, kind: TransportFrame["kind"] = "text") {
  const dispatches: Record<string, unknown>[] = [];
  const subscriptions: string[] = [];
  const fixture = {
    dispatches, subscriptions,
    onDispatch: (params: Record<string, unknown>) => {
      acknowledge(params);
    },
  };
  function acknowledge(params: Record<string, unknown>, patch: Record<string, unknown> = {}): void {
    endpoint.push({ jsonrpc: "2.0", method: "action", params: {
      ...params, serverSeq: dispatches.length,
      origin: { clientId: options.clientId, clientSeq: params.clientSeq }, ...patch,
    } }, kind);
  }
  endpoint.onSend = (message) => {
    const params = record(message.params);
    if (message.method === "initialize" || message.method === "ping") {
      endpoint.push({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "1.0.0" } }, kind);
    } else if (message.method === "subscribe") {
      subscriptions.push(String(params.channel));
      endpoint.push({ jsonrpc: "2.0", id: message.id, result: { snapshot: { state: { _meta: {
        "x-ahp-application": {
          schemaVersion: 1, sessionType: { id: "type", key: "test.session", version: 1 },
          toolContracts: [{ id: definition.id, key: definition.key, version: 1, schemaDialect: "draft-07",
            definition: { name: definition.name, inputSchema: definition.inputSchema } }],
        },
      } } } } }, kind);
    } else if (message.method === "dispatchAction") {
      dispatches.push(params);
      fixture.onDispatch(params);
    }
  };
  return { fixture, acknowledge };
}

async function open(kind: TransportFrame["kind"] = "text", borrowed = false) {
  const endpoint = new Endpoint();
  const { fixture, acknowledge } = script(endpoint, kind);
  const client = await connectToolClient(borrowed
    ? { transport: endpoint, ownership: "borrowed", detach: endpoint.detach }
    : { transport: endpoint, ownership: "owned" }, options);
  cleanup.push(() => client.shutdown());
  return { endpoint, fixture, acknowledge, client };
}

function invoke(endpoint: Endpoint, callId = "invocation", input: unknown = {}, kind: TransportFrame["kind"] = "text"): void {
  endpoint.push({ jsonrpc: "2.0", method: "x-ahp/tools/invoke",
    params: { callId, channel, key: definition.key, version: 1, input } }, kind);
}

function completions(endpoint: Endpoint): Record<string, unknown>[] {
  return endpoint.sent.filter((message) => message.method === "x-ahp/tools/complete").map((message) => record(message.params));
}

it("uses one runtime through legacy and new imports without evaluating platform or server modules", async () => {
  expect(legacyConnect).toBe(connectToolClient);
  expect(ToolInvocationTransport).toBe(NewTransport);
  const { client, endpoint } = await open();
  await client.joinSession(channel, []);
  await client.client.ping();
  expect(endpoint.sent.map((message) => message.method)).toEqual(["initialize", "subscribe", "dispatchAction", "ping"]);
  expect(record(endpoint.sent[0]?.params)).toEqual({ channel: "ahp-root://", ...options, initialSubscriptions: ["ahp-root://"] });
  await client.shutdown();
  await client.client.shutdown();
  expect(endpoint.close).toHaveBeenCalledOnce();
});

it.each(["text", "binary", "parsed"] as const)("runs real SDK initialize, exact ack and local execution on %s frames", async (kind) => {
  const { client, endpoint } = await open(kind);
  const execute = vi.fn(() => ({ marker: "chosen" }));
  await client.joinSession(channel, [{ definition, execute }]);
  invoke(endpoint, "run", {}, kind);
  await client.client.ping();
  expect(execute).toHaveBeenCalledOnce();
  expect(completions(endpoint)).toEqual([{ callId: "run", channel, key: definition.key, version: 1, output: { marker: "chosen" } }]);
});

it.each(["rejection", "mismatch"])("keeps the prior handler after %s and removes it on an accepted empty advertisement", async (failure) => {
  const { client, endpoint, fixture, acknowledge } = await open();
  const previous = vi.fn(() => "previous");
  const candidate = vi.fn(() => "candidate");
  await client.joinSession(channel, [{ definition, execute: previous }]);
  fixture.onDispatch = (params) => {
    acknowledge(params, failure === "rejection"
      ? { rejectionReason: "denied" }
      : { action: { type: "session/activeClientSet", activeClient: { clientId: options.clientId, tools: [] } } });
  };
  await expect(client.joinSession(channel, [{ definition, execute: candidate }])).rejects.toThrow();
  invoke(endpoint);
  await client.client.ping();
  expect(previous).toHaveBeenCalledOnce();
  expect(candidate).not.toHaveBeenCalled();
  fixture.onDispatch = (params) => {
    acknowledge(params);
  };
  await client.joinSession(channel, []);
  invoke(endpoint, "empty");
  await client.client.ping();
  expect(previous).toHaveBeenCalledOnce();
  expect(completions(endpoint).at(-1)?.error).toBe("Tool implementation unavailable.");
});

it("ignores wrong origin, sequence, channel and action until the exact advertisement acknowledgement", async () => {
  const { client, endpoint, fixture, acknowledge } = await open();
  const dispatched = Promise.withResolvers<Record<string, unknown>>();
  fixture.onDispatch = (params) => {
    dispatched.resolve(params);
  };
  const execute = vi.fn(() => "accepted");
  const joining = client.joinSession(channel, [{ definition, execute }]);
  const params = await dispatched.promise;
  acknowledge(params, { origin: { clientId: "other", clientSeq: params.clientSeq } });
  acknowledge(params, { origin: { clientId: options.clientId, clientSeq: 9999 } });
  acknowledge(params, { channel: "ahp-session:/other" });
  acknowledge(params, { action: { type: "session/titleChanged" } });
  invoke(endpoint);
  await client.client.ping();
  expect(execute).not.toHaveBeenCalled();
  acknowledge(params);
  await joining;
  await client.client.ping();
  expect(execute).toHaveBeenCalledOnce();
});

it("never activates a rejected staged candidate or lets it execute queued invocations", async () => {
  const { client, endpoint, fixture, acknowledge } = await open();
  const execute = vi.fn();
  fixture.onDispatch = (params) => {
    invoke(endpoint);
    acknowledge(params, { rejectionReason: "denied" });
  };
  await expect(client.joinSession(channel, [{ definition, execute }])).rejects.toThrow("rejected");
  await client.client.ping();
  expect(execute).not.toHaveBeenCalled();
  expect(completions(endpoint).at(-1)?.error).toBe("Tool implementation unavailable.");
});

it("serializes same-channel joins after failure while another channel progresses", async () => {
  const { client, fixture, acknowledge } = await open();
  const dispatched = Promise.withResolvers<Record<string, unknown>>();
  fixture.onDispatch = (params) => {
    if (fixture.dispatches.length === 1) dispatched.resolve(params);
    else acknowledge(params);
  };
  const first = client.joinSession(channel, []);
  const firstFailure = expect(first).rejects.toThrow("rejected");
  const firstParams = await dispatched.promise;
  const second = client.joinSession(channel, []);
  await client.joinSession("ahp-session:/independent", []);
  expect(fixture.subscriptions).toEqual([channel, "ahp-session:/independent"]);
  acknowledge(firstParams, { rejectionReason: "denied" });
  await firstFailure;
  await second;
  expect(fixture.subscriptions).toEqual([channel, "ahp-session:/independent", channel]);
});

it("times out an unacknowledged advertisement and preserves the prior active handler", async () => {
  vi.useFakeTimers();
  const { client, endpoint, fixture } = await open();
  const previous = vi.fn();
  await client.joinSession(channel, [{ definition, execute: previous }]);
  fixture.onDispatch = () => undefined;
  const next = vi.fn();
  const joining = expect(client.joinSession(channel, [{ definition, execute: next }])).rejects.toThrow("Timed out");
  await vi.advanceTimersByTimeAsync(5_001);
  await joining;
  invoke(endpoint);
  await client.client.ping();
  expect(previous).toHaveBeenCalledOnce();
  expect(next).not.toHaveBeenCalled();
});

it("shutdown rejects active and queued joins without late advertisement or activation", async () => {
  const { client, endpoint, fixture } = await open();
  const dispatched = Promise.withResolvers<undefined>();
  fixture.onDispatch = () => {
    dispatched.resolve(undefined);
  };
  const execute = vi.fn();
  const first = expect(client.joinSession(channel, [{ definition, execute }])).rejects.toThrow();
  await dispatched.promise;
  const second = expect(client.joinSession(channel, [{ definition, execute }])).rejects.toThrow();
  await client.shutdown();
  await Promise.all([first, second]);
  expect(fixture.dispatches).toHaveLength(1);
  expect(fixture.subscriptions).toHaveLength(1);
  expect(endpoint.close).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
});

it.each(["owned", "borrowed"] as const)("releases %s endpoints on initialization failure and preserves the primary failure", async (ownership) => {
  const endpoint = new Endpoint();
  endpoint.onSend = (message) => {
    endpoint.push({ jsonrpc: "2.0", id: message.id,
      error: { code: -32602, message: "Initialization deliberately rejected" } });
  };
  const release = () => {
    endpoint.retire();
    throw new Error("Cleanup deliberately failed");
  };
  endpoint.close.mockImplementation(release);
  endpoint.detach.mockImplementation(release);
  await expect(connectToolClient(ownership === "owned"
    ? { transport: endpoint, ownership }
    : { transport: endpoint, ownership, detach: endpoint.detach }, options)).rejects.toThrow("Initialization deliberately rejected");
  expect(ownership === "owned" ? endpoint.close : endpoint.detach).toHaveBeenCalledOnce();
  expect(endpoint.readers).toHaveLength(0);
  if (ownership === "borrowed") expect(endpoint.close).not.toHaveBeenCalled();
});

it("detaches a borrowed lease once, releases its reader and prevents late completion on its carrier", async () => {
  const { client, endpoint } = await open("text", true);
  const late = Promise.withResolvers<string>();
  const entered = Promise.withResolvers<undefined>();
  await client.joinSession(channel, [{ definition, execute: () => {
    entered.resolve(undefined);
    return late.promise;
  } }]);
  invoke(endpoint);
  await entered.promise;
  const successor = new Endpoint();
  let routedEndpoint = endpoint;
  const carrier = { receive: (message: unknown) => {
    routedEndpoint.push(message);
  } };
  endpoint.detach.mockImplementation(() => {
    endpoint.retire();
    routedEndpoint = successor;
    void client.shutdown();
  });
  await client.shutdown();
  await client.shutdown();
  expect(endpoint.detach).toHaveBeenCalledOnce();
  expect(endpoint.close).not.toHaveBeenCalled();
  expect(endpoint.readers).toHaveLength(0);
  const count = endpoint.sent.length;
  late.resolve("must-not-send");
  await late.promise;
  await Promise.resolve();
  expect(endpoint.sent).toHaveLength(count);
  expect(completions(endpoint)).toEqual([]);
  // A successor logical endpoint on the supplier's carrier has its own reader.
  const read = successor.recv();
  carrier.receive({ jsonrpc: "2.0", method: "successor" });
  expect(await read).toEqual(frame({ jsonrpc: "2.0", method: "successor" }));
  expect(() => {
    endpoint.push({});
  }).toThrow("retired");
  successor.retire();
});

it.each(["text", "binary", "parsed"] as const)("preserves deep JSON, reserved keys and a >1 MiB envelope through %s extension frames", async (kind) => {
  const { client, endpoint } = await open(kind);
  let deep: unknown = "leaf";
  for (let index = 0; index < 80; index += 1) deep = { next: deep };
  const input = { constructor: "data", prototype: "data", deep, large: "x".repeat(1024 * 1024) };
  const execute = vi.fn((input: unknown) => ({ input, marker: "parity" }));
  await client.joinSession(channel, [{ definition, execute }]);
  invoke(endpoint, "parity", input, kind);
  await client.client.ping();
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[0]).toEqual(input);
  const call = client.callTool(channel, definition, {});
  const request = endpoint.sent.find((message) => message.method === "x-ahp/tools/call");
  endpoint.push({ jsonrpc: "2.0", id: request?.id, result: input }, kind);
  await expect(call).resolves.toEqual(input);
});

it.each(["text", "binary", "parsed"] as const)("forwards ordinary and request-shaped %s frames by identity", async (kind) => {
  const endpoint = new Endpoint();
  const transport = new NewTransport(endpoint);
  cleanup.push(() => transport.close());
  const execute = vi.fn();
  transport.stage(channel, "registration", [{ definition, execute }]);
  transport.activate(channel, "registration");
  for (const message of [
    { jsonrpc: "2.0", method: "ordinary", params: {} },
    { jsonrpc: "2.0", id: "request", method: "x-ahp/tools/invoke", params: { callId: "wrong", channel, key: definition.key, version: 1, input: {} } },
    { jsonrpc: "1.0", method: "x-ahp/tools/invoke", params: {} },
  ]) {
    const original = frame(message, kind);
    endpoint.pushFrame(original);
    await expect(transport.recv()).resolves.toBe(original);
  }
  expect(execute).not.toHaveBeenCalled();
  expect(endpoint.sent).toEqual([]);
});

it("bounds binary decoding and forwards oversized or invalid UTF-8 frames without execution", async () => {
  const endpoint = new Endpoint();
  const transport = new NewTransport(endpoint);
  cleanup.push(() => transport.close());
  const execute = vi.fn();
  transport.stage(channel, "registration", [{ definition, execute }]);
  transport.activate(channel, "registration");
  const base = JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/invoke",
    params: { callId: "limit", channel, key: definition.key, version: 1, input: {} } });
  const oversized: TransportFrame = { kind: "binary", data: new TextEncoder().encode(base.padEnd(2 * 1024 * 1024 + 1, " ")) };
  const invalid: TransportFrame = { kind: "binary", data: new Uint8Array([0xff, 0xfe]) };
  for (const original of [oversized, invalid]) {
    endpoint.pushFrame(original);
    await expect(transport.recv()).resolves.toBe(original);
  }
  expect(execute).not.toHaveBeenCalled();
  const boundary: TransportFrame = { kind: "binary", data: new TextEncoder().encode(base.padEnd(2 * 1024 * 1024, " ")) };
  const ordinary = frame({ jsonrpc: "2.0", method: "ordinary" });
  endpoint.pushFrame(boundary);
  endpoint.pushFrame(ordinary);
  await expect(transport.recv()).resolves.toBe(ordinary);
  expect(execute).toHaveBeenCalledOnce();
});

it("times out extension calls at 35 seconds and clears request timers on close", async () => {
  vi.useFakeTimers();
  const endpoint = new Endpoint();
  const transport = new NewTransport(endpoint);
  const timed = expect(transport.requestCall({ channel, key: definition.key, version: 1, input: {} })).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(35_001);
  await timed;
  const pending = expect(transport.requestCall({ channel, key: definition.key, version: 1, input: {} })).rejects.toThrow("closed");
  await transport.close();
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  await expect(transport.requestCall({ channel, key: definition.key, version: 1, input: {} })).rejects.toThrow("closed");
  expect(() => {
    transport.stage(channel, "late", []);
  }).toThrow("closed");
  expect(() => {
    transport.activate(channel, "late");
  }).toThrow("closed");
});

it("rejects an acknowledgement wait when the remote event stream closes", async () => {
  const { client, endpoint, fixture } = await open();
  fixture.onDispatch = () => {
    endpoint.retire();
  };
  await expect(client.joinSession(channel, [])).rejects.toThrow("event stream closed");
  await client.shutdown();
  expect(endpoint.close).toHaveBeenCalledOnce();
});

it("captures the borrowed detach callback before the caller mutates its descriptor", async () => {
  const endpoint = new Endpoint();
  script(endpoint);
  const descriptor = { transport: endpoint, ownership: "borrowed" as const, detach: endpoint.detach };
  const client = await connectToolClient(descriptor, options);
  const replacement = vi.fn();
  descriptor.detach = replacement;
  await client.shutdown();
  expect(endpoint.detach).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  expect(endpoint.close).not.toHaveBeenCalled();
});

it("preserves the receiver of a supplied detach method and captures owned close methods", async () => {
  const endpoint = new Endpoint();
  script(endpoint);
  const descriptor = {
    transport: endpoint, ownership: "borrowed" as const,
    detach() {
      return this.transport.detach();
    },
  };
  const client = await connectToolClient(descriptor, options);
  const replacement = vi.fn();
  descriptor.detach = replacement;
  await client.shutdown();
  expect(endpoint.detach).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  expect(endpoint.close).not.toHaveBeenCalled();
  for (const mode of ["direct", "connection"]) {
    const owned = new Endpoint();
    script(owned);
    const original = owned.close;
    const runtime = mode === "direct"
      ? new NewTransport(owned)
      : await connectToolClient({ transport: owned, ownership: "owned" }, options);
    const other = vi.fn();
    owned.close = other;
    if (runtime instanceof NewTransport) await runtime.close();
    else await runtime.shutdown();
    expect(original).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  }
});

it("keeps the staged early-invocation queue bound and does not activate after shutdown", async () => {
  const endpoint = new Endpoint();
  const transport = new NewTransport(endpoint);
  const execute = vi.fn();
  transport.stage(channel, "candidate", [{ definition, execute }]);
  for (let index = 0; index < 65; index += 1) invoke(endpoint, String(index));
  const ordinary = frame({ jsonrpc: "2.0", method: "ordinary" });
  endpoint.pushFrame(ordinary);
  await expect(transport.recv()).resolves.toBe(ordinary);
  expect(execute).not.toHaveBeenCalled();
  expect(completions(endpoint)).toHaveLength(1);
  expect(completions(endpoint)[0]?.error).toBe("Tool implementation unavailable.");
  await transport.close();
  transport.discard(channel, "candidate");
  expect(() => {
    transport.activate(channel, "candidate");
  }).toThrow("closed");
  expect(execute).not.toHaveBeenCalled();
});

it.each(["EOF", "read failure", "send failure"])("retires the wrapper and releases owned cleanup after %s even when SDK is already closed", async (failure) => {
  const { client, endpoint } = await open();
  const pending = expect(client.callTool(channel, definition, {})).rejects.toThrow();
  if (failure === "EOF") endpoint.retire();
  else if (failure === "read failure") endpoint.readers.shift()?.reject(new Error("Read failed"));
  else {
    endpoint.onSend = () => {
      throw new Error("Send failed");
    };
    await expect(client.client.ping()).rejects.toThrow();
  }
  await pending;
  await client.shutdown();
  expect(endpoint.close).toHaveBeenCalledOnce();
  expect(endpoint.readers).toHaveLength(0);
});

it("retires a pending read locally and closes an owned endpoint exactly once", async () => {
  const close = vi.fn();
  const inner: AhpTransport = {
    send: () => undefined,
    recv: () => new Promise<TransportFrame | null>(() => undefined),
    close,
  };
  const transport = new ToolInvocationTransport(inner);
  const read = transport.recv();
  await transport.close();
  await transport.close();
  expect(close).toHaveBeenCalledOnce();
  await expect(read).resolves.toBeNull();
});

it("awaits the existing asynchronous borrowed release after EOF already closed the SDK", async () => {
  const { client, endpoint } = await open("text", true);
  const release = Promise.withResolvers<undefined>();
  const entered = Promise.withResolvers<undefined>();
  endpoint.detach.mockImplementation(() => {
    entered.resolve(undefined);
    return release.promise;
  });
  endpoint.retire();
  await entered.promise;
  let finished = false;
  const shutdown = client.shutdown().then(() => {
    finished = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  try {
    expect(finished).toBe(false);
  } finally {
    release.resolve(undefined);
  }
  await shutdown;
  expect(finished).toBe(true);
  expect(endpoint.detach).toHaveBeenCalledOnce();
  expect(endpoint.close).not.toHaveBeenCalled();
});

it("correlates extension responses delivered as binary frames", async () => {
  let request: Parameters<AhpTransport["send"]>[0] | undefined;
  const inbound: TransportFrame[] = [];
  const transport = new ToolInvocationTransport({
    send: (message) => {
      request = message;
    },
    recv: () => Promise.resolve(inbound.shift() ?? null),
    close: () => undefined,
  });
  const call = transport.requestCall({ channel: "ahp-session:/test", key: "test.echo", version: 1, input: {} });
  const result = expect(call).resolves.toEqual({ ok: true });
  expect(typeof request).toBe("string");
  const id = typeof request === "string" ? /"id":"([^"]+)"/.exec(request)?.[1] : undefined;
  expect(id).toBeDefined();
  inbound.push({ kind: "binary", data: new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } })) });
  await transport.recv();
  await transport.close();
  await result;
});

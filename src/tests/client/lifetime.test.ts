import { expect, it, vi } from "vitest";
import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { connectClient } from "@client";
import { ClientTransport } from "@client/transport";
import { parseUnknownJson } from "@jsonrpc";
import { createToolClient, connectToolClient } from "@tool/client";
import { createWorkClient } from "@work/helpers/client";
import { Endpoint, record } from "./endpoint";

const options = { clientId: "native", protocolVersions: ["1.0.0"] };
const resource = { kind: "session", id: "ahp-session:/delta", instanceId: crypto.randomUUID() };

function nativeStateEnding(report: "closed" | "end") {
  const finish = Promise.withResolvers<undefined>(), released = vi.fn();
  const observe = vi.spyOn(AhpClient.prototype, "stateChanges").mockImplementationOnce(async function* () {
    try {
      yield { status: "connected" };
      await finish.promise;
      if (report === "closed") yield { status: "closed", reason: { type: "shutdown" } };
    } finally {
      released();
    }
  });
  return { finish, released, observe };
}
function script(endpoint: Endpoint) {
  let negotiate = true;
  endpoint.onSend = ({ id, method }) => {
    if (method === "x-ahp/tools/capabilities" && !negotiate) {
      endpoint.push({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unavailable" } });
      return;
    }
    const result = method === "x-ahp/tools/capabilities"
      ? { version: 1, assignments: true, dispatch: true, continuation: false }
      : method === "x-ahp/work/subscribe"
        ? { version: 1, subscriptionId: crypto.randomUUID(), streamEpoch: "epoch", items: [] }
        : method === "x-ahp/work/list" ? { version: 1, items: [] } : { protocolVersion: "1.0.0" };
    endpoint.push({ jsonrpc: "2.0", id, result });
  };
  return (allow: boolean) => {
    negotiate = allow;
  };
}

it("publishes one shutdown promise before running reentrant application cleanups", async () => {
  const peer = new Endpoint();
  script(peer);
  const connection = await connectClient({ transport: peer, ownership: "borrowed", detach: peer.detach }, options);
  let inside: Promise<void> | undefined;
  const ended = vi.fn();
  connection.lifetime.addCleanup(() => {
    expect(connection.lifetime.signal.aborted).toBe(true);
    inside = connection.shutdown();
    throw new Error("Application cleanup failed");
  });
  connection.lifetime.addCleanup(ended);
  const done = connection.shutdown();
  expect(inside).toBe(done);
  expect(connection.shutdown()).toBe(done);
  await done;
  expect(ended).toHaveBeenCalledOnce();
  expect(peer.detach).toHaveBeenCalledOnce();
  expect(peer.close).not.toHaveBeenCalled();
});

it.each(["closed", "end"] as const)("retires the shared endpoint after a native state reader reports %s", async (report) => {
  const native = nativeStateEnding(report);
  const peer = new Endpoint(), release = Promise.withResolvers<undefined>();
  const detach = vi.fn(() => release.promise);
  script(peer);
  const client = await connectClient({ transport: peer, ownership: "borrowed", detach }, options);
  const clean = vi.fn();
  client.lifetime.addCleanup(clean);
  peer.onSend = () => undefined;
  const pending = client.rpc.request("x-ahp/test/pending", {}).catch((reason: unknown) => reason);
  try {
    native.finish.resolve(undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(client.lifetime.signal.aborted).toBe(true);
    expect(native.observe).toHaveBeenCalledOnce();
    expect(native.released).toHaveBeenCalledOnce();
    expect(clean).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledOnce();
    expect(await pending).toBeInstanceOf(Error);
    expect(client.protocol.shutdown()).toBe(client.shutdown());
    expect(peer.close).not.toHaveBeenCalled();
  } finally {
    native.observe.mockRestore();
    release.resolve(undefined);
    await client.shutdown();
    await pending;
  }
});

it("rejects an unfinished native handshake and closes once when the state stream ends during initialization", async () => {
  const peer = new Endpoint();
  const native = nativeStateEnding("end");
  const result = connectClient({ transport: peer, ownership: "owned" }, options).then(() => "ready", () => "closed");
  try {
    native.finish.resolve(undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(peer.close).toHaveBeenCalledOnce();
    expect(await result).toBe("closed");
    expect(native.released).toHaveBeenCalledOnce();
  } finally {
    native.observe.mockRestore();
    peer.retire();
    await result;
  }
});

it("rolls back failed/duplicate tool attachment while preserving native and work ownership", async () => {
  const peer = new Endpoint();
  const allow = script(peer);
  const connection = await connectClient({ transport: peer, ownership: "owned" }, options);
  const work = createWorkClient(connection);
  try {
    expect((await work.subscribe({ resource })).status).toBe("ready");
    allow(false);
    await expect(createToolClient(connection)).rejects.toThrow();
    await connection.protocol.ping();
    expect((await work.refresh()).status).toBe("ready");
    allow(true);
    const tool = await createToolClient(connection);
    expect(tool.connection).toBe(connection);
    await expect(createToolClient(connection)).rejects.toThrow();
    expect(peer.sent.filter(({ method }) => method === "x-ahp/tools/capabilities")).toHaveLength(2);
    peer.retire();
    await vi.waitFor(() => {
      expect(connection.lifetime.signal.aborted).toBe(true);
    });
    expect(work.snapshot().status).toBe("disconnected");
    await expect(createToolClient(connection)).rejects.toThrow();
    await tool.shutdown();
    expect(peer.close).toHaveBeenCalledOnce();
  } finally {
    await work.dispose();
    await connection.shutdown();
  }
});

it("releases a newly owned connection once on negotiation failure", async () => {
  const peer = new Endpoint();
  script(peer)(false);
  await expect(connectToolClient({ transport: peer, ownership: "owned" }, options)).rejects.toThrow();
  expect(peer.close).toHaveBeenCalledOnce();
});

it("shares the pending borrowed release and its rejection across tools, native SDK and connection shutdown", async () => {
  const peer = new Endpoint();
  script(peer);
  const release = Promise.withResolvers<undefined>();
  const detach = vi.fn(() => release.promise);
  const tools = await connectToolClient({ transport: peer, ownership: "borrowed", detach }, options);
  let settled = false;
  const native = tools.connection.protocol.shutdown(), connection = tools.connection.shutdown(), adapter = tools.shutdown();
  const outcomes = Promise.allSettled([native, connection, adapter]);
  const finish = () => {
    settled = true;
  };
  void native.then(finish, finish);
  try {
    expect(native).toBe(connection);
    expect(native).toBe(adapter);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally {
    release.reject(new Error("Detach failed"));
    await outcomes;
  }
  expect(await outcomes).toEqual(Array.from({ length: 3 }, () => ({ status: "rejected", reason: new Error("Detach failed") })));
  expect(detach).toHaveBeenCalledOnce();
  expect(peer.close).not.toHaveBeenCalled();
});

it.each(["native", "EOF"] as const)("ends the lifetime once after %s even if a borrowed detach rejects", async (cause) => {
  const peer = new Endpoint();
  script(peer);
  const detach = vi.fn(() => Promise.reject(new Error("Detach failed")));
  const client = await connectClient({ transport: peer, ownership: "borrowed", detach }, options);
  const cleanup = vi.fn();
  client.lifetime.addCleanup(cleanup);
  if (cause === "native") await expect(client.protocol.shutdown()).rejects.toThrow("Detach failed");
  else {
    peer.retire();
    await vi.waitFor(() => {
      expect(client.lifetime.signal.aborted).toBe(true);
    });
  }
  await expect(client.shutdown()).rejects.toThrow("Detach failed");
  expect(client.lifetime.signal.aborted).toBe(true);
  expect(detach).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(peer.close).not.toHaveBeenCalled();
});

it("disposing a pending work view leaves other recipients and native RPC on the same reader", async () => {
  const peer = new Endpoint();
  script(peer);
  const connection = await connectClient({ transport: peer, ownership: "owned" }, options);
  const a = createWorkClient(connection), b = createWorkClient(connection);
  const first = await a.subscribe({ resource }), second = await b.subscribe({ resource });
  expect(first.subscriptionId).not.toBe(second.subscriptionId);
  const entered = Promise.withResolvers<undefined>();
  const previous = peer.onSend;
  peer.onSend = (message) => {
    if (message.method === "x-ahp/work/list" && record(message.params).subscriptionId === first.subscriptionId) entered.resolve(undefined);
    else previous(message);
  };
  const pending = a.refresh();
  await entered.promise;
  await a.dispose();
  expect((await pending).status).toBe("disposed");
  expect((await b.refresh()).status).toBe("ready");
  await connection.protocol.ping();
  await b.dispose();
  await connection.shutdown();
  expect(peer.close).toHaveBeenCalledOnce();
});

it("keeps the send slot occupied after a notification's local deadline and sends no request ID", async () => {
  vi.useFakeTimers();
  const writes: string[] = [], parked = Promise.withResolvers<undefined>();
  const transport = new ClientTransport({ recv: () => Promise.resolve(null), close() {}, send(message) {
    if (typeof message !== "string") throw new Error("Expected private notification text.");
    writes.push(message);
    return parked.promise;
  } });
  try {
    const pending = Array.from({ length: 64 }, () => transport.notify("x-ahp/demo/hint", { sample: true }, { timeoutMs: 5 }).catch(() => undefined));
    await vi.advanceTimersByTimeAsync(6);
    await Promise.all(pending);
    expect(writes).toHaveLength(64);
    expect(record(parseUnknownJson(writes[0] ?? ""))).not.toHaveProperty("id");
    await expect(transport.notify("x-ahp/demo/hint", {})).rejects.toThrow("capacity");
    parked.resolve(undefined);
    await Promise.resolve();
    await transport.notify("x-ahp/demo/hint", {});
    expect(writes).toHaveLength(65);
  } finally {
    parked.resolve(undefined);
    await transport.close();
    vi.useRealTimers();
  }
});

it.each(["owned", "borrowed"] as const)("retires the %s lifetime when a native write is refused at the shared send limit", async (ownership) => {
  const endpoint = new Endpoint();
  script(endpoint);
  const parked = Promise.withResolvers<undefined>();
  const transport = { recv: endpoint.recv.bind(endpoint), close: endpoint.close.bind(endpoint), send(message: Parameters<typeof endpoint.send>[0]) {
    if (typeof message === "string" && message.includes("x-ahp/test/park")) return parked.promise;
    endpoint.send(message);
    return undefined;
  } };
  const connection = await connectClient(ownership === "owned"
    ? { transport, ownership }
    : { transport, ownership, detach: endpoint.detach }, options);
  const cleanup = vi.fn();
  connection.lifetime.addCleanup(cleanup);
  const pending = Array.from({ length: 64 }, () => connection.rpc.notify("x-ahp/test/park", {}).catch(() => undefined));
  try {
    await expect(connection.rpc.notify("x-ahp/test/overflow", {})).rejects.toThrow("capacity");
    expect(connection.lifetime.signal.aborted).toBe(false);
    const refused = expect(connection.protocol.ping()).rejects.toThrow();
    expect(connection.lifetime.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    await refused;
    await expect(connection.rpc.notify("x-ahp/test/later", {})).rejects.toThrow("closed");
    await connection.protocol.shutdown();
    await connection.shutdown();
    expect(endpoint.close).toHaveBeenCalledTimes(ownership === "owned" ? 1 : 0);
    expect(endpoint.detach).toHaveBeenCalledTimes(ownership === "borrowed" ? 1 : 0);
  } finally {
    parked.resolve(undefined);
    await connection.shutdown();
    await Promise.all(pending);
  }
});

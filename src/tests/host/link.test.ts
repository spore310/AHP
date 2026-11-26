import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openHostLink, type HostLink, type HostLinkOptions } from "@host";
import { routeOutcomeUnknown, routeUnavailable } from "@host/helpers/routing/link";
import { RpcError, parseUnknownJson, type JsonRpcMessage } from "@jsonrpc";
import { createSelfSignedCertificate } from "./tlsFixture";

const CAPACITY_MESSAGE = "Routed request capacity unavailable";
const frameSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.number().optional(), method: z.string(), params: z.unknown() });
type PeerFrame = z.infer<typeof frameSchema>;

/** One accepted socket of the scripted peer. Sending on a socket the link already dropped is a no-op. */
interface PeerConnection {
  readonly headers: IncomingHttpHeaders;
  readonly closed: Promise<void>;
  reply(id: number | undefined, result: unknown): void;
  refuse(id: number | undefined, code: number, message: string): void;
  notify(method: string, params: unknown): void;
  terminate(): void;
}
type PeerScript = (frame: PeerFrame, connection: PeerConnection) => void;
interface Peer {
  readonly port: number;
  /** Every JSON-RPC frame the peer received, in arrival order, over all connections. */
  readonly frames: PeerFrame[];
  readonly connections: PeerConnection[];
  /** Resolves once the peer has received at least that many frames. */
  received(count: number): Promise<void>;
}
type Outcome = { readonly status: "resolved"; readonly value: unknown } | { readonly status: "rejected"; readonly error: unknown };

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) await release().catch(() => undefined);
});

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return { promise, resolve: () => {
    resolve(undefined);
  } };
};
/** Observes a promise at once, so a later rejection always has a handler. */
const settled = (promise: Promise<unknown>): Promise<Outcome> =>
  promise.then((value): Outcome => ({ status: "resolved", value }), (error: unknown): Outcome => ({ status: "rejected", error }));
const rejection = (outcome: Outcome): RpcError => {
  assert.ok(outcome.status === "rejected", "expected a rejection");
  assert.ok(outcome.error instanceof RpcError, "expected an RpcError");
  return outcome.error;
};
/** Lets already-received socket data and queued callbacks run. Bounded: it never waits for new input. */
const turn = async (rounds = 3): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setImmediate(resolve));
};
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const eventually = async (read: () => boolean, label: string, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!read()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await pause(5);
  }
};
const frameToText = (data: RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};

/** A real WebSocket listener on the loopback interface whose every connection the test scripts. */
const startPeer = async (script: PeerScript, tls?: { readonly key: string; readonly cert: string }): Promise<Peer> => {
  const server = tls === undefined ? createHttpServer() : createHttpsServer(tls);
  const sockets = new WebSocketServer({ server });
  const frames: PeerFrame[] = [];
  const connections: PeerConnection[] = [];
  const waiters: { readonly count: number; resolve(): void }[] = [];
  sockets.on("connection", (socket: WebSocket, request) => {
    const closed = deferred();
    socket.on("close", closed.resolve);
    socket.on("error", () => undefined);
    const send = (message: Record<string, unknown>): void => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", ...message }), () => undefined);
    };
    const connection: PeerConnection = {
      headers: request.headers,
      closed: closed.promise,
      reply: (id, result) => {
        send({ id, result });
      },
      refuse: (id, code, message) => {
        send({ id, error: { code, message } });
      },
      notify: (method, params) => {
        send({ method, params });
      },
      terminate: () => {
        socket.terminate();
      },
    };
    connections.push(connection);
    socket.on("message", (data) => {
      const frame = frameSchema.parse(parseUnknownJson(frameToText(data)));
      frames.push(frame);
      script(frame, connection);
      for (const waiter of waiters.splice(0)) {
        if (frames.length >= waiter.count) waiter.resolve();
        else waiters.push(waiter);
      }
    });
  });
  // A plaintext client on the TLS port is the server's own handshake failure, not a test error.
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanup.push(async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => {
      sockets.close(resolve);
    });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    port: (server.address() as AddressInfo).port, frames, connections,
    received: (count) => frames.length >= count
      ? Promise.resolve()
      : new Promise((resolve) => {
          waiters.push({ count, resolve });
        }),
  };
};

interface OpenedLink {
  readonly link: HostLink;
  /** Method of every notification handed to `onNotification`, in delivery order. */
  readonly notifications: string[];
  /** How many times an `onClose` handler registered at open ran. */
  readonly closes: () => number;
  readonly closed: Promise<void>;
}
const linkOptions = (peer: Peer, notifications: string[], overrides: Partial<HostLinkOptions>): HostLinkOptions => ({
  hostId: "host-b", endpoint: `ws://127.0.0.1:${String(peer.port)}/`, headers: {}, connectTimeoutMs: 2_000, requestTimeoutMs: 5_000, maxPending: 8,
  onNotification: (message: JsonRpcMessage) => {
    notifications.push("method" in message ? message.method : "not-a-notification");
  },
  ...overrides,
});
const open = async (peer: Peer, overrides: Partial<HostLinkOptions> = {}): Promise<OpenedLink> => {
  const notifications: string[] = [];
  const link = await openHostLink(linkOptions(peer, notifications, overrides));
  cleanup.push(() => {
    link.close();
    return Promise.resolve();
  });
  let closes = 0;
  const closed = deferred();
  link.onClose(() => {
    closes += 1;
    closed.resolve();
  });
  return { link, notifications, closes: () => closes, closed: closed.promise };
};

describe("host link", () => {
  it("H5-01 request/response and notification order", async () => {
    const peer = await startPeer((frame, connection) => {
      if (frame.method === "refuse") {
        connection.refuse(frame.id, -32600, "Protected view unavailable");
      } else if (frame.method === "burst") {
        for (const name of ["first", "second", "third"]) connection.notify(name, { of: frame.id });
        connection.reply(frame.id, "burst-done");
      } else if (frame.method !== "note") {
        connection.reply(frame.id, { echoed: frame.params });
      }
    });
    const { link, notifications } = await open(peer);
    expect(link.hostId).toBe("host-b");
    expect(link.isOpen()).toBe(true);

    await expect(link.request("echo", { value: 7 })).resolves.toEqual({ echoed: { value: 7 } });
    expect(peer.frames[0]).toEqual({ jsonrpc: "2.0", id: expect.any(Number) as number, method: "echo", params: { value: 7 } });

    const refused = rejection(await settled(link.request("refuse", {})));
    expect(refused.code).toBe(-32600);
    expect(refused.message).toBe("Protected view unavailable");
    // A refusal is an answer: the link stays usable.
    expect(link.isOpen()).toBe(true);

    await expect(link.request("burst", {})).resolves.toBe("burst-done");
    expect(notifications).toEqual(["first", "second", "third"]);

    // The link's own notification reaches the peer without an id and without waiting for a reply.
    expect(link.notify("note", { n: 1 })).toBe(true);
    await peer.received(4);
    expect(peer.frames[3]).toEqual({ jsonrpc: "2.0", method: "note", params: { n: 1 } });
    // Every request used a distinct id and none is left pending.
    expect(new Set(peer.frames.slice(0, 3).map((frame) => frame.id)).size).toBe(3);
    expect(link.pending()).toBe(0);
  });

  it("H5-07 bounds pending requests", async () => {
    const peer = await startPeer(() => undefined);
    const { link } = await open(peer, { maxPending: 2 });
    const first = settled(link.request("one", {}));
    const second = settled(link.request("two", {}));
    expect(link.pending()).toBe(2);

    const third = rejection(await settled(link.request("three", {})));
    expect(third.message).toBe(CAPACITY_MESSAGE);
    expect(link.pending()).toBe(2);
    // The refused request was never written: the peer sees exactly the two admitted ones.
    await peer.received(2);
    await turn();
    expect(peer.frames.map((frame) => frame.method)).toEqual(["one", "two"]);
    expect(link.isOpen()).toBe(true);

    link.close();
    expect(link.pending()).toBe(0);
    expect((await first).status).toBe("rejected");
    expect((await second).status).toBe("rejected");
  });

  it("H5-07 a missed deadline closes the link and releases everything", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    cleanup.push(() => {
      process.off("unhandledRejection", onUnhandled);
      return Promise.resolve();
    });
    const peer = await startPeer(() => undefined);
    const { link, notifications, closes } = await open(peer, { requestTimeoutMs: 150 });

    const slow = settled(link.request("slow", {}));
    const other = settled(link.request("other", {}));
    expect(link.pending()).toBe(2);
    await peer.received(2);
    // The peer has both frames and stays silent, so neither outcome is known when the deadline passes.
    expect(rejection(await slow).message).toBe(routeOutcomeUnknown().message);
    expect(rejection(await other).message).toBe(routeOutcomeUnknown().message);
    expect(link.isOpen()).toBe(false);
    expect(link.pending()).toBe(0);
    expect(closes()).toBe(1);
    // The socket itself was released, not only the bookkeeping.
    const connection = peer.connections[0];
    assert.ok(connection !== undefined);
    await connection.closed;

    expect(rejection(await settled(link.request("later", {}))).message).toBe(routeUnavailable().message);
    expect(link.notify("later", {})).toBe(false);
    link.close();
    link.close();
    expect(closes()).toBe(1);
    // A handler registered after the close still learns about it, once.
    let lateHandler = 0;
    link.onClose(() => {
      lateHandler += 1;
    });
    expect(lateHandler).toBe(1);

    // The peer answers after the deadline. Nobody receives that reply.
    const [slowFrame, otherFrame] = peer.frames;
    connection.reply(slowFrame?.id, "too late");
    connection.refuse(otherFrame?.id, -32600, "too late");
    connection.notify("too-late", {});
    await pause(50);
    expect(notifications).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(closes()).toBe(1);
    expect(peer.frames).toHaveLength(2);
    expect(link.pending()).toBe(0);
  });

  it("H5-05 a reply lost after the peer applied the request is reported as an unknown outcome", async () => {
    const applied: PeerFrame[] = [];
    const peer = await startPeer((frame, connection) => {
      // The commit happens, then the connection dies before any reply is written.
      applied.push(frame);
      connection.terminate();
    });
    const { link, closed } = await open(peer);
    const lost = rejection(await settled(link.request("commit", { value: 1 })));
    expect(lost.message).toBe("Routed request outcome unknown");
    expect(lost.message).toBe(routeOutcomeUnknown().message);
    expect(lost.code).toBe(routeOutcomeUnknown().code);
    await closed;
    await turn();
    // Applied exactly once: the link did not send the request again.
    expect(applied.map((frame) => frame.method)).toEqual(["commit"]);
    expect(peer.connections).toHaveLength(1);

    // Contrast: on a link that is already closed nothing leaves this process, so the failure is definite.
    expect(link.isOpen()).toBe(false);
    const definite = rejection(await settled(link.request("commit", { value: 2 })));
    expect(definite.message).toBe("Routed request unavailable");
    expect(definite.message).toBe(routeUnavailable().message);
    await turn();
    expect(applied).toHaveLength(1);
    expect(peer.frames).toHaveLength(1);

    // The same holds when the peer went away while the link was idle.
    const idle = await open(peer);
    const connection = peer.connections[1];
    assert.ok(connection !== undefined);
    connection.terminate();
    await idle.closed;
    expect(rejection(await settled(idle.link.request("commit", { value: 3 }))).message).toBe(routeUnavailable().message);
    await turn();
    expect(applied).toHaveLength(1);
  });

  it("H6-07 H5-01 holds what followed a reply until the caller's reply is enqueued", async () => {
    const ids = new Map<string, number | undefined>();
    const peer = await startPeer((frame, connection) => {
      if (frame.method === "solo") {
        connection.reply(frame.id, "solo-reply");
        connection.notify("after-solo", {});
        return;
      }
      if (frame.method === "probe") {
        connection.reply(frame.id, "probe-reply");
        return;
      }
      ids.set(frame.method, frame.id);
      if (frame.method !== "barrier") return;
      // One burst, in this exact order on the wire.
      connection.reply(ids.get("m1"), "r1");
      connection.notify("n1", {});
      connection.reply(ids.get("m2"), "r2");
      connection.reply(ids.get("m3"), "r3");
      connection.reply(ids.get("barrier"), "barrier-reply");
    });
    const order: string[] = [];
    const { link } = await open(peer, { onNotification: (message) => {
      order.push("method" in message ? message.method : "not-a-notification");
    } });
    const after = deferred();
    const second = settled(link.request("m2", {}));
    const first = settled(link.request("m1", {}, after.promise));
    const third = settled(link.request("m3", {}, undefined, true)).then((outcome) => {
      order.push("m3");
      return outcome;
    });
    // The peer answers this one last and nothing holds it: once it resolves, every earlier frame was handled.
    await expect(link.request("barrier", {})).resolves.toBe("barrier-reply");
    await turn();
    expect(await first).toEqual({ status: "resolved", value: "r1" });
    // Replies to other requests are not held.
    expect(await second).toEqual({ status: "resolved", value: "r2" });
    // What followed the held reply waits: the notification, and the ordered confirmation behind it.
    expect(order).toEqual([]);
    expect(link.pending()).toBe(1);

    after.resolve();
    expect(await third).toEqual({ status: "resolved", value: "r3" });
    expect(order).toEqual(["n1", "m3"]);
    expect(link.pending()).toBe(0);

    // A caller reply that is never enqueued cannot hold the link forever: the request deadline releases it.
    const bounded = await open(peer, { requestTimeoutMs: 300 });
    await expect(bounded.link.request("solo", {}, new Promise<void>(() => undefined))).resolves.toBe("solo-reply");
    await expect(bounded.link.request("probe", {})).resolves.toBe("probe-reply");
    await turn();
    expect(bounded.notifications).toEqual([]);
    await eventually(() => bounded.notifications.length > 0, "the hold to be released by the deadline");
    expect(bounded.notifications).toEqual(["after-solo"]);
    expect(bounded.link.isOpen()).toBe(true);
    await expect(bounded.link.request("probe", {}, undefined, true)).resolves.toBe("probe-reply");
  });

  it("H5-10 a TLS link works with the deployment's CA and fails closed and sanitized without it", async () => {
    const { key, cert } = createSelfSignedCertificate();
    const secret = "SECRET-PROOF-VALUE";
    const forwarded = "SECRET-FORWARDED-CALLER-CREDENTIAL";
    const headers = { "x-ahp-host-proof": secret, "x-ahp-host-forwarded": forwarded };
    const peer = await startPeer((frame, connection) => {
      connection.reply(frame.id, { echoed: frame.params });
    }, { key, cert });
    const endpoint = `wss://localhost:${String(peer.port)}/`;

    const trusted = await open(peer, { endpoint, headers, tls: { ca: cert } });
    await expect(trusted.link.request("echo", { over: "tls" })).resolves.toEqual({ echoed: { over: "tls" } });
    expect(peer.connections).toHaveLength(1);
    expect(peer.connections[0]?.headers["x-ahp-host-proof"]).toBe(secret);

    const attempts: Record<string, Partial<HostLinkOptions>> = {
      "default trust store": { endpoint, headers },
      "another deployment's CA": { endpoint, headers, tls: { ca: createSelfSignedCertificate().cert } },
      "plaintext to the TLS port": { endpoint: `ws://localhost:${String(peer.port)}/`, headers },
    };
    for (const [label, overrides] of Object.entries(attempts)) {
      const outcome = await settled(openHostLink(linkOptions(peer, [], overrides)).then((link) => {
        link.close();
        return "connected";
      }));
      const error = rejection(outcome);
      expect(error.message, label).toBe("Routed request unavailable");
      expect(error.message, label).toBe(routeUnavailable().message);
      expect(error.code, label).toBe(routeUnavailable().code);
      expect(error.data, label).toBeUndefined();
      expect(error.cause, label).toBeUndefined();
      const text = `${String(error)}\n${error.message}\n${JSON.stringify(error)}`;
      for (const leaked of ["localhost", "127.0.0.1", String(peer.port), "wss:", "certificate", "self", "CERT", secret, forwarded]) {
        expect(text, `${label}: ${leaked}`).not.toContain(leaked);
      }
    }
    // No refused attempt reached the JSON-RPC layer of the peer.
    await turn();
    expect(peer.connections).toHaveLength(1);
    expect(peer.frames).toHaveLength(1);
  });

  it("H5-07 inbound flood closes the link", async () => {
    const flood = 5_000;
    const peer = await startPeer((frame, connection) => {
      if (frame.method !== "hold") return;
      connection.reply(frame.id, "held");
      for (let index = 0; index < flood; index += 1) connection.notify("flood", { index });
    });
    const { link, notifications, closed, closes } = await open(peer, { requestTimeoutMs: 30_000 });
    const after = deferred();
    await expect(link.request("hold", {}, after.promise)).resolves.toBe("held");
    // More than 4,096 frames arrive behind a hold that is never released: the link ends instead of buffering them.
    await closed;
    expect(link.isOpen()).toBe(false);
    expect(closes()).toBe(1);
    expect(notifications).toEqual([]);
    const connection = peer.connections[0];
    assert.ok(connection !== undefined);
    await connection.closed;
    // Releasing the hold afterwards delivers nothing that was buffered.
    after.resolve();
    await turn();
    expect(notifications).toEqual([]);
    expect(rejection(await settled(link.request("later", {}))).message).toBe(routeUnavailable().message);
  });
});

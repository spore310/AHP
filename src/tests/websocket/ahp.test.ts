import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSessionsFactory,
  SESSION_URI_PREFIX,
  type SessionsFactory,
} from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createWebSocketServer, type WebSocketServerHandle } from "@websocket";
// INTERNAL canonical protocol/lifecycle compatibility, not public protected-host evidence.
import { createAHPKernel as createAHPConnectionModule } from "@websocket/helpers/ahp/helpers/kernel/helpers";

import { FrameLog, methodFrame, responseWithId } from "./helpers";

const servers: WebSocketServerHandle[] = [];
const sockets: WebSocket[] = [];

const startHost = async (): Promise<{ url: string; factory: ReturnType<typeof createSessionsFactory> }> => {
  const factory = createSessionsFactory({ providers: [mockProvider] });
  const binding = createAHPConnectionModule(factory);
  const server = createWebSocketServer({
    host: "127.0.0.1",
    port: 0,
    handlers: binding.handlers,
    onConnection: (context) => {
      binding.onConnection(context);
    },
    beforeDispatch: (dispatch) => {
      binding.beforeDispatch(dispatch);
    },
  });
  servers.push(server);
  const address = await server.start();
  return { url: `ws://127.0.0.1:${String(address.port)}/`, factory };
};

const connect = async (url: string): Promise<{ socket: WebSocket; frames: FrameLog }> => {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const opened = new WebSocket(url);
    opened.once("open", () => {
      sockets.push(opened);
      resolve(opened);
    });
    opened.once("error", reject);
  });
  return { socket, frames: new FrameLog(socket) };
};

const send = (socket: WebSocket, payload: unknown): void => {
  socket.send(JSON.stringify(payload));
};

const initialize = async (
  socket: WebSocket,
  frames: FrameLog,
  clientId: string,
  id = 1,
): Promise<void> => {
  send(socket, {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      channel: "ahp-root://",
      clientId,
      protocolVersions: ["1.0.0"],
      initialSubscriptions: ["ahp-root://"],
    },
  });
  const response = await frames.waitFor(responseWithId(id));
  expect(response).toMatchObject({
    jsonrpc: "2.0",
    id,
    result: { protocolVersion: "1.0.0" },
  });
};

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

describe("AHP connection lifetime", () => {
  it("keeps a root subscriber registered until close", async () => {
    const { url, factory } = await startHost();
    const first = await connect(url);
    const second = await connect(url);
    await initialize(first.socket, first.frames, "first");
    await initialize(second.socket, second.frames, "second");

    await factory.createSession({ channel: `${SESSION_URI_PREFIX}catalogue-peer` });

    await expect(first.frames.waitFor(methodFrame("root/sessionAdded"))).resolves.toMatchObject({
      method: "root/sessionAdded",
    });
    await expect(second.frames.waitFor(methodFrame("root/sessionAdded"))).resolves.toMatchObject({
      method: "root/sessionAdded",
    });
  });

  it("publishes an accepted action once and does not answer a dispatch notification", async () => {
    const { url, factory } = await startHost();
    const origin = await connect(url);
    await initialize(origin.socket, origin.frames, "origin");
    const channel = `${SESSION_URI_PREFIX}dispatch-peer`;
    await factory.createSession({ channel });
    await origin.frames.waitFor(methodFrame("root/sessionAdded"));

    send(origin.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "subscribe",
      params: { channel },
    });
    await origin.frames.waitFor(responseWithId(2));

    const before = origin.frames.frames.length;
    send(origin.socket, {
      jsonrpc: "2.0",
      method: "dispatchAction",
      params: {
        channel,
        clientSeq: 1,
        action: { type: "session/titleChanged", title: "Renamed" },
        origin: { clientId: "spoofed", clientSeq: 99 },
      },
    });
    send(origin.socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await origin.frames.waitFor(responseWithId(3));

    const delivered = origin.frames.frames.slice(before).filter(methodFrame("action"));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      method: "action",
      params: {
        channel,
        action: { type: "session/titleChanged", title: "Renamed" },
        origin: { clientId: "origin", clientSeq: 1 },
      },
    });
    expect(origin.frames.frames.some((frame) => (
      typeof frame === "object" && frame !== null && "id" in frame && frame.id === undefined
    ))).toBe(false);
  });

  it("applies session/activeClientSet on the wire with the connection origin", async () => {
    const { url, factory } = await startHost();
    const subscriber = await connect(url);
    const outsider = await connect(url);
    await initialize(subscriber.socket, subscriber.frames, "subscriber");
    await initialize(outsider.socket, outsider.frames, "outsider");
    const channel = `${SESSION_URI_PREFIX}active-client-peer`;
    await factory.createSession({ channel });
    await subscriber.frames.waitFor(methodFrame("root/sessionAdded"));
    await outsider.frames.waitFor(methodFrame("root/sessionAdded"));

    send(subscriber.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "subscribe",
      params: { channel },
    });
    await subscriber.frames.waitFor(responseWithId(2));

    const beforeSubscriber = subscriber.frames.frames.length;
    const beforeOutsider = outsider.frames.frames.length;
    send(subscriber.socket, {
      jsonrpc: "2.0",
      method: "dispatchAction",
      params: {
        channel,
        clientSeq: 1,
        action: {
          type: "session/activeClientSet",
          activeClient: {
            clientId: "subscriber",
            displayName: "Subscriber",
            tools: [{ name: "read_file" }],
          },
        },
        origin: { clientId: "spoofed", clientSeq: 99 },
      },
    });
    send(subscriber.socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    send(outsider.socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await subscriber.frames.waitFor(responseWithId(3));
    await outsider.frames.waitFor(responseWithId(3));

    const delivered = subscriber.frames.frames.slice(beforeSubscriber).filter(methodFrame("action"));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      method: "action",
      params: {
        channel,
        action: {
          type: "session/activeClientSet",
          activeClient: {
            clientId: "subscriber",
            displayName: "Subscriber",
            tools: [{ name: "read_file" }],
          },
        },
        origin: { clientId: "subscriber", clientSeq: 1 },
      },
    });
    expect(factory.getSessionSnapshot(channel)?.state.activeClients).toEqual([
      { clientId: "subscriber", displayName: "Subscriber", tools: [{ name: "read_file" }] },
    ]);
    expect(outsider.frames.frames.slice(beforeOutsider).filter(methodFrame("action"))).toEqual([]);
  });

  it("rejects a subscribe to an unknown channel scheme", async () => {
    const { url, factory } = await startHost();
    const client = await connect(url);
    await initialize(client.socket, client.frames, "origin");

    send(client.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "subscribe",
      params: { channel: "ahp-other://example" },
    });
    await expect(client.frames.waitFor(responseWithId(2))).resolves.toMatchObject({
      id: 2,
      error: { code: JsonRpcErrorCodes.InvalidParams },
    });
    expect(factory.listSessionSnapshots()).toHaveLength(0);
  });

  it("rejects a request-shaped dispatch without mutating session state", async () => {
    const { url, factory } = await startHost();
    const origin = await connect(url);
    await initialize(origin.socket, origin.frames, "origin");
    const channel = `${SESSION_URI_PREFIX}request-dispatch`;
    await factory.createSession({ channel });
    const before = factory.getSessionSnapshot(channel);

    send(origin.socket, {
      jsonrpc: "2.0",
      id: 9,
      method: "dispatchAction",
      params: {
        channel,
        clientSeq: 1,
        action: { type: "session/titleChanged", title: "Nope" },
      },
    });
    await expect(origin.frames.waitFor(responseWithId(9))).resolves.toMatchObject({
      id: 9,
      error: { code: JsonRpcErrorCodes.InvalidRequest },
    });
    expect(factory.getSessionSnapshot(channel)?.state.title).toBe(before?.state.title);
  });

  it("rejects operations before initialize and closes an unsupported version after the error", async () => {
    const { url, factory } = await startHost();
    const client = await connect(url);

    send(client.socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await expect(client.frames.waitFor(responseWithId(1))).resolves.toMatchObject({
      id: 1,
      error: { code: JsonRpcErrorCodes.InvalidRequest },
    });

    send(client.socket, {
      jsonrpc: "2.0",
      method: "dispatchAction",
      params: {
        channel: `${SESSION_URI_PREFIX}early`,
        clientSeq: 1,
        action: { type: "session/titleChanged", title: "Early" },
      },
    });
    send(client.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "bad",
        protocolVersions: ["0.0.0"],
        initialSubscriptions: [],
      },
    });
    send(client.socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "createSession",
      params: { channel: `${SESSION_URI_PREFIX}pipelined` },
    });

    await expect(client.frames.waitFor(responseWithId(2))).resolves.toMatchObject({
      id: 2,
      error: { code: AhpErrorCodes.UnsupportedProtocolVersion, data: { supportedVersions: ["1.0.0", "0.9.0"] } },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("socket did not close"));
      }, 1_000);
      client.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(factory.listSessionSnapshots()).toHaveLength(0);
  });

  it("does not expose dispose as a wire method", async () => {
    const { url, factory } = await startHost();
    const client = await connect(url);
    await initialize(client.socket, client.frames, "origin");

    send(client.socket, { jsonrpc: "2.0", id: 4, method: "__dispose" });
    await expect(client.frames.waitFor(responseWithId(4))).resolves.toMatchObject({
      id: 4,
      error: { code: JsonRpcErrorCodes.MethodNotFound },
    });

    await factory.createSession({ channel: `${SESSION_URI_PREFIX}still-live` });
    await expect(client.frames.waitFor(methodFrame("root/sessionAdded"))).resolves.toMatchObject({
      method: "root/sessionAdded",
    });
  });

  it("delivers a rejected dispatch only to the origin and leaves state unchanged", async () => {
    const { url, factory } = await startHost();
    const origin = await connect(url);
    const other = await connect(url);
    await initialize(origin.socket, origin.frames, "origin");
    await initialize(other.socket, other.frames, "other", 1);
    const channel = `${SESSION_URI_PREFIX}rejected`;
    await factory.createSession({ channel });
    const before = factory.getSessionSnapshot(channel);

    send(origin.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "subscribe",
      params: { channel },
    });
    send(other.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "subscribe",
      params: { channel },
    });
    await origin.frames.waitFor(responseWithId(2));
    await other.frames.waitFor(responseWithId(2));

    const originBefore = origin.frames.frames.length;
    const otherBefore = other.frames.frames.length;
    send(origin.socket, {
      jsonrpc: "2.0",
      method: "dispatchAction",
      params: {
        channel,
        clientSeq: 2,
        action: { type: "session/workingDirectorySet", directory: "file:///workspace" },
      },
    });
    send(origin.socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await origin.frames.waitFor(responseWithId(3));

    const originActions = origin.frames.frames.slice(originBefore).filter(methodFrame("action"));
    const otherActions = other.frames.frames.slice(otherBefore).filter(methodFrame("action"));
    expect(originActions).toHaveLength(1);
    const rejected = originActions[0];
    expect(rejected).toMatchObject({
      method: "action",
      params: {
        channel,
        origin: { clientId: "origin", clientSeq: 2 },
      },
    });
    const params = typeof rejected === "object" && rejected !== null && "params" in rejected
      ? rejected.params
      : undefined;
    const reason = typeof params === "object" && params !== null && "rejectionReason" in params
      ? params.rejectionReason
      : undefined;
    expect(typeof reason).toBe("string");
    expect(reason).not.toBe("");
    expect(otherActions).toHaveLength(0);
    expect(factory.getSessionSnapshot(channel)).toEqual(before);
  });

  it("does not initialize when initialize arrives as a notification", async () => {
    const { url } = await startHost();
    const client = await connect(url);
    send(client.socket, {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "origin",
        protocolVersions: ["1.0.0"],
        initialSubscriptions: ["ahp-root://"],
      },
    });
    send(client.socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await expect(client.frames.waitFor(responseWithId(1))).resolves.toMatchObject({
      id: 1,
      error: { code: JsonRpcErrorCodes.InvalidRequest },
    });
    expect(client.frames.frames.some((frame) => (
      typeof frame === "object" && frame !== null && "result" in frame
    ))).toBe(false);
  });

  it("keeps a remaining subscriber working after the other disconnects", async () => {
    const { url, factory } = await startHost();
    const leaving = await connect(url);
    const staying = await connect(url);
    await initialize(leaving.socket, leaving.frames, "leaving");
    await initialize(staying.socket, staying.frames, "staying", 1);
    leaving.socket.close();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("socket did not close"));
      }, 1_000);
      leaving.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await factory.createSession({ channel: `${SESSION_URI_PREFIX}after-close` });
    await expect(staying.frames.waitFor(methodFrame("root/sessionAdded"))).resolves.toMatchObject({
      method: "root/sessionAdded",
    });
  });

  it("rejects a second initialize without resetting the connection", async () => {
    const { url, factory } = await startHost();
    const client = await connect(url);
    await initialize(client.socket, client.frames, "origin");
    await factory.createSession({ channel: `${SESSION_URI_PREFIX}kept` });
    await client.frames.waitFor(methodFrame("root/sessionAdded"));

    send(client.socket, {
      jsonrpc: "2.0",
      id: 8,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "other",
        protocolVersions: ["1.0.0"],
        initialSubscriptions: [],
      },
    });
    await expect(client.frames.waitFor(responseWithId(8))).resolves.toMatchObject({
      id: 8,
      error: { code: JsonRpcErrorCodes.InvalidRequest },
    });

    await factory.createSession({ channel: `${SESSION_URI_PREFIX}still-origin` });
    const added = await client.frames.waitFor((frame) => (
      methodFrame("root/sessionAdded")(frame)
      && typeof frame === "object"
      && frame !== null
      && "params" in frame
      && JSON.stringify(frame.params).includes("still-origin")
    ));
    expect(added).toMatchObject({ method: "root/sessionAdded" });
  });

  it("rolls back every initial subscription when one URI is missing", async () => {
    const { url, factory } = await startHost();
    const client = await connect(url);
    const channel = `${SESSION_URI_PREFIX}present`;
    await factory.createSession({ channel });

    send(client.socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "origin",
        protocolVersions: ["1.0.0"],
        initialSubscriptions: [channel, `${SESSION_URI_PREFIX}missing`],
      },
    });
    await expect(client.frames.waitFor(responseWithId(1))).resolves.toMatchObject({
      id: 1,
      error: { code: AhpErrorCodes.SessionNotFound },
    });

    await factory.createSession({ channel: `${SESSION_URI_PREFIX}later` });
    send(client.socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await expect(client.frames.waitFor(responseWithId(2))).resolves.toMatchObject({
      id: 2,
      error: { code: JsonRpcErrorCodes.InvalidRequest },
    });
    expect(client.frames.frames.filter(methodFrame("root/sessionAdded"))).toHaveLength(0);
  });

  it("delivers a rename to subscribers only, and stops after unsubscribe", async () => {
    const { url, factory } = await startHost();
    const actor = await connect(url);
    const peer = await connect(url);
    const outsider = await connect(url);
    await initialize(actor.socket, actor.frames, "actor");
    await initialize(peer.socket, peer.frames, "peer", 1);
    await initialize(outsider.socket, outsider.frames, "outsider", 1);
    const channel = `${SESSION_URI_PREFIX}shared`;
    await factory.createSession({ channel });

    send(actor.socket, { jsonrpc: "2.0", id: 2, method: "subscribe", params: { channel } });
    send(peer.socket, { jsonrpc: "2.0", id: 2, method: "subscribe", params: { channel } });
    await actor.frames.waitFor(responseWithId(2));
    await peer.frames.waitFor(responseWithId(2));

    const actorBefore = actor.frames.frames.length;
    const peerBefore = peer.frames.frames.length;
    const outsiderBefore = outsider.frames.frames.length;
    send(actor.socket, {
      jsonrpc: "2.0",
      method: "dispatchAction",
      params: { channel, clientSeq: 1, action: { type: "session/titleChanged", title: "Shared" } },
    });
    await actor.frames.waitFor((frame) => methodFrame("action")(frame) && JSON.stringify(frame).includes("Shared"));
    await peer.frames.waitFor((frame) => methodFrame("action")(frame) && JSON.stringify(frame).includes("Shared"));
    send(outsider.socket, { jsonrpc: "2.0", id: 3, method: "ping", params: { channel: "ahp-root://" } });
    await outsider.frames.waitFor(responseWithId(3));

    const sessionActions = (frames: FrameLog, before: number): unknown[] => frames.frames.slice(before).filter((frame) => (
      methodFrame("action")(frame) && JSON.stringify(frame).includes(channel)
    ));
    expect(sessionActions(actor.frames, actorBefore)).toHaveLength(1);
    expect(sessionActions(peer.frames, peerBefore)).toHaveLength(1);
    expect(sessionActions(outsider.frames, outsiderBefore)).toHaveLength(0);

    send(peer.socket, { jsonrpc: "2.0", method: "unsubscribe", params: { channel } });
    send(peer.socket, { jsonrpc: "2.0", id: 4, method: "ping", params: { channel: "ahp-root://" } });
    await peer.frames.waitFor(responseWithId(4));
    const peerAfterUnsubscribe = peer.frames.frames.length;
    send(actor.socket, {
      jsonrpc: "2.0",
      method: "dispatchAction",
      params: { channel, clientSeq: 2, action: { type: "session/titleChanged", title: "After" } },
    });
    await actor.frames.waitFor((frame) => methodFrame("action")(frame) && JSON.stringify(frame).includes("After"));
    send(peer.socket, { jsonrpc: "2.0", id: 5, method: "ping", params: { channel: "ahp-root://" } });
    await peer.frames.waitFor(responseWithId(5));
    expect(sessionActions(peer.frames, peerAfterUnsubscribe)).toHaveLength(0);
    expect(factory.getSessionSnapshot(channel)?.state.title).toBe("After");
  });

  it("does not keep a subscription when subscribe fails", async () => {
    const { url, factory } = await startHost();
    const client = await connect(url);
    await initialize(client.socket, client.frames, "origin");
    const channel = `${SESSION_URI_PREFIX}ghost`;

    send(client.socket, {
      jsonrpc: "2.0",
      id: 5,
      method: "subscribe",
      params: { channel },
    });
    await expect(client.frames.waitFor(responseWithId(5))).resolves.toMatchObject({
      id: 5,
      error: { code: AhpErrorCodes.SessionNotFound },
    });

    await factory.createSession({ channel });
    send(client.socket, {
      jsonrpc: "2.0",
      id: 6,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await client.frames.waitFor(responseWithId(6));
    const sessionActions = client.frames.frames.filter((frame) => (
      methodFrame("action")(frame)
      && typeof frame === "object"
      && frame !== null
      && "params" in frame
      && typeof frame.params === "object"
      && frame.params !== null
      && "channel" in frame.params
      && frame.params.channel === channel
    ));
    expect(sessionActions).toHaveLength(0);
  });
});

describe("session disposal and listing", () => {
  it("removes a session from subscribers and lists the sessions that remain", async () => {
    const { url, factory } = await startHost();
    const owner = await connect(url);
    const peer = await connect(url);
    const rootOnly = await connect(url);
    const sessionOnly = await connect(url);
    await initialize(owner.socket, owner.frames, "owner");
    await initialize(peer.socket, peer.frames, "peer", 1);
    await initialize(rootOnly.socket, rootOnly.frames, "root-only", 1);
    send(sessionOnly.socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "session-only",
        protocolVersions: ["1.0.0"],
        initialSubscriptions: [],
      },
    });
    await sessionOnly.frames.waitFor(responseWithId(1));
    const channel = `${SESSION_URI_PREFIX}dispose-me`;
    const kept = `${SESSION_URI_PREFIX}keep-me`;
    await factory.createSession({ channel });
    await factory.createSession({ channel: kept });

    send(owner.socket, { jsonrpc: "2.0", id: 2, method: "subscribe", params: { channel } });
    send(peer.socket, { jsonrpc: "2.0", id: 2, method: "subscribe", params: { channel } });
    send(sessionOnly.socket, { jsonrpc: "2.0", id: 2, method: "subscribe", params: { channel } });
    await owner.frames.waitFor(responseWithId(2));
    await peer.frames.waitFor(responseWithId(2));
    await sessionOnly.frames.waitFor(responseWithId(2));

    send(owner.socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "disposeSession",
      params: { channel },
    });
    await expect(owner.frames.waitFor(responseWithId(3))).resolves.toMatchObject({ id: 3, result: null });
    await expect(owner.frames.waitFor(methodFrame("root/sessionRemoved"))).resolves.toMatchObject({
      method: "root/sessionRemoved",
      params: { channel: "ahp-root://", session: channel },
    });
    await expect(peer.frames.waitFor(methodFrame("root/sessionRemoved"))).resolves.toMatchObject({
      method: "root/sessionRemoved",
      params: { session: channel },
    });
    await expect(rootOnly.frames.waitFor(methodFrame("root/sessionRemoved"))).resolves.toMatchObject({
      method: "root/sessionRemoved",
      params: { session: channel },
    });
    await expect(sessionOnly.frames.waitFor(methodFrame("root/sessionRemoved"))).resolves.toMatchObject({
      method: "root/sessionRemoved",
      params: { session: channel },
    });

    send(owner.socket, {
      jsonrpc: "2.0",
      id: 4,
      method: "listSessions",
      params: { channel: "ahp-root://" },
    });
    const listed = await owner.frames.waitFor(responseWithId(4));
    expect(listed).toMatchObject({
      id: 4,
      result: { items: [{ resource: kept }] },
    });

    send(owner.socket, {
      jsonrpc: "2.0",
      id: 5,
      method: "ping",
      params: { channel: "ahp-root://" },
    });
    await expect(owner.frames.waitFor(responseWithId(5))).resolves.toMatchObject({ id: 5, result: null });
    expect(factory.getSessionSnapshot(channel)).toBeUndefined();
  });
});

describe("AHP snapshot reply barrier", () => {
  it("delivers a post-snapshot action once after the subscribe reply", async () => {
    const inner = createSessionsFactory({ providers: [mockProvider] });
    const channel = `${SESSION_URI_PREFIX}t19-barrier`;
    let injected = false;
    const factory: SessionsFactory = {
      createSession: (params) => inner.createSession(params),
      getSessionToolManifest: (sessionUri) => inner.getSessionToolManifest(sessionUri),
      getSessionSnapshot: (sessionUri) => {
        const snapshot = inner.getSessionSnapshot(sessionUri);
        if (!injected && sessionUri === channel && snapshot !== undefined) {
          injected = true;
          inner.dispatchAction({
            channel,
            clientSeq: 1,
            action: { type: "session/titleChanged", title: "After snapshot" },
            clientId: "t19",
          });
        }
        return snapshot;
      },
      listSessionSnapshots: () => inner.listSessionSnapshots(),
      listSessions: (params) => inner.listSessions(params),
      disposeSession: (params) => inner.disposeSession(params),
      getCurrentServerSeq: () => inner.getCurrentServerSeq(),
      listAgents: () => inner.listAgents(),
      dispatchAction: (params) => inner.dispatchAction(params),
      onCatalogueNotification: (listener) => inner.onCatalogueNotification(listener),
      onSessionEnvelope: (listener) => inner.onSessionEnvelope(listener),
      dispose: () => inner.dispose(),
    };
    const binding = createAHPConnectionModule(factory);
    const server = createWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      handlers: binding.handlers,
      onConnection: (context) => {
        binding.onConnection(context);
      },
      beforeDispatch: (dispatch) => {
        binding.beforeDispatch(dispatch);
      },
    });
    servers.push(server);
    const address = await server.start();
    const { socket, frames } = await connect(`ws://127.0.0.1:${String(address.port)}/`);
    await initialize(socket, frames, "t19-client");
    await factory.createSession({ channel });
    await frames.waitFor(methodFrame("root/sessionAdded"));

    send(socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "subscribe",
      params: { channel },
    });
    const reply = await frames.waitFor(responseWithId(2));
    expect(reply).toMatchObject({
      id: 2,
      result: {
        snapshot: {
          resource: channel,
          state: { title: "New Session" },
        },
      },
    });
    expect(injected).toBe(true);

    const titleChanged = (frame: unknown): boolean => (
      methodFrame("action")(frame)
      && typeof frame === "object"
      && frame !== null
      && "params" in frame
      && typeof frame.params === "object"
      && frame.params !== null
      && "channel" in frame.params
      && frame.params.channel === channel
      && "action" in frame.params
      && typeof frame.params.action === "object"
      && frame.params.action !== null
      && "type" in frame.params.action
      && frame.params.action.type === "session/titleChanged"
      && "title" in frame.params.action
      && frame.params.action.title === "After snapshot"
    );
    await frames.waitFor(titleChanged);

    const replyIndex = frames.frames.findIndex(responseWithId(2));
    const actionFrames = frames.frames.filter(titleChanged);
    const actionIndex = frames.frames.findIndex(titleChanged);
    expect(replyIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeGreaterThan(replyIndex);
    expect(actionFrames).toHaveLength(1);
    expect(JSON.stringify(reply)).not.toContain("After snapshot");
  });
});

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentDirectory, createStaticTokenAuthenticator, type ConnectionAuthenticator } from "@agents";
import { createSessionsFactory } from "@sessions";
import { mockProvider } from "@sessions/mock";
import {
  createAHPBinding,
  createWebSocketServer,
  type WebSocketServerHandle,
} from "@websocket";

import {
  createRegistrationFixture,
  createSessionOwnersFixture,
  createTestClock,
  createWorkFixture,
  SESSION_URI,
  WORK_ID,
  WORK_KIND,
} from "../agents/fixtures";
import { FrameLog, responseWithId } from "./helpers";

const servers: WebSocketServerHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  sockets.length = 0;
  await Promise.all(servers.map(async (server) => server.stop()));
  servers.length = 0;
});

interface RpcFrame {
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

const setup = async (authenticator: ConnectionAuthenticator) => {
  const clock = createTestClock();
  const registrations = createRegistrationFixture();
  const agents = createAgentDirectory({
    registrations: registrations.repository,
    now: clock.now,
    presenceTtlMs: 90_000,
  });
  const sessionOwners = createSessionOwnersFixture();
  const work = createWorkFixture();
  const factory = createSessionsFactory({ providers: [mockProvider] });
  const binding = createAHPBinding(factory, () => undefined, {
    agents,
    work: work.service,
    sessionOwners,
  });
  const server = createWebSocketServer({
    host: "127.0.0.1",
    port: 0,
    authenticator,
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
  return {
    url: `ws://127.0.0.1:${String(address.port)}/`,
    registrations,
    work,
  };
};

const connect = async (
  url: string,
  token?: string,
): Promise<{ socket: WebSocket; frames: FrameLog }> => {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const opened = token === undefined
      ? new WebSocket(url)
      : new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    opened.once("open", () => {
      sockets.push(opened);
      resolve(opened);
    });
    opened.once("error", reject);
  });
  return { socket, frames: new FrameLog(socket) };
};

let nextId = 1;
const rpc = async (
  socket: WebSocket,
  frames: FrameLog,
  method: string,
  params: unknown,
): Promise<RpcFrame> => {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return await frames.waitFor(responseWithId(id)) as RpcFrame;
};

const initialize = async (
  socket: WebSocket,
  frames: FrameLog,
  clientId: string,
): Promise<RpcFrame> => await rpc(socket, frames, "initialize", {
  channel: "ahp-root://",
  clientId,
  protocolVersions: ["1.0.0"],
});

describe("authenticated agent/work transport", () => {
  it("uses the handshake principal, never initialize.clientId, for agent identity", async () => {
    const { url, registrations, work } = await setup(
      createStaticTokenAuthenticator(new Map([
        ["alice-token", "alice"],
        ["bob-token", "bob"],
      ])),
    );

    const alice = await connect(url, "alice-token");
    expect((await initialize(alice.socket, alice.frames, "shared-client")).error)
      .toBeUndefined();
    const aliceRegistration = await rpc(
      alice.socket,
      alice.frames,
      "x-ahp/agents/register",
      { version: 1, agentKey: "coding-worker" },
    );
    expect(aliceRegistration.error).toBeUndefined();
    const aliceAgent = aliceRegistration.result as {
      agentId: string;
      presenceExpiresAt: string;
    };

    const bob = await connect(url, "bob-token");
    expect((await initialize(bob.socket, bob.frames, "shared-client")).error)
      .toBeUndefined();
    const bobRenew = await rpc(
      bob.socket,
      bob.frames,
      "x-ahp/agents/renew",
      { version: 1 },
    );
    expect(bobRenew.error).toEqual({
      code: -32602,
      message: "Request rejected",
    });

    const bobRegistration = await rpc(
      bob.socket,
      bob.frames,
      "x-ahp/agents/register",
      { version: 1, agentKey: "coding-worker" },
    );
    expect(bobRegistration.error).toBeUndefined();
    const bobAgent = bobRegistration.result as { agentId: string };
    expect(bobAgent.agentId).not.toBe(aliceAgent.agentId);

    const submission = await rpc(
      bob.socket,
      bob.frames,
      "x-ahp/work/submit",
      {
        version: 1,
        sessionUri: SESSION_URI,
        requestKey: "request-bob",
        kind: WORK_KIND,
        input: { path: "experiment.txt" },
      },
    );
    expect(submission.result).toEqual({ version: 1, workId: WORK_ID });
    expect(work.submitted[0]?.principal).toEqual({ subject: "bob" });
    expect(registrations.records.size).toBe(2);

    const anonymous = await connect(url);
    expect((await initialize(anonymous.socket, anonymous.frames, "alice")).error)
      .toBeUndefined();
    const denied = await rpc(
      anonymous.socket,
      anonymous.frames,
      "x-ahp/agents/register",
      { version: 1, agentKey: "coding-worker" },
    );
    expect(denied.error).toEqual({
      code: -32600,
      message: "Authentication required",
    });
    expect(registrations.records.size).toBe(2);
    expect(work.calls).toEqual(["submit"]);
  });

  it("buffers frames while an asynchronous authenticator is pending", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { url } = await setup({
      authenticate: async () => {
        await gate;
        return { subject: "alice" };
      },
    });

    const { socket, frames } = await connect(url);
    const pending = rpc(socket, frames, "initialize", {
      channel: "ahp-root://",
      clientId: "early-client",
      protocolVersions: ["1.0.0"],
    });
    release();
    const response = await pending;
    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({ protocolVersion: "1.0.0" });
  });

  it("rejects a throwing authenticator without stopping the server", async () => {
    const authenticator: ConnectionAuthenticator = {
      authenticate: (input) => {
        const authorization = input.headers.authorization;
        if (authorization === "Bearer boom") {
          return Promise.reject(new Error("authentication failed"));
        }
        return Promise.resolve(
          authorization === "Bearer good" ? { subject: "alice" } : undefined,
        );
      },
    };
    const { url } = await setup(authenticator);

    const rejected = new WebSocket(url, { headers: { Authorization: "Bearer boom" } });
    rejected.on("error", () => undefined);
    const closeCode = await new Promise<number>((resolve) => {
      rejected.once("close", (code) => {
        resolve(code);
      });
    });
    expect(closeCode).toBe(1011);

    const accepted = await connect(url, "good");
    expect((await initialize(accepted.socket, accepted.frames, "client")).error)
      .toBeUndefined();
    const registration = await rpc(
      accepted.socket,
      accepted.frames,
      "x-ahp/agents/register",
      { version: 1, agentKey: "coding-worker" },
    );
    expect(registration.error).toBeUndefined();
  });
});

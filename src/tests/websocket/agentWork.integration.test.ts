import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentInfo } from "@microsoft/agent-host-protocol";
import { createStaticTokenAuthenticator } from "@agents";
import { createBaselineSessionApplication } from "@application";
import type { WorkRepository } from "@persistence/types";
import type { SessionBackend, SessionProvider } from "@sessions/types";
import { mockProvider } from "@sessions/mock";
import { createAHPServer, type AHPServerHandle } from "@websocket";

import {
  createRegistrationFixture,
  LEASE_TOKEN,
  SESSION_URI,
  WORK_ID,
  WORK_KIND,
} from "../agents/fixtures";
import { FrameLog, responseWithId } from "./helpers";

const hosts: AHPServerHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  sockets.length = 0;
  await Promise.all(hosts.map(async (host) => host.stop()));
  hosts.length = 0;
});

interface RpcFrame {
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

interface WorkCaptures {
  readonly submitted: Array<{ readonly owner: string; readonly kind: string }>;
  readonly claimed: Array<{ readonly agentId: string; readonly principal: string }>;
  readonly renewed: Array<{ readonly workId: string; readonly token: string }>;
  readonly completed: Array<{ readonly workId: string; readonly token: string }>;
}

const createWorkRepository = (): { repository: WorkRepository; captures: WorkCaptures } => {
  const captures: WorkCaptures = {
    submitted: [],
    claimed: [],
    renewed: [],
    completed: [],
  };
  const repository: WorkRepository = {
    submit: (input) => {
      captures.submitted.push({
        owner: input.session.ownerPrincipalSubject,
        kind: input.kind,
      });
      return Promise.resolve({ id: WORK_ID, created: true });
    },
    claim: (input) => {
      captures.claimed.push({
        agentId: input.agentId,
        principal: input.principalSubject,
      });
      return Promise.resolve({
        workId: WORK_ID,
        sessionUri: SESSION_URI,
        kind: WORK_KIND,
        input: { instruction: "review" },
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: "2026-10-20T00:01:00.000Z",
        attempt: 1,
      });
    },
    renew: (input) => {
      captures.renewed.push({ workId: input.workId, token: input.token });
      return Promise.resolve({ leaseExpiresAt: "2026-10-20T00:02:00.000Z" });
    },
    complete: (input) => {
      captures.completed.push({ workId: input.workId, token: input.token });
      return Promise.resolve(true);
    },
    fail: () => Promise.resolve("queued"),
    cancel: () => Promise.resolve("cancelled"),
    get: () => Promise.resolve({
      id: WORK_ID,
      sessionUri: SESSION_URI,
      requestKey: "request-1",
      kind: WORK_KIND,
      input: { instruction: "review" },
      status: "completed",
      leaseAgentId: "agent-secret",
      leaseToken: "token-secret",
      leaseExpiresAt: "2026-10-20T00:02:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      result: { ok: true },
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:01:00.000Z",
    }),
    reconcileExpired: () => Promise.resolve(0),
    hasDependentWork: () => Promise.resolve(false),
  };
  return { repository, captures };
};

/**
 * A provider whose backend disposal parks under test control so the host
 * facade is observed against a genuinely open settle window. It carries the
 * "mock" identity because applied creations resolve their provider from the
 * baseline application's type, which pins provider "mock".
 */
const createDisposeGatedProvider = () => {
  let release: (() => void) | undefined;
  const agentInfo: AgentInfo = {
    provider: "mock",
    displayName: "Mock Agent",
    description: "Disposal gate used by facade settle-window tests.",
    models: [],
  };
  const provider: SessionProvider = {
    providerId: "mock",
    agentInfo,
    startSession: (): Promise<SessionBackend> => Promise.resolve({
      dispose: () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    }),
  };
  return {
    provider,
    settle: (): void => {
      const settled = release;
      if (settled === undefined) {
        throw new Error("No gated disposal is parked.");
      }
      release = undefined;
      settled();
    },
  };
};

const connect = async (url: string, token: string): Promise<{
  readonly socket: WebSocket;
  readonly frames: FrameLog;
}> => {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const opened = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
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
): Promise<RpcFrame> => await rpc(socket, frames, "initialize", {
  channel: "ahp-root://",
  clientId: "integration-client",
  protocolVersions: ["1.0.0"],
});

describe("authenticated AHP agent/work composition", () => {
  it("runs an authenticated A/B submit, claim, renew, complete and get flow", async () => {
    const registrations = createRegistrationFixture();
    const { repository, captures } = createWorkRepository();
    const host = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: {
        providers: [mockProvider],
        application: createBaselineSessionApplication(),
      },
      agentWork: {
        authenticator: createStaticTokenAuthenticator(new Map([
          ["alice-token", "alice"],
          ["bob-token", "bob"],
        ])),
        registrations: registrations.repository,
        work: repository,
        allowedKinds: new Set([WORK_KIND]),
      },
    });
    hosts.push(host);
    const address = await host.start();
    const url = `ws://127.0.0.1:${String(address.port)}/`;

    const alice = await connect(url, "alice-token");
    expect((await initialize(alice.socket, alice.frames)).error).toBeUndefined();
    expect((await rpc(alice.socket, alice.frames, "createSession", {
      channel: SESSION_URI,
    })).error).toBeUndefined();

    const worker = await connect(url, "alice-token");
    expect((await initialize(worker.socket, worker.frames)).error).toBeUndefined();

    const registration = await rpc(worker.socket, worker.frames, "x-ahp/agents/register", {
      version: 1,
      agentKey: "coding-worker",
    });
    expect(registration.error).toBeUndefined();
    const agentId = (registration.result as { readonly agentId: string }).agentId;

    const submission = await rpc(alice.socket, alice.frames, "x-ahp/work/submit", {
      version: 1,
      sessionUri: SESSION_URI,
      requestKey: "request-1",
      kind: WORK_KIND,
      input: { instruction: "review" },
      targetAgentId: agentId,
    });
    expect(submission.result).toEqual({ version: 1, workId: WORK_ID });
    expect(captures.submitted).toEqual([{ owner: "alice", kind: WORK_KIND }]);

    const claim = await rpc(worker.socket, worker.frames, "x-ahp/work/claim", {
      version: 1,
      sessionUri: SESSION_URI,
    });
    expect(claim.result).toMatchObject({
      version: 1,
      work: { workId: WORK_ID, leaseToken: LEASE_TOKEN },
    });
    expect(captures.claimed).toEqual([{ agentId, principal: "alice" }]);

    const renewal = await rpc(worker.socket, worker.frames, "x-ahp/work/renew", {
      version: 1,
      workId: WORK_ID,
      leaseToken: LEASE_TOKEN,
    });
    expect(renewal.result).toEqual({
      version: 1,
      leaseExpiresAt: "2026-10-20T00:02:00.000Z",
    });
    expect(captures.renewed).toEqual([{ workId: WORK_ID, token: LEASE_TOKEN }]);

    const completion = await rpc(worker.socket, worker.frames, "x-ahp/work/complete", {
      version: 1,
      workId: WORK_ID,
      leaseToken: LEASE_TOKEN,
      result: { ok: true },
    });
    expect(completion.result).toBeNull();
    expect(captures.completed).toEqual([{ workId: WORK_ID, token: LEASE_TOKEN }]);

    const result = await rpc(alice.socket, alice.frames, "x-ahp/work/get", {
      version: 1,
      workId: WORK_ID,
    });
    expect(result.result).toMatchObject({
      version: 1,
      work: { id: WORK_ID, status: "completed", result: { ok: true } },
    });
    expect(JSON.stringify(result.result)).not.toContain("token-secret");
    expect(JSON.stringify(result.result)).not.toContain("agent-secret");
  });

  it("keeps the host facade fail-closed while a connection disposal is settling", async () => {
    const registrations = createRegistrationFixture();
    const { repository } = createWorkRepository();
    const gated = createDisposeGatedProvider();
    const host = createAHPServer({
      host: "127.0.0.1",
      port: 0,
      sessions: {
        // The gated "mock" identity is the only registered provider: the
        // baseline application's catalogue keeps resolving it, while every
        // backend disposal parks under test control.
        providers: [gated.provider],
        application: createBaselineSessionApplication(),
      },
      agentWork: {
        authenticator: createStaticTokenAuthenticator(new Map([
          ["alice-token", "alice"],
        ])),
        registrations: registrations.repository,
        work: repository,
        allowedKinds: new Set([WORK_KIND]),
      },
    });
    hosts.push(host);
    const address = await host.start();
    const url = `ws://127.0.0.1:${String(address.port)}/`;

    const alice = await connect(url, "alice-token");
    expect((await initialize(alice.socket, alice.frames)).error).toBeUndefined();
    expect((await rpc(alice.socket, alice.frames, "createSession", {
      channel: SESSION_URI,
    })).error).toBeUndefined();

    // The connection disposal parks on the backend: the record is gone while
    // the settlement still holds the owner binding.
    const disposing = rpc(alice.socket, alice.frames, "disposeSession", {
      channel: SESSION_URI,
    });
    let settling = false;
    for (let attempt = 0; attempt < 20 && !settling; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      settling = host.sessions.getSessionSnapshot(SESSION_URI) === undefined;
    }
    expect(settling).toBe(true);

    // The facade mirrors the AHP create denial while the window is open.
    await expect(host.sessions.createSession({ channel: SESSION_URI }))
      .rejects.toThrow("A session disposal is still settling");

    // ...and reopens once the settlement releases the binding.
    gated.settle();
    expect((await disposing).error).toBeUndefined();
    await host.sessions.createSession({ channel: SESSION_URI });
    expect(host.sessions.getSessionSnapshot(SESSION_URI)).toBeDefined();

    // Leave nothing parked for teardown: dispose the reopened session and
    // release its gated backend once the disposal actually parks.
    const teardown = host.sessions.disposeSession({ channel: SESSION_URI });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      try {
        gated.settle();
        break;
      } catch {
        // The disposal has not parked yet; wait another turn.
      }
    }
    await teardown;
  });
});

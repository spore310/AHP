import type {
  ActionEnvelope,
  SessionState,
} from "@microsoft/agent-host-protocol";
import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import { createAgentDirectory } from "@agents";
import type { JsonRpcParams } from "@jsonrpc";
import type { SessionSnapshot, SessionsFactory } from "@sessions/types";
import { WorkError } from "@work";
import { createAHPBinding } from "@websocket/helpers/ahp";
import {
  AGENT_REGISTER_METHOD,
  WORK_SUBMIT_METHOD,
} from "@websocket/helpers/ahp/constants";
import type {
  JsonRpcInvocation,
  WebSocketConnectionContext,
} from "@websocket";

import {
  createRegistrationFixture,
  createSessionOwnersFixture,
  createTestClock,
  createWorkFixture,
  SESSION_URI,
} from "../agents/fixtures";

const invocation: JsonRpcInvocation = {
  kind: "request",
  onReplySettled: (): void => undefined,
};

const contextFor = (
  connectionId: string,
  subject: string | undefined,
  closeHandlers: Map<string, () => void>,
): WebSocketConnectionContext => ({
  connectionId,
  ...(subject !== undefined ? { principal: { subject } } : {}),
  send: (): boolean => true,
  onClose: (handler): void => {
    closeHandlers.set(connectionId, handler);
  },
  close: (): void => undefined,
});

const initialize = (
  binding: ReturnType<typeof createAHPBinding>,
  context: WebSocketConnectionContext,
): void => {
  const handler = binding.handlers.initialize;
  if (handler === undefined) {
    throw new Error("Missing initialize handler");
  }
  handler(
    {
      channel: "ahp-root://",
      clientId: "self-reported-client",
      protocolVersions: ["1.0.0"],
    },
    context,
    {
      kind: "request",
      onReplySettled: (listener): void => {
        listener({ outcome: "success", responseSent: true });
      },
    },
  );
};

const invoke = (
  binding: ReturnType<typeof createAHPBinding>,
  method: string,
  params: JsonRpcParams,
  context: WebSocketConnectionContext,
): Promise<unknown> => {
  const handler = binding.handlers[method];
  if (handler === undefined) {
    throw new Error(`Missing handler for ${method}`);
  }
  return Promise.resolve().then(() => handler(params, context, invocation));
};

const setup = () => {
  const clock = createTestClock();
  const registrations = createRegistrationFixture();
  const agents = createAgentDirectory({
    registrations: registrations.repository,
    now: clock.now,
    presenceTtlMs: 90_000,
  });
  const sessionOwners = createSessionOwnersFixture();
  const work = createWorkFixture();
  const created: unknown[] = [];
  const disposed: unknown[] = [];
  const liveRecords = new Set<string>();
  const snapshotFor = (uri: string): SessionSnapshot => ({
    resource: uri,
    fromSeq: 0,
    state: {} as SessionState,
  });
  const readChannel = (params: unknown): string | undefined => {
    if (typeof params !== "object" || params === null || !("channel" in params)) {
      return undefined;
    }
    const { channel } = params;
    return typeof channel === "string" ? channel : undefined;
  };

  const factory: SessionsFactory = {
    createSession: (params, onRecordCreated) => {
      created.push(params);
      // A real factory invokes the attach hook when the record lands; without
      // calling it the owner binding would never exist for this stub and the
      // handler's resolution-time verification would read the create as lost.
      const channel = readChannel(params);
      if (channel !== undefined) {
        liveRecords.add(channel);
        onRecordCreated?.(channel);
      }
      return Promise.resolve();
    },
    getSessionSnapshot: (uri) => (liveRecords.has(uri) ? snapshotFor(uri) : undefined),
    getSessionToolManifest: () => undefined,
    listSessionSnapshots: () => [],
    listSessions: () => ({ items: [] }),
    disposeSession: (params) => {
      work.calls.push("disposeSession");
      disposed.push(params);
      const channel = readChannel(params);
      if (channel !== undefined) {
        liveRecords.delete(channel);
      }
      return Promise.resolve();
    },
    getCurrentServerSeq: () => 0,
    listAgents: () => [],
    dispatchAction: (): ActionEnvelope => {
      throw new Error("dispatchAction is not used by these tests");
    },
    onCatalogueNotification: () => () => undefined,
    onSessionEnvelope: () => () => undefined,
    dispose: () => Promise.resolve(),
  };

  const binding = createAHPBinding(factory, () => undefined, {
    agents,
    work: work.service,
    sessionOwners,
  });
  return {
    clock,
    registrations,
    agents,
    sessionOwners,
    work,
    created,
    disposed,
    binding,
  };
};

describe("createAHPBinding agent/work lifecycle", () => {
  it("binds a created session to the authenticated principal and unbinds after disposal", async () => {
    const { sessionOwners, work, created, disposed, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const alice = contextFor("connection-1", "alice", closeHandlers);
    binding.onConnection(alice);
    initialize(binding, alice);

    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    expect(created).toEqual([{ channel: SESSION_URI }]);
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
    expect(work.assertedSessions).toHaveLength(0);

    await invoke(binding, "disposeSession", { channel: SESSION_URI }, alice);
    expect(work.assertedSessions).toEqual([SESSION_URI]);
    expect(work.calls).toEqual(["assertSessionDisposable", "disposeSession"]);
    expect(disposed).toEqual([{ channel: SESSION_URI }]);
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();
  });

  it("does not bind a session created without a trusted principal", async () => {
    const { sessionOwners, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const anonymous = contextFor("connection-1", undefined, closeHandlers);
    binding.onConnection(anonymous);
    initialize(binding, anonymous);

    await invoke(binding, "createSession", { channel: SESSION_URI }, anonymous);
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();
  });

  it("does not let another principal or an anonymous connection dispose an owned session", async () => {
    const { sessionOwners, disposed, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const alice = contextFor("connection-1", "alice", closeHandlers);
    binding.onConnection(alice);
    initialize(binding, alice);
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);

    const bob = contextFor("connection-2", "bob", closeHandlers);
    binding.onConnection(bob);
    initialize(binding, bob);
    await expect(invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      bob,
    )).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });

    const anonymous = contextFor("connection-3", undefined, closeHandlers);
    binding.onConnection(anonymous);
    initialize(binding, anonymous);
    await expect(invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      anonymous,
    )).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });

    expect(disposed).toHaveLength(0);
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
  });

  it("keeps the owner when work blocks disposal", async () => {
    const { sessionOwners, work, disposed, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const alice = contextFor("connection-1", "alice", closeHandlers);
    binding.onConnection(alice);
    initialize(binding, alice);
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);

    work.service.assertSessionDisposable = () => {
      work.calls.push("assertSessionDisposable");
      return Promise.reject(new WorkError("conflict", "dependent work exists"));
    };

    await expect(invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      alice,
    )).rejects.toMatchObject({
      code: AhpErrorCodes.Conflict,
      message: "Conflict",
    });
    expect(disposed).toHaveLength(0);
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
  });

  it("releases presence when the connection closes", async () => {
    const { agents, registrations, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const alice = contextFor("connection-1", "alice", closeHandlers);
    binding.onConnection(alice);
    initialize(binding, alice);

    const registered = await invoke(
      binding,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "coding-worker" },
      alice,
    ) as { agentId: string };
    expect(registrations.records.size).toBe(1);
    expect(agents.getOnline(registered.agentId)).toBeDefined();

    closeHandlers.get("connection-1")?.();
    expect(agents.getOnline(registered.agentId)).toBeUndefined();
    expect(agents.getByConnection("connection-1")).toBeUndefined();

    // A duplicate close callback is harmless.
    closeHandlers.get("connection-1")?.();
    expect(agents.getOnline(registered.agentId)).toBeUndefined();
  });

  it("releases all presence when the binding is disposed", async () => {
    const { agents, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const alice = contextFor("connection-1", "alice", closeHandlers);
    binding.onConnection(alice);
    initialize(binding, alice);
    const registered = await invoke(
      binding,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "coding-worker" },
      alice,
    ) as { agentId: string };

    binding.dispose();
    expect(agents.getOnline(registered.agentId)).toBeUndefined();
  });

  it("rejects extension notifications before the handler runs", () => {
    const { registrations, binding } = setup();
    const closeHandlers = new Map<string, () => void>();
    const alice = contextFor("connection-1", "alice", closeHandlers);
    binding.onConnection(alice);
    initialize(binding, alice);

    let failure: unknown;
    try {
      binding.beforeDispatch({
        kind: "notification",
        method: AGENT_REGISTER_METHOD,
        params: { version: 1, agentKey: "coding-worker" },
        context: alice,
        invocation: {
          kind: "notification",
          onReplySettled: (): void => undefined,
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: JsonRpcErrorCodes.InvalidRequest,
      message: "Invalid method kind",
    });
    expect(registrations.registerCalls).toHaveLength(0);

    expect(() => {
      binding.beforeDispatch({
        kind: "request",
        method: WORK_SUBMIT_METHOD,
        params: { version: 1 },
        context: alice,
        invocation,
      });
    }).not.toThrow();
  });
});

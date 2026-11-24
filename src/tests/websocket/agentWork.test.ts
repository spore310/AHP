import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { createAgentDirectory } from "@agents";
import type { JsonRpcParams } from "@jsonrpc";
import { createAgentWorkExtension, type AgentWorkExtension } from "@websocket/helpers/ahp/agentWork";
import {
  AGENT_REGISTER_METHOD,
  AGENT_RENEW_METHOD,
  AGENT_UNREGISTER_METHOD,
  AGENT_WORK_REQUEST_METHODS,
  AHP_NOTIFICATION_METHODS,
  AHP_REQUEST_METHODS,
  WORK_GET_METHOD,
} from "@websocket/helpers/ahp/constants";
import type { JsonRpcInvocation, WebSocketConnectionContext } from "@websocket";

import {
  createRegistrationFixture,
  createTestClock,
  createWorkFixture,
  SESSION_URI,
  WORK_ID,
  WORK_KIND,
} from "../agents/fixtures";

const invocation: JsonRpcInvocation = {
  kind: "request",
  onReplySettled: (): void => undefined,
};

const contextFor = (
  connectionId: string,
  subject?: string,
): WebSocketConnectionContext => ({
  connectionId,
  ...(subject !== undefined ? { principal: { subject } } : {}),
  send: (): boolean => true,
  onClose: (): void => undefined,
  close: (): void => undefined,
});

const invoke = (
  extension: AgentWorkExtension,
  method: string,
  params: JsonRpcParams,
  context: WebSocketConnectionContext,
): Promise<unknown> => {
  const handler = extension.handlers[method];
  if (handler === undefined) {
    throw new Error(`Missing handler for ${method}`);
  }
  return Promise.resolve().then(() => handler(params, context, invocation));
};

interface SetupOptions {
  readonly omitAgents?: boolean;
  readonly omitWork?: boolean;
}

const setup = (options: SetupOptions = {}) => {
  const clock = createTestClock();
  const registrations = createRegistrationFixture();
  const agents = createAgentDirectory({
    registrations: registrations.repository,
    now: clock.now,
    presenceTtlMs: 90_000,
  });
  const work = createWorkFixture();
  const extension = createAgentWorkExtension({
    ...(options.omitAgents === true ? {} : { agents }),
    ...(options.omitWork === true ? {} : { work: work.service }),
  });
  return { clock, registrations, agents, work, extension };
};

const registerAgent = async (
  extension: AgentWorkExtension,
  context: WebSocketConnectionContext,
  agentKey = "coding-worker",
): Promise<{
  version: number;
  agentId: string;
  presenceExpiresAt: string;
}> => {
  const result = await invoke(
    extension,
    AGENT_REGISTER_METHOD,
    { version: 1, agentKey },
    context,
  );
  return result as {
    version: number;
    agentId: string;
    presenceExpiresAt: string;
  };
};

describe("agent work extension request surface", () => {
  it("requires the protected command service to install V1 mutation handlers", () => {
    const { extension } = setup();
    for (const method of ["submit", "claim", "renew", "complete", "fail", "cancel", "updateData"]) {
      const name = `x-ahp/work/${method}`;
      expect(extension.handlers[name], name).toBeUndefined();
      expect(AHP_REQUEST_METHODS.has(name), name).toBe(true);
    }
  });

  it("declares every extension method request-only", () => {
    for (const method of AGENT_WORK_REQUEST_METHODS) {
      expect(AHP_REQUEST_METHODS.has(method)).toBe(true);
      expect(AHP_NOTIFICATION_METHODS.has(method)).toBe(false);
    }
  });

  it("registers, renews, and unregisters with exact versioned replies", async () => {
    const { clock, registrations, agents, extension } = setup();
    const alice = contextFor("connection-1", "alice");

    const registered = await registerAgent(extension, alice);
    const record = [...registrations.records.values()][0];
    expect(record).toBeDefined();
    expect(registered).toEqual({
      version: 1,
      agentId: record?.id,
      presenceExpiresAt: new Date(1_000_000 + 90_000).toISOString(),
    });
    expect(agents.getOnline(registered.agentId)).toMatchObject({
      principalSubject: "alice",
      connectionId: "connection-1",
      generation: 1,
    });

    clock.advance(1_000);
    await expect(invoke(extension, AGENT_RENEW_METHOD, { version: 1 }, alice)).resolves.toEqual({
      version: 1,
      agentId: registered.agentId,
      presenceExpiresAt: new Date(1_001_000 + 90_000).toISOString(),
    });

    await expect(invoke(extension, AGENT_UNREGISTER_METHOD, { version: 1 }, alice))
      .resolves.toBeNull();
    expect(agents.getOnline(registered.agentId)).toBeUndefined();
  });

  it("requires an authenticated principal before touching state", async () => {
    const { registrations, work, extension } = setup();
    const anonymous = contextFor("anonymous");
    const methods = [
      AGENT_REGISTER_METHOD,
      AGENT_RENEW_METHOD,
      AGENT_UNREGISTER_METHOD,
      WORK_GET_METHOD,
    ];

    for (const method of methods) {
      await expect(invoke(extension, method, { version: 1 }, anonymous)).rejects.toMatchObject({
        name: "RpcError",
        code: JsonRpcErrorCodes.InvalidRequest,
        message: "Authentication required",
      });
    }
    expect(registrations.registerCalls).toHaveLength(0);
    expect(work.calls).toHaveLength(0);
  });

  it("fails safely when optional services are not configured", async () => {
    const { extension } = setup({ omitAgents: true, omitWork: true });
    const alice = contextFor("connection-1", "alice");

    await expect(invoke(
      extension,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "coding-worker" },
      alice,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidRequest,
      message: "Extension is not configured",
    });
    await expect(invoke(
      extension,
      WORK_GET_METHOD,
      { version: 1, workId: WORK_ID },
      alice,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidRequest,
      message: "Extension is not configured",
    });
  });

  it("rejects unsupported versions and extra fields before changing state", async () => {
    const { registrations, work, extension } = setup();
    const alice = contextFor("connection-1", "alice");

    await expect(invoke(
      extension,
      AGENT_REGISTER_METHOD,
      { version: 2, agentKey: "coding-worker" },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    await expect(invoke(
      extension,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "coding-worker", extra: true },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    expect(registrations.registerCalls).toHaveLength(0);

    for (const params of [{ version: 2, workId: WORK_ID }, { version: 1, workId: WORK_ID, extra: true }]) {
      await expect(invoke(extension, WORK_GET_METHOD, params, alice)).rejects.toBeInstanceOf(ZodError);
    }
    expect(work.calls).toHaveLength(0);
  });

  it("rejects blank display names and unstorable agent keys", async () => {
    const { registrations, extension } = setup();
    const alice = contextFor("connection-1", "alice");

    await expect(invoke(
      extension,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "coding-worker", displayName: "   " },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    expect(registrations.registerCalls).toHaveLength(0);

    await expect(invoke(
      extension,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "bad\u0000key" },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    expect(registrations.registerCalls).toHaveLength(0);
  });

  it("does not create a durable registration row behind a connection conflict", async () => {
    const { registrations, extension } = setup();
    const alice = contextFor("connection-1", "alice");

    const first = await registerAgent(extension, alice);
    expect(registrations.records.size).toBe(1);

    // Another agentKey from the same connection can never bind, so it is
    // rejected before a durable row is created.
    await expect(invoke(
      extension,
      AGENT_REGISTER_METHOD,
      { version: 1, agentKey: "other-worker" },
      alice,
    )).rejects.toMatchObject({ code: AhpErrorCodes.Conflict, message: "Conflict" });
    expect(registrations.registerCalls).toHaveLength(1);
    expect(registrations.records.size).toBe(1);

    // Re-registering the connection's own agent key stays allowed.
    const again = await registerAgent(extension, alice);
    expect(again.agentId).toBe(first.agentId);
    expect(registrations.registerCalls).toHaveLength(2);
    expect(registrations.records.size).toBe(1);
  });

  it("maps a live-connection conflict to a generic conflict", async () => {
    const { extension } = setup();
    const first = contextFor("connection-1", "alice");
    const second = contextFor("connection-2", "alice");
    await registerAgent(extension, first);

    await expect(registerAgent(extension, second)).rejects.toMatchObject({
      code: AhpErrorCodes.Conflict,
      message: "Conflict",
    });
  });
});

describe("agent work extension work replies", () => {
  it("forwards work reads with the verified principal and versioned reply", async () => {
    const { work, extension } = setup();
    const alice = contextFor("connection-1", "alice");
    const view = {
      id: WORK_ID,
      sessionUri: SESSION_URI,
      kind: WORK_KIND,
      status: "completed",
      input: { path: "experiment.txt" },
      result: { ok: true },
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    };
    await expect(invoke(
      extension,
      WORK_GET_METHOD,
      { version: 1, workId: WORK_ID },
      alice,
    )).resolves.toEqual({ version: 1, work: view });
    expect(work.got[0]).toEqual({
      principal: { subject: "alice" },
      workId: WORK_ID,
    });
  });
});

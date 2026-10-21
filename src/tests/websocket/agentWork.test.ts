import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { createAgentDirectory } from "@agents";
import { RpcError, type JsonRpcParams } from "@jsonrpc";
import { WorkError } from "@work";
import { createAgentWorkExtension, type AgentWorkExtension } from "@websocket/helpers/ahp/agentWork";
import {
  AGENT_REGISTER_METHOD,
  AGENT_RENEW_METHOD,
  AGENT_UNREGISTER_METHOD,
  AGENT_WORK_REQUEST_METHODS,
  AHP_NOTIFICATION_METHODS,
  AHP_REQUEST_METHODS,
  WORK_CANCEL_METHOD,
  WORK_CLAIM_METHOD,
  WORK_COMPLETE_METHOD,
  WORK_FAIL_METHOD,
  WORK_GET_METHOD,
  WORK_RENEW_METHOD,
  WORK_SUBMIT_METHOD,
} from "@websocket/helpers/ahp/constants";
import type { JsonRpcInvocation, WebSocketConnectionContext } from "@websocket";

import {
  createRegistrationFixture,
  createSessionOwnersFixture,
  createTestClock,
  createWorkFixture,
  LEASE_TOKEN,
  SESSION_URI,
  WORK_ID,
  WORK_KIND,
  type WorkFixtureOptions,
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
  readonly workOptions?: WorkFixtureOptions;
}

const setup = (options: SetupOptions = {}) => {
  const clock = createTestClock();
  const registrations = createRegistrationFixture();
  const agents = createAgentDirectory({
    registrations: registrations.repository,
    now: clock.now,
    presenceTtlMs: 90_000,
  });
  const sessionOwners = createSessionOwnersFixture();
  const work = createWorkFixture(options.workOptions);
  const extension = createAgentWorkExtension({
    ...(options.omitAgents === true ? {} : { agents }),
    ...(options.omitWork === true ? {} : { work: work.service }),
    sessionOwners,
  });
  return { clock, registrations, agents, sessionOwners, work, extension };
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
      WORK_SUBMIT_METHOD,
      WORK_CLAIM_METHOD,
      WORK_RENEW_METHOD,
      WORK_COMPLETE_METHOD,
      WORK_FAIL_METHOD,
      WORK_CANCEL_METHOD,
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

  it("requires a live registered agent for agent-scoped work", async () => {
    const { work, extension } = setup();
    const alice = contextFor("connection-1", "alice");

    for (const method of [
      WORK_CLAIM_METHOD,
      WORK_RENEW_METHOD,
      WORK_COMPLETE_METHOD,
      WORK_FAIL_METHOD,
    ]) {
      await expect(invoke(extension, method, { version: 1 }, alice)).rejects.toMatchObject({
        code: JsonRpcErrorCodes.InvalidParams,
        message: "Request rejected",
      });
    }
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
      WORK_SUBMIT_METHOD,
      {
        version: 1,
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: {},
      },
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

    await registerAgent(extension, alice);
    await expect(invoke(
      extension,
      WORK_SUBMIT_METHOD,
      {
        version: 2,
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: {},
      },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    await expect(invoke(
      extension,
      WORK_SUBMIT_METHOD,
      {
        version: 1,
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: {},
        extra: true,
      },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    expect(work.calls).toHaveLength(0);
  });

  it("rejects blank display names, unstorable scalar text, unsafe payloads, and non-object results", async () => {
    const { registrations, work, extension } = setup();
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

    await registerAgent(extension, alice);
    await expect(invoke(
      extension,
      WORK_SUBMIT_METHOD,
      {
        version: 1,
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: { note: "a\u0000b" },
      },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    expect(work.calls).toHaveLength(0);

    await expect(invoke(
      extension,
      WORK_SUBMIT_METHOD,
      {
        version: 1,
        sessionUri: `${SESSION_URI}\u0000`,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: { instruction: "change" },
      },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
    expect(work.calls).toHaveLength(0);

    await expect(invoke(
      extension,
      WORK_COMPLETE_METHOD,
      {
        version: 1,
        workId: WORK_ID,
        leaseToken: LEASE_TOKEN,
        result: "not-an-object",
      },
      alice,
    )).rejects.toBeInstanceOf(ZodError);
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
  it("forwards principal-scoped work requests with exact reply shapes", async () => {
    const { registrations, sessionOwners, work, extension } = setup();
    const alice = contextFor("connection-1", "alice");
    const registered = await registerAgent(extension, alice);
    sessionOwners.bind(SESSION_URI, "alice");

    const targetAgentId = "00000000-0000-4000-8000-000000000201";
    await expect(invoke(
      extension,
      WORK_SUBMIT_METHOD,
      {
        version: 1,
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: { path: "experiment.txt" },
        targetAgentId,
      },
      alice,
    )).resolves.toEqual({ version: 1, workId: WORK_ID });
    expect(work.submitted[0]).toEqual({
      principal: { subject: "alice" },
      input: {
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: { path: "experiment.txt" },
        targetAgentId,
      },
    });

    const expectedAgent = {
      principal: { subject: "alice" },
      agentId: registered.agentId,
      connectionId: "connection-1",
      generation: 1,
    };
    await expect(invoke(
      extension,
      WORK_CLAIM_METHOD,
      { version: 1, sessionUri: SESSION_URI },
      alice,
    )).resolves.toEqual({
      version: 1,
      work: {
        workId: WORK_ID,
        sessionUri: SESSION_URI,
        kind: WORK_KIND,
        input: { path: "experiment.txt" },
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: "2026-01-01T00:00:00.000Z",
        attempt: 1,
      },
    });
    expect(work.claimed[0]?.agent).toEqual(expectedAgent);

    await expect(invoke(
      extension,
      WORK_RENEW_METHOD,
      { version: 1, workId: WORK_ID, leaseToken: LEASE_TOKEN },
      alice,
    )).resolves.toEqual({
      version: 1,
      leaseExpiresAt: "2026-01-01T00:00:02.000Z",
    });

    await expect(invoke(
      extension,
      WORK_COMPLETE_METHOD,
      {
        version: 1,
        workId: WORK_ID,
        leaseToken: LEASE_TOKEN,
        result: { ok: true },
      },
      alice,
    )).resolves.toBeNull();
    expect(work.completed[0]).toEqual({
      agent: expectedAgent,
      workId: WORK_ID,
      token: LEASE_TOKEN,
      result: { ok: true },
    });

    await expect(invoke(
      extension,
      WORK_FAIL_METHOD,
      {
        version: 1,
        workId: WORK_ID,
        leaseToken: LEASE_TOKEN,
        retryable: true,
        message: "transient failure",
      },
      alice,
    )).resolves.toEqual({ version: 1, status: "queued" });
    expect(work.failed[0]?.reason).toEqual({
      retryable: true,
      message: "transient failure",
    });

    await expect(invoke(
      extension,
      WORK_CANCEL_METHOD,
      { version: 1, workId: WORK_ID },
      alice,
    )).resolves.toBeNull();
    expect(work.cancelled[0]).toEqual({
      principal: { subject: "alice" },
      workId: WORK_ID,
    });

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

    expect(registrations.records.size).toBe(1);
  });

  it("returns a null claim when no work is available", async () => {
    const { sessionOwners, extension } = setup({ workOptions: { lease: null } });
    const alice = contextFor("connection-1", "alice");
    await registerAgent(extension, alice);
    sessionOwners.bind(SESSION_URI, "alice");

    await expect(invoke(
      extension,
      WORK_CLAIM_METHOD,
      { version: 1, sessionUri: SESSION_URI },
      alice,
    )).resolves.toEqual({ version: 1, work: null });
  });

  it("rejects work on a live session owned by a different principal", async () => {
    const { sessionOwners, work, extension } = setup();
    const alice = contextFor("connection-1", "alice");
    await registerAgent(extension, alice);
    sessionOwners.bind(SESSION_URI, "bob");

    await expect(invoke(
      extension,
      WORK_SUBMIT_METHOD,
      {
        version: 1,
        sessionUri: SESSION_URI,
        requestKey: "request-1",
        kind: WORK_KIND,
        input: {},
      },
      alice,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
      message: "Request rejected",
    });
    await expect(invoke(
      extension,
      WORK_CLAIM_METHOD,
      { version: 1, sessionUri: SESSION_URI },
      alice,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
      message: "Request rejected",
    });
    expect(work.calls).toHaveLength(0);
  });

  it("maps stale and exhausted lease failures to an invalid request", async () => {
    for (const code of ["stale", "exhausted"] as const) {
      const { sessionOwners, extension } = setup({
        workOptions: { claimError: new WorkError(code, "internal detail") },
      });
      const alice = contextFor("connection-1", "alice");
      await registerAgent(extension, alice);
      sessionOwners.bind(SESSION_URI, "alice");

      await expect(invoke(
        extension,
        WORK_CLAIM_METHOD,
        { version: 1, sessionUri: SESSION_URI },
        alice,
      )).rejects.toEqual(new RpcError(JsonRpcErrorCodes.InvalidRequest, "Request rejected"));
    }
  });
});

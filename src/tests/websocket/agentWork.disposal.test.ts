import { AhpErrorCodes, JsonRpcErrorCodes, type AgentInfo } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import type { JsonRpcParams } from "@jsonrpc";
import { createSessionsFactory } from "@sessions";
import type { SessionBackend, SessionProvider } from "@sessions/types";
import { createSessionOwnerRegistry, createWorkService } from "@work";
import type { DurableSessionInput, WorkRepository } from "@persistence/types";
import { createAHPBinding } from "@websocket/helpers/ahp";
import type { JsonRpcInvocation, WebSocketConnectionContext } from "@websocket";

import { createRegistrationFixture } from "../agents/fixtures";

const SESSION_URI = "ahp-session:/disposal-race";
const WORK_KIND = "code.review";
const WORK_ID = "00000000-0000-4000-8000-000000090001";

const invocation: JsonRpcInvocation = {
  kind: "request",
  onReplySettled: (): void => undefined,
};

const contextFor = (
  connectionId: string,
  subject: string,
): WebSocketConnectionContext => ({
  connectionId,
  principal: { subject },
  send: (): boolean => true,
  onClose: (): void => undefined,
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

/**
 * A provider whose backend disposal is parked under test control so the
 * dispose-vs-recreate races land deterministically.
 */
const createGatedProvider = () => {
  let release: (() => void) | undefined;
  let failing = false;
  const agentInfo: AgentInfo = {
    provider: "gated",
    displayName: "Gated Agent",
    description: "Disposal gate used by the lifecycle race tests.",
    models: [],
  };
  const provider: SessionProvider = {
    providerId: "gated",
    agentInfo,
    startSession: (): Promise<SessionBackend> => {
      return Promise.resolve({
        dispose: () => new Promise<void>((resolve, reject) => {
          release = (): void => {
            if (failing) {
              reject(new Error("backend disposal failed"));
              return;
            }
            resolve();
          };
        }),
      });
    },
  };
  return {
    provider,
    /** Releases the parked disposal; `fail: true` makes the backend reject. */
    settle: (options: { fail?: boolean } = {}): void => {
      failing = options.fail === true;
      const settled = release;
      if (settled === undefined) {
        throw new Error("No gated disposal is parked.");
      }
      release = undefined;
      settled();
    },
  };
};

const createRepository = () => {
  const submitted: string[] = [];
  const cancelled: string[] = [];
  const dependentWork = new Set<string>();
  const repository: WorkRepository = {
    submit: (input) => {
      submitted.push(`${input.session.sessionUri}\u0000${input.requestKey}`);
      return Promise.resolve({ id: WORK_ID, created: true });
    },
    claim: () => Promise.resolve(null),
    renew: () => Promise.resolve(null),
    complete: () => Promise.resolve(false),
    fail: () => Promise.resolve(null),
    cancel: (input) => {
      cancelled.push(input.workId);
      return Promise.resolve("cancelled");
    },
    get: () => Promise.resolve(null),
    reconcileExpired: () => Promise.resolve(0),
    hasDependentWork: (sessionUri) => Promise.resolve(dependentWork.has(sessionUri)),
  };
  return { repository, submitted, cancelled, dependentWork };
};

const setup = () => {
  const gated = createGatedProvider();
  const factory = createSessionsFactory({ providers: [gated.provider] });
  const sessionOwners = createSessionOwnerRegistry();
  const { repository, submitted, cancelled, dependentWork } = createRepository();
  const registrations = createRegistrationFixture().repository;

  const work = createWorkService({
    repository,
    sessions: sessionOwners,
    presence: { getByConnection: () => undefined },
    registrations,
    describeSession: (uri): DurableSessionInput | undefined => {
      const snapshot = factory.getSessionSnapshot(uri);
      if (snapshot === undefined) {
        return undefined;
      }
      const state = snapshot.state as { readonly provider?: unknown };
      const owner = sessionOwners.owner(uri);
      if (typeof state.provider !== "string" || owner === undefined) {
        return undefined;
      }
      const now = new Date().toISOString();
      return {
        sessionUri: uri,
        ownerPrincipalSubject: owner,
        providerId: state.provider,
        createdAt: now,
        modifiedAt: now,
        lastServerSeq: snapshot.fromSeq,
        durableState: { fromSeq: snapshot.fromSeq, state: snapshot.state },
      };
    },
    allowedKinds: new Set([WORK_KIND]),
  });

  const binding = createAHPBinding(factory, () => undefined, {
    work,
    sessionOwners,
  });

  return { gated, factory, sessionOwners, work, submitted, cancelled, dependentWork, binding };
};

const connect = (
  binding: ReturnType<typeof createAHPBinding>,
  connectionId: string,
  subject: string,
): WebSocketConnectionContext => {
  const context = contextFor(connectionId, subject);
  binding.onConnection(context);
  initialize(binding, context);
  return context;
};

describe("agent work disposal races", () => {
  it("releases the owner binding when backend disposal fails and keeps the recreated session owned", async () => {
    const { gated, factory, sessionOwners, work, submitted, cancelled, binding } = setup();
    const alice = connect(binding, "connection-1", "alice");
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    let settled = false;
    const disposing = invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      alice,
    );
    void disposing.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    // The record is gone while the backend disposal is parked; the owner
    // binding deliberately outlives the removal so recreates during the window
    // fail closed instead of creating an unowned record.
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeUndefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    const bob = connect(binding, "connection-2", "bob");
    await expect(invoke(
      binding,
      "createSession",
      { channel: SESSION_URI },
      bob,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
      message: "Session not found",
    });

    gated.settle({ fail: true });
    await expect(disposing).rejects.toMatchObject({ code: JsonRpcErrorCodes.InternalError });
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();

    // The same URI is re-creatable once the failed disposal settles.
    await invoke(binding, "createSession", { channel: SESSION_URI }, bob);
    expect(sessionOwners.owner(SESSION_URI)).toBe("bob");

    // The stale principal can no longer make the recreated session accept work.
    const submission = {
      sessionUri: SESSION_URI,
      requestKey: "after-race",
      kind: WORK_KIND,
      input: { path: "experiment.txt" },
    };
    await expect(work.submit({ subject: "alice" }, submission))
      .rejects.toMatchObject({ code: "unauthorized" });

    const lease = await work.submit({ subject: "bob" }, submission);
    expect(lease.id).toBe(WORK_ID);
    expect(submitted).toEqual([`${SESSION_URI}\u0000after-race`]);
    expect(cancelled).toEqual([]);
  });

  it("keeps mid-window recreates fail-closed when the disposal succeeds", async () => {
    const { gated, factory, sessionOwners, binding } = setup();
    const alice = connect(binding, "connection-1", "alice");
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);

    let settled = false;
    const disposing = invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      alice,
    );
    void disposing.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeUndefined();

    const bob = connect(binding, "connection-2", "bob");
    await expect(invoke(
      binding,
      "createSession",
      { channel: SESSION_URI },
      bob,
    )).rejects.toMatchObject({ code: JsonRpcErrorCodes.InvalidParams });

    gated.settle();
    await expect(disposing).resolves.toBeNull();
    expect(settled).toBe(true);
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();

    await invoke(binding, "createSession", { channel: SESSION_URI }, bob);
    expect(sessionOwners.owner(SESSION_URI)).toBe("bob");
  });

  it("keeps the owner binding when dependent work blocks disposal", async () => {
    const { dependentWork, sessionOwners, factory, binding } = setup();
    const alice = connect(binding, "connection-1", "alice");
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    dependentWork.add(SESSION_URI);

    await expect(invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      alice,
    )).rejects.toMatchObject({ code: AhpErrorCodes.Conflict });

    // The live record and its owner binding survive a work-blocked disposal.
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
  });
});

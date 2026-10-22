import { AhpErrorCodes, JsonRpcErrorCodes, type AgentInfo } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import type { JsonRpcParams } from "@jsonrpc";
import { createSessionsFactory } from "@sessions";
import type { SessionBackend, SessionProvider } from "@sessions/types";
import { createSessionOwnerRegistry, createWorkService, type SessionOwnerRegistry } from "@work";
import type { DurableSessionInput, WorkRepository } from "@persistence/types";
import { createAHPBinding } from "@websocket/helpers/ahp";
import { isSettlingSession } from "@websocket/helpers/settling";
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

/**
 * A provider whose backend start is parked under test control so the
 * create-vs-dispose races land deterministically; any backend it finally
 * produces disposes immediately.
 */
const createLateStartProvider = () => {
  const parked: Array<(backend: SessionBackend) => void> = [];
  const agentInfo: AgentInfo = {
    provider: "late",
    displayName: "Late Agent",
    description: "Backend-start gate used by the binding lifecycle tests.",
    models: [],
  };
  const provider: SessionProvider = {
    providerId: "late",
    agentInfo,
    startSession: (): Promise<SessionBackend> => new Promise<SessionBackend>((resolve) => {
      parked.push(resolve);
    }),
  };
  return {
    provider,
    /** Resolves the oldest parked backend start (FIFO). */
    release: (): void => {
      const resolve = parked.shift();
      if (resolve === undefined) {
        throw new Error("No parked backend start to release.");
      }
      resolve({ dispose: () => Promise.resolve() });
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

const setupWithProvider = (
  provider: SessionProvider,
  sessionOwners: SessionOwnerRegistry = createSessionOwnerRegistry(),
) => {
  const factory = createSessionsFactory({ providers: [provider] });
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

  return { factory, sessionOwners, work, submitted, cancelled, dependentWork, binding };
};

const setup = () => {
  const gated = createGatedProvider();
  return { gated, ...setupWithProvider(gated.provider) };
};

const setupLate = () => {
  const late = createLateStartProvider();
  return { late, ...setupWithProvider(late.provider) };
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

  it("denies the owner's own recreate inside the settling window", async () => {
    const { gated, factory, sessionOwners, binding } = setup();
    const alice = connect(binding, "connection-1", "alice");
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    const disposing = invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      alice,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeUndefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    // Even the bound owner is refused: a mid-window recreate would be stripped
    // by the settlement's unconditional release, stranding an ownerless record.
    await expect(invoke(
      binding,
      "createSession",
      { channel: SESSION_URI },
      alice,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
      message: "Session not found",
    });

    gated.settle();
    await expect(disposing).resolves.toBeNull();
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();

    // The post-settle recreate binds its true creator, and the settlement can
    // no longer strip that binding because there is none to release.
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
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

  it("denies a stale detached create from binding a foreign successor's record", async () => {
    const { late, factory, sessionOwners, work, binding } = setupLate();
    const alice = connect(binding, "connection-1", "alice");
    const creating = invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    // The record attaches and the owner binding lands while the backend start
    // is parked; the create cannot complete until its start is released.
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    // The creator's own disposal releases the binding at settlement: a
    // back-endless record returns immediately.
    await invoke(binding, "disposeSession", { channel: SESSION_URI }, alice);
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();

    // A successor attaches its record and its binding at the same instant.
    const bob = connect(binding, "connection-2", "bob");
    const bobCreating = invoke(binding, "createSession", { channel: SESSION_URI }, bob);
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("bob");

    // The stale create resolves without re-binding, and its resolution answers
    // a typed conflict instead of a success the caller could rely on.
    late.release();
    await expect(creating).rejects.toMatchObject({
      code: AhpErrorCodes.Conflict,
      message: "The created session is no longer available.",
    });
    expect(sessionOwners.owner(SESSION_URI)).toBe("bob");
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();

    // The durable work channel stays with the true creator.
    await expect(work.submit({ subject: "alice" }, {
      sessionUri: SESSION_URI,
      requestKey: "late-takeover",
      kind: WORK_KIND,
      input: { path: "experiment.txt" },
    })).rejects.toMatchObject({ code: "unauthorized" });
    await expect(work.submit({ subject: "bob" }, {
      sessionUri: SESSION_URI,
      requestKey: "true-creator",
      kind: WORK_KIND,
      input: { path: "experiment.txt" },
    })).resolves.toMatchObject({ id: WORK_ID });

    late.release();
    await expect(bobCreating).resolves.toBeNull();
    expect(sessionOwners.owner(SESSION_URI)).toBe("bob");
  });

  it("answers conflict for a create whose record was disposed mid-start and never binds a ghost", async () => {
    const { late, factory, sessionOwners, binding } = setupLate();
    const alice = connect(binding, "connection-1", "alice");
    const creating = invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    // The creator disposes its own record mid-start; the back-endless record
    // is gone immediately and the binding was released at settlement.
    await invoke(binding, "disposeSession", { channel: SESSION_URI }, alice);
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeUndefined();
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();

    // The parked start resolves into a detached record. The stale create must
    // neither re-bind (which would strand an ownerless settle window no
    // settlement can release) nor answer plain success.
    late.release();
    await expect(creating).rejects.toMatchObject({ code: AhpErrorCodes.Conflict });
    expect(sessionOwners.owner(SESSION_URI)).toBeUndefined();
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeUndefined();

    // The URI is immediately re-creatable, and the recreate binds its true
    // creator at attach time.
    const recreating = invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
    late.release();
    await expect(recreating).resolves.toBeNull();
  });

  it("protects a live in-flight create against foreign disposal", async () => {
    const { late, factory, sessionOwners, binding } = setupLate();
    const alice = connect(binding, "connection-1", "alice");
    const creating = invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");

    // While the backend start is parked, the record already carries its owner
    // binding: a foreign connection cannot dispose it.
    const bob = connect(binding, "connection-2", "bob");
    await expect(invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      bob,
    )).rejects.toMatchObject({
      code: JsonRpcErrorCodes.InvalidParams,
      message: "Session not found",
    });
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();

    late.release();
    await expect(creating).resolves.toBeNull();
    expect(sessionOwners.owner(SESSION_URI)).toBe("alice");
  });

  it("surfaces a failing settlement unbind and heals the settle window on a re-dispose", async () => {
    // A custom registry whose unbind fails exactly once: the shipped
    // registries cannot throw, so this pins the documented failure shape for
    // embedders instead of swallowing it into a permanent settle lockout.
    const inner = createSessionOwnerRegistry();
    let unbindFails = true;
    const sessionOwners: SessionOwnerRegistry = {
      bind: (uri, subject) => {
        inner.bind(uri, subject);
      },
      owner: (uri) => inner.owner(uri),
      unbind: (uri) => {
        if (unbindFails) {
          unbindFails = false;
          throw new Error("unbind failed");
        }
        inner.unbind(uri);
      },
      clear: () => {
        inner.clear();
      },
    };
    const gated = createGatedProvider();
    const { factory, binding } = setupWithProvider(gated.provider, sessionOwners);
    const alice = connect(binding, "connection-1", "alice");
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    expect(inner.owner(SESSION_URI)).toBe("alice");

    const disposing = invoke(binding, "disposeSession", { channel: SESSION_URI }, alice);
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeUndefined();
    expect(inner.owner(SESSION_URI)).toBe("alice");

    // The backend disposal fails and the settlement's unbind throw replaces
    // the outcome: the failure stays loud instead of silently keeping a
    // binding the settlement was supposed to release.
    gated.settle({ fail: true });
    await expect(disposing).rejects.toThrow("unbind failed");
    expect(inner.owner(SESSION_URI)).toBe("alice");

    // The re-dispose answers SessionNotFound (the record is already gone) but
    // still releases the binding in finally, healing the settle window.
    await expect(invoke(
      binding,
      "disposeSession",
      { channel: SESSION_URI },
      alice,
    )).rejects.toMatchObject({ code: AhpErrorCodes.SessionNotFound });
    expect(inner.owner(SESSION_URI)).toBeUndefined();

    const recreating = invoke(binding, "createSession", { channel: SESSION_URI }, alice);
    await expect(recreating).resolves.toBeNull();
    expect(inner.owner(SESSION_URI)).toBe("alice");
    expect(factory.getSessionSnapshot(SESSION_URI)).toBeDefined();
  });
});

describe("shared settle-window probe", () => {
  it("marks exactly an owner binding without a live record", async () => {
    const { gated, factory, sessionOwners, binding } = setup();
    const alice = connect(binding, "connection-1", "alice");
    await invoke(binding, "createSession", { channel: SESSION_URI }, alice);

    // Live and owned is not settling; an unknown channel is not settling.
    expect(isSettlingSession(sessionOwners, factory, SESSION_URI)).toBe(false);
    expect(isSettlingSession(sessionOwners, factory, "ahp-session:/unknown")).toBe(false);

    // Mid-disposal (record gone, binding still held by the parked settle) the
    // probe fires, which is what keeps the create window closed for every
    // principal.
    const disposing = invoke(binding, "disposeSession", { channel: SESSION_URI }, alice);
    await new Promise((resolve) => setImmediate(resolve));
    expect(isSettlingSession(sessionOwners, factory, SESSION_URI)).toBe(true);

    gated.settle();
    await expect(disposing).resolves.toBeNull();
    expect(isSettlingSession(sessionOwners, factory, SESSION_URI)).toBe(false);
  });
});

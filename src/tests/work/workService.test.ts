import { describe, expect, it, vi } from "vitest";

import type {
  AgentRegistrationRecord,
  AgentRegistrationRepository,
  DurableSessionInput,
  WorkItemRecord,
  WorkLeaseRecord,
  WorkRepository,
} from "@persistence/types";
import type { AuthenticatedPrincipal, PresenceBinding } from "@agents/types";
import { WorkError, createSessionOwnerRegistry, createWorkService } from "@work";

const principal: AuthenticatedPrincipal = { subject: "alice" };
const session: DurableSessionInput = {
  sessionUri: "ahp-session:/work-unit",
  ownerPrincipalSubject: "alice",
  providerId: "mock",
  createdAt: "2026-10-20T00:00:00.000Z",
  modifiedAt: "2026-10-20T00:00:00.000Z",
  lastServerSeq: 1,
  durableState: {},
};

const registration = (
  overrides: Partial<AgentRegistrationRecord> = {},
): AgentRegistrationRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  principalSubject: "alice",
  agentKey: "worker",
  enabled: true,
  createdAt: "2026-10-20T00:00:00.000Z",
  ...overrides,
});

const presence = (overrides: Partial<PresenceBinding> = {}): PresenceBinding => ({
  agentId: "11111111-1111-4111-8111-111111111111",
  principalSubject: "alice",
  connectionId: "connection-a",
  generation: 1,
  expiresAt: Date.now() + 60_000,
  ...overrides,
});

const workItem = (overrides: Partial<WorkItemRecord> = {}): WorkItemRecord => ({
  id: "22222222-2222-4222-8222-222222222222",
  sessionUri: session.sessionUri,
  requestKey: "request-1",
  kind: "code.patch",
  input: { instruction: "change" },
  status: "queued",
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...overrides,
});

const createFakes = (overrides: {
  readonly describeSession?: (sessionUri: string) => DurableSessionInput | undefined;
} = {}) => {
  const submit = vi.fn((): Promise<{ readonly id: string; readonly created: boolean }> => (
    Promise.resolve({ id: "work-1", created: true })
  ));
  const claim = vi.fn((): Promise<WorkLeaseRecord | null> => Promise.resolve({
    workId: "22222222-2222-4222-8222-222222222222",
    sessionUri: session.sessionUri,
    kind: "code.patch",
    input: { instruction: "change" },
    leaseToken: "33333333-3333-4333-8333-333333333333",
    leaseExpiresAt: "2026-10-20T00:01:00.000Z",
    attempt: 1,
  }));
  const renew = vi.fn((): Promise<{ readonly leaseExpiresAt: string }> => (
    Promise.resolve({ leaseExpiresAt: "2026-10-20T00:02:00.000Z" })
  ));
  const complete = vi.fn((): Promise<boolean> => Promise.resolve(true));
  const fail = vi.fn((): Promise<"queued" | "failed" | null> => Promise.resolve("queued"));
  const cancel = vi.fn((): Promise<"queued" | "leased" | "completed" | "failed" | "cancelled" | null> => (
    Promise.resolve("cancelled")
  ));
  const get = vi.fn((): Promise<WorkItemRecord | null> => (
    Promise.resolve(workItem({ leaseAgentId: "agent", leaseToken: "secret" }))
  ));
  const reconcileExpired = vi.fn((): Promise<number> => Promise.resolve(0));
  const hasDependentWork = vi.fn((): Promise<boolean> => Promise.resolve(false));
  const repository: WorkRepository = {
    submit,
    claim,
    renew,
    complete,
    fail,
    cancel,
    get,
    reconcileExpired,
    hasDependentWork,
  };
  const register = vi.fn(() => Promise.resolve(registration()));
  const getById = vi.fn(() => Promise.resolve(registration()));
  const registrations: AgentRegistrationRepository = {
    register,
    getById,
  };
  const bindings = new Map<string, PresenceBinding>([["connection-a", presence()]]);
  const owners = createSessionOwnerRegistry();
  owners.bind(session.sessionUri, principal.subject);
  const service = createWorkService({
    repository,
    sessions: owners,
    presence: {
      getByConnection: (connectionId) => bindings.get(connectionId),
    },
    registrations,
    describeSession: overrides.describeSession
      ?? ((sessionUri) => (sessionUri === session.sessionUri ? session : undefined)),
    allowedKinds: new Set(["code.patch"]),
    now: () => Date.now(),
    maxInputBytes: 256,
    maxResultBytes: 256,
  });
  return {
    repository,
    registrations,
    bindings,
    owners,
    service,
    submit,
    cancel,
    complete,
    get,
    hasDependentWork,
    getById,
  };
};

const agentContext = {
  principal,
  agentId: "11111111-1111-4111-8111-111111111111",
  connectionId: "connection-a",
  generation: 1,
} as const;

describe("work service", () => {
  it("submits only through an authenticated owned live session", async () => {
    const { submit, service } = createFakes();
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.patch",
      input: { instruction: "change" },
    })).resolves.toEqual({ id: "work-1" });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      session,
      requestKey: "request-1",
      kind: "code.patch",
    }));

    await expect(service.submit({ subject: "bob" }, {
      sessionUri: session.sessionUri,
      requestKey: "request-2",
      kind: "code.patch",
      input: { instruction: "change" },
    })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a target agent owned by another principal", async () => {
    const { getById, service } = createFakes();
    getById.mockResolvedValue(registration({ principalSubject: "bob" }));

    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.patch",
      input: { instruction: "change" },
      targetAgentId: "11111111-1111-4111-8111-111111111111",
    })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects disallowed kinds, bad request keys and oversized input", async () => {
    const { service } = createFakes();
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.review",
      input: {},
    })).rejects.toMatchObject({ code: "invalid" });
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "",
      kind: "code.patch",
      input: {},
    })).rejects.toMatchObject({ code: "invalid" });
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.patch",
      input: { payload: "x".repeat(300) },
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects blank session URIs, oversized URIs, blank request keys and kinds", async () => {
    const { service } = createFakes();
    await expect(service.submit(principal, {
      sessionUri: "ahp-session:/" + "x".repeat(2_049),
      requestKey: "request-1",
      kind: "code.patch",
      input: {},
    })).rejects.toMatchObject({ code: "invalid" });
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "   ",
      kind: "code.patch",
      input: {},
    })).rejects.toMatchObject({ code: "invalid" });
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: " ",
      input: {},
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects input carrying PostgreSQL-JSONB-unsafe text", async () => {
    const { service } = createFakes();
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.patch",
      input: { note: "a\u0000b" },
    })).rejects.toMatchObject({ code: "invalid" });
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-2",
      kind: "code.patch",
      input: { note: "\ud800" },
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses a submission that races a disposal and cancels the durable row", async () => {
    const { cancel, owners, service, submit } = createFakes();
    let release: () => void = (): void => undefined;
    submit.mockImplementationOnce((): Promise<{ readonly id: string; readonly created: boolean }> => (
      new Promise((resolve) => {
        release = (): void => {
          resolve({ id: "work-race", created: true });
        };
      })
    ));
    const pending = service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-race",
      kind: "code.patch",
      input: { instruction: "change" },
    });
    // The disposal removes the live session and its owner binding while the
    // repository write is still in flight.
    owners.unbind(session.sessionUri);
    release();
    await expect(pending).rejects.toMatchObject({ code: "conflict" });
    expect(cancel).toHaveBeenCalledWith({
      workId: "work-race",
      principalSubject: "alice",
    });
  });

  it("reports the reconciled conflict even when the cancel itself fails", async () => {
    const { cancel, owners, service, submit } = createFakes();
    let release: () => void = (): void => undefined;
    submit.mockImplementationOnce((): Promise<{ readonly id: string; readonly created: boolean }> => (
      new Promise((resolve) => {
        release = (): void => {
          resolve({ id: "work-race", created: true });
        };
      })
    ));
    const pending = service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-race-cancel-fails",
      kind: "code.patch",
      input: { instruction: "change" },
    });
    cancel.mockRejectedValueOnce(new Error("storage unavailable"));
    owners.unbind(session.sessionUri);
    release();
    // The ownership problem outranks the reconciliation failure, and the typed
    // conflict is exactly what the caller sees — never a false success.
    await expect(pending).rejects.toMatchObject({ code: "conflict" });
  });

  it("exposes ownership conflicts as typed work-domain errors", () => {
    const { owners } = createFakes();
    expect(() => {
      owners.bind(session.sessionUri, "bob");
    }).toThrow(WorkError);
    expect(() => {
      owners.bind(session.sessionUri, "bob");
    }).toThrow("The session already belongs to another principal.");
    expect(() => {
      owners.bind(session.sessionUri, principal.subject);
    }).not.toThrow();
  });

  it("rejects unstorable text in scalar submission and claim fields", async () => {
    const { service } = createFakes();
    await expect(service.submit(principal, {
      sessionUri: "ahp-session:/work\u0000-unit",
      requestKey: "request-1",
      kind: "code.patch",
      input: { instruction: "change" },
    })).rejects.toMatchObject({ code: "invalid", message: "A session URI is required." });

    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request\u0000-1",
      kind: "code.patch",
      input: { instruction: "change" },
    })).rejects.toMatchObject({ code: "invalid", message: "A bounded request key is required." });

    await expect(service.claim(agentContext, "ahp-session:/work\u0000-unit"))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses a durable projection JSONB cannot store", async () => {
    const { service } = createFakes({
      describeSession: (sessionUri) => (sessionUri === session.sessionUri
        ? { ...session, durableState: { workingDirectories: ["a\u0000b"] } }
        : undefined),
    });
    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-projection",
      kind: "code.patch",
      input: { instruction: "change" },
    })).rejects.toMatchObject({
      code: "invalid",
      message: "The session projection cannot be stored as JSON.",
    });
  });

  it("refuses a replayed request key whose landed row is terminal", async () => {
    const { cancel, get, service, submit } = createFakes();
    submit.mockResolvedValue({ id: "work-1", created: false });
    const submission = {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.patch",
      input: { instruction: "change" },
    };

    get.mockResolvedValue(workItem({ status: "cancelled" }));
    await expect(service.submit(principal, submission)).rejects.toMatchObject({
      code: "conflict",
      message: "That request key is already terminal.",
    });

    get.mockResolvedValue(workItem({ status: "failed" }));
    await expect(service.submit(principal, submission)).rejects.toMatchObject({ code: "conflict" });

    expect(cancel).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith({ workId: "work-1", principalSubject: "alice" });
  });

  it("keeps idempotent replay success for a non-terminal landed row", async () => {
    const { get, service, submit } = createFakes();
    submit.mockResolvedValue({ id: "work-1", created: false });
    const result = await service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "request-1",
      kind: "code.patch",
      input: { instruction: "change" },
    });
    expect(result).toEqual({ id: "work-1" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing, expired, or mismatched presence binding", async () => {
    const first = createFakes();
    await expect(first.service.claim({ ...agentContext, generation: 2 }, session.sessionUri))
      .rejects.toMatchObject({ code: "unauthorized" });

    const second = createFakes();
    second.bindings.set("connection-a", presence({ expiresAt: Date.now() - 1 }));
    await expect(second.service.claim(agentContext, session.sessionUri))
      .rejects.toMatchObject({ code: "unauthorized" });

    const third = createFakes();
    await expect(third.service.claim({ ...agentContext, connectionId: "missing" }, session.sessionUri))
      .rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a disabled agent registration", async () => {
    const { getById, service } = createFakes();
    getById.mockResolvedValue(registration({ enabled: false }));
    await expect(service.claim(agentContext, session.sessionUri))
      .rejects.toMatchObject({ code: "unauthorized" });
  });

  it("returns the current fenced lease and maps renew", async () => {
    const { service } = createFakes();
    await expect(service.claim(agentContext, session.sessionUri)).resolves.toMatchObject({
      workId: "22222222-2222-4222-8222-222222222222",
      leaseToken: "33333333-3333-4333-8333-333333333333",
      attempt: 1,
    });
    await expect(service.renew(
      agentContext,
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    )).resolves.toEqual({ leaseExpiresAt: "2026-10-20T00:02:00.000Z" });
  });

  it("rejects non-object results and stale completions", async () => {
    const { complete, service } = createFakes();
    await expect(service.complete(
      agentContext,
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "not-an-object",
    )).rejects.toMatchObject({ code: "invalid" });

    complete.mockResolvedValue(false);
    await expect(service.complete(
      agentContext,
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      { ok: true },
    )).rejects.toMatchObject({ code: "stale" });
  });

  it("does not expose lease tokens in work views", async () => {
    const { service } = createFakes();
    const view = await service.get(principal, "22222222-2222-4222-8222-222222222222");
    expect(view).not.toHaveProperty("leaseToken");
    expect(view).not.toHaveProperty("leaseAgentId");
  });

  it("rejects disposal while dependent work exists", async () => {
    const { hasDependentWork, service } = createFakes();
    hasDependentWork.mockResolvedValue(true);
    await expect(service.assertSessionDisposable(session.sessionUri))
      .rejects.toBeInstanceOf(WorkError);
  });

  it("refuses a dispose channel carrying text the work index cannot compare", async () => {
    const { hasDependentWork, service } = createFakes();

    await expect(service.assertSessionDisposable("ahp-session:/x\u0000"))
      .rejects.toMatchObject({ code: "invalid", message: "A session URI is required." });
    await expect(service.assertSessionDisposable("ahp-session:/\ud800"))
      .rejects.toMatchObject({ code: "invalid" });
    expect(hasDependentWork).not.toHaveBeenCalled();

    // Comparable text still reaches the dependent-work lookup.
    await expect(service.assertSessionDisposable(session.sessionUri)).resolves.toBeUndefined();
    expect(hasDependentWork).toHaveBeenCalledWith(session.sessionUri);
  });

  it("refuses a durable projection nested beyond the JSONB-safety depth budget", async () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 600; index += 1) {
      deep = { a: deep };
    }
    const { service, submit } = createFakes({
      describeSession: (sessionUri) => (sessionUri === session.sessionUri
        ? { ...session, durableState: deep }
        : undefined),
    });

    await expect(service.submit(principal, {
      sessionUri: session.sessionUri,
      requestKey: "deep-projection",
      kind: "code.patch",
      input: {},
    })).rejects.toMatchObject({
      code: "invalid",
      message: "The session projection cannot be stored as JSON.",
    });
    expect(submit).not.toHaveBeenCalled();
  });
});

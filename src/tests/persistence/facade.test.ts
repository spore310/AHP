import { describe, expect, it, vi } from "vitest";

import { createPersistence } from "@persistence/helpers/provider";
import type {
  AgentRegistrationRecord,
  PersistenceProvider,
  WorkSubmitInput,
} from "@persistence/types";

vi.mock("pg", () => {
  throw new Error("The neutral persistence facade evaluated pg.");
});

const makeProvider = () => {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const provider: PersistenceProvider = {
    registrations: {
      register(input) {
        calls.push(["register", input]);
        return Promise.resolve({
          id: "registration-id",
          principalSubject: input.principalSubject,
          agentKey: input.agentKey,
          displayName: input.displayName,
          enabled: true,
          createdAt: "2026-10-23T00:00:00.000Z",
        });
      },
      getById(id) {
        calls.push(["getById", id]);
        return Promise.resolve(undefined);
      },
    },
    sessions: {
      ensure(input) {
        calls.push(["ensure", input]);
        return Promise.resolve(input);
      },
      get(sessionUri) {
        calls.push(["sessionGet", sessionUri]);
        return Promise.resolve(undefined);
      },
      delete(sessionUri) {
        calls.push(["deleteSession", sessionUri]);
        return Promise.resolve(false);
      },
    },
    work: {
      submit(input) {
        calls.push(["submit", input]);
        return Promise.resolve({ id: "work-id", created: true });
      },
      claim(input) {
        calls.push(["claim", input]);
        return Promise.resolve(null);
      },
      renew(input) {
        calls.push(["renew", input]);
        return Promise.resolve(null);
      },
      complete(input) {
        calls.push(["complete", input]);
        return Promise.resolve(false);
      },
      fail(input) {
        calls.push(["fail", input]);
        return Promise.resolve(null);
      },
      cancel(input) {
        calls.push(["cancel", input]);
        return Promise.resolve(null);
      },
      get(input) {
        calls.push(["getWork", input]);
        return Promise.resolve(null);
      },
      reconcileExpired() {
        calls.push(["reconcileExpired"]);
        return Promise.resolve(0);
      },
      hasDependentWork(sessionUri) {
        calls.push(["hasDependentWork", sessionUri]);
        return Promise.resolve(false);
      },
    },
    dispose: vi.fn(async () => undefined),
  };
  return { provider, calls };
};

const deferred = <TResult,>() => {
  let resolve!: (value: TResult) => void;
  const promise = new Promise<TResult>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

describe("neutral persistence facade", () => {
  it("loads and uses the neutral facade without evaluating a driver", async () => {
    const { provider } = makeProvider();
    expect(createPersistence(provider)).toBeDefined();
  });

  it("delegates to a non-SQL provider and shares one disposal boundary", async () => {
    const { provider, calls } = makeProvider();
    const persistence = createPersistence(provider);
    const input = { principalSubject: "principal", agentKey: "agent" };
    await expect(persistence.registrations.register(input)).resolves.toMatchObject({ id: "registration-id" });
    await expect(persistence.work.submit({
      session: {
        sessionUri: "session://one",
        ownerPrincipalSubject: "principal",
        providerId: "provider",
        createdAt: "2026-10-23T00:00:00.000Z",
        modifiedAt: "2026-10-23T00:00:00.000Z",
        lastServerSeq: 1,
        durableState: {},
      },
      requestKey: "request",
      kind: "task",
      input: { value: 1 },
    })).resolves.toEqual({ id: "work-id", created: true });
    await expect(persistence.sessions.delete("session://one")).resolves.toBe(false);
    await persistence.dispose();
    expect(provider.dispose).toHaveBeenCalledOnce();
    expect(calls.map((call) => call[0])).toEqual(["register", "submit", "deleteSession"]);
    await expect(persistence.work.reconcileExpired()).rejects.toMatchObject({ code: "database" });
    expect(calls).toHaveLength(3);
  });

  it("preserves repository receivers and delegates one atomic method exactly once", async () => {
    let invocations = 0;
    const registrations = {
      marker: "bound",
      register(this: { marker: string }, input: { principalSubject: string; agentKey: string }) {
        invocations += 1;
        return Promise.resolve({
          id: this.marker,
          principalSubject: input.principalSubject,
          agentKey: input.agentKey,
          enabled: true,
          createdAt: "2026-10-23T00:00:00.000Z",
        });
      },
      getById: async () => undefined,
    };
    const { provider } = makeProvider();
    const receiverProvider: PersistenceProvider = { ...provider, registrations };
    const facade = createPersistence(receiverProvider);
    await expect(facade.registrations.register({ principalSubject: "p", agentKey: "a" }))
      .resolves.toMatchObject({ id: "bound" });
    expect(invocations).toBe(1);
    await facade.dispose();
  });

  it("drains pending calls from multiple namespaces through the shared scope", async () => {
    const { provider } = makeProvider();
    const registration = deferred<AgentRegistrationRecord>();
    const submission = deferred<{ readonly id: string; readonly created: boolean }>();
    const pendingProvider: PersistenceProvider = {
      ...provider,
      registrations: { ...provider.registrations, register: () => registration.promise },
      work: { ...provider.work, submit: (_input: WorkSubmitInput) => submission.promise },
    };
    const persistence = createPersistence(pendingProvider);
    const registrationResult = persistence.registrations.register({ principalSubject: "p", agentKey: "a" });
    const workResult = persistence.work.submit({
      session: {
        sessionUri: "session://pending",
        ownerPrincipalSubject: "p",
        providerId: "test",
        createdAt: "2026-10-23T00:00:00.000Z",
        modifiedAt: "2026-10-23T00:00:00.000Z",
        lastServerSeq: 1,
        durableState: {},
      },
      requestKey: "pending",
      kind: "task",
      input: {},
    });
    const disposal = persistence.dispose();
    expect(provider.dispose).not.toHaveBeenCalled();
    registration.resolve({
      id: "registration-id",
      principalSubject: "p",
      agentKey: "a",
      enabled: true,
      createdAt: "2026-10-23T00:00:00.000Z",
    });
    submission.resolve({ id: "work-id", created: true });
    await expect(registrationResult).resolves.toMatchObject({ id: "registration-id" });
    await expect(workResult).resolves.toEqual({ id: "work-id", created: true });
    await disposal;
    expect(provider.dispose).toHaveBeenCalledOnce();
  });
});

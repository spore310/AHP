import { describe, expect, it, vi } from "vitest";
import { createClientToolDispatcher, createClientToolPolicy } from "@toolExecution/helpers/client/helpers/broker";
import { clientPolicyFixture } from "./clientPolicyFixture";

describe("client tool canonical policy", () => {
  it("requires separate exact invoke and execute assignments and stamps the actual caller", async () => {
    const f = clientPolicyFixture();
    const invoke = await f.policyService.authorize({ ...f.request, operation: "invoke" });
    const execute = await f.policyService.authorize({ ...f.request, operation: "execute", executor: f.executor, executorContext: f.executorContext });
    expect(invoke.current()).toBe(true);
    expect(execute.current()).toBe(true);
    expect(execute.authority).toMatchObject({ actor: f.caller.actor, connectionId: f.caller.connectionId, executor: f.executor, route: f.route });
    f.registry.removeBinding({ bindingId: `grant-${f.caller.connectionId}`, scope: f.origin, revision: 1 });
    expect(invoke.current()).toBe(false);
    await expect(f.policyService.authorize({ ...f.request, operation: "invoke" })).rejects.toThrow("denied");
  });

  it("does not turn invoke permission into advertisement or receive permission", async () => {
    const f = clientPolicyFixture({ operations: ["invoke"] });
    await expect(f.policyService.authorize({ ...f.request, operation: "invoke" })).resolves.toBeDefined();
    await expect(f.policyService.authorize({ ...f.request, operation: "advertise" })).rejects.toThrow("denied");
    await expect(f.policyService.authorize({ ...f.request, operation: "execute", executor: f.executor, executorContext: f.executorContext })).rejects.toThrow("denied");
  });

  it("one complete positive grant path survives an unrelated selected binding", async () => {
    const f = clientPolicyFixture();
    f.registry.installBinding({ id: "unrelated", actor: f.caller.actor, scope: f.origin,
      roles: [], policies: [f.policy], revision: 1, authority: { kind: "host-policy", policy: f.policy } });
    await expect(f.policyService.authorize({ ...f.request, operation: "invoke" })).resolves.toBeDefined();
  });

  for (const field of ["connection", "generation", "registration", "actor"] as const) {
    it(`denies an executor ${field} substitution`, async () => {
      const f = clientPolicyFixture();
      const executor = { ...f.executor,
        ...(field === "connection" ? { connectionId: "another" } : {}),
        ...(field === "generation" ? { generation: 2 } : {}),
        ...(field === "registration" ? { registrationRevision: 2 } : {}),
        ...(field === "actor" ? { actor: f.caller.actor } : {}),
      };
      await expect(f.policyService.authorize({ ...f.request, operation: "execute", executor, executorContext: f.executorContext })).rejects.toThrow("denied");
    });
  }

  it("denies missing assignments even when grants and policies allow", async () => {
    const f = clientPolicyFixture();
    const tuple = f.tuples.find((entry) => entry.operation === "execute");
    if (tuple === undefined) throw new Error("Missing fixture executor");
    f.registry.removeExecutorAssignment(tuple);
    await expect(f.policyService.authorize({ ...f.request, operation: "execute", executor: f.executor, executorContext: f.executorContext })).rejects.toThrow("denied");
  });

  it("rejects unissued registrations and changed implementation definitions", async () => {
    const f = clientPolicyFixture();
    await expect(f.policyService.authorize({ ...f.request, registration: { ...f.registration }, operation: "invoke" })).rejects.toThrow("denied");
    const changed = createClientToolPolicy({ ...f.brokerOptions, registrations: [{ ...f.registration,
      definition: { ...f.registration.definition, inputSchema: { type: "object", properties: { substitute: { type: "string" } } } } }] });
    const registration = changed.registrations[0];
    if (registration === undefined) throw new Error("Missing fixture registration");
    await expect(changed.authorize({ ...f.request, registration, operation: "invoke" })).rejects.toThrow("denied");
  });

  it("denies challenges and provider selection denial", async () => {
    const f = clientPolicyFixture({ challenge: true });
    await expect(f.policyService.authorize({ ...f.request, operation: "invoke" })).rejects.toThrow("denied");
    const allowed = clientPolicyFixture();
    await expect(allowed.policyService.authorize({ ...allowed.request, providerId: "wrong-provider", operation: "invoke" })).rejects.toThrow("denied");
  });

  it("rejects changed origin incarnation and complete target route", async () => {
    const f = clientPolicyFixture();
    await expect(f.policyService.authorize({ ...f.request, origin: { ...f.origin, instanceId: "new" }, operation: "invoke" })).rejects.toThrow("denied");
    await expect(f.policyService.authorize({ ...f.request, resolution: { route: { ...f.route, targets: [] } }, operation: "invoke" })).rejects.toThrow("denied");
  });

  it("does not accept a decision revoked during an awaited permission check", async () => {
    let unblock: (value: "allow") => void = () => undefined;
    let entered: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = clientPolicyFixture({ permission: () => {
      entered();
      return new Promise((resolve) => {
        unblock = resolve;
      });
    } });
    const pending = f.policyService.authorize({ ...f.request, operation: "invoke" });
    await waiting;
    f.registry.removeBinding({ bindingId: `grant-${f.caller.connectionId}`, scope: f.origin, revision: 1 });
    unblock("allow");
    await expect(pending).rejects.toThrow("denied");
  });
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

describe("client host proxy dispatcher", () => {
  const setup = (options: Parameters<typeof clientPolicyFixture>[0] = {}) => {
    const f = clientPolicyFixture(options);
    const dispatcher = createClientToolDispatcher({ ...f.brokerOptions,
      dispatcher: { limits: { maxInFlight: 1, shutdownWaitMs: 1 } } });
    const registration = dispatcher.policy.registrations[0];
    if (registration === undefined) throw new Error("Missing fixture registration");
    return { ...f, dispatcher, request: { ...f.request, registration,
      executor: f.executor, executorContext: f.executorContext, callId: "call-1", current: () => true, fence: () => true } };
  };

  it("uses the P08 lifecycle and returns only schema-validated remote output", async () => {
    const f = setup();
    const send = vi.fn((input: unknown) => Promise.resolve({ value: typeof input === "object" ? "result-canary" : "invalid" }));
    const handle = f.dispatcher.dispatch({ ...f.request, send });
    await expect(handle.result).resolves.toEqual({ status: "succeeded", output: { value: "result-canary" }, cleanupFailures: 0 });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toEqual({ path: "private-canary" });
    expect(f.dispatcher.stats().active).toBe(0);
    await f.dispatcher.shutdown();
  });

  it("denies receive-only callers before the remote send port", async () => {
    const f = setup({ operations: ["execute", "advertise"] });
    const send = vi.fn(() => Promise.resolve({ value: "forbidden" }));
    await expect(f.dispatcher.dispatch({ ...f.request, send }).result).resolves.toMatchObject({ status: "failed" });
    expect(send).not.toHaveBeenCalled();
    await f.dispatcher.shutdown();
  });

  it("denies revoked result disclosure after actual remote settlement", async () => {
    const f = setup();
    const entered = deferred<undefined>();
    const remote = deferred<unknown>();
    const handle = f.dispatcher.dispatch({ ...f.request, send: () => {
      entered.resolve(undefined);
      return remote.promise;
    } });
    await entered.promise;
    f.registry.removeBinding({ bindingId: `grant-${f.caller.connectionId}`, scope: f.origin, revision: 1 });
    remote.resolve({ value: "must-not-disclose" });
    await expect(handle.result).resolves.toMatchObject({ status: "failed", code: "stale" });
    expect(f.dispatcher.stats().active).toBe(0);
    await f.dispatcher.shutdown();
  });

  it("cancels caller wait but retains remote draining and admission capacity until completion", async () => {
    const f = setup();
    const entered = deferred<undefined>();
    const remote = deferred<unknown>();
    const send = vi.fn(() => {
      entered.resolve(undefined);
      return remote.promise;
    });
    const handle = f.dispatcher.dispatch({ ...f.request, send });
    await entered.promise;
    handle.cancel();
    await expect(handle.result).resolves.toMatchObject({ status: "failed", code: "cancelled" });
    expect(f.dispatcher.stats()).toMatchObject({ active: 1, draining: 1 });
    await expect(f.dispatcher.dispatch({ ...f.request, callId: "call-2", send }).result).resolves.toMatchObject({ status: "failed", code: "capacity" });
    expect(send).toHaveBeenCalledOnce();
    await expect(f.dispatcher.shutdown()).resolves.toEqual({ draining: 1 });
    remote.resolve({ value: "late-result" });
    await expect(handle.settled).resolves.toMatchObject({ status: "failed", code: "cancelled" });
    expect(f.dispatcher.stats().active).toBe(0);
  });

  it("rejects invalid output and does not repeat a remote action", async () => {
    const f = setup();
    const send = vi.fn(() => Promise.resolve({ wrong: "output" }));
    await expect(f.dispatcher.dispatch({ ...f.request, send }).result).resolves.toMatchObject({ status: "failed", code: "invalid-output" });
    expect(send).toHaveBeenCalledOnce();
    await f.dispatcher.shutdown();
  });

  it("preserves input and output byte bounds around the remote send", async () => {
    const f = setup();
    const oversized = "x".repeat(1024 * 1024);
    const send = vi.fn(() => Promise.resolve({ value: oversized }));
    await expect(f.dispatcher.dispatch({ ...f.request, input: { path: oversized }, send }).result).resolves.toMatchObject({ status: "failed", code: "invalid-input" });
    expect(send).not.toHaveBeenCalled();
    await expect(f.dispatcher.dispatch({ ...f.request, callId: "bounded-input", send }).result).resolves.toMatchObject({ status: "failed", code: "invalid-output" });
    expect(send).toHaveBeenCalledOnce();
    await f.dispatcher.shutdown();
  });

  for (const port of ["current", "fence"] as const) {
    it("consumes an invalid rejecting " + port + " verdict without remote execution", async () => {
      const f = setup();
      const send = vi.fn(() => Promise.resolve({ value: "forbidden" }));
      const handle = f.dispatcher.dispatch({ ...f.request, send,
        [port]: () => Promise.reject(new Error("private-port-error")) as unknown as boolean });
      await expect(handle.result).resolves.toMatchObject({ status: "failed" });
      await handle.settled;
      expect(send).not.toHaveBeenCalled();
      await f.dispatcher.shutdown();
    });
  }

  it("remote timeout retains draining until a late real settlement", async () => {
    vi.useFakeTimers();
    try {
      const f = setup();
      const entered = deferred<undefined>();
      const remote = deferred<unknown>();
      const handle = f.dispatcher.dispatch({ ...f.request, send: () => {
        entered.resolve(undefined);
        return remote.promise;
      } });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(30000);
      await expect(handle.result).resolves.toMatchObject({ status: "failed", code: "timeout" });
      expect(f.dispatcher.stats()).toMatchObject({ active: 1, draining: 1 });
      remote.resolve({ value: "late" });
      await expect(handle.settled).resolves.toMatchObject({ status: "failed", code: "timeout" });
      expect(f.dispatcher.stats().active).toBe(0);
      await f.dispatcher.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});

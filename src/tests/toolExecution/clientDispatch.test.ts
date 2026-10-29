import { describe, expect, it, vi } from "vitest";
import { createClientToolDispatcher, createClientToolPolicy } from "@toolExecution/helpers/client/helpers/broker";
import { clientPolicyFixture } from "./clientPolicyFixture";

describe("client tool canonical policy", () => {
  it("supports bounded multi-purpose proof sets without reducing advertised tool capacity", async () => {
    const f = clientPolicyFixture();
    const proof = await f.policyService.authorize({ ...f.request, operation: "invoke" });
    for (const count of [Number.NaN, undefined, 0.5, -1, 0, 513]) {
      const members = [{ authorization: proof.authorization, actor: f.caller }];
      const cohort = new Proxy(members, { get: (target, key, receiver): unknown => key === "length" ? count : Reflect.get(target, key, receiver) });
      const proofs = new Proxy([proof], { get: (target, key, receiver): unknown => key === "length" ? count : Reflect.get(target, key, receiver) });
      expect(f.registry.validateAssignmentCohort(cohort)).toBe(false);
      expect(f.policyService.current(proofs)).toBe(false);
    }
    for (const count of [128, 130, 256, 512]) {
      const proofs = Array.from({ length: count }, () => proof);
      expect(f.policyService.current(proofs)).toBe(true);
      expect(f.registry.validateAssignmentCohort(proofs.map((entry) => ({ authorization: entry.authorization, actor: f.caller })))).toBe(true);
    }
    const oversized = Array.from({ length: 513 }, () => proof);
    expect(f.policyService.current(oversized)).toBe(false);
    expect(f.registry.validateAssignmentCohort(oversized.map((entry) => ({ authorization: entry.authorization, actor: f.caller })))).toBe(false);
  });

  it("captures cohort provenance once without trusting caller array methods", async () => {
    const f = clientPolicyFixture();
    const proof = await f.policyService.authorize({ ...f.request, operation: "invoke" });
    const forged = [{ authorization: structuredClone(proof.authorization), actor: f.caller }];
    Object.defineProperty(forged, "map", { value: () => [] });
    expect(f.registry.validateAssignmentCohort(forged)).toBe(false);
    const copied = [{ ...proof }];
    Object.defineProperty(copied, "map", { value: () => [{ authorization: proof.authorization, actor: f.caller, signal: f.request.signal }] });
    expect(f.policyService.current(copied)).toBe(false);
    f.registry.removeBinding({ bindingId: `grant-${f.caller.connectionId}`, scope: f.origin, revision: 1 });
    let reads = 0;
    const switching = { get authorization() {
      reads += 1;
      return reads === 1 ? proof.authorization : { stamps: [], admitted: [], decisions: [] };
    }, actor: f.caller };
    expect(f.registry.validateAssignmentCohort([switching])).toBe(false);
    expect(reads).toBe(1);
  });

  it("checks caller and executor proof cohorts at one final time instead of trailing clocks", async () => {
    let time = 0;
    let onClock = () => undefined;
    const f = clientPolicyFixture({ now: () => {
      onClock();
      return time;
    }, decisionTtlMs: 10 });
    const invoke = await f.policyService.authorize({ ...f.request, operation: "invoke" });
    time = 9;
    const advertisement = await f.policyService.authorize({ ...f.request, caller: f.executorContext, operation: "advertise" });
    const execute = await f.policyService.authorize({ ...f.request, operation: "execute", executor: f.executor, executorContext: f.executorContext });
    expect(invoke.current()).toBe(true);
    onClock = () => {
      time = 11;
      return undefined;
    };
    expect(advertisement.current()).toBe(true);
    expect(execute.current()).toBe(true);
    expect(f.policyService.current([invoke, advertisement, execute])).toBe(false);
    expect(f.policyService.current([advertisement, execute])).toBe(true);
    expect(f.registry.validateAssignmentCohort([
      { authorization: advertisement.authorization, actor: f.executorContext },
      { authorization: execute.authorization, actor: f.caller },
    ])).toBe(true);
  });

  it("rejects copied proof objects, foreign policy-service proofs, swapped actors and reentrant cohort revocation", async () => {
    let onClock = () => undefined;
    const f = clientPolicyFixture({ now: () => {
      onClock();
      return 0;
    } });
    const proof = await f.policyService.authorize({ ...f.request, operation: "invoke" });
    expect(f.policyService.current([{ ...proof }])).toBe(false);
    const other = createClientToolPolicy(f.brokerOptions);
    expect(other.current([proof])).toBe(false);
    expect(f.registry.validateAssignmentCohort([{ authorization: proof.authorization, actor: f.executorContext }])).toBe(false);
    expect(f.registry.validateAssignmentCohort([{ authorization: structuredClone(proof.authorization), actor: f.caller }])).toBe(false);
    const fence = f.registry.captureFence();
    onClock = () => {
      f.registry.teardown(f.origin);
      return undefined;
    };
    expect(f.policyService.current([proof])).toBe(false);
    expect(fence()).toBe(false);
  });

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

  it("returns admission while remote execution is pending and denies unadmitted receipts", async () => {
    const f = setup();
    const remote = deferred<unknown>();
    const handle = f.dispatcher.dispatch({ ...f.request, send: () => remote.promise });
    expect(await handle.admitted).toBe(true);
    expect(f.dispatcher.stats().active).toBe(1);
    const denied = f.dispatcher.dispatch({ ...f.request, callId: "over-capacity", send: () => Promise.resolve({ value: "forbidden" }) });
    expect(await denied.admitted).toBe(false);
    handle.cancel();
    expect(f.dispatcher.stats().draining).toBe(1);
    remote.resolve({ value: "late" });
    await handle.settled;
    await f.dispatcher.shutdown();
  });

  it("refreshes successfully retained result authority after original expiry without changing execution proofs", async () => {
    let time = 0;
    const f = setup({ now: () => time, decisionTtlMs: 10 });
    const input = { path: "original" };
    const send = vi.fn(() => Promise.resolve({ value: "retained-output" }));
    const handle = f.dispatcher.dispatch({ ...f.request, input, send });
    input.path = "changed-after-dispatch";
    await expect(handle.result).resolves.toMatchObject({ status: "succeeded" });
    time = 11;
    expect(handle.current()).toBe(false);
    const refreshed = await handle.refresh();
    expect(refreshed?.()).toBe(true);
    expect(handle.current()).toBe(false);
    expect(send).toHaveBeenCalledExactlyOnceWith({ path: "original" }, expect.anything());
    f.registry.removeBinding({ bindingId: `grant-${f.caller.connectionId}`, scope: f.origin, revision: 1 });
    expect(refreshed?.()).toBe(false);
    expect(await handle.refresh()).toBeUndefined();
    await f.dispatcher.shutdown();
  });

  it("fresh result access rejects a changed full route even if the new route independently permits execution", async () => {
    let narrow = false;
    const f = setup({ resolve: (request) => ({ route: { origin: request.origin, targets: narrow ? [] : [request.origin] } }) });
    for (const context of [f.caller, f.executorContext]) f.registry.installBinding({
      id: `grant-${context.connectionId}-alternate`, actor: context.actor, scope: f.origin, roles: [], policies: [f.policy],
      authority: { kind: "host-policy", policy: f.policy }, revision: 1,
    });
    for (const tuple of f.tuples) {
      const alternate = { ...tuple, bindingId: tuple.bindingId + "-alternate", route: { origin: f.origin, targets: [] } };
      if (tuple.operation === "execute") f.registry.installExecutorAssignment(alternate);
      else f.registry.installToolAssignment(alternate);
    }
    const handle = f.dispatcher.dispatch({ ...f.request, send: () => Promise.resolve({ value: "original-route-result" }) });
    await expect(handle.result).resolves.toMatchObject({ status: "succeeded" });
    narrow = true;
    // Canonical scope routes are fixed until a trusted relationship update.
    f.registry.installResource({ resource: f.origin, route: { origin: f.origin, targets: [] },
      owner: f.caller.actor.principal, externalAuthority: "none",
      admission: { sessionType: f.request.sessionType, providerId: f.request.providerId } });
    const resolution = await f.dispatcher.policy.resolve(f.request);
    const caller = await f.dispatcher.policy.authorize({ ...f.request, resolution, operation: "invoke", executor: undefined, executorContext: undefined });
    const executor = await f.dispatcher.policy.authorize({ ...f.request, resolution, operation: "execute" });
    expect(f.dispatcher.policy.current([caller, executor])).toBe(true);
    expect(await handle.refresh()).toBeUndefined();
    expect(handle.current()).toBe(false);
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionsFactory } from "@sessions";
import { createMockProvider } from "@sessions/mock";
import { createToolDispatcher, createToolResultProjection, ToolAction } from "@toolExecution";
import type { ToolDispatchPorts, ToolDispatcherOptions, ToolProjectionOptions } from "@toolExecution";
import type { AssignmentAuthorization, ResourceOperationAuthority } from "@authorization";
import { resourceFixture, operationActor, operationRef } from "../authorization/resourceFixture";
import { contract, facts, registration } from "./fixtures";
import type { Input, Output } from "./fixtures";

const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.useRealTimers();
});
async function fixture(options: { ttl?: number; resourceTimeout?: number; dispatcher?: Omit<ToolDispatcherOptions, "projection">; enabled?: boolean; missingGuard?: boolean } = {}) {
  let ownerClockHook = () => {};
  const sessions = createSessionsFactory({ providers: [createMockProvider()], now: () => {
    ownerClockHook();
    return new Date("2026-01-02T03:04:05Z");
  } });
  await sessions.createSession({ channel: "ahp-session:/first", provider: "mock" });
  const envelopes: unknown[] = [];
  sessions.onSessionEnvelope((envelope) => envelopes.push(envelope));
  const f = resourceFixture({ targetKind: "session", ttl: options.ttl, timeoutMs: options.resourceTimeout, commit: (payload, context, admission) => {
    if (typeof payload !== "object" || payload === null || !("value" in payload) || typeof payload.value !== "string") return false;
    const result = sessions.dispatchAction({ channel: context.target.id, clientId: context.actor.connectionId, clientSeq: 1,
      action: { type: "session/titleChanged", title: payload.value }, admission });
    return result.rejectionReason === undefined;
  } });
  for (const ref of f.refs) f.grant(ref, ["read", "mutate"]);
  f.registry.installTool(contract);
  f.registry.installToolAssignment({ resource: f.first, route: f.route, recipient: operationActor.actor,
    contract: { id: contract.id, key: contract.key, version: contract.version }, operation: "invoke", bindingId: "binding:" + f.first.id, policyRef: operationRef("read") });
  let invocation: AssignmentAuthorization;
  const refresh = async () => {
    invocation = await f.registry.projectAssignments({ actor: operationActor, purpose: "invoke", recipient: "caller", scope: f.first, route: f.route,
      tools: [{ contractId: contract.id, bindingId: "binding:" + f.first.id, policyRef: operationRef("read") }] });
    expect(invocation.admitted).toHaveLength(1);
  };
  await refresh();
  const execute = vi.fn<(input: Input) => Output>(() => ({ value: "Projected title" }));
  const cleanup = vi.fn<() => void>(() => {});
  class Action extends ToolAction<Input, Output> { override execute = execute; override cleanup = cleanup; }
  let projector: ToolProjectionOptions["project"] = (output) => ({ target: f.target, operation: "mutate", payload: output });
  const project = vi.fn<ToolProjectionOptions["project"]>((output, context) => projector(output, context));
  const projection = createToolResultProjection({ resources: f.resources, project });
  const dispatcher = createToolDispatcher({ ...options.dispatcher, limits: { shutdownWaitMs: 5, ...options.dispatcher?.limits }, ...(options.enabled === false ? {} : { projection }) });
  let admissionHook = () => {};
  const admission = (authority: ResourceOperationAuthority) => {
    admissionHook();
    return authority.registry === f.registry && f.registry.validateAuthorityCohort([{ authorization: invocation, actor: operationActor }], authority.decisions);
  };
  const ports: ToolDispatchPorts = {
    resolve: () => {
      const base = facts();
      const authority = { ...base.authority, actor: operationActor.actor, route: f.route };
      return { ...base, caller: operationActor, resources: f.route, authority };
    },
    coarse: () => true,
    authorize: (context) => ({ decision: { effect: "allow", reveal: true, challengeRequired: false }, authority: context.authority }),
    current: () => f.registry.validateAssignments(invocation, operationActor),
    ...(options.missingGuard === true ? {} : { admitProjection: (_context, authority) => admission(authority) }),
  };
  const dispatch = () => dispatcher.dispatch({ callId: "call-1", input: { path: "input" }, registration: registration(() => new Action()), ports });
  disposals.push(async () => {
    f.resources.dispose();
    await dispatcher.shutdown();
    await sessions.dispose();
  });
  return { ...f, sessions, envelopes, dispatcher, ports, execute, cleanup, project, dispatch, refresh,
    onProject: (hook: ToolProjectionOptions["project"]) => {
      projector = hook;
    },
    onOwnerClock: (hook: () => void) => {
      ownerClockHook = hook;
    }, onAdmission: (hook: () => void) => {
      admissionHook = hook;
    } };
}

describe("authorized result projection", () => {
  it("R04 validated executor output alone cannot change session state", async () => {
    const f = await fixture({ enabled: false });
    const before = f.sessions.getSessionSnapshot(f.first.id);
    f.execute.mockReturnValue({ value: JSON.stringify({ type: "session/titleChanged", title: "untrusted" }) });
    expect(await f.dispatch().settled).toMatchObject({ status: "succeeded" });
    expect(f.sessions.getSessionSnapshot(f.first.id)).toEqual(before);
    expect(f.envelopes).toHaveLength(0);
    expect(f.project).not.toHaveBeenCalled();
  });
  it("R04 configured mapping uses real owning reducer once after output validation and cleanup", async () => {
    const f = await fixture();
    const before = f.sessions.getCurrentServerSeq();
    f.onProject((output, context) => {
      expect(f.cleanup).toHaveBeenCalledOnce();
      expect(Object.isFrozen(output)).toBe(true);
      expect(Object.isFrozen(context)).toBe(true);
      return { target: f.target, operation: "mutate", payload: output };
    });
    const handle = f.dispatch();
    expect(await handle.settled).toMatchObject({ status: "succeeded", output: { value: "Projected title" } });
    expect(await handle.result).toEqual(await handle.settled);
    expect(f.envelopes).toHaveLength(1);
    expect(f.sessions.getCurrentServerSeq()).toBe(before + 1);
    expect(f.sessions.getSessionSnapshot(f.first.id)?.state.title).toBe("Projected title");
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.cleanup).toHaveBeenCalledOnce();
    expect(f.project).toHaveBeenCalledOnce();
  });
  it.each(["no-guard", "unknown-operation", "wrong-target", "malformed-payload", "cleanup", "output"])("R04 rejects %s without applying output as state or retrying execution", async (failure) => {
    const f = await fixture({ missingGuard: failure === "no-guard" });
    if (failure === "unknown-operation") f.onProject((output) => ({ target: f.target, operation: "arbitrary-patch", payload: output }));
    if (failure === "wrong-target") f.onProject((output) => ({ target: f.second, operation: "mutate", payload: output }));
    if (failure === "malformed-payload") f.onProject(() => ({ target: f.target, operation: "mutate", payload: { arbitraryState: true } }));
    if (failure === "cleanup") f.cleanup.mockImplementation(() => {
      throw new Error("secret-cleanup");
    });
    if (failure === "output") f.execute.mockReturnValue({ value: 42 } as unknown as Output);
    const before = f.sessions.getSessionSnapshot(f.first.id);
    const outcome = await f.dispatch().settled;
    expect(outcome).toMatchObject({ status: "failed", code: failure === "cleanup" ? "cleanup-failed" : failure === "output" ? "invalid-output" : "projection-failed", effectPossible: true });
    expect(outcome).not.toHaveProperty("output");
    expect(JSON.stringify(outcome)).not.toContain("secret");
    expect(f.sessions.getSessionSnapshot(f.first.id)).toEqual(before);
    expect(f.envelopes).toHaveLength(0);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it.each(["invoke", "operation"])("R05 joint final proof cohort denies expired %s authority at actual owning-service boundary", async (expired) => {
    const f = await fixture({ ttl: expired === "invoke" ? 10 : 100 });
    f.time(5);
    if (expired === "operation") f.proofDeadline(10);
    const before = f.sessions.getSessionSnapshot(f.first.id);
    f.onOwnerClock(() => {
      f.time(11);
    });
    f.onProject((output) => {
      f.time(9);
      return { target: f.target, operation: "mutate", payload: output };
    });
    expect(await f.dispatch().settled).toMatchObject({ status: "failed", code: "projection-failed", phase: "projection" });
    expect(f.sessions.getSessionSnapshot(f.first.id)).toEqual(before);
    expect(f.envelopes).toHaveLength(0);
    f.onOwnerClock(() => {});
    f.onProject((output) => ({ target: f.target, operation: "mutate", payload: output }));
    f.proofDeadline(1000);
    await f.refresh();
    expect(await f.dispatch().settled).toMatchObject({ status: "succeeded" });
    expect(f.envelopes).toHaveLength(1);
  });
  it("R05 pure dispatcher deadline fence follows authority callbacks at owner admission", async () => {
    let time = 0;
    const f = await fixture({ dispatcher: { now: () => time, fenceNow: () => time, limits: { timeoutMs: 10 } } });
    const before = f.sessions.getSessionSnapshot(f.first.id);
    f.onProject((output) => {
      time = 9;
      return { target: f.target, operation: "mutate", payload: output };
    });
    f.onAdmission(() => {
      time = 11;
    });
    expect(await f.dispatch().settled).toMatchObject({ status: "failed", code: "projection-failed" });
    expect(f.sessions.getSessionSnapshot(f.first.id)).toEqual(before);
    expect(f.envelopes).toHaveLength(0);
    f.onAdmission(() => {});
    f.onProject((output) => ({ target: f.target, operation: "mutate", payload: output }));
    expect(await f.dispatch().settled).toMatchObject({ status: "succeeded" });
    expect(f.envelopes).toHaveLength(1);
  });
  it.each(["revoke", "replace", "cancel", "shutdown"])("R05 %s while projector is parked prevents commit and retains owned output until settlement", async (failure) => {
    const f = await fixture();
    const entered = Promise.withResolvers<undefined>();
    const parked = Promise.withResolvers<undefined>();
    f.onProject(async (output) => {
      entered.resolve(undefined);
      await parked.promise;
      return { target: f.target, operation: "mutate", payload: output };
    });
    const handle = f.dispatch();
    await entered.promise;
    const before = f.sessions.getSessionSnapshot(f.first.id);
    if (failure === "revoke") f.grant(f.first, []);
    if (failure === "replace") f.instances.set(f.target.id, "replacement");
    if (failure === "cancel") handle.cancel();
    if (failure === "shutdown") expect(await f.dispatcher.shutdown()).toEqual({ draining: 1 });
    expect(f.dispatcher.stats().active).toBe(1);
    expect(f.dispatcher.stats().retainedOutputBytes).toBeGreaterThan(0);
    parked.resolve(undefined);
    expect(await handle.settled).toMatchObject({ status: "failed", effectPossible: true });
    expect(f.dispatcher.stats()).toEqual({ active: 0, draining: 0, retainedOutputBytes: 0 });
    expect(f.sessions.getSessionSnapshot(f.first.id)).toEqual(before);
    expect(f.envelopes).toHaveLength(0);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.cleanup).toHaveBeenCalledOnce();
    const fresh = await fixture();
    expect(await fresh.dispatch().settled).toMatchObject({ status: "succeeded" });
    expect(fresh.envelopes).toHaveLength(1);
  });
  it("R05 configured custom projection clock requires a pure deadline reader", () => {
    const projection = createToolResultProjection({ resources: {} as never, project: () => undefined });
    expect(() => createToolDispatcher({ now: () => 0, projection })).toThrow(/pure deadline reader/);
  });
});

it("R05 resource timeout retains dispatcher output until actual resolver settlement", async () => {
  vi.useFakeTimers();
  const f = await fixture({ resourceTimeout: 5 });
  const entered = Promise.withResolvers<undefined>();
  const parked = Promise.withResolvers<undefined>();
  f.onResolve(async () => {
    entered.resolve(undefined);
    await parked.promise;
  });
  const handle = f.dispatch();
  await entered.promise;
  try {
    await vi.advanceTimersByTimeAsync(6);
    expect(f.resources.stats()).toEqual({ active: 1 });
    expect(f.dispatcher.stats().active).toBe(1);
    expect(f.dispatcher.stats().retainedOutputBytes).toBeGreaterThan(0);
    handle.cancel();
    expect(f.dispatcher.stats().draining).toBe(1);
  } finally {
    parked.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(await handle.settled).toMatchObject({ status: "failed" });
  expect(f.dispatcher.stats()).toEqual({ active: 0, draining: 0, retainedOutputBytes: 0 });
  expect(f.envelopes).toHaveLength(0);
});

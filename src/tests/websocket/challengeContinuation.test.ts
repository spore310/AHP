import { createPrivateToolProtocol } from "@websocket/helpers/ahp/helpers/toolProtocol";
import type { JsonRpcInvocation, ReplySettlement, WebSocketConnectionContext } from "@websocket/types";
import { createToolDispatcher } from "@toolExecution";
import type { ToolDispatchHandle } from "@toolExecution";
import { EchoAction, contract, ports, registration } from "../toolExecution/fixtures";
import { afterEach, expect, it, vi } from "vitest";
import type { ChallengeAdapter } from "@toolExecution";
import { createPolicyIntegrationFixture, createCodingHarness, channel } from "./policyIntegrationFixture";

const fixtures: Array<Awaited<ReturnType<typeof createPolicyIntegrationFixture>>> = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.stop()));
});
function adapter() {
  return { begin: vi.fn<ChallengeAdapter["begin"]>(() => ({ continuationId: "PRIVATE-ADAPTER-CANARY", expiresAt: new Date(Date.now() + 20000).toISOString(), presentation: { kind: "wait" } })),
    verify: vi.fn<ChallengeAdapter["verify"]>(() => ({ status: "verified", continuationId: "PRIVATE-ADAPTER-CANARY" })) };
}

it("C02 public same-socket dispatch/status/resume executes the original cross-client call", async () => {
  const verifier = adapter();
  const f = await createPolicyIntegrationFixture({ mode: "cross", host: { invokeChallenge: true, dispatcher: { challenge: { adapter: verifier } } } });
  fixtures.push(f);
  const caller = await f.connect(f.caller), executor = await f.connect(f.executor), observer = await f.connect("observer");
  const harness = createCodingHarness(), read = harness[0];
  if (read === undefined) throw new Error("Missing read");
  await executor.client.joinSession(channel, [read]);
  const selector = { id: read.definition.id, key: read.definition.key, version: read.definition.version };
  expect((await caller.assigned()).tools.find((tool) => tool.contract.id === selector.id)?.conditions).toEqual(["challenge-required"]);
  const receipt = await caller.client.dispatchTool(channel, selector, { path: "P13-INPUT-CANARY" });
  expect(receipt.status).toBe("challenge-required");
  if (receipt.status !== "challenge-required") throw new Error("Missing challenge");
  expect(read.execute).not.toHaveBeenCalled();
  expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "waiting", callId: receipt.callId });
  expect(await observer.client.resumeTool(receipt.continuationId, "foreign-proof")).toMatchObject({ status: "denied" });
  expect(verifier.verify).not.toHaveBeenCalled();
  expect(await caller.client.resumeTool(receipt.continuationId, "approved-proof")).toEqual({ version: 2, status: "accepted", callId: receipt.callId });
  let status = await caller.client.statusTool(receipt.callId);
  for (let count = 0; count < 20 && status.status !== "completed"; count += 1) status = await caller.client.statusTool(receipt.callId);
  expect(status).toMatchObject({ status: "completed", output: { value: "P12-HANDLER-RESULT:coding.read:P13-INPUT-CANARY:7" } });
  expect(read.execute).toHaveBeenCalledOnce();
  expect(await caller.client.resumeTool(receipt.continuationId, "approved-proof")).toMatchObject({ status: "denied" });
  expect(JSON.stringify(caller.received)).not.toContain("PRIVATE-ADAPTER-CANARY");
  expect(JSON.stringify(observer.received)).not.toMatch(/P13-INPUT-CANARY|approved-proof|PRIVATE-ADAPTER-CANARY/);
});

async function start(verifier: ChallengeAdapter, extra: Omit<Parameters<typeof createPolicyIntegrationFixture>[0], "mode" | "host"> = {}) {
  const f = await createPolicyIntegrationFixture({ mode: "cross", ...extra, host: { invokeChallenge: true, dispatcher: { challenge: { adapter: verifier } } } });
  fixtures.push(f);
  const caller = await f.connect(f.caller), executor = await f.connect(f.executor);
  const harness = createCodingHarness(), read = harness[0];
  if (read === undefined) throw new Error("Missing read");
  await executor.client.joinSession(channel, [read]);
  const selector = { id: read.definition.id, key: read.definition.key, version: read.definition.version };
  const receipt = await caller.client.dispatchTool(channel, selector, { path: "P13-PARKED-CANARY" });
  if (receipt.status !== "challenge-required") throw new Error("Missing challenge");
  return { f, caller, executor, harness, read, selector, receipt };
}

it("C01 false proof is terminal and cannot execute or disclose parked input", async () => {
  const verifier = adapter();
  verifier.verify.mockReturnValue({ status: "denied", code: "SECRET-DENIAL" });
  const { caller, executor, read, receipt } = await start(verifier);
  expect(await caller.client.resumeTool(receipt.continuationId, "mfaPassed")).toMatchObject({ status: "denied" });
  expect(await caller.client.resumeTool(receipt.continuationId, "other-proof")).toMatchObject({ status: "denied" });
  await executor.client.client.ping();
  expect(read.execute).not.toHaveBeenCalled();
  expect(verifier.verify).toHaveBeenCalledOnce();
  expect(JSON.stringify(executor.received)).not.toContain("P13-PARKED-CANARY");
  expect(JSON.stringify(caller.received)).not.toContain("SECRET-DENIAL");
});

it.each(["input", "mfaPassed", "actor", "resource", "executor", "policyRevision"])("C03 strict resume rejects replacement %s before verifier", async (field) => {
  const verifier = adapter(), { caller, executor, read, receipt } = await start(verifier);
  const response = await caller.request("x-ahp/tools/resume", { version: 2, continuationId: receipt.continuationId, proofRef: "proof", [field]: "SUBSTITUTION-CANARY" });
  expect(response).toHaveProperty("error");
  expect(verifier.verify).not.toHaveBeenCalled();
  await executor.client.client.ping();
  expect(read.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toMatch(/P13-PARKED-CANARY|SUBSTITUTION-CANARY/);
  expect(await caller.client.resumeTool(receipt.continuationId, "proof")).toMatchObject({ status: "accepted" });
});

it("C04 two public resumes settle one verified execution and one safe denial", async () => {
  const verifier = adapter(), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  verifier.verify.mockImplementation(async () => {
    entered.resolve(undefined);
    await release.promise;
    return { status: "verified", continuationId: "PRIVATE-ADAPTER-CANARY" };
  });
  const { caller, read, receipt } = await start(verifier);
  try {
    const first = caller.client.resumeTool(receipt.continuationId, "proof"), second = caller.client.resumeTool(receipt.continuationId, "proof");
    await entered.promise;
    expect(read.execute).not.toHaveBeenCalled();
    release.resolve(undefined);
    const replies = await Promise.all([first, second]);
    expect(replies.map((reply) => reply.status).sort()).toEqual(["accepted", "denied"]);
    await vi.waitFor(() => {
      expect(read.execute).toHaveBeenCalledOnce();
    });
    expect(verifier.verify).toHaveBeenCalledOnce();
  } finally {
    release.resolve(undefined);
  }
});

it("C05 revoking a parent grant during verification prevents late execution", async () => {
  const verifier = adapter(), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>(), finished = Promise.withResolvers<undefined>();
  verifier.verify.mockImplementation(async () => {
    entered.resolve(undefined);
    await release.promise;
    finished.resolve(undefined);
    return { status: "verified", continuationId: "PRIVATE-ADAPTER-CANARY" };
  });
  const { f, caller, executor, read, receipt } = await start(verifier);
  try {
    const resumed = caller.client.resumeTool(receipt.continuationId, "proof").then((reply) => reply.status, () => "closed");
    await entered.promise;
    const scope = f.host.sessions.authorization?.getResource(channel);
    if (scope === undefined) throw new Error("Missing scope");
    expect(f.registry.removeBinding({ bindingId: "fixture-grant-junior", scope, revision: 1 })).toBe(true);
    await caller.closed;
    release.resolve(undefined);
    await finished.promise;
    expect(await resumed).not.toBe("accepted");
    await executor.client.client.ping();
    expect(read.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(executor.received)).not.toContain("P13-PARKED-CANARY");
  } finally {
    release.resolve(undefined);
  }
});

it("C06 verified identity step-up preserves agent identity and cannot satisfy separate human consent", async () => {
  let consent = true, revokeConsent = true;
  const verifier = adapter();
  verifier.verify.mockImplementation(() => {
    if (revokeConsent) consent = false;
    return { status: "verified", continuationId: "PRIVATE-ADAPTER-CANARY" };
  });
  const { f, caller, executor, read, receipt, selector } = await start(verifier, { providerBarrier: { armed: { value: true }, reached: () => undefined, decide: () => Promise.resolve(consent ? "allow" : "deny") } });
  const bound = verifier.begin.mock.calls[0]?.[0];
  expect(bound?.caller.actor).toEqual(caller.actual.context.actor);
  expect(bound?.caller.actor.kind).toBe("agent");
  expect(bound?.caller.delegationRef).toBe("verified-delegation-" + f.caller);
  expect(await caller.client.resumeTool(receipt.continuationId, "identity-only")).toMatchObject({ status: "denied" });
  expect(verifier.verify).toHaveBeenCalledOnce();
  await executor.client.client.ping();
  expect(read.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toContain("P13-PARKED-CANARY");
  consent = true;
  revokeConsent = false;
  const approved = await caller.client.dispatchTool(channel, selector, { path: "explicit-consent-control" });
  if (approved.status !== "challenge-required") throw new Error("Missing control challenge");
  expect(await caller.client.resumeTool(approved.continuationId, "approved-proof")).toMatchObject({ status: "accepted" });
  await vi.waitFor(() => {
    expect(read.execute).toHaveBeenCalledOnce();
  });
});

it.each(["disconnect", "executor", "session", "restart"])("C05 %s invalidates an old continuation and fresh admission still works", async (change) => {
  const verifier = adapter(), started = await start(verifier);
  const { f, caller, executor, read, receipt, selector } = started;
  let nextCaller = caller, nextExecutor = executor;
  if (change === "restart") {
    await f.stop();
    const freshVerifier = adapter(), fresh = await start(freshVerifier);
    expect(await fresh.caller.client.resumeTool(receipt.continuationId, "old-proof")).toMatchObject({ status: "denied" });
    expect(freshVerifier.verify).not.toHaveBeenCalled();
    expect(await fresh.caller.client.resumeTool(fresh.receipt.continuationId, "new-proof")).toMatchObject({ status: "accepted" });
    expect(read.execute).not.toHaveBeenCalled();
    return;
  }
  if (change === "disconnect") {
    await caller.client.shutdown();
    await caller.closed;
    nextCaller = await f.connect(f.caller);
  }
  if (change === "executor") {
    await executor.client.shutdown();
    await executor.closed;
    nextExecutor = await f.connect(f.executor);
  }
  if (change === "session") {
    await f.host.sessions.disposeSession({ channel });
    await Promise.all([caller.closed, executor.closed]);
    await f.recreate();
    nextCaller = await f.connect(f.caller);
    nextExecutor = await f.connect(f.executor);
  }
  expect(await nextCaller.client.resumeTool(receipt.continuationId, "old-proof")).toMatchObject({ status: "denied" });
  expect(verifier.verify).not.toHaveBeenCalled();
  expect(read.execute).not.toHaveBeenCalled();
  await nextExecutor.client.joinSession(channel, [read]);
  const fresh = await nextCaller.client.dispatchTool(channel, selector, { path: "fresh-control" });
  if (fresh.status !== "challenge-required") throw new Error("Missing fresh challenge");
  expect(await nextCaller.client.resumeTool(fresh.continuationId, "new-proof")).toMatchObject({ status: "accepted" });
  await vi.waitFor(() => {
    expect(read.execute).toHaveBeenCalledOnce();
  });
});

it.each(["expiry", "cancel"])("C07 initial challenge reply rejects final-callback %s", async (change) => {
  let time = 1000, armed = false;
  let handle: ToolDispatchHandle<unknown> | undefined;
  const dispatcher = createToolDispatcher({ now: () => time, fenceNow: () => time, challenge: { adapter: {
    begin: () => ({ continuationId: "adapter-id", expiresAt: new Date(1500).toISOString(), presentation: { kind: "wait" } }),
    verify: () => ({ status: "verified", continuationId: "adapter-id" }),
  } } });
  const context: WebSocketConnectionContext = { connectionId: "test", connectionGeneration: 1, send: () => true, close: () => undefined, onClose: () => undefined };
  const service = createPrivateToolProtocol({ continuation: true, ready: () => {
    if (armed) {
      if (change === "expiry") time = 1500;
      else handle?.cancel();
    }
    return true;
  }, fence: () => true, assignment: () => Promise.reject(new Error("Unused")), onInvalidate: () => () => undefined,
  dispatch: (_context, request, callId) => {
    const authority = ports(callId);
    authority.authorize = (actionContext) => ({ decision: { effect: "allow", reveal: true, challengeRequired: true }, authority: actionContext.authority });
    const actual = dispatcher.dispatch({ callId, input: request.input, registration: registration(() => new EchoAction()), ports: authority });
    handle = actual;
    return { ...actual, admitted: actual.admission, current: () => true, refresh: () => Promise.resolve(() => true) };
  } });
  const call = async (method: string, params: Record<string, unknown>) => {
    const listeners: Array<(settlement: ReplySettlement) => void> = [];
    let guard = () => true;
    const invocation: JsonRpcInvocation = { kind: "request", guardReply: (check) => {
      guard = check;
    }, onReplySettled: (listener) => {
      listeners.push(listener);
    } };
    const handler = service.handlers["x-ahp/tools/" + method];
    if (handler === undefined) throw new Error("Missing handler");
    const reply = await handler(params, context, invocation);
    return { reply, finish: () => {
      const sent = guard();
      for (const listener of listeners) listener({ outcome: sent ? "success" : "failure", responseSent: sent });
      return sent;
    } };
  };
  try {
    expect((await call("capabilities", { version: 2 })).finish()).toBe(true);
    const pending = await call("dispatch", { version: 2, channel, contract: { id: contract.id, key: contract.key, version: contract.version }, input: { path: "expired" } });
    expect(pending.reply).toMatchObject({ status: "challenge-required" });
    armed = true;
    expect(pending.finish()).toBe(false);
  } finally {
    service.dispose();
    await dispatcher.shutdown();
  }
});

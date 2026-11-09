import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { TrustedRequestContext } from "@authorization";
import type { ClientToolRoute } from "@toolExecution/helpers/client/helpers/broker";
import type { ChallengeAdapter } from "@toolExecution";
import { sessionReducer, type SessionState, type SessionAction } from "@microsoft/agent-host-protocol";
import { createToolPolicyHost } from "./toolPolicyFixture";
import { FrameLog, responseWithId } from "./helpers";
import { createServerHarness } from "../toolExecution/serverFixture";
import { createPolicyIntegrationFixture, createCodingHarness, channel } from "./policyIntegrationFixture";

const fixtures: Array<Awaited<ReturnType<typeof createPolicyIntegrationFixture>>> = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
};
const sourceEvidence = { path: "src/tests/toolExecution/serverFixture.ts", export: "createServerHarness", revision: 7,
  candidate: createHash("sha256").update(readFileSync("src/tests/toolExecution/serverFixture.ts")).digest("hex") };
async function fixture(options: Omit<Parameters<typeof createPolicyIntegrationFixture>[0], "mode" | "server"> & { readonly mixed?: boolean } = {}) {
  const context: TrustedRequestContext = { actor: { kind: "user", principal: { domainId: "local", subject: "host-service" } }, connectionId: "host-owned-executor", authRevision: "p15-host-auth-4" };
  let current = true;
  const harness = createServerHarness("p15-source-" + sourceEvidence.candidate);
  const executor = { context, generation: 11, current: () => current, fence: () => current };
  const f = await createPolicyIntegrationFixture({ ...options, mode: "server", server: { executor, registrations: (options.mixed === true ? harness.slice(0, 1) : harness).map((entry) => entry.registration) } });
  fixtures.push(f);
  const read = required(harness[0]);
  const selector = { id: read.definition.id, key: read.definition.key, version: read.definition.version };
  return { ...f, harness, read, selector, executorIdentity: executor, hostCurrent: (value: boolean) => {
    current = value;
  } };
}

it.each(["junior", "junior-agent"])("E05 public %s invokes the exact host action with separate authenticated authority and no client execution", async (subject) => {
  const f = await fixture();
  const caller = await f.connect(subject), observer = await f.connect("observer");
  const competing = createCodingHarness();
  await expect(caller.client.joinSession(channel, competing)).rejects.toThrow(/not assigned|does not match/);
  const view = await caller.assigned(), row = required(view.tools.find((tool) => tool.contract.id === f.selector.id));
  expect(row.purposes).toEqual(["discover", "invoke"]);
  expect(row.execution).toEqual({ binding: f.read.registration.implementation, registrationRevision: 5, source: f.read.registration.source });
  expect(row.descriptor.inputSchema).toEqual(f.read.definition.inputSchema);
  expect(view.connection).toEqual({ id: caller.actual.context.connectionId, generation: caller.actual.fence.connectionGeneration });
  expect(await caller.request("x-ahp/tools/advertise", { version: 2, channel, viewRevision: view.viewRevision, contracts: [f.selector] })).toHaveProperty("error");
  await expect(caller.client.callTool(channel, f.selector, { path: "P15-ARGUMENT-CANARY" })).resolves.toEqual({ value: "P15-HOST-RESULT:coding.read:P15-ARGUMENT-CANARY:" + subject });
  expect(f.read.execute).toHaveBeenCalledOnce();
  expect(f.read.cleanup).toHaveBeenCalledOnce();
  const actual = required(f.read.execute.mock.calls[0])[1];
  expect(actual.caller).toEqual(caller.actual.context);
  expect(actual.executor).toEqual({ actor: f.executorIdentity.context.actor, connectionId: f.executorIdentity.context.connectionId, generation: 11, registrationRevision: 5 });
  expect(actual.resources).toEqual(f.route(required(f.host.sessions.authorization?.getResource(channel))).route);
  expect(actual.implementation).toEqual(f.read.registration.implementation);
  expect(actual.contract).toEqual({ id: f.selector.id, revision: 3 });
  expect(actual.authority.policyRevisions).toEqual(expect.arrayContaining([f.provider, f.chatPolicy, f.policy]));
  for (const entry of [...f.harness.slice(1), ...competing]) expect(entry.execute).not.toHaveBeenCalled();
  await caller.client.client.ping();
  await observer.client.client.ping();
  expect(JSON.stringify(caller.received)).toContain("P15-HOST-RESULT");
  expect(JSON.stringify(caller.received)).not.toMatch(/x-ahp\/tools\/invoke|x-ahp\/tools\/complete|p15-host-auth-4/);
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-DESCRIPTOR|P12-SCHEMA|p15-source|p15-approved|p15-host-auth/);
  expect(sourceEvidence.export).toBe("createServerHarness");
  expect(sourceEvidence.candidate).toMatch(/^[a-f0-9]{64}$/);
});

it.each(["caller", "executor", "provider", "missing-evaluator", "challenge"])("E05 public denies missing %s authority with zero host or competing execution", async (missing) => {
  const f = await fixture({ ...(missing === "provider" ? { providerVerdict: () => Promise.resolve("deny") } : {}), host: {
    ...(missing === "caller" ? { roles: { "junior": ["discover"], "junior-agent": ["discover"], "observer": ["discover"] } } : {}),
    ...(missing === "missing-evaluator" ? { permissionEvaluators: { "p12-provider": () => "allow" } } : {}),
    ...(missing === "challenge" ? { invokeChallenge: true } : {}),
  } });
  if (missing === "executor") f.registry.removeBinding({ bindingId: "p15-host-execute", scope: required(f.host.sessions.authorization?.getResource(channel)), revision: 1 });
  if (missing === "provider") {
    // Mandatory provider denial also blocks the native subscription; prove this boundary directly.
    await expect(f.connect(f.caller)).rejects.toThrow();
  } else {
    const caller = await f.connect(f.caller), observer = await f.connect("observer");
    expect(await caller.client.dispatchTool(channel, f.selector, { path: "P15-FORBIDDEN-ARGUMENT" })).toMatchObject({ status: "denied" });
    await caller.client.client.ping();
    await observer.client.client.ping();
    expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-DESCRIPTOR|P12-SCHEMA|p15-source/);
  }
  for (const entry of f.harness) {
    expect(entry.execute).not.toHaveBeenCalled();
    expect(entry.prepare).not.toHaveBeenCalled();
  }
});

it("E05 rejects absent, invalid and host-identity client credentials before authority", async () => {
  const f = await fixture();
  for (const credential of [undefined, "r5-invalid", "r5-host-service"]) {
    const socket = credential === undefined ? new WebSocket(f.url) : new WebSocket(f.url, credential);
    const frames = new FrameLog(socket);
    socket.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    try {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { channel: "ahp-root://", clientId: "host-service", protocolVersions: ["1.0.0"], initialSubscriptions: [channel] } }));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "x-ahp/tools/dispatch", params: { version: 2, channel, contract: f.selector, input: { path: "P15-UNAUTHENTICATED" } } }));
      for (const id of [1, 2]) expect(await frames.waitFor(responseWithId(id), 2000)).toHaveProperty("error.code");
      expect(JSON.stringify(frames.frames)).not.toMatch(/P15-|P12-DESCRIPTOR|P12-SCHEMA|p15-source/);
    } finally {
      socket.close();
    }
  }
  for (const entry of f.harness) expect(entry.execute).not.toHaveBeenCalled();
  const caller = await f.connect(f.caller);
  await expect(caller.client.callTool(channel, f.selector, { path: "authenticated-control" })).resolves.toHaveProperty("value");
  expect(f.read.execute).toHaveBeenCalledOnce();
});

it("E05 strict dispatch rejects contract, schema, identity and implementation substitution without fallback", async () => {
  const f = await fixture(), caller = await f.connect(f.caller), observer = await f.connect("observer");
  for (const contract of [{ ...f.selector, id: "99999999-9999-4999-8999-999999999999" }, { ...f.selector, key: "coding.forged" }, { ...f.selector, version: 4 }]) {
    expect(await caller.client.dispatchTool(channel, contract, { path: "P15-SUBSTITUTED" })).toMatchObject({ status: "denied" });
  }
  for (const field of ["inputSchema", "outputSchema", "implementation", "implementationId", "source", "registrationRevision", "location", "actor", "executor", "route", "resource", "generation", "mfaPassed"]) {
    expect(await caller.request("x-ahp/tools/dispatch", { version: 2, channel, contract: f.selector, input: { path: "P15-SUBSTITUTED" }, [field]: "P15-PRIVATE-METADATA" }), field).toHaveProperty("error");
  }
  for (const input of [{ path: 42 }, { path: "P15-INVALID-INPUT", roles: ["admin"] }]) expect(await caller.client.dispatchTool(channel, f.selector, input)).toMatchObject({ status: "denied" });
  for (const entry of f.harness) expect(entry.create).not.toHaveBeenCalled();
  await expect(caller.client.joinSession(channel, createCodingHarness())).rejects.toThrow();
  await expect(caller.client.callTool(channel, f.selector, { path: "strict-control" })).resolves.toHaveProperty("value");
  expect(f.read.execute).toHaveBeenCalledOnce();
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR|p15-source/);
});

it("E05 exact full route denies substitutions and missing provider proof then admits a fresh control", async () => {
  let substitute: (route: ClientToolRoute) => ClientToolRoute = (route) => route;
  const f = await fixture({ host: { resolve: ({ origin }) => substitute(f.route(origin)) } });
  const caller = await f.connect(f.caller), observer = await f.connect("observer");
  const cases: Array<(route: ClientToolRoute) => ClientToolRoute> = [
    ({ route }) => ({ route }),
    (value) => ({ ...value, externalProofs: [{ resource: f.workspace, revision: "expired", validUntil: 1 }] }),
    (value) => ({ ...value, externalProofs: [{ resource: { ...f.workspace, instanceId: "retired" }, revision: "wrong", validUntil: Date.now() + 60000 }] }),
    (value) => ({ ...value, route: { ...value.route, targets: [f.workspace] } }),
    (value) => ({ ...value, route: { ...value.route, targets: [f.chat] } }),
    (value) => ({ ...value, route: { ...value.route, origin: { ...value.route.origin, id: "ahp-session:/other" } } }),
    (value) => ({ ...value, route: { ...value.route, origin: { ...value.route.origin, instanceId: "retired-origin" } } }),
    (value) => ({ ...value, route: { ...value.route, targets: [{ ...f.chat, instanceId: "retired-chat" }, f.workspace] } }),
    (value) => ({ ...value, route: { ...value.route, targets: [f.chat, { ...f.workspace, id: "workspace:/other" }] } }),
  ];
  for (const mutation of cases) {
    substitute = mutation;
    expect(await caller.client.dispatchTool(channel, f.selector, { path: "P15-WRONG-ROUTE" })).toMatchObject({ status: "denied" });
  }
  expect(f.read.create).not.toHaveBeenCalled();
  substitute = (route) => route;
  await expect(caller.client.callTool(channel, f.selector, { path: "fresh-route" })).resolves.toHaveProperty("value");
  expect(f.read.execute).toHaveBeenCalledOnce();
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR/);
});

it.each(["caller-grant", "executor-grant", "host-generation", "caller-generation", "mandatory"])("E05 %s changed during awaited authorization suppresses host execution", async (change) => {
  const reached = Promise.withResolvers<undefined>(), release = Promise.withResolvers<"allow" | "deny">(), armed = { value: false };
  const f = await fixture({ providerBarrier: { armed, reached: () => {
    reached.resolve(undefined);
  }, decide: () => release.promise } });
  const caller = await f.connect(f.caller), observer = await f.connect("observer");
  await expect(caller.client.callTool(channel, f.selector, { path: "before-change" })).resolves.toHaveProperty("value");
  armed.value = true;
  const parked = caller.client.dispatchTool(channel, f.selector, { path: "P15-PARKED-CANARY" }).then((reply) => reply.status, (error: unknown) => String(error));
  try {
    await reached.promise;
    const scope = required(f.host.sessions.authorization?.getResource(channel));
    if (change === "caller-grant") f.registry.removeBinding({ bindingId: "fixture-grant-" + f.caller, scope, revision: 1 });
    if (change === "executor-grant") f.registry.removeBinding({ bindingId: "p15-host-execute", scope, revision: 1 });
    if (change === "mandatory") f.registry.removeBinding({ bindingId: "p12-" + f.chatPolicy.id + "-" + f.caller, scope: f.chat, revision: 1 });
    if (change === "host-generation") f.hostCurrent(false);
    if (change === "caller-generation") {
      await caller.transport.close();
      await caller.closed;
      await caller.actual.released;
    }
    armed.value = false;
    release.resolve("allow");
    expect(await parked).toMatch(/denied|closed|unavailable|disposed/);
    expect(f.read.execute).toHaveBeenCalledOnce();
    await observer.client.client.ping();
    expect(JSON.stringify(observer.received)).not.toMatch(/P15-PARKED|P15-HOST-RESULT|P12-SCHEMA|P12-DESCRIPTOR/);
    if (change === "host-generation") {
      f.hostCurrent(true);
      await expect(caller.client.callTool(channel, f.selector, { path: "fresh-host" })).resolves.toHaveProperty("value");
    }
    if (change === "caller-generation") {
      const replacement = await f.connect(f.caller);
      expect(replacement.actual.context.connectionId).not.toBe(caller.actual.context.connectionId);
      expect(replacement.actual.fence.connectionGeneration).not.toBe(caller.actual.fence.connectionGeneration);
      await expect(replacement.client.callTool(channel, f.selector, { path: "fresh-caller" })).resolves.toHaveProperty("value");
    }
  } finally {
    armed.value = false;
    release.resolve("allow");
    await parked;
  }
});

it("E05 server challenge resumes once and private status never discloses to another client", async () => {
  const adapter = { begin: vi.fn<ChallengeAdapter["begin"]>(() => ({ continuationId: "P15-PRIVATE-ADAPTER", expiresAt: new Date(Date.now() + 20000).toISOString(), presentation: { kind: "wait" } })),
    verify: vi.fn<ChallengeAdapter["verify"]>(() => ({ status: "verified", continuationId: "P15-PRIVATE-ADAPTER" })) };
  const f = await fixture({ host: { invokeChallenge: true, dispatcher: { challenge: { adapter } } } });
  const caller = await f.connect(f.caller), observer = await f.connect("observer");
  const receipt = await caller.client.dispatchTool(channel, f.selector, { path: "P15-CONTINUATION-INPUT" });
  if (receipt.status !== "challenge-required") throw new Error("Missing server challenge");
  expect(f.read.execute).not.toHaveBeenCalled();
  expect(f.read.prepare).not.toHaveBeenCalled();
  expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "waiting" });
  expect(await observer.client.resumeTool(receipt.continuationId, "P15-FOREIGN-PROOF")).toMatchObject({ status: "denied" });
  expect(adapter.verify).not.toHaveBeenCalled();
  expect(await caller.client.resumeTool(receipt.continuationId, "P15-PROOF")).toMatchObject({ status: "accepted" });
  let status = await caller.client.statusTool(receipt.callId);
  for (let count = 0; count < 20 && status.status !== "completed"; count += 1) status = await caller.client.statusTool(receipt.callId);
  expect(status).toMatchObject({ status: "completed", output: { value: "P15-HOST-RESULT:coding.read:P15-CONTINUATION-INPUT:junior-agent" } });
  expect(await observer.client.statusTool(receipt.callId)).toEqual({ version: 2, status: "unavailable" });
  expect(await caller.client.resumeTool(receipt.continuationId, "P15-PROOF")).toMatchObject({ status: "denied" });
  expect(f.read.execute).toHaveBeenCalledOnce();
  expect(f.read.cleanup).toHaveBeenCalledOnce();
  expect(JSON.stringify(caller.received)).not.toMatch(/P15-PRIVATE-ADAPTER|x-ahp\/tools\/invoke/);
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-CONTINUATION|P15-HOST-RESULT|P15-PRIVATE-ADAPTER|P15-PROOF|P12-SCHEMA|P12-DESCRIPTOR/);
  f.hostCurrent(false);
  expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "unavailable" });
});

it.each(["execute", "cleanup", "output"])("E03/E05 %s failure is sanitized after one host attempt", async (failure) => {
  const f = await fixture(), caller = await f.connect(f.caller), observer = await f.connect("observer");
  if (failure === "execute") f.read.execute.mockImplementation(() => {
    throw new Error("P15-SECRET-EXECUTION");
  });
  if (failure === "cleanup") f.read.cleanup.mockImplementation(() => {
    throw new Error("P15-SECRET-CLEANUP");
  });
  if (failure === "output") f.read.execute.mockReturnValue({ value: 42, private: "P15-SECRET-OUTPUT" } as never);
  await expect(caller.client.callTool(channel, f.selector, { path: "P15-FAILED-CALL" })).rejects.toThrow("unavailable");
  expect(f.read.execute).toHaveBeenCalledOnce();
  expect(f.read.cleanup).toHaveBeenCalledOnce();
  await caller.client.client.ping();
  await observer.client.client.ping();
  expect(JSON.stringify(caller.received)).not.toMatch(/P15-SECRET|P15-HOST-RESULT/);
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR/);
});

it("E03/E05 cancellation retains capacity until noncooperative host work and cleanup settle", async () => {
  const reached = Promise.withResolvers<undefined>(), release = Promise.withResolvers<{ value: string }>(), cleaned = Promise.withResolvers<undefined>();
  const f = await fixture({ host: { dispatcher: { limits: { maxInFlight: 1, shutdownWaitMs: 5 } } } });
  f.read.execute.mockImplementation(() => {
    reached.resolve(undefined);
    return release.promise;
  });
  f.read.cleanup.mockImplementation(() => {
    cleaned.resolve(undefined);
  });
  const caller = await f.connect(f.caller), observer = await f.connect("observer");
  const receipt = await caller.client.dispatchTool(channel, f.selector, { path: "P15-DRAINING-INPUT" });
  if (receipt.status !== "accepted") throw new Error("Missing admitted host call");
  try {
    await reached.promise;
    expect(await caller.client.cancelTool(receipt.callId)).toMatchObject({ status: "draining" });
    expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "draining" });
    expect(await caller.client.dispatchTool(channel, f.selector, { path: "P15-CAPACITY-REJECTED" })).toMatchObject({ status: "denied" });
    expect(f.read.execute).toHaveBeenCalledOnce();
    expect(f.read.cleanup).not.toHaveBeenCalled();
    release.resolve({ value: "P15-LATE-RESULT" });
    await cleaned.promise;
    let status = await caller.client.statusTool(receipt.callId);
    for (let count = 0; count < 20 && status.status === "draining"; count += 1) status = await caller.client.statusTool(receipt.callId);
    expect(status.status).toBe("cancelled");
    expect(f.read.cleanup).toHaveBeenCalledOnce();
    expect(await observer.client.statusTool(receipt.callId)).toMatchObject({ status: "unavailable" });
    await observer.client.client.ping();
    expect(JSON.stringify(caller.received)).not.toContain("P15-LATE-RESULT");
    expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR/);
    f.read.execute.mockReturnValue({ value: "fresh-after-drain" });
    await expect(caller.client.callTool(channel, f.selector, { path: "fresh" })).resolves.toEqual({ value: "fresh-after-drain" });
  } finally {
    release.resolve({ value: "P15-LATE-RESULT" });
  }
});

it("E05 a server-only host executes through the public client without a client broker configuration", async () => {
  const f = await fixture({ host: { clientExecution: false } }), caller = await f.connect(f.caller);
  await expect(caller.client.callTool(channel, f.selector, { path: "server-only" })).resolves.toEqual({ value: "P15-HOST-RESULT:coding.read:server-only:junior-agent" });
  expect(f.read.execute).toHaveBeenCalledOnce();
});

it("E03/E05 mixed host and client routes share one public capacity budget without fallback", async () => {
  const remote = required(createCodingHarness()[1]);
  const remoteRegistration = { definition: remote.definition, revision: 5, source: { id: "mixed-client-source", revision: 7 },
    implementation: { location: "client" as const, suppliedBy: "client" as const, implementation: "client-owned" as const, implementationId: "mixed-client" } };
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<{ value: string }>();
  const f = await fixture({ mixed: true, host: { registrations: [remoteRegistration], dispatcher: { limits: { maxInFlight: 1 } },
    assignment: (subject, _registration, operation) => subject !== "observer" && (!["advertise", "execute"].includes(operation) || subject === "senior-agent") } });
  f.read.execute.mockImplementation(() => {
    entered.resolve(undefined);
    return release.promise;
  });
  const caller = await f.connect(f.caller), executor = await f.connect("senior-agent"), observer = await f.connect("observer");
  await executor.client.joinSession(channel, [remote]);
  const remoteSelector = { id: remote.definition.id, key: remote.definition.key, version: remote.definition.version };
  const receipt = await caller.client.dispatchTool(channel, f.selector, { path: "P15-MIXED-HOST" });
  if (receipt.status !== "accepted") throw new Error("Host admission missing");
  try {
    await entered.promise;
    expect(await caller.client.dispatchTool(channel, remoteSelector, { path: "P15-MIXED-REJECTED" })).toMatchObject({ status: "denied" });
    await executor.client.client.ping();
    expect(remote.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(executor.received)).not.toMatch(/P15-MIXED-HOST|P15-MIXED-REJECTED/);
    release.resolve({ value: "P15-MIXED-RESULT" });
    let status = await caller.client.statusTool(receipt.callId);
    for (let count = 0; count < 20 && status.status !== "completed"; count += 1) status = await caller.client.statusTool(receipt.callId);
    expect(status).toMatchObject({ status: "completed", output: { value: "P15-MIXED-RESULT" } });
    await expect(caller.client.callTool(channel, remoteSelector, { path: "remote-control" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.summary:remote-control:7" });
    expect(remote.execute).toHaveBeenCalledOnce();
    expect(f.read.execute).toHaveBeenCalledOnce();
    await observer.client.client.ping();
    expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-HANDLER|P12-SCHEMA|P12-DESCRIPTOR/);
  } finally {
    release.resolve({ value: "P15-MIXED-RESULT" });
  }
});

it.each(["overlap", "dispatcher-conflict"])("E02 public host rejects %s configuration before serving", async (conflict) => {
  const f = await fixture();
  const registration = f.read.registration;
  await expect(createToolPolicyHost([registration.definition], { registrations: conflict === "overlap"
    ? [{ definition: registration.definition, revision: 1, source: registration.source, implementation: { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: "competing" } }]
    : [], server: { executor: f.executorIdentity, registrations: [registration], ...(conflict === "dispatcher-conflict" ? { dispatcher: { limits: { maxInFlight: 2 } } } : {}) } })).rejects.toThrow(conflict === "overlap" ? "overlap" : "shared dispatcher");
});

it("E05 forged client completion cannot replace an admitted local result", async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<{ value: string }>();
  const f = await fixture(), caller = await f.connect(f.caller), observer = await f.connect("observer");
  f.read.execute.mockImplementation(() => {
    entered.resolve(undefined);
    return release.promise;
  });
  const receipt = await caller.client.dispatchTool(channel, f.selector, { path: "P15-LOCAL-INPUT" });
  if (receipt.status !== "accepted") throw new Error("Missing local admission");
  try {
    await entered.promise;
    const origin = required(f.host.sessions.authorization?.getResource(channel));
    const completion = { version: 2, callId: receipt.callId, channel, contract: f.selector, route: f.route(origin).route,
      execution: { binding: f.read.registration.implementation, registrationRevision: 5, source: f.read.registration.source },
      connection: { id: caller.actual.context.connectionId, generation: caller.actual.fence.connectionGeneration }, advertisementId: globalThis.crypto.randomUUID(), output: { value: "P15-FORGED-RESULT" } };
    await caller.transport.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: completion }));
    await caller.client.client.ping();
    expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "running" });
    release.resolve({ value: "P15-GENUINE-RESULT" });
    let status = await caller.client.statusTool(receipt.callId);
    for (let count = 0; count < 20 && status.status !== "completed"; count += 1) status = await caller.client.statusTool(receipt.callId);
    expect(status).toMatchObject({ status: "completed", output: { value: "P15-GENUINE-RESULT" } });
    expect(f.read.execute).toHaveBeenCalledOnce();
    await observer.client.client.ping();
    expect(JSON.stringify(caller.received)).not.toContain("P15-FORGED-RESULT");
    expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR/);
  } finally {
    release.resolve({ value: "P15-GENUINE-RESULT" });
  }
});

it("E04/E05 shared host identity preserves senior/junior scopes and native snapshot/action sequencing", async () => {
  const f = await fixture(), senior = await f.connect("senior"), junior = await f.connect("junior-agent"), observer = await f.connect("observer");
  expect((await senior.assigned()).tools).toHaveLength(4);
  expect((await junior.assigned()).tools.map((entry) => entry.contract.key)).toEqual(["coding.read", "coding.summary"]);
  expect((await observer.assigned()).tools).toEqual([]);
  const before = (await observer.client.client.subscribe(channel)).result.snapshot?.state as SessionState;
  const title = "public native sequence control";
  const envelope = f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title } });
  await observer.client.client.ping();
  const action = observer.received.find((frame) => typeof frame === "object" && frame !== null && "method" in frame && frame.method === "action" && JSON.stringify(frame).includes(title));
  if (typeof action !== "object" || action === null || !("params" in action)) throw new Error("Missing native action");
  const params = action.params as { action: SessionAction; serverSeq: number };
  expect(params.serverSeq).toBe(envelope.serverSeq);
  expect(sessionReducer(before, params.action)).toEqual((await observer.client.client.subscribe(channel)).result.snapshot?.state);
  const write = required(f.harness[2]), selector = { id: write.definition.id, key: write.definition.key, version: write.definition.version };
  expect(await junior.client.dispatchTool(channel, selector, { path: "P15-JUNIOR-FORBIDDEN" })).toMatchObject({ status: "denied" });
  await expect(senior.client.callTool(channel, selector, { path: "P15-SENIOR-PRIVATE" })).resolves.toEqual({ value: "P15-HOST-RESULT:coding.write:P15-SENIOR-PRIVATE:senior" });
  expect(write.execute).toHaveBeenCalledOnce();
  await junior.client.client.ping();
  await observer.client.client.ping();
  expect(JSON.stringify(junior.received)).not.toMatch(/P15-SENIOR-PRIVATE|P12-SCHEMA-write|P12-DESCRIPTOR-write|P12-SCHEMA-terminal/);
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR|p15-source|p15-approved/);
});

it("E05 a parked server call cannot cross session destruction and same-URI recreation", async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  const f = await fixture({ host: { resolve: async ({ origin, input }) => {
    if (typeof input === "object" && input !== null && "path" in input && input.path === "P15-OLD-INCARNATION") {
      entered.resolve(undefined);
      await release.promise;
    }
    return f.route(origin);
  } } });
  const caller = await f.connect(f.caller);
  const original = required(f.host.sessions.authorization?.getResource(channel));
  const parked = caller.client.dispatchTool(channel, f.selector, { path: "P15-OLD-INCARNATION" }).then((reply) => reply.status, (error: unknown) => String(error));
  try {
    await entered.promise;
    await f.host.sessions.disposeSession({ channel });
    await caller.closed;
    await f.recreate();
    const replacement = required(f.host.sessions.authorization?.getResource(channel));
    expect(replacement.id).toBe(original.id);
    expect(replacement.instanceId).not.toBe(original.instanceId);
    const next = await f.connect(f.caller);
    release.resolve(undefined);
    expect(await parked).toMatch(/denied|closed|unavailable/);
    expect(f.read.execute).not.toHaveBeenCalled();
    await expect(next.client.callTool(channel, f.selector, { path: "new-incarnation" })).resolves.toHaveProperty("value");
    expect(required(f.read.execute.mock.calls[0])[1].resources.origin).toEqual(replacement);
    await next.client.client.ping();
    expect(JSON.stringify(next.received)).not.toContain("P15-OLD-INCARNATION");
  } finally {
    release.resolve(undefined);
    await parked;
  }
});

it("E05 initial snapshot revocation drops buffered host-session content and descriptors", async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<"allow">();
  let waiting = false;
  const f = await fixture({ host: { permission: () => {
    if (!waiting) return Promise.resolve("allow");
    entered.resolve(undefined);
    return release.promise;
  } } });
  const socket = new WebSocket(f.url, "r5-" + f.caller), frames = new FrameLog(socket);
  socket.on("error", () => undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  waiting = true;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { channel: "ahp-root://", clientId: "buffered-caller", protocolVersions: ["1.0.0"], initialSubscriptions: [channel] } }));
  try {
    await Promise.race([entered.promise, frames.waitFor(responseWithId(1), 2000).then((frame) => {
      throw new Error("Initialization completed before permission barrier: " + JSON.stringify(frame));
    })]);
    f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title: "P15-BUFFERED-PRIVATE-CANARY" } });
    expect(f.registry.removeBinding({ bindingId: "fixture-grant-" + f.caller, scope: required(f.host.sessions.authorization?.getResource(channel)), revision: 1 })).toBe(true);
    waiting = false;
    release.resolve("allow");
    expect(await frames.waitFor(responseWithId(1), 2000)).toHaveProperty("error");
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping", params: {} }));
    await frames.waitFor(responseWithId(2), 2000);
    expect(JSON.stringify(frames.frames)).not.toMatch(/P15-BUFFERED|P12-SCHEMA|P12-DESCRIPTOR|p15-source|p15-approved/);
    for (const entry of f.harness) expect(entry.execute).not.toHaveBeenCalled();
  } finally {
    waiting = false;
    release.resolve("allow");
    socket.close();
  }
});

it("E05 a live host assignment cannot bypass an invoke-only mandatory provider denial", async () => {
  const armed = { value: false };
  const verdict = vi.fn(() => Promise.resolve("deny" as const));
  const f = await fixture({ providerBarrier: { armed, reached: () => undefined, decide: verdict } });
  const caller = await f.connect(f.caller), observer = await f.connect("observer");
  const initial = required((await caller.assigned()).tools.find((entry) => entry.contract.id === f.selector.id));
  expect(initial.purposes).toContain("invoke");
  expect(initial.execution?.binding.location).toBe("server");
  armed.value = true;
  expect(await caller.client.dispatchTool(channel, f.selector, { path: "P15-PROVIDER-DENIED" })).toMatchObject({ status: "denied" });
  expect(verdict).toHaveBeenCalled();
  expect((await caller.client.client.subscribe(channel)).result.snapshot).toBeDefined();
  expect(required((await caller.assigned()).tools.find((entry) => entry.contract.id === f.selector.id)).purposes).toEqual(["discover"]);
  for (const entry of f.harness) {
    expect(entry.prepare).not.toHaveBeenCalled();
    expect(entry.execute).not.toHaveBeenCalled();
  }
  await caller.client.client.ping();
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P15-|P12-SCHEMA|P12-DESCRIPTOR|p15-source/);
  expect(JSON.stringify(caller.received)).not.toContain("P15-PROVIDER-DENIED");
  armed.value = false;
  await expect(caller.client.callTool(channel, f.selector, { path: "provider-restored" })).resolves.toHaveProperty("value");
  expect(f.read.execute).toHaveBeenCalledOnce();
});

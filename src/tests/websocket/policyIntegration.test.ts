import { afterEach, expect, it, vi } from "vitest";
import { sessionReducer, type SessionState, type SessionAction } from "@microsoft/agent-host-protocol";
import type { ClientToolRoute } from "@toolExecution/helpers/client/helpers/broker";
import WebSocket from "ws";
import { FrameLog, responseWithId } from "./helpers";
import { createPolicyIntegrationFixture, createCodingHarness, channel } from "./policyIntegrationFixture";
import { parseToolWire, toolInvokeSchema, toolAssignedReplySchema, type ToolInvoke } from "@toolExecution/helpers/client/helpers/protocol";

const fixtures: Array<Awaited<ReturnType<typeof createPolicyIntegrationFixture>>> = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
});

it("X01 grants issued after initialization give the agent only an explicit subset and parent revocation suppresses its parked call", async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<"allow" | "deny">();
  const armed = { value: false };
  const f = await createPolicyIntegrationFixture({ mode: "cross", providerBarrier: {
    armed, reached: () => {
      entered.resolve(undefined);
    }, decide: () => release.promise,
  }, host: {
    roles: { "senior": ["discover", "invoke", "advertise", "execute"], "senior-agent": ["discover", "invoke", "advertise", "execute"],
      "junior": ["discover"], "junior-agent": ["discover"], "observer": ["discover"] },
    assignment: (subject) => subject === "senior-agent",
  } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), user = await f.connect("junior"), agent = await f.connect("junior-agent", "display-senior");
  const harness = createCodingHarness(), read = harness[0], summary = harness[1];
  if (read === undefined || summary === undefined) throw new Error("Missing harness");
  await executor.client.joinSession(channel, [read, summary]);
  expect((await user.assigned()).tools).toEqual([]);
  expect((await agent.assigned()).tools).toEqual([]);
  const selector = (tool: typeof read) => ({ id: tool.definition.id, key: tool.definition.key, version: tool.definition.version });
  expect(await agent.client.dispatchTool(channel, selector(read), { path: "P12-BEFORE-ISSUANCE" })).toMatchObject({ status: "denied" });
  const scope = f.host.sessions.authorization?.getResource(channel);
  if (scope === undefined) throw new Error("Missing canonical scope");
  f.registry.installBinding({ id: "p12-issued-parent", actor: user.actual.context.actor, scope, roles: ["discover", "invoke"],
    policies: [f.policy], revision: 1, authority: { kind: "host-policy", policy: f.policy } });
  f.registry.installBinding({ id: "p12-issued-child", actor: agent.actual.context.actor, scope, roles: ["discover", "invoke"],
    policies: [f.policy], revision: 1, authority: { kind: "delegation", issuer: user.actual.context.actor, parentGrantId: "p12-issued-parent" } });
  for (const [peer, bindingId, tools] of [[user, "p12-issued-parent", [read, summary]], [agent, "p12-issued-child", [read]]] as const) {
    for (const tool of tools) for (const operation of ["discover", "invoke"] as const) {
      f.registry.installToolAssignment({ resource: scope, route: f.route(scope).route, recipient: peer.actual.context.actor,
        contract: selector(tool), operation, bindingId, policyRef: f.policy });
    }
  }
  await executor.client.joinSession(channel, [read, summary]);
  expect((await user.assigned()).tools.map((tool) => tool.contract.key)).toEqual(["coding.read", "coding.summary"]);
  expect((await agent.assigned()).tools.map((tool) => tool.contract.key)).toEqual(["coding.read"]);
  await expect(user.client.callTool(channel, selector(summary), { path: "parent-summary" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.summary:parent-summary:7" });
  expect(await agent.client.dispatchTool(channel, selector(summary), { path: "P12-UNDELEGATED-SUMMARY" })).toMatchObject({ status: "denied" });
  await expect(agent.client.callTool(channel, selector(read), { path: "delegated-read" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:delegated-read:7" });
  expect(JSON.stringify(agent.received)).toContain("P12-DESCRIPTOR-read");
  expect(JSON.stringify(agent.received)).not.toMatch(/P12-DESCRIPTOR-summary|P12-SCHEMA-summary|parent-summary/);
  armed.value = true;
  const parked = agent.client.dispatchTool(channel, selector(read), { path: "P12-REVOKED-DELEGATION" });
  try {
    await entered.promise;
    expect(f.registry.removeBinding({ bindingId: "p12-issued-parent", scope, revision: 1 })).toBe(true);
    armed.value = false;
    release.resolve("allow");
    expect(await parked).toMatchObject({ status: "denied" });
    await executor.client.client.ping();
    expect(read.execute).toHaveBeenCalledOnce();
    expect(summary.execute).toHaveBeenCalledOnce();
    expect((await agent.assigned()).tools).toEqual([]);
    expect((await user.assigned()).tools).toEqual([]);
    await agent.client.client.ping();
    expect(JSON.stringify(executor.received)).not.toMatch(/P12-BEFORE-ISSUANCE|P12-UNDELEGATED-SUMMARY|P12-REVOKED-DELEGATION/);
    for (const tool of harness.slice(2)) expect(tool.execute).not.toHaveBeenCalled();
  } finally {
    armed.value = false;
    release.resolve("allow");
    await parked.catch(() => undefined);
  }
});

it.each(["self", "cross"] as const)("X05/X06 %s route denies an absent required invoke evaluator despite live native views and an active executor", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode, host: { permissionEvaluators: { "p12-provider": () => "allow" } } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller), observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selected = (await executor.assigned()).tools.find((tool) => tool.contract.id === chosen.definition.id);
  expect(selected?.purposes).toEqual(["discover", "advertise", "execute"]);
  expect(selected?.execution).toBeDefined();
  expect((await caller.assigned()).tools.find((tool) => tool.contract.id === chosen.definition.id)?.purposes).not.toContain("invoke");
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  expect(await caller.client.dispatchTool(channel, selector, { path: "P12-MISSING-EVALUATOR" })).toMatchObject({ status: "denied" });
  await executor.client.client.ping();
  await observer.client.client.ping();
  for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).toContain("P12-DESCRIPTOR-read");
  expect(JSON.stringify(executor.received)).not.toContain("P12-MISSING-EVALUATOR");
  expect(JSON.stringify(observer.received)).not.toMatch(/P12-DESCRIPTOR|P12-SCHEMA|P12-MISSING-EVALUATOR/);
});

it.each(["self", "cross"] as const)("X05/X06 %s route rejects local contract/schema substitution and validates the selected handler output", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller), observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  const substitutions = [
    { ...chosen.definition, id: "99999999-9999-4999-8999-999999999999" },
    { ...chosen.definition, version: chosen.definition.version + 1 },
    { ...chosen.definition, description: "P12-SUBSTITUTED-DESCRIPTOR" },
    { ...chosen.definition, inputSchema: { type: "object" as const, properties: { path: { type: "number" } } } },
    { ...chosen.definition, outputSchema: { type: "object" as const, properties: { value: { type: "number" } } } },
  ];
  for (const definition of substitutions) await expect(executor.client.joinSession(channel, [{ definition, execute: chosen.execute }])).rejects.toThrow(/not assigned|does not match/);
  expect(chosen.execute).not.toHaveBeenCalled();
  let invalid = true;
  const execute = vi.fn((input: unknown, context: Parameters<typeof chosen.execute>[1]) => invalid
    ? { value: 42, secret: "P12-INVALID-OUTPUT" }
    : chosen.execute(input, context));
  await executor.client.joinSession(channel, [{ definition: chosen.definition, execute }]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "invalid-output" })).rejects.toThrow("unavailable");
  await executor.client.client.ping();
  expect(execute).toHaveBeenCalledOnce();
  expect(chosen.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(caller.received)).not.toContain("P12-INVALID-OUTPUT");
  invalid = false;
  await expect(caller.client.callTool(channel, selector, { path: "validated-output" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:validated-output:7" });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(chosen.execute).toHaveBeenCalledOnce();
  for (const tool of harness.slice(1)) expect(tool.execute).not.toHaveBeenCalled();
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P12-INVALID-OUTPUT|P12-HANDLER-RESULT|P12-SUBSTITUTED-DESCRIPTOR|P12-SCHEMA/);
});

it.each(["self", "cross"] as const)("X05/X06 %s route rejects a parked call after the same session URI acquires a new incarnation", async (mode) => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  const f = await createPolicyIntegrationFixture({ mode, host: { resolve: async ({ origin, input }) => {
    if (typeof input === "object" && input !== null && "path" in input && input.path === "P12-OLD-INCARNATION") {
      entered.resolve(undefined);
      await release.promise;
    }
    return f.route(origin);
  } } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const original = createCodingHarness(), chosen = original[0];
  if (chosen === undefined) throw new Error("Missing handler");
  await executor.client.joinSession(channel, [chosen]);
  const before = f.host.sessions.authorization?.getResource(channel);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "old-resource-control" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:old-resource-control:7" });
  const parked = caller.client.dispatchTool(channel, selector, { path: "P12-OLD-INCARNATION" }).then((reply) => reply.status, (error: unknown) => String(error));
  try {
    await entered.promise;
    await f.host.sessions.disposeSession({ channel });
    await Promise.all([executor.closed, caller.closed]);
    await f.recreate();
    const after = f.host.sessions.authorization?.getResource(channel);
    expect(after?.id).toBe(before?.id);
    expect(after?.instanceId).not.toBe(before?.instanceId);
    const replacement = await f.connect(f.executor), nextCaller = mode === "self" ? replacement : await f.connect(f.caller);
    const nextHarness = createCodingHarness(), next = nextHarness[0];
    if (next === undefined) throw new Error("Missing new handler");
    await replacement.client.joinSession(channel, [next]);
    release.resolve(undefined);
    expect(await parked).toMatch(/denied|closed|unavailable/);
    await replacement.client.client.ping();
    expect(chosen.execute).toHaveBeenCalledOnce();
    for (const tool of nextHarness) expect(tool.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(replacement.received)).not.toContain("P12-OLD-INCARNATION");
    await expect(nextCaller.client.callTool(channel, selector, { path: "new-resource-control" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:new-resource-control:7" });
    expect(next.execute).toHaveBeenCalledOnce();
  } finally {
    release.resolve(undefined);
    await parked;
  }
});

it("X02 broader parent-session authority cannot replace triage-chat assignments or its mandatory constraint", async () => {
  const f = await createPolicyIntegrationFixture({ mode: "cross" });
  fixtures.push(f);
  const executor = await f.connect(f.executor), pm = await f.connect("pm-agent"), harness = createCodingHarness();
  await executor.client.joinSession(channel, harness);
  const parent = f.host.sessions.authorization?.getResource(f.parentChannel), origin = f.host.sessions.authorization?.getResource(channel);
  if (parent === undefined || origin === undefined) throw new Error("Missing canonical sessions");
  expect(new Set([parent.instanceId, origin.instanceId, f.chat.instanceId, f.workspace.instanceId]).size).toBe(4);
  expect(f.host.sessions.getSessionToolManifest(channel)?.sessionType.key).toBe("test.triage-session");
  expect((await pm.assigned()).tools.map((tool) => tool.contract.key)).toEqual(["coding.read", "coding.summary"]);
  await pm.client.client.subscribe(f.parentChannel);
  const frame = await pm.request("x-ahp/tools/assigned", { version: 2, channel: f.parentChannel });
  if (typeof frame !== "object" || frame === null || !("result" in frame)) throw new Error("Missing parent view");
  const view = parseToolWire(toolAssignedReplySchema, frame.result);
  expect(view.resource).toEqual(parent);
  expect(view.tools.map((tool) => tool.contract.key)).toEqual(["coding.read", "coding.summary", "coding.terminal", "coding.write"]);
  expect(view.tools.every((tool) => tool.purposes.includes("invoke"))).toBe(true);
  const baseline = pm.received.length;
  for (const tool of harness.slice(2)) {
    const selector = { id: tool.definition.id, key: tool.definition.key, version: tool.definition.version };
    expect(await pm.client.dispatchTool(channel, selector, { path: "P12-PARENT-CANNOT-GRANT" })).toMatchObject({ status: "denied" });
    expect(await pm.request("x-ahp/tools/dispatch", { version: 2, channel, contract: selector, input: {}, route: f.route(parent).route })).toHaveProperty("error");
  }
  const read = harness[0];
  if (read === undefined) throw new Error("Missing read tool");
  const selector = { id: read.definition.id, key: read.definition.key, version: read.definition.version };
  await expect(pm.client.callTool(channel, selector, { path: "triage-read" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:triage-read:7" });
  expect(f.registry.removeBinding({ bindingId: "p12-" + f.chatPolicy.id + "-pm-agent", scope: f.chat, revision: 1 })).toBe(true);
  expect(f.registry.readBindings({ actor: pm.actual.context.actor, scope: parent }).bindings.some((binding) => binding.id === "p12-parent-pm-agent")).toBe(true);
  const outcome = await pm.client.dispatchTool(channel, selector, { path: "P12-PARENT-BYPASS" }).then((reply) => reply.status, (error: unknown) => String(error));
  expect(outcome).toMatch(/denied|closed|unavailable/);
  await pm.closed;
  await executor.client.client.ping();
  expect(read.execute).toHaveBeenCalledOnce();
  for (const tool of harness.slice(1)) expect(tool.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toMatch(/P12-PARENT-CANNOT-GRANT|P12-PARENT-BYPASS/);
  expect(JSON.stringify(pm.received.slice(baseline))).not.toMatch(/P12-SCHEMA-write|P12-SCHEMA-terminal|P12-DESCRIPTOR-write|P12-DESCRIPTOR-terminal/);
});

it.each(["self", "cross"] as const)("X05/X06 %s route cannot reroute a parked call onto a replacement executor connection", async (mode) => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  const f = await createPolicyIntegrationFixture({ mode, host: { resolve: async ({ origin, input }) => {
    if (typeof input === "object" && input !== null && "path" in input && input.path === "P12-OLD-CONNECTION") {
      entered.resolve(undefined);
      await release.promise;
    }
    return f.route(origin);
  } } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const original = createCodingHarness(), chosen = original[0];
  if (chosen === undefined) throw new Error("Missing handler");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "original-connection" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:original-connection:7" });
  const parked = caller.client.dispatchTool(channel, selector, { path: "P12-OLD-CONNECTION" }).then(
    (reply) => reply.status, (error: unknown) => error instanceof Error ? error.message : String(error));
  try {
    await entered.promise;
    await executor.transport.close();
    await executor.closed;
    await executor.actual.released;
    const replacement = await f.connect(f.executor), nextCaller = mode === "self" ? replacement : caller;
    expect(replacement.actual.context.actor).toEqual(executor.actual.context.actor);
    expect(replacement.actual.context.connectionId).not.toBe(executor.actual.context.connectionId);
    expect(replacement.actual.fence.connectionGeneration).toBeGreaterThan(executor.actual.fence.connectionGeneration);
    const nextHarness = createCodingHarness(), next = nextHarness[0];
    if (next === undefined) throw new Error("Missing replacement handler");
    await replacement.client.joinSession(channel, [next]);
    release.resolve(undefined);
    expect(await parked).toMatch(/denied|closed|unavailable/);
    await replacement.client.client.ping();
    expect(chosen.execute).toHaveBeenCalledOnce();
    for (const tool of nextHarness) expect(tool.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(replacement.received)).not.toContain("P12-OLD-CONNECTION");
    await expect(nextCaller.client.callTool(channel, selector, { path: "new-connection" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:new-connection:7" });
    expect(next.execute).toHaveBeenCalledOnce();
  } finally {
    release.resolve(undefined);
    await parked;
  }
});

it.each(["self", "cross"] as const)("X05/X06 %s route preserves exact in-flight cancellation and cleanup after advertisement invalidation", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller), observer = await f.connect("observer");
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>(), aborted = Promise.withResolvers<undefined>();
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  const execute = vi.fn(async (_input: unknown, context: Parameters<typeof chosen.execute>[1]) => {
    context.signal.addEventListener("abort", () => {
      aborted.resolve(undefined);
    }, { once: true });
    entered.resolve(undefined);
    await release.promise;
    return { value: "P12-LATE-INVALIDATED-RESULT" };
  });
  await executor.client.joinSession(channel, [{ definition: chosen.definition, execute }]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  const receipt = await caller.client.dispatchTool(channel, selector, { path: "P12-ACTIVE-INVALIDATION" });
  if (receipt.status !== "accepted") throw new Error("Missing active call");
  try {
    await entered.promise;
    const scope = f.host.sessions.authorization?.getResource(channel);
    if (scope === undefined) throw new Error("Missing scope");
    expect(f.registry.removeBinding({ bindingId: "fixture-grant-observer", scope, revision: 1 })).toBe(true);
    await executor.client.client.ping();
    expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "running" });
    expect(await caller.client.cancelTool(receipt.callId)).toMatchObject({ status: "draining" });
    await aborted.promise;
    expect(f.host.toolExecutionStats()).toMatchObject({ active: 1, draining: 1 });
    release.resolve(undefined);
    await vi.waitFor(async () => {
      expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "cancelled" });
    });
    expect(f.host.toolExecutionStats()).toMatchObject({ active: 0, draining: 0 });
    expect(execute).toHaveBeenCalledOnce();
    for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(caller.received)).not.toContain("P12-LATE-INVALIDATED-RESULT");
    await observer.closed;
    expect(JSON.stringify(observer.received)).not.toMatch(/P12-ACTIVE-INVALIDATION|P12-LATE-INVALIDATED-RESULT/);
  } finally {
    release.resolve(undefined);
  }
});

it.each(["self", "cross"] as const)("X05/X06 %s route retires invalidated advertisements before selection and after awaited resolution", async (mode) => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  const f = await createPolicyIntegrationFixture({ mode, host: { resolve: async ({ origin, input }) => {
    if (typeof input === "object" && input !== null && "path" in input && input.path === "P12-STALE-ADVERTISEMENT") {
      entered.resolve(undefined);
      await release.promise;
    }
    return f.route(origin);
  } } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "before-invalidation" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:before-invalidation:7" });
  const parked = caller.client.dispatchTool(channel, selector, { path: "P12-STALE-ADVERTISEMENT" });
  try {
    await entered.promise;
    const scope = f.host.sessions.authorization?.getResource(channel);
    if (scope === undefined) throw new Error("Missing scope");
    expect(f.registry.removeBinding({ bindingId: "fixture-grant-observer", scope, revision: 1 })).toBe(true);
    await vi.waitFor(() => {
      expect(JSON.stringify(executor.received)).toContain("x-ahp/tools/assignmentsChanged");
    });
    release.resolve(undefined);
    expect(await parked).toMatchObject({ status: "denied" });
    expect(await caller.client.dispatchTool(channel, selector, { path: "P12-AFTER-INVALIDATION" })).toMatchObject({ status: "denied" });
    await executor.client.client.ping();
    expect(chosen.execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(executor.received)).not.toMatch(/P12-STALE-ADVERTISEMENT|P12-AFTER-INVALIDATION/);
    await executor.client.joinSession(channel, [chosen]);
    await expect(caller.client.callTool(channel, selector, { path: "fresh-ack" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:fresh-ack:7" });
    expect(chosen.execute).toHaveBeenCalledTimes(2);
  } finally {
    release.resolve(undefined);
    await parked.catch(() => undefined);
  }
});

it.each(["self", "cross"] as const)("X05/X06 %s client refuses substituted source, implementation and connection tuples on actual host invocations", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  let mutation: ((invoke: ToolInvoke) => unknown) | undefined;
  let reached = Promise.withResolvers<undefined>();
  const executor = await f.connect(f.executor, "executor", false, (frame) => {
    if (mutation === undefined) return frame;
    if (typeof frame !== "object" || frame === null || !("params" in frame)) throw new Error("Missing host invoke");
    const altered = { ...frame, params: mutation(parseToolWire(toolInvokeSchema, frame.params)) };
    reached.resolve(undefined);
    return altered;
  });
  const caller = mode === "self" ? executor : await f.connect(f.caller), observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "tuple-control" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:tuple-control:7" });
  const cases: ReadonlyArray<readonly [string, (invoke: ToolInvoke) => unknown]> = [
    ["source-id", (value) => ({ ...value, execution: { ...value.execution, source: { ...value.execution.source, id: "substituted-source" } } })],
    ["source-revision", (value) => ({ ...value, execution: { ...value.execution, source: { ...value.execution.source, revision: 8 } } })],
    ["registration-revision", (value) => ({ ...value, execution: { ...value.execution, registrationRevision: 6 } })],
    ["implementation-id", (value) => ({ ...value, execution: { ...value.execution, binding: { ...value.execution.binding, implementationId: "substituted-handler" } } })],
    ["execution-location", (value) => ({ ...value, execution: { ...value.execution, binding: { location: "server", suppliedBy: "server", implementation: "host" } } })],
    ["connection-id", (value) => ({ ...value, connection: { ...value.connection, id: "retired-connection" } })],
    ["connection-generation", (value) => ({ ...value, connection: { ...value.connection, generation: value.connection.generation + 1 } })],
    ["contract-version", (value) => ({ ...value, contract: { ...value.contract, version: value.contract.version + 1 } })],
    ["origin-incarnation", (value) => ({ ...value, route: { ...value.route, origin: { ...value.route.origin, instanceId: "retired-instance" } } })],
  ];
  for (const [label, substitute] of cases) {
    mutation = substitute;
    reached = Promise.withResolvers<undefined>();
    const receipt = await caller.client.dispatchTool(channel, selector, { path: "P12-ALTERED-" + label });
    if (receipt.status !== "accepted") throw new Error("Expected actual authorized host invocation: " + label);
    await reached.promise;
    await executor.client.client.ping();
    expect(chosen.execute, label).toHaveBeenCalledOnce();
    expect(await caller.client.statusTool(receipt.callId), label).toMatchObject({ status: "running" });
    await caller.client.cancelTool(receipt.callId);
    // Settle the real host's retained work with its original exact correlation.
    // This is explicit cleanup, not successful public execution evidence.
    const raw = executor.received.find((frame) => typeof frame === "object" && frame !== null && "method" in frame && frame.method === "x-ahp/tools/invoke"
      && "params" in frame && JSON.stringify(frame.params).includes(receipt.callId));
    if (typeof raw !== "object" || raw === null || !("params" in raw)) throw new Error("Missing original correlation");
    const { input: _input, ...correlation } = parseToolWire(toolInvokeSchema, raw.params);
    expect(_input).toEqual({ path: "P12-ALTERED-" + label });
    await executor.transport.send(JSON.stringify({ jsonrpc: "2.0", method: "x-ahp/tools/complete", params: { ...correlation, error: "execution-failed" } }));
    await executor.client.client.ping();
    await vi.waitFor(async () => {
      expect(await caller.client.statusTool(receipt.callId)).toMatchObject({ status: "cancelled" });
    });
  }
  mutation = undefined;
  await expect(caller.client.callTool(channel, selector, { path: "tuple-restored" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:tuple-restored:7" });
  expect(chosen.execute).toHaveBeenCalledTimes(2);
  for (const competing of harness.slice(1)) expect(competing.execute).not.toHaveBeenCalled();
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P12-ALTERED|P12-HANDLER-RESULT|P12-DESCRIPTOR|P12-SCHEMA/);
});

it("X01/X02/X03 one harness preserves distinct senior, junior and PM user/agent inventories, private results and SDK views", async () => {
  const f = await createPolicyIntegrationFixture({ mode: "cross" });
  fixtures.push(f);
  const executor = await f.connect("senior-agent"), harness = createCodingHarness();
  await executor.client.joinSession(channel, harness);
  const peers = new Map([["senior-agent", executor]]);
  for (const subject of ["senior", "junior", "junior-agent", "pm", "pm-agent", "observer"]) peers.set(subject, await f.connect(subject, "senior-agent"));
  const read = harness[0], summary = harness[1], write = harness[2], terminal = harness[3];
  if (read === undefined || summary === undefined || write === undefined || terminal === undefined) throw new Error("Missing harness");
  const select = (tool: typeof read) => ({ id: tool.definition.id, key: tool.definition.key, version: tool.definition.version });
  for (const [subject, peer] of peers) {
    const expected = subject === "observer" ? [] : subject.startsWith("senior") ? ["coding.read", "coding.summary", "coding.terminal", "coding.write"] : ["coding.read", "coding.summary"];
    expect((await peer.assigned()).tools.map((tool) => tool.contract.key), subject).toEqual(expected);
    expect(peer.actual.context.actor, subject).toEqual(f.actors[subject]?.actor);
    const native = (await peer.client.client.subscribe(channel)).result.snapshot?.state as SessionState;
    expect(JSON.stringify(native), subject + " native snapshot contains no private descriptor").not.toMatch(/P12-SCHEMA|P12-DESCRIPTOR/);
    const events = peer.client.client.events(), next = events.next();
    const title = "P12-NATIVE-" + subject;
    const envelope = f.host.sessions.dispatchAction({ channel, clientId: "host", clientSeq: 1, action: { type: "session/titleChanged", title } });
    const delivered = await next;
    await events.return?.();
    expect(delivered.done).toBe(false);
    const actionFrame = peer.received.find((frame) => typeof frame === "object" && frame !== null && "method" in frame && frame.method === "action" && JSON.stringify(frame).includes(JSON.stringify(title)));
    if (typeof actionFrame !== "object" || actionFrame === null || !("params" in actionFrame)) throw new Error("Missing SDK action");
    const params = actionFrame.params as { action: SessionAction; serverSeq: number };
    expect(params.serverSeq).toBe(envelope.serverSeq);
    expect(sessionReducer(native, params.action)).toEqual((await peer.client.client.subscribe(channel)).result.snapshot?.state);
  }
  for (const subject of ["junior", "junior-agent", "pm", "pm-agent"]) {
    const peer = peers.get(subject);
    if (peer === undefined) throw new Error("Missing peer");
    for (const tool of [read, summary]) await expect(peer.client.callTool(channel, select(tool), { path: subject })).resolves.toEqual({ value: "P12-HANDLER-RESULT:" + tool.definition.key + ":" + subject + ":7" });
    for (const tool of [write, terminal]) {
      expect(await peer.client.dispatchTool(channel, select(tool), { path: "P12-RESTRICTED-" + subject })).toMatchObject({ status: "denied" });
      const view = await peer.assigned();
      await expect(peer.advertise(view.viewRevision, [select(tool)])).rejects.toThrow();
    }
    await expect(peer.client.joinSession(channel, [read])).rejects.toThrow("does not match");
    expect(JSON.stringify(peer.received), subject + " hidden schema").not.toMatch(/P12-SCHEMA-write|P12-SCHEMA-terminal|P12-DESCRIPTOR-write|P12-DESCRIPTOR-terminal/);
    expect(JSON.stringify(peer.received), subject + " positive descriptor control").toContain("P12-DESCRIPTOR-read");
  }
  expect(write.execute).not.toHaveBeenCalled();
  expect(terminal.execute).not.toHaveBeenCalled();
  const senior = peers.get("senior");
  if (senior === undefined) throw new Error("Missing senior");
  await expect(senior.client.callTool(channel, select(write), { path: "senior-control" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.write:senior-control:7" });
  const receipt = await senior.client.dispatchTool(channel, select(read), { path: "P12-SENIOR-PRIVATE-RESULT" });
  if (receipt.status !== "accepted") throw new Error("Missing private call");
  await vi.waitFor(async () => {
    expect(await senior.client.statusTool(receipt.callId)).toMatchObject({ status: "completed", output: { value: "P12-HANDLER-RESULT:coding.read:P12-SENIOR-PRIVATE-RESULT:7" } });
  });
  for (const [subject, peer] of peers) if (!subject.startsWith("senior")) {
    expect(await peer.client.statusTool(receipt.callId), subject).toEqual({ version: 2, status: "unavailable" });
    await peer.client.client.ping();
    expect(JSON.stringify(peer.received), subject).not.toContain("P12-SENIOR-PRIVATE-RESULT");
  }
  const juniorAgent = peers.get("junior-agent");
  if (juniorAgent === undefined) throw new Error("Missing delegated agent");
  const scope = f.host.sessions.authorization?.getResource(channel);
  if (scope === undefined) throw new Error("Missing scope");
  const binding = f.registry.readBindings({ actor: juniorAgent.actual.context.actor, scope }).bindings.find((entry) => entry.id === "fixture-grant-junior-agent");
  expect(binding?.authority).toEqual({ kind: "delegation", issuer: f.actors.junior?.actor, parentGrantId: "fixture-grant-junior" });
  expect(f.registry.removeBinding({ bindingId: "fixture-grant-junior", scope, revision: 1 })).toBe(true);

  await expect(juniorAgent.client.callTool(channel, select(read), { path: "P12-REVOKED-CHILD" })).rejects.toThrow();

  await expect(juniorAgent.client.client.subscribe(channel)).rejects.toThrow();

  await juniorAgent.closed;

  await executor.client.client.ping();

  expect(JSON.stringify(executor.received)).not.toContain("P12-REVOKED-CHILD");

  expect(await senior.client.dispatchTool(channel, select(summary), { path: "P12-INVALIDATED-ADVERTISEMENT" })).toMatchObject({ status: "denied" });
  await executor.client.joinSession(channel, harness);
  await expect(senior.client.callTool(channel, select(summary), { path: "independent-parent" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.summary:independent-parent:7" });
});

it.each(["self", "cross"] as const)("X05/X06 %s route rejects altered trusted routes and absent provider proof with otherwise valid grants", async (mode) => {
  let substitute: ((route: ClientToolRoute) => ClientToolRoute) = (route) => route;
  const f = await createPolicyIntegrationFixture({ mode, host: { resolve: ({ origin }) => substitute(f.route(origin)) } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "route-control" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:route-control:7" });
  const cases: ReadonlyArray<readonly [string, (route: ClientToolRoute) => ClientToolRoute]> = [
    ["missing-provider-proof", ({ route }) => ({ route })],
    ["expired-provider-proof", (value) => ({ ...value, externalProofs: [{ resource: f.workspace, revision: "expired", validUntil: 1 }] })],
    ["wrong-provider-incarnation", (value) => ({ ...value, externalProofs: [{ resource: { ...f.workspace, instanceId: "retired-workspace" }, revision: "wrong", validUntil: Date.now() + 60_000 }] })],
    ["omit-chat", (value) => ({ ...value, route: { ...value.route, targets: [f.workspace] } })],
    ["omit-workspace", (value) => ({ ...value, route: { ...value.route, targets: [f.chat] } })],
    ["substitute-origin", (value) => ({ ...value, route: { ...value.route, origin: { ...value.route.origin, id: "ahp-session:/other" } } })],
    ["retired-origin", (value) => ({ ...value, route: { ...value.route, origin: { ...value.route.origin, instanceId: "retired-origin" } } })],
    ["retired-chat", (value) => ({ ...value, route: { ...value.route, targets: [{ ...f.chat, instanceId: "retired-chat" }, f.workspace] } })],
    ["substitute-workspace", (value) => ({ ...value, route: { ...value.route, targets: [f.chat, { ...f.workspace, id: "workspace:/other" }] } })],
  ];
  for (const [label, mutation] of cases) {
    substitute = mutation;
    const input = { path: "P12-ROUTE-DENIED-" + label };
    expect(await caller.client.dispatchTool(channel, selector, input), label).toMatchObject({ status: "denied" });
    await executor.client.client.ping();
    expect(chosen.execute, label).toHaveBeenCalledOnce();
    expect(JSON.stringify(executor.received), label).not.toContain(input.path);
  }
  substitute = (route) => route;
  await expect(caller.client.callTool(channel, selector, { path: "route-restored" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:route-restored:7" });
  expect(chosen.execute).toHaveBeenCalledTimes(2);
  await observer.client.client.ping();
  expect(JSON.stringify(observer.received)).not.toMatch(/P12-ROUTE-DENIED|P12-HANDLER-RESULT|P12-SCHEMA|P12-DESCRIPTOR/);
  for (const competing of harness.slice(1)) expect(competing.execute).not.toHaveBeenCalled();
});

it.each(["self", "cross"] as const)("X05/X06 %s route executes the approved harness with actual identity, source and full mandatory route", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor, "claimed-display-executor", true);
  const caller = mode === "self" ? executor : await f.connect(f.caller, "claimed-display-caller");
  const observer = await f.connect("observer", "claimed-display-senior");
  const harness = createCodingHarness();
  const chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing selected handler");
  await executor.client.joinSession(channel, [chosen]);
  const callerHarness = createCodingHarness();
  if (mode === "cross") {
    const competing = callerHarness[0];
    if (competing === undefined) throw new Error("Missing competing handler");
    await expect(caller.client.joinSession(channel, [competing])).rejects.toThrow("does not match");
  }
  expect(await observer.assigned()).toMatchObject({ tools: [] });
  const view = await caller.assigned();
  expect(view.tools.some((tool) => tool.contract.id === chosen.definition.id)).toBe(true);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  const input = { path: "P12-PRIVATE-INPUT" };
  await expect(caller.client.callTool(channel, selector, input)).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:P12-PRIVATE-INPUT:7" });
  expect(chosen.execute).toHaveBeenCalledOnce();
  for (const competing of harness.slice(1)) expect(competing.execute).not.toHaveBeenCalled();
  for (const competing of callerHarness) expect(competing.execute).not.toHaveBeenCalled();
  const raw = executor.received.find((frame) => typeof frame === "object" && frame !== null && "method" in frame && frame.method === "x-ahp/tools/invoke");
  if (typeof raw !== "object" || raw === null || !("params" in raw)) throw new Error("No actual executor frame");
  const invoke = parseToolWire(toolInvokeSchema, raw.params);
  expect(invoke.contract).toEqual(selector);
  expect(invoke.connection).toEqual({ id: executor.actual.context.connectionId, generation: executor.actual.fence.connectionGeneration });
  expect(invoke.route).toEqual(f.route(f.host.sessions.authorization?.getResource(channel) ?? invoke.route.origin).route);
  expect(invoke.execution).toEqual({ binding: f.registrations[0]?.implementation, registrationRevision: 5, source: f.registrations[0]?.source });
  expect(invoke.execution.source.id).toContain(f.sourceEvidence.candidate);
  expect(f.sourceEvidence).toMatchObject({ path: "src/tests/toolExecution/fixtures.ts", export: "createCodingHarness", revision: 7 });
  expect(executor.actual.context.actor).toEqual(f.actors[f.executor]?.actor);
  expect(caller.actual.context.actor).toEqual(f.actors[f.caller]?.actor);
  expect(caller.actual.context).toMatchObject({ agentGeneration: 2, delegationRef: "verified-delegation-" + f.caller });
  expect(mode === "self" ? caller.actual.context.connectionId === executor.actual.context.connectionId : caller.actual.context.connectionId !== executor.actual.context.connectionId).toBe(true);
  await observer.client.client.ping();
  for (const canary of ["P12-DESCRIPTOR", "P12-SCHEMA", "P12-PRIVATE-INPUT", "P12-HANDLER-RESULT", f.sourceEvidence.candidate]) expect(JSON.stringify(observer.received)).not.toContain(canary);
});

it.each(["self", "cross"] as const)("X05/X06 %s route denies forged authority, contract/source/location and route selectors without local effects", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const contract = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  const input = { path: "P12-DENIED-INPUT" };
  const base = { version: 2, channel, contract, input };
  const variants: ReadonlyArray<readonly [string, unknown]> = [
    ["caller actor", { ...base, actor: executor.actual.context.actor }],
    ["role", { ...base, roles: ["admin"] }], ["owner", { ...base, owner: "creator" }],
    ["grant", { ...base, grants: ["fixture-grant-senior"] }], ["provider", { ...base, providerId: "mock" }],
    ["executor", { ...base, executor: executor.actual.context }],
    ["contract id", { ...base, contract: { ...contract, id: "99999999-9999-4999-8999-999999999999" } }],
    ["contract version", { ...base, contract: { ...contract, version: 4 } }],
    ["schema", { ...base, contract: { ...contract, inputSchema: { type: "object" } } }],
    ["implementation", { ...base, implementation: { ...f.registrations[0]?.implementation, implementationId: "substitute" } }],
    ["registration revision", { ...base, registrationRevision: 999 }],
    ["source", { ...base, source: { id: "attacker-source", revision: 7 } }],
    ["source revision", { ...base, source: { ...f.registrations[0]?.source, revision: 999 } }],
    ["execution location", { ...base, execution: { location: "server", suppliedBy: "server", implementation: "host" } }],
    ["origin incarnation", { ...base, route: { origin: { ...f.route(f.host.sessions.authorization?.getResource(channel) ?? f.chat).route.origin, instanceId: "old" }, targets: [f.workspace] } }],
    ["target omission", { ...base, route: { origin: f.chat, targets: [] } }],
    ["unsubscribed origin", { ...base, channel: "ahp-session:/parent-forgery" }],
    ["invalid input", { ...base, input: { path: 42 } }],
  ];
  for (const [label, params] of variants) {
    const reply = await caller.request("x-ahp/tools/dispatch", params);
    expect(JSON.stringify(reply), label).not.toContain("\"status\":\"accepted\"");
    expect(JSON.stringify(reply), label).toMatch(/"error"|"status":"denied"/);
  }
  const legacy = await caller.request("x-ahp/tools/call", { channel, key: contract.key, version: contract.version, input });
  expect(legacy).toMatchObject({ error: { message: "Tool protocol extension required" } });
  await executor.client.client.ping();
  await observer.client.client.ping();
  for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
  for (const peer of [executor, observer]) expect(JSON.stringify(peer.received)).not.toContain("P12-DENIED-INPUT");
  await expect(caller.client.callTool(channel, contract, { path: "P12-POSITIVE-AFTER-DENIAL" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:P12-POSITIVE-AFTER-DENIAL:7" });
  expect(chosen.execute).toHaveBeenCalledOnce();
});

it.each(["self", "cross"] as const)("X05/X06 %s route independently requires caller invoke and executor receive grants", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const contract = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  const tuple = executor.actual.tuples.find((tuple) => tuple.contract.id === contract.id);
  if (tuple === undefined) throw new Error("Missing real executor assignment");
  expect(f.registry.removeExecutorAssignment(tuple)).toBe(true);
  expect(await caller.client.dispatchTool(channel, contract, { path: "P12-NO-EXECUTOR" })).toMatchObject({ status: "denied" });
  await executor.client.client.ping();
  expect(chosen.execute).not.toHaveBeenCalled();
  f.registry.installExecutorAssignment(tuple);
  await executor.client.joinSession(channel, [chosen]);
  const scope = f.host.sessions.authorization?.getResource(channel);
  if (scope === undefined) throw new Error("Missing scope");
  const original = f.registry.readBindings({ actor: caller.actual.context.actor, scope }).bindings.find((binding) => binding.id === "fixture-grant-" + f.caller);
  if (original === undefined) throw new Error("Missing actual caller grant");
  f.registry.removeBinding({ bindingId: original.id, scope, revision: original.revision });
  f.registry.installBinding({ ...original, revision: original.revision + 1, roles: original.roles.filter((role) => role !== "invoke") });
  // Binding replacement is explicit removal/reinstall. Restore exact tuples so the
  // next denial distinguishes the missing invoke role from missing assignment rows.
  for (const registration of f.registrations) for (const operation of ["discover", "invoke", "advertise"] as const) {
    const definition = registration.definition;
    f.registry.installToolAssignment({ resource: scope, route: f.route(scope).route, recipient: original.actor,
      contract: { id: definition.id, key: definition.key, version: definition.version }, operation,
      bindingId: original.id, policyRef: f.policy });
  }
  for (const tuple of caller.actual.tuples) f.registry.installExecutorAssignment(tuple);
  expect(await caller.client.dispatchTool(channel, contract, { path: "P12-NO-CALLER" })).toMatchObject({ status: "denied" });
  await executor.client.client.ping();
  expect(chosen.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toContain("P12-NO-CALLER");
});

it.each(["self", "cross"] as const)("X05/X06 %s route obeys mandatory provider denial despite otherwise valid caller and executor grants", async (mode) => {
  let denied = false, evaluations = 0;
  const f = await createPolicyIntegrationFixture({ mode, providerVerdict: () => {
    evaluations += 1;
    return Promise.resolve(denied ? "deny" : "allow");
  } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "allowed" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:allowed:7" });
  const before = evaluations;
  denied = true;
  expect(await caller.client.dispatchTool(channel, selector, { path: "P12-PROVIDER-DENIED" })).toMatchObject({ status: "denied" });
  await executor.client.client.ping();
  expect(evaluations).toBeGreaterThan(before);
  expect(chosen.execute).toHaveBeenCalledOnce();
  expect(JSON.stringify(executor.received)).not.toContain("P12-PROVIDER-DENIED");
  denied = false;
  await expect(caller.client.callTool(channel, selector, { path: "restored" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:restored:7" });
  expect(chosen.execute).toHaveBeenCalledTimes(2);
  for (const competing of harness.slice(1)) expect(competing.execute).not.toHaveBeenCalled();
});

it.each(["self", "cross"] as const)("X05/X06 %s route denies an unsatisfied required challenge before any assigned tool view", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode, challengeRequired: true });
  fixtures.push(f);
  // With no implemented challenge continuation (P13), the required challenge must
  // deny the protected view itself: no assigned inventory, no private metadata.
  const outcomes = await Promise.all([...new Set([f.executor, f.caller, "observer"])].map(async (subject) => [
    subject, await f.connect(subject).then(() => "connected", (error: unknown): string => error instanceof Error ? error.message : String(error))] as const));
  for (const [subject, outcome] of outcomes) {
    expect(outcome, subject + " denied").toContain("Protected view unavailable");
    expect(outcome, subject + " no hidden canary").not.toMatch(/P12-DESCRIPTOR|P12-SCHEMA|P12-HANDLER-RESULT/);
  }
  for (const capture of f.captures) expect(JSON.stringify(capture.received)).not.toMatch(/P12-DESCRIPTOR|P12-SCHEMA|P12-HANDLER-RESULT/);
});

it.each(["self", "cross"] as const)("X05/X06 %s route reaches a required invoke challenge with a real independently authorized executor", async (mode) => {
  let invokeChecks = 0;
  const f = await createPolicyIntegrationFixture({ mode, host: { invokeChallenge: true }, providerBarrier: {
    armed: { value: true }, reached: () => {
      invokeChecks += 1;
    }, decide: () => Promise.resolve("allow"),
  } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller), observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing handler");
  await executor.client.joinSession(channel, [chosen]);
  const selected = (await executor.assigned()).tools.find((tool) => tool.contract.id === chosen.definition.id);
  expect(selected?.purposes).toEqual(["discover", "advertise", "execute"]);
  expect(selected?.execution).toBeDefined();
  const callerView = await caller.assigned();
  expect(callerView.tools.find((tool) => tool.contract.id === chosen.definition.id)?.purposes).not.toContain("invoke");
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  const before = invokeChecks;
  expect(await caller.client.dispatchTool(channel, selector, { path: "P12-UNSATISFIED-CHALLENGE" })).toMatchObject({ status: "denied" });
  expect(invokeChecks).toBeGreaterThan(before);
  await executor.client.client.ping();
  await observer.client.client.ping();
  for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).toContain("P12-DESCRIPTOR-read");
  expect(JSON.stringify(executor.received)).not.toContain("P12-UNSATISFIED-CHALLENGE");
  expect(JSON.stringify(observer.received)).not.toMatch(/P12-DESCRIPTOR|P12-SCHEMA|P12-UNSATISFIED-CHALLENGE/);
});

it.each(["self", "cross"] as const)("X05/X06 %s route denies when the caller loses the mandatory chat constraint binding", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "P12-MANDATORY-BASE" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:P12-MANDATORY-BASE:7" });
  const chatBindingId = "p12-" + f.chatPolicy.id + "-" + f.caller;
  expect(f.registry.removeBinding({ bindingId: chatBindingId, scope: f.chat, revision: 1 })).toBe(true);
  // Revocation fails the revoked peer's connection closed (its protected views
  // re-validate against the mandatory chat constraint). The public deny is then
  // either an in-band "denied" reply or the fail-closed transport; the tool must
  // never run again either way.
  const outcome = await caller.client.dispatchTool(channel, selector, { path: "P12-NO-MANDATORY" }).then(
    (reply) => ["settled", reply.status] as const,
    (error: unknown) => ["rejected", String(error)] as const);
  if (outcome[0] === "settled") expect(outcome[1], "mandatory denial").toBe("denied");
  else expect(outcome[1], "fail-closed revocation").toMatch(/closed|unavailable|denied/);
  // The revoked peer cannot issue further traffic: its connection fails closed.
  await caller.actual.released;
  await expect(caller.client.client.ping()).rejects.toThrow();
  if (mode === "cross") await executor.client.client.ping();
  expect(chosen.execute).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(executor.received)).not.toContain("P12-NO-MANDATORY");
});

it.each(["self", "cross"] as const)("X05/X06 %s route revocation during an awaited decision denies without executing the quarantined call", { timeout: 15000 }, async (mode) => {
  const decisions: Array<(value: "allow" | "deny") => void> = [];
  const reachedAt = Promise.withResolvers<number>();
  const armed = { value: false };
  const f = await createPolicyIntegrationFixture({ mode, providerBarrier: {
    armed, reached: () => {
      reachedAt.resolve(1);
    },
    decide: () => new Promise<"allow" | "deny">((resolve) => {
      decisions.push(resolve);
    }),
  } });
  fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  // Arming is a test-controlled gate: every pre-armed verdict releases "allow".
  await expect(caller.client.callTool(channel, selector, { path: "P12-BEFORE" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:P12-BEFORE:7" });
  const scope = f.host.sessions.authorization?.getResource(channel);
  if (scope === undefined) throw new Error("Missing scope");
  armed.value = true;
  const parked = caller.client.dispatchTool(channel, selector, { path: "P12-PARKED" }).then(
    (reply) => ["settled", reply.status] as const,
    (error: unknown) => ["rejected", String(error)] as const);
  try {
    await reachedAt.promise;
    expect(decisions.length).toBeGreaterThan(0);
    const original = f.registry.readBindings({ actor: caller.actual.context.actor, scope }).bindings.find((binding) => binding.id === "fixture-grant-" + f.caller);
    if (original === undefined) throw new Error("Missing actual caller grant");
    f.registry.removeBinding({ bindingId: original.id, scope, revision: original.revision });
    armed.value = false;
    for (const verdict of decisions.splice(0)) verdict("allow");
    // The quarantined call stays at zero effects even against a released "allow":
    // the revalidation denies (in-band or by the revoked peer's fail-closed
    // transport), and the executor never observes the parked input.
    const outcome = await parked;
    if (outcome[0] === "settled") expect(outcome[1], "quarantined denial").toBe("denied");
    else expect(outcome[1], "quarantine keeps the call un-delivered").toMatch(/closed|unavailable|denied/);
    if (mode === "cross") await executor.client.client.ping();
    expect(chosen.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(executor.received)).not.toContain("P12-PARKED");
  } finally {
    armed.value = false;
    for (const verdict of decisions.splice(0)) verdict("allow");
    await parked;
  }
});

it.each(["self", "cross"] as const)("X05/X06 %s route rejects missing and invalid credentials before initialized tool authority", { timeout: 15000 }, async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode });
  fixtures.push(f);
  const executor = await f.connect(f.executor), harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  for (const credential of [undefined, "r5-invalid"]) {
    // The transport attaches unauthenticated sockets as open but unprivileged
    // connections. Denials are authoritative per frame, never a host close.
    const socket = credential === undefined ? new WebSocket(f.url) : new WebSocket(f.url, credential);
    const frames = new FrameLog(socket);
    socket.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientId: "senior-agent", protocolVersions: ["1.0.0"], initialSubscriptions: [channel] } }));
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "x-ahp/tools/dispatch", params: { version: 2, channel,
      contract: { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version }, input: { path: "P12-UNAUTHENTICATED" } } }));
    try {
      for (const [label, id] of [["initialize", 1], ["dispatch", 2]] as const) {
        const reply = await frames.waitFor(responseWithId(id), 2000);
        expect(reply, label + " denied").toHaveProperty("error.code");
        if (typeof reply !== "object" || reply === null || !("error" in reply) || typeof reply.error !== "object"
          || reply.error === null || !("code" in reply.error)) throw new Error("Missing public RPC error");
        expect(typeof reply.error.code).toBe("number");
        expect(JSON.stringify(reply), label + " authority absent").not.toContain("\"result\"");
      }
      expect(JSON.stringify(frames.frames), "no authorized canary").not.toMatch(/P12-DESCRIPTOR|P12-SCHEMA|P12-HANDLER-RESULT/);
    } finally {
      socket.close();
    }
  }
  await executor.client.client.ping();
  for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toContain("P12-UNAUTHENTICATED");
});

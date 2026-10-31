import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { createPolicyIntegrationFixture, createCodingHarness, channel } from "./policyIntegrationFixture";
import { parseToolWire, toolInvokeSchema } from "@toolExecution/helpers/client/helpers/protocol";

const fixtures: Array<Awaited<ReturnType<typeof createPolicyIntegrationFixture>>> = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop())); });

it.each(["self", "cross"] as const)("X05/X06 %s route executes the approved harness with actual identity, source and full mandatory route", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode }); fixtures.push(f);
  const executor = await f.connect(f.executor, "claimed-display-executor", true);
  const caller = mode === "self" ? executor : await f.connect(f.caller, "claimed-display-caller");
  const observer = await f.connect("observer", "claimed-display-senior");
  const harness = createCodingHarness();
  const chosen = harness[0]; if (chosen === undefined) throw new Error("Missing selected handler");
  await executor.client.joinSession(channel, [chosen]);
  const callerHarness = createCodingHarness();
  if (mode === "cross") {
    const competing = callerHarness[0]; if (competing === undefined) throw new Error("Missing competing handler");
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
  const f = await createPolicyIntegrationFixture({ mode }); fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const observer = await f.connect("observer");
  const harness = createCodingHarness(), chosen = harness[0]; if (chosen === undefined) throw new Error("Missing tool");
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
    expect(JSON.stringify(reply), label).not.toContain('"status":"accepted"');
    expect(JSON.stringify(reply), label).toMatch(/"error"|"status":"denied"/);
  }
  const legacy = await caller.request("x-ahp/tools/call", { channel, key: contract.key, version: contract.version, input });
  expect(legacy).toMatchObject({ error: { message: "Tool protocol extension required" } });
  await executor.client.client.ping(); await observer.client.client.ping();
  for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
  for (const peer of [executor, observer]) expect(JSON.stringify(peer.received)).not.toContain("P12-DENIED-INPUT");
  await expect(caller.client.callTool(channel, contract, { path: "P12-POSITIVE-AFTER-DENIAL" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:P12-POSITIVE-AFTER-DENIAL:7" });
  expect(chosen.execute).toHaveBeenCalledOnce();
});

it.each(["self", "cross"] as const)("X05/X06 %s route independently requires caller invoke and executor receive grants", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode }); fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0]; if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const contract = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  const tuple = executor.actual.tuples.find((tuple) => tuple.contract.id === contract.id);
  if (tuple === undefined) throw new Error("Missing real executor assignment");
  expect(f.registry.removeExecutorAssignment(tuple)).toBe(true);
  expect(await caller.client.dispatchTool(channel, contract, { path: "P12-NO-EXECUTOR" })).toMatchObject({ status: "denied" });
  await executor.client.client.ping(); expect(chosen.execute).not.toHaveBeenCalled();
  f.registry.installExecutorAssignment(tuple);
  await executor.client.joinSession(channel, [chosen]);
  const scope = f.host.sessions.authorization?.getResource(channel); if (scope === undefined) throw new Error("Missing scope");
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
  await executor.client.client.ping(); expect(chosen.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toContain("P12-NO-CALLER");
});

it.each(["self", "cross"] as const)("X05/X06 %s route obeys mandatory provider denial despite otherwise valid caller and executor grants", async (mode) => {
  let denied = false, evaluations = 0;
  const f = await createPolicyIntegrationFixture({ mode, providerVerdict: () => { evaluations += 1; return Promise.resolve(denied ? "deny" : "allow"); } }); fixtures.push(f);
  const executor = await f.connect(f.executor), caller = mode === "self" ? executor : await f.connect(f.caller);
  const harness = createCodingHarness(), chosen = harness[0]; if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  const selector = { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version };
  await expect(caller.client.callTool(channel, selector, { path: "allowed" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:allowed:7" });
  const before = evaluations;
  denied = true;
  expect(await caller.client.dispatchTool(channel, selector, { path: "P12-PROVIDER-DENIED" })).toMatchObject({ status: "denied" });
  await executor.client.client.ping();
  expect(evaluations).toBeGreaterThan(before); expect(chosen.execute).toHaveBeenCalledOnce();
  expect(JSON.stringify(executor.received)).not.toContain("P12-PROVIDER-DENIED");
  denied = false;
  await expect(caller.client.callTool(channel, selector, { path: "restored" })).resolves.toEqual({ value: "P12-HANDLER-RESULT:coding.read:restored:7" });
  expect(chosen.execute).toHaveBeenCalledTimes(2);
  for (const competing of harness.slice(1)) expect(competing.execute).not.toHaveBeenCalled();
});

it.each(["self", "cross"] as const)("X05/X06 %s route rejects missing and invalid credentials before initialized tool authority", async (mode) => {
  const f = await createPolicyIntegrationFixture({ mode }); fixtures.push(f);
  const executor = await f.connect(f.executor), harness = createCodingHarness(), chosen = harness[0];
  if (chosen === undefined) throw new Error("Missing tool");
  await executor.client.joinSession(channel, [chosen]);
  for (const credential of [undefined, "r5-invalid"]) {
    const socket = credential === undefined ? new WebSocket(f.url) : new WebSocket(f.url, credential);
    const frames: string[] = [];
    socket.on("message", (data) => frames.push(data.toString()));
    socket.on("error", () => undefined);
    const closed = new Promise<number>((resolve) => { socket.once("close", resolve); });
    socket.once("open", () => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientId: "senior-agent", protocolVersions: ["1.0.0"], initialSubscriptions: [channel] } }));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "x-ahp/tools/dispatch", params: { version: 2, channel,
        contract: { id: chosen.definition.id, key: chosen.definition.key, version: chosen.definition.version }, input: { path: "P12-UNAUTHENTICATED" } } }));
    });
    try {
      expect(await closed).not.toBe(1000);
      expect(frames.join("")).not.toMatch(/P12-DESCRIPTOR|P12-SCHEMA|P12-HANDLER-RESULT/);
    } finally { socket.terminate(); }
  }
  await executor.client.client.ping();
  for (const tool of harness) expect(tool.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(executor.received)).not.toContain("P12-UNAUTHENTICATED");
});

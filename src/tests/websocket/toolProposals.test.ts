import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { sessionReducer, type SessionAction, type SessionState } from "@microsoft/agent-host-protocol";
import { connectToolClient, type ToolClient } from "@tool/client";
import { createApprovedArtifactSource } from "@tool/execution";
import type { ToolAssignmentRecord } from "@authorization/helpers/evaluate";
import { TOOL_SCHEMA_DIALECT, type ToolContractDefinition } from "@tool";
import { createActionSequence } from "@sessions";
import { connectPolicyTransport, createToolPolicyHost, toolPolicyChannel as channel } from "./toolPolicyFixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const definition = { id: "d504eb1a-86a1-4887-8ad6-19d1c42b79bc", key: "proposal.echo", version: 1, name: "proposal_echo",
  schemaDialect: TOOL_SCHEMA_DIALECT, inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } } satisfies ToolContractDefinition;
const roles = { proposer: ["discover", "propose", "approve"], approver: ["discover", "approve"], publisher: ["discover", "publish"],
  activator: ["discover", "activate"], executor: ["discover", "invoke", "advertise", "execute"] };

async function fixture(allowSelfApproval = false, options: Pick<NonNullable<Parameters<typeof createToolPolicyHost>[1]>, "sequence" | "resolve" | "artifacts"> = {}) {
  const f = await createToolPolicyHost([], { roles, toolDiscovery: Object.keys(roles), protectedViews: true, management: { allowSelfApproval }, ...options });
  const { port } = await f.host.start();
  cleanups.push(() => f.host.stop());
  const connect = async (subject: keyof typeof roles): Promise<ToolClient> => {
    const transport = await connectPolicyTransport(`ws://127.0.0.1:${String(port)}/capacity`, subject);
    const client = await connectToolClient({ transport, ownership: "owned" }, { clientId: subject, protocolVersions: ["1.0.0"] });
    cleanups.push(() => client.shutdown());
    await client.connection.protocol.subscribe(channel);
    return client;
  };
  const context = (subject: keyof typeof roles) => {
    const record = [...f.contexts.values()].find((entry) => entry.context.actor.principal.subject === subject);
    if (record === undefined) throw new Error("Missing authenticated fixture actor.");
    return record;
  };
  return { ...f, connect, context };
}

function assignExecutor(f: Awaited<ReturnType<typeof fixture>>, contract: ToolAssignmentRecord["contract"], implementation: NonNullable<ToolAssignmentRecord["implementation"]>, registrationRevision = 1): void {
  const origin = f.host.sessions.authorization?.getResource(channel);
  if (origin === undefined) throw new Error("Missing assignment scope.");
  const actual = f.context("executor");
  const tuple = { resource: origin, route: { origin, targets: [origin] }, recipient: actual.context.actor, contract,
    bindingId: "fixture-grant-executor", policyRef: f.policy };
  for (const operation of ["discover", "invoke", "advertise"] as const) f.registry.installToolAssignment({ ...tuple, operation });
  f.registry.installExecutorAssignment({ ...tuple, operation: "execute", implementation,
    executor: { actor: actual.context.actor, connectionId: actual.context.connectionId, generation: actual.fence.connectionGeneration, registrationRevision } });
}

it("Q01/Q03/Q04 publishes an exact proposal, activates the current instance, and requires separate executor authority", async () => {
  const sequence = createActionSequence();
  let onAllocate: (() => void) | undefined;
  const f = await fixture(false, { sequence: { current: () => sequence.current(), next: () => {
    onAllocate?.();
    return sequence.next();
  } } });
  const [proposer, approver, publisher, activator, executor] = await Promise.all((Object.keys(roles) as (keyof typeof roles)[]).map(f.connect));
  if (proposer === undefined || approver === undefined || publisher === undefined || activator === undefined || executor === undefined) throw new Error("Missing clients.");
  const { host } = f;
  const origin = host.sessions.authorization?.getResource(channel);
  const tools = host.sessions.managedTools;
  if (origin === undefined || tools === undefined) throw new Error("Missing tool management.");
  const before = host.sessions.getSessionSnapshot(channel);
  const proposal = await proposer.proposeTool(channel, definition);
  if (proposal.status !== "proposed") throw new Error("Proposal was not accepted.");
  expect(await executor.dispatchTool(channel, definitionSelector(), {})).toMatchObject({ status: "denied" });
  expect(await proposer.approveTool(channel, proposal.proposalId, 1)).toEqual({ version: 1, status: "unavailable" });
  expect(await publisher.approveTool(channel, proposal.proposalId, 1)).toEqual({ version: 1, status: "unavailable" });
  const approvals = await Promise.all([approver.approveTool(channel, proposal.proposalId, 1), approver.approveTool(channel, proposal.proposalId, 1)]);
  expect(approvals.map(({ status }) => status).sort()).toEqual(["approved", "unavailable"]);
  expect(await approver.publishTool(channel, proposal.proposalId, 2)).toEqual({ version: 1, status: "unavailable" });
  expect(await publisher.publishTool(channel, proposal.proposalId, 2)).toMatchObject({ status: "published", revision: 3 });
  expect(host.sessions.getSessionSnapshot(channel)).toEqual(before);
  expect(host.sessions.getSessionToolManifest(channel)?.toolContracts).toEqual([]);
  const request = { origin, expectedRevision: 0, proposalId: proposal.proposalId, signal: new AbortController().signal, current: () => true, fence: () => true };
  expect(await tools.activate({ ...request, actor: f.context("publisher").context })).toBeUndefined();
  let current = true;
  onAllocate = () => {
    current = false;
    onAllocate = undefined;
  };
  expect(await tools.activate({ ...request, actor: f.context("activator").context, current: () => current, fence: () => current })).toBeUndefined();
  expect(host.sessions.getSessionSnapshot(channel)).toEqual(before);
  expect(tools.revision(origin)).toBe(0);
  const oldView = (await activator.connection.protocol.subscribe(channel)).result.snapshot?.state as SessionState;
  const events = activator.connection.protocol.events();
  const received = events.next();
  const enabled = await tools.activate({ ...request, actor: f.context("activator").context });
  if (enabled === undefined) throw new Error("Tool activation was not accepted.");
  const event = await received;
  await events.return?.();
  if (event.done || event.value.event.type !== "action") throw new Error("Missing metadata envelope.");
  expect(event.value.event.params.action).toEqual({ type: "session/metaChanged", _meta: {} });
  const snapshot = (await activator.connection.protocol.subscribe(channel)).result.snapshot;
  expect(snapshot?.state).toEqual(sessionReducer(oldView, event.value.event.params.action as SessionAction));
  expect(enabled.revision).toBe(1);
  expect(await tools.activate({ ...request, actor: f.context("activator").context })).toBeUndefined();
  expect(await executor.dispatchTool(channel, definitionSelector(), {})).toMatchObject({ status: "denied" });
  assignExecutor(f, definitionSelector(), { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: enabled.tool.source.id });
  const execute = vi.fn(() => ({ value: "approved proposal" }));
  await executor.joinSession(channel, [{ definition, execute }]);
  await expect(executor.callTool(channel, definitionSelector(), {})).resolves.toEqual({ value: "approved proposal" });
  expect(execute).toHaveBeenCalledOnce();
  await host.sessions.authorization?.disposeSession(origin);
  await f.recreate();
  expect(await tools.activate({ ...request, actor: f.context("activator").context })).toBeUndefined();
});

it("Q04 retires a parked invocation when activation replaces the manifest even if its definition is already registered", async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>();
  let armed = false;
  const f = await fixture(false, { resolve: async ({ origin, input }) => {
    if (armed && input !== null) {
      entered.resolve(undefined);
      await release.promise;
    }
    return { route: { origin, targets: [origin] } };
  } });
  const [proposer, approver, publisher, activator] = await Promise.all([f.connect("proposer"), f.connect("approver"), f.connect("publisher"), f.connect("activator")]);
  const origin = f.host.sessions.authorization?.getResource(channel), tools = f.host.sessions.managedTools;
  if (origin === undefined || tools === undefined) throw new Error("Missing tool management.");
  const nextDefinition = { ...definition, id: "e33f8bfc-cfc2-4b8d-be55-0d419d9ce7ba", version: 2 };
  const publish = async (candidate: ToolContractDefinition): Promise<string> => {
    const proposed = await proposer.proposeTool(channel, candidate);
    if (proposed.status !== "proposed") throw new Error("Missing proposal.");
    expect(await approver.approveTool(channel, proposed.proposalId, 1)).toMatchObject({ status: "approved" });
    expect(await publisher.publishTool(channel, proposed.proposalId, 2)).toMatchObject({ status: "published" });
    return proposed.proposalId;
  };
  const first = await publish(definition), second = await publish(nextDefinition);
  const activate = (proposalId: string, expectedRevision: number) => tools.activate({ origin, proposalId, expectedRevision,
    actor: f.context("activator").context, signal: new AbortController().signal, current: () => true, fence: () => true });
  expect(await activate(first, 0)).toMatchObject({ revision: 1 });
  const activated = await activate(second, 1);
  if (activated === undefined) throw new Error("Missing replacement.");
  await activator.shutdown();
  await f.connect("activator");
  const executor = await f.connect("executor");
  const contract = { id: nextDefinition.id, key: nextDefinition.key, version: nextDefinition.version };
  assignExecutor(f, contract, { location: "client", suppliedBy: "client", implementation: "client-owned", implementationId: activated.tool.source.id });
  const execute = vi.fn(() => ({ value: "replacement" }));
  await expect(executor.joinSession(channel, [{ definition: nextDefinition, execute }])).resolves.toBeUndefined();
  armed = true;
  const parked = executor.dispatchTool(channel, contract, {}).catch(() => ({ status: "closed" }));
  try {
    await entered.promise;
    const registryFence = f.registry.captureFence();
    expect(await activate(first, 2)).toMatchObject({ revision: 3 });
    expect(registryFence()).toBe(true);
  } finally {
    release.resolve(undefined);
  }
  expect(await parked).toMatchObject({ status: "denied" });
  expect(execute).not.toHaveBeenCalled();
  expect(f.host.sessions.getSessionToolManifest(channel)?.toolContracts.map(({ version }) => version)).toEqual([1]);
});

it("Q04/F04 loads and executes an approved artifact bound to a published proposal after exact activation", async () => {
  const bytes = new TextEncoder().encode("approved proposal artifact fixture");
  const artifacts = createApprovedArtifactSource({ approve: () => true, read: () => bytes });
  const f = await fixture(false, { artifacts });
  const [proposer, approver, publisher, , executor] = await Promise.all((Object.keys(roles) as (keyof typeof roles)[]).map(f.connect));
  if (proposer === undefined || approver === undefined || publisher === undefined || executor === undefined) throw new Error("Missing clients.");
  const origin = f.host.sessions.authorization?.getResource(channel), tools = f.host.sessions.managedTools;
  if (origin === undefined || tools === undefined) throw new Error("Missing tool management.");
  const proposal = await proposer.proposeTool(channel, definition);
  if (proposal.status !== "proposed") throw new Error("Missing proposal.");
  expect(await approver.approveTool(channel, proposal.proposalId, 1)).toMatchObject({ status: "approved" });
  expect(await publisher.publishTool(channel, proposal.proposalId, 2)).toMatchObject({ status: "published" });
  const contract = definitionSelector();
  const descriptor = { artifactId: "published-proposal-artifact", publisherId: "approved-publisher", contractRevision: contract.version,
    implementationRevision: 3, runtime: "fixture", platform: "test", digest: createHash("sha256").update(bytes).digest("hex"), verificationRef: "approval" };
  artifacts.register({ contract, source: { id: proposal.proposalId, revision: 1 }, descriptor });
  await expect(executor.loadApprovedTool(channel, contract, { runtime: "fixture", platform: "test", verify: () => true, load: () => undefined })).rejects.toThrow();
  await executor.shutdown();
  const activated = await tools.activate({ origin, proposalId: proposal.proposalId, expectedRevision: 0, actor: f.context("activator").context,
    signal: new AbortController().signal, current: () => true, fence: () => true });
  expect(activated).toMatchObject({ revision: 1 });
  const assigned = await f.connect("executor");
  assignExecutor(f, contract, { location: "client", suppliedBy: "server", implementation: "approved-artifact", artifactRef: descriptor.artifactId }, 3);
  const execute = vi.fn(() => ({ value: "artifact for approved proposal" }));
  await assigned.loadApprovedTool(channel, contract, { runtime: "fixture", platform: "test", verify: () => true, load: () => ({ definition, execute }) });
  expect(await assigned.callTool(channel, contract, {})).toEqual({ value: "artifact for approved proposal" });
  expect(execute).toHaveBeenCalledOnce();
});

it("Q02/Q03 bounds proposal input and permits explicit self-approval without publication authority", async () => {
  const f = await fixture(true);
  const proposer = await f.connect("proposer");
  const oversized = { ...definition, description: "x".repeat(64 * 1024) };
  const unsupported = { ...definition, inputSchema: { ...definition.inputSchema, $ref: "https://example.invalid/definition" } };
  for (const candidate of [oversized, unsupported]) expect(await proposer.proposeTool(channel, candidate)).toEqual({ version: 1, status: "unavailable" });
  const proposed = await proposer.proposeTool(channel, definition);
  if (proposed.status !== "proposed") throw new Error("Missing proposal.");
  expect(await proposer.proposeTool(channel, { ...definition, id: "9920f651-c24e-4a69-bb8d-140f67da0ca8" })).toEqual({ version: 1, status: "unavailable" });
  expect(await proposer.approveTool(channel, proposed.proposalId, 1)).toMatchObject({ status: "approved" });
  expect(await proposer.publishTool(channel, proposed.proposalId, 2)).toEqual({ version: 1, status: "unavailable" });
});

function definitionSelector() {
  return { id: definition.id, key: definition.key, version: definition.version };
}

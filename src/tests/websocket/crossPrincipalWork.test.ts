import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { createMemoryDurableStorage, type DurableHost, type DurableStorage } from "@persistence";
import type { StoredWork } from "@persistence/helpers/durability/workTypes";
import { mockProvider } from "@sessions/mock";
import { connectToolClient, type ToolInvocationContext } from "@toolExecution/client";
import { actorFor, channel, clientTool, createReviewHost, demoProof, reviewWorkerKey, selector } from "../../../examples/advanced/host";
import { createExamplePersistence, createExampleRegistrationState } from "../../../examples/advanced/persistence";
import { openWorkClient } from "../../../examples/advanced/work";

it.each(["grant revocation", "disconnect", "provider write revocation"] as const)("enforces the mapped junior's exact work lease through %s", async (loss) => {
  const directory = createExampleRegistrationState();
  const rows = new Map<string, StoredWork>();
  const underlying = createMemoryDurableStorage(rows, directory.registrations);
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let park = false;
  let store: DurableHost | undefined;
  const storage: DurableStorage = { async acquire(...args) {
    const host = await underlying.acquire(...args);
    store = host;
    return { ...host, resources: { ...host.resources, async replaceData(...change) {
      if (park) {
        entered.resolve(undefined);
        await resume.promise;
      }
      return host.resources.replaceData(...change);
    } } };
  } };
  const persistence = { ...createExamplePersistence().provider, registrations: directory.repository, durability: storage, dispose: directory.dispose };
  const demo = createReviewHost("direct", { durability: { storage, hostId: "cross-principal" }, provider: mockProvider, persistence });
  const peers: { shutdown(): Promise<void> }[] = [];
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    const url = "ws://127.0.0.1:" + String(port);
    const inner = await WebSocketTransport.connect(url, { protocols: "demo-senior" });
    const incoming: string[] = [];
    const senior = await connectToolClient({ ownership: "owned", transport: { close: inner.close.bind(inner), send: inner.send.bind(inner), recv: async () => {
      const frame = await inner.recv();
      if (frame?.kind === "text") incoming.push(frame.text);
      return frame;
    } } }, { clientId: "senior-executor", protocolVersions: ["1.0.0"] });
    peers.push(senior);
    const junior = await openWorkClient(url, "junior", "registered-junior");
    peers.push(junior.client);
    await expect(junior.request("x-ahp/agents/register", { agentKey: "review-agent" })).rejects.toThrow();
    const registration = z.object({ agentId: z.uuid() }).parse(await junior.request("x-ahp/agents/register", { agentKey: reviewWorkerKey }));
    expect(directory.registrations.get(registration.agentId)?.agentKey).toBe(reviewWorkerKey);
    demo.allowTool("senior", clientTool, ["advertise"]);
    demo.allowClientExecutor("senior", clientTool);
    const execute = vi.fn((input: unknown, invocation: ToolInvocationContext) => {
      expect(input).toEqual({});
      expect(invocation.route.origin).toEqual(demo.origin());
      return { value: "review finished" };
    });
    await senior.joinSession(channel, [{ definition: clientTool, execute }]);
    await junior.request("x-ahp/tools/capabilities", { version: 2 });
    await junior.client.subscribe(channel);
    const service = demo.host.work;
    assert.ok(service);
    const subject = loss === "provider write revocation" ? "pm" : "senior";
    if (subject === "pm") peers.push((await openWorkClient(url, "pm", "work-submitter")).client);
    const { context } = demo.connection(subject);
    const { id } = await service.submit({ context, signal: new AbortController().signal, isCurrent: () => demo.connection(subject).context === context },
      { requestKey: "review", kind: "code.review", input: { subject: "senior review" }, targetAgentId: registration.agentId,
        scope: [{ resource: { kind: "session", id: channel }, include: true }] });
    const row = rows.get(id);
    assert.ok(row);
    expect(row.owner).toBe("senior");
    expect(row.submitter).toEqual(actorFor(subject));
    const binding = directory.registrations.get(registration.agentId);
    assert.ok(binding?.executionEpoch);
    const work = { workId: id, attempt: 1, leaseToken: randomUUID() };
    // P3 owns acquisition. Seed only the issued lease using the registration created by the real connection.
    rows.set(id, { ...row, status: "leased", revision: "2", attemptCount: 1, lease: { attempt: 1, registrationId: registration.agentId,
      executionEpoch: binding.executionEpoch, leaseToken: work.leaseToken, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    if (loss === "provider write revocation") {
      assert.ok(store);
      const target = demo.origin();
      const caller = demo.connection("junior").context;
      expect(caller.actor).toEqual(actorFor("junior"));
      const change = { expectedDataRevision: "1", data: { review: "in progress" } };
      expect(await demo.replaceReviewData(caller, { ...work, leaseToken: randomUUID() }, change)).toBe(false);
      demo.consent(false);
      expect(await demo.replaceReviewData(caller, work, change)).toBe(false);
      expect((await store.resources.get(target))?.dataRevision).toBe("1");
      demo.consent(true);
      expect(await demo.replaceReviewData(caller, work, change)).toBe(true);
      expect(await store.resources.get(target)).toMatchObject({ dataRevision: "2", data: change.data });
      park = true;
      const blocked = demo.replaceReviewData(caller, work, { expectedDataRevision: "2", data: { review: "stale write" } });
      await entered.promise;
      expect(demo.revokeJuniorWork()).toBe(true);
      resume.resolve(undefined);
      expect(await blocked).toBe(false);
      expect(await store.resources.get(target)).toMatchObject({ dataRevision: "2", data: change.data });
      return;
    }
    const dispatch = () => junior.request("x-ahp/tools/dispatch", { version: 2, channel, contract: selector(clientTool), input: {}, work });
    const challenge = z.object({ status: z.literal("challenge-required"), continuationId: z.string(), callId: z.string() });
    const first = challenge.parse(await dispatch());
    await expect(junior.request("x-ahp/tools/resume", { version: 2, continuationId: first.continuationId, proofRef: demoProof })).resolves.toMatchObject({ status: "accepted" });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(incoming.some((frame) => frame.includes("\"x-ahp/tools/invoke\""))).toBe(true);
    expect(incoming.join("")).not.toContain(work.leaseToken);
    expect(JSON.stringify(execute.mock.calls)).not.toContain(work.leaseToken);
    await vi.waitFor(async () => {
      expect(await junior.request("x-ahp/tools/status", { version: 2, callId: first.callId })).toMatchObject({ status: "completed" });
    });
    const next = challenge.parse(await dispatch());
    if (loss === "grant revocation") {
      expect(demo.revokeJuniorWork()).toBe(true);
      await senior.joinSession(channel, [{ definition: clientTool, execute }]);
      await expect(dispatch()).resolves.toMatchObject({ status: "denied" });
      expect(await junior.request("x-ahp/tools/dispatch", { version: 2, channel, contract: selector(clientTool), input: {} })).toMatchObject({ status: "challenge-required" });
    } else {
      await junior.client.shutdown();
      const reconnect = await openWorkClient(url, "junior", "registered-junior");
      peers.push(reconnect.client);
      await reconnect.request("x-ahp/tools/capabilities", { version: 2 });
      await reconnect.client.subscribe(channel);
      expect(await reconnect.request("x-ahp/tools/resume", { version: 2, continuationId: next.continuationId, proofRef: demoProof })).toMatchObject({ status: "denied" });
      expect(await reconnect.request("x-ahp/tools/dispatch", { version: 2, channel, contract: selector(clientTool), input: {}, work })).toMatchObject({ status: "denied" });
    }
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    resume.resolve(undefined);
    await Promise.allSettled(peers.map((peer) => peer.shutdown()));
    await demo.stop();
  }
});

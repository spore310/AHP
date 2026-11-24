import assert from "node:assert/strict";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { mockProvider } from "@sessions/mock";
import type { RuntimeResourceDriver } from "@sessions";
import { connectToolClient, type ToolClient } from "@tool/client";
import { channel, clientTool, createReviewHost, demoProof, reviewWorkerKey, selector } from "../../../examples/advanced/host";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { claimedLease, execution } from "../../../examples/advanced/work";

it("enforces the leased work scope on real private dispatch and keeps the token off the executor socket", async () => {
  const driver: RuntimeResourceDriver = {
    key: "dispatch-chat", kind: "chat", version: 1,
    registration: ({ resource }) => ({ route: { origin: resource, targets: [resource] }, externalAuthority: "none" }),
    captureRecoveryInput: () => ({}), ensure: () => Promise.resolve({ metadata: {}, release() {} }),
    restore: () => Promise.resolve({ metadata: {}, release() {} }), destroy: () => Promise.resolve(),
  };
  const { provider } = createExamplePersistence();
  assert.ok(provider.durability);
  const demo = createReviewHost("direct", { provider: { ...mockProvider, drivers: [driver] }, persistence: provider,
    durability: { storage: provider.durability, hostId: "tagged-dispatch" } });
  const clients: ToolClient[] = [], executorFrames: string[] = [];
  try {
    const { port } = await demo.host.start();
    await demo.provision();
    const child = await demo.createReviewChat("ahp-chat:/review/limited", driver);
    const connect = async (name: "senior" | "junior") => {
      const raw = await WebSocketTransport.connect("ws://127.0.0.1:" + String(port), { protocols: "demo-" + name });
      const transport = { send: raw.send.bind(raw), close: raw.close.bind(raw), async recv() {
        const frame = await raw.recv();
        if (name === "senior" && frame) executorFrames.push(frame.kind === "text"
          ? frame.text
          : frame.kind === "binary" ? new TextDecoder().decode(frame.data) : JSON.stringify(frame.message));
        return frame;
      } };
      const client = await connectToolClient({ transport, ownership: "owned" }, { clientId: name, protocolVersions: ["1.0.0"] });
      clients.push(client);
      return client;
    };
    const caller = await connect("junior"), executor = await connect("senior");
    demo.allowTool("senior", clientTool, ["advertise"]);
    demo.allowClientExecutor("senior", clientTool);
    const run = vi.fn(() => ({ value: "reviewed" }));
    await executor.joinSession(channel, [{ definition: clientTool, execute: run }]);
    await caller.connection.protocol.subscribe(channel);
    const rpc = caller.connection.rpc;
    const { agentId } = z.object({ agentId: z.uuid() }).parse(await rpc.request("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey }));
    const session = { kind: "session", id: channel } as const;
    const service = demo.host.work;
    assert.ok(service);
    const claim = async (resource: { kind: string; id: string }, key: string) => {
      const job = await service.submit({ context: demo.connection("senior").context, signal: new AbortController().signal, isCurrent: () => true },
        { kind: "code.review", requestKey: key, input: {}, scope: [{ resource, include: true }], targetAgentId: agentId });
      const { lease } = claimedLease.parse(await rpc.request("x-ahp/work/claim", { version: 1, session }));
      expect(lease.workId).toBe(job.id);
      return execution(lease);
    };
    const childLease = await claim({ kind: child.kind, id: child.id }, "child-only");
    expect(await caller.dispatchTool(channel, selector(clientTool), {}, { work: childLease })).toMatchObject({ status: "denied" });
    expect(run).not.toHaveBeenCalled();
    await rpc.request("x-ahp/work/complete", { version: 1, ...childLease, result: {} });
    const sessionLease = await claim(session, "whole-session");
    const receipt = await caller.dispatchTool(channel, selector(clientTool), {}, { work: sessionLease });
    assert.equal(receipt.status, "challenge-required");
    expect(await caller.resumeTool(receipt.continuationId, demoProof)).toMatchObject({ status: "accepted" });
    await vi.waitFor(async () => {
      expect(await caller.statusTool(receipt.callId)).toMatchObject({ status: "completed", output: { value: "reviewed" } });
    });
    expect(run).toHaveBeenCalledOnce();
    expect(executorFrames.some((frame) => frame.includes("x-ahp/tools/invoke"))).toBe(true);
    for (const lease of [childLease, sessionLease]) expect(executorFrames.join("")).not.toContain(lease.leaseToken);
  } finally {
    await Promise.all(clients.map((client) => client.shutdown()));
    await demo.stop();
  }
});

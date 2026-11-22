import assert from "node:assert/strict";
import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { ToolInvocationTransport } from "@toolExecution/client/transport";
import { z } from "zod";
import { channel, type Subject } from "./host";

async function openWorkClient(url: string, subject: Subject, label: string) {
  const transport = new ToolInvocationTransport(await WebSocketTransport.connect(url, { protocols: "demo-" + subject }));
  const client = new AhpClient(transport);
  client.connect();
  try {
    await client.initialize({ clientId: label, protocolVersions: ["1.0.0"], initialSubscriptions: [] });
    return { client, request: (method: string, params: Record<string, unknown>) => transport.request(method, { version: 1, ...params }) };
  } catch (error) {
    await client.shutdown();
    throw error;
  }
}

/** The owner and its registered worker use distinct connections and the same verified principal. */
export async function showWorkLease(url: string): Promise<void> {
  const cleanup: AhpClient[] = [];
  try {
    const owner = await openWorkClient(url, "senior", "review-owner");
    cleanup.push(owner.client);
    const worker = await openWorkClient(url, "senior", "review-worker");
    cleanup.push(worker.client);
    const other = await openWorkClient(url, "pm", "triage-observer");
    cleanup.push(other.client);
    const { agentId } = z.object({ agentId: z.uuid() }).parse(await worker.request("x-ahp/agents/register", { agentKey: "review-worker" }));
    const { workId } = z.object({ workId: z.uuid() }).parse(await owner.request("x-ahp/work/submit", {
      sessionUri: channel, requestKey: "first-review", kind: "code.review", input: { summary: "Check the sample" }, targetAgentId: agentId,
    }));
    const claimed = await worker.request("x-ahp/work/claim", { sessionUri: channel });
    const { work } = z.object({ work: z.object({ workId: z.uuid(), leaseToken: z.uuid() }) }).parse(claimed);
    assert.equal(work.workId, workId);
    const lease = { workId, leaseToken: work.leaseToken };
    await worker.request("x-ahp/work/renew", lease);
    await worker.request("x-ahp/work/complete", { ...lease, result: { summary: "Review complete" } });
    const receipt = z.object({ work: z.object({ status: z.literal("completed"), result: z.object({ summary: z.string() }) }) })
      .parse(await owner.request("x-ahp/work/get", { workId }));
    assert.equal(receipt.work.result.summary, "Review complete");
    assert.deepEqual(await other.request("x-ahp/work/get", { workId }), { version: 1, work: null });
    process.stdout.write("Work lease renewed and completed by the owner; a different principal sees no work item.\n");
  } finally {
    await Promise.all(cleanup.map((client) => client.shutdown()));
  }
}

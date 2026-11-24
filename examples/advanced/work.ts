import assert from "node:assert/strict";
import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { ToolInvocationTransport } from "@toolExecution/client/transport";
import { z } from "zod";
import { channel, type Subject } from "./host";

export async function openWorkClient(url: string, subject: Subject, label: string) {
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

/** A registered agent can maintain its presence while remote work mutations are closed. */
export async function showWorkBoundary(url: string): Promise<void> {
  const worker = await openWorkClient(url, "senior", "review-worker");
  try {
    const { agentId } = z.object({ agentId: z.uuid() })
      .parse(await worker.request("x-ahp/agents/register", { agentKey: "review-worker" }));
    const renewed = z.object({ agentId: z.uuid() }).parse(await worker.request("x-ahp/agents/renew", {}));
    assert.equal(renewed.agentId, agentId);
    await assert.rejects(worker.request("x-ahp/work/submit", {
      sessionUri: channel, requestKey: "first-review", kind: "code.review", input: {},
    }), /Tool operation unavailable/);
    assert.deepEqual(await worker.request("x-ahp/work/get", { workId: "11111111-1111-4111-8111-111111111111" }),
      { version: 1, work: null });
    assert.equal(await worker.request("x-ahp/agents/unregister", {}), null);
    process.stdout.write("The worker registered and renewed its presence. The host rejected remote work submission.\n");
  } finally {
    await worker.client.shutdown();
  }
}

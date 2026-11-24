import assert from "node:assert/strict";
import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { ToolInvocationTransport } from "@toolExecution/client/transport";
import { z } from "zod";
import { channel, reviewWorkerKey, type createReviewHost, type Subject } from "./host";

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
export async function showWorkBoundary(url: string, demo: ReturnType<typeof createReviewHost>): Promise<void> {
  const worker = await openWorkClient(url, "junior", "review-worker");
  try {
    const { agentId } = z.object({ agentId: z.uuid() })
      .parse(await worker.request("x-ahp/agents/register", { agentKey: reviewWorkerKey }));
    const renewed = z.object({ agentId: z.uuid() }).parse(await worker.request("x-ahp/agents/renew", {}));
    assert.equal(renewed.agentId, agentId);
    const service = demo.host.work;
    assert.ok(service);
    const callerFor = (subject: Subject) => {
      const { context } = demo.connection(subject);
      return { context, signal: new AbortController().signal, isCurrent: () => demo.connection(subject).context === context };
    };
    const manager = callerFor("pm");
    const job = await service.submit(manager, { requestKey: "first-review", kind: "code.review", input: { topic: "release notes" },
      targetAgentId: agentId, scope: [{ resource: { kind: "session", id: channel }, include: true }] });
    const detail = await service.get(callerFor("senior"), job.id);
    assert.equal(detail?.entities?.owner.subject, "senior");
    assert.equal(detail.entities.submitter.principal.subject, "pm");
    assert.equal(await service.get(manager, job.id), null);
    assert.equal(await demo.juniorHasWorkGrant(), true);
    await assert.rejects(worker.request("x-ahp/work/submit", {
      requestKey: "first-review", kind: "code.review", input: {},
      scope: [{ resource: { kind: "session", id: channel }, include: true }],
    }), /Tool operation unavailable/);
    assert.deepEqual(await worker.request("x-ahp/work/get", { workId: job.id }),
      { version: 1, work: null });
    assert.equal(demo.revokeJuniorWork(), true);
    assert.equal(await demo.juniorHasWorkGrant(), false);
    assert.equal(await worker.request("x-ahp/agents/unregister", {}), null);
    process.stdout.write("The project manager submitted work in the senior's session for the mapped junior worker. The senior read the job. The junior's execution grant was current, then revoked.\n");
  } finally {
    await worker.client.shutdown();
  }
}

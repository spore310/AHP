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
    return { client, async request(method: string, params: Record<string, unknown>) {
      try {
        return await transport.request(method, { version: 1, ...params });
      } catch (cause) {
        throw new Error("Example request failed for " + method, { cause });
      }
    } };
  } catch (error) {
    await client.shutdown();
    throw error;
  }
}

export const claimedLease = z.object({ version: z.literal(1), status: z.literal("claimed"),
  lease: z.object({ workId: z.uuid(), attempt: z.int().positive(), leaseToken: z.uuid(), priority: z.int(), leaseExpiresAt: z.iso.datetime() }) });

export function execution(lease: z.infer<typeof claimedLease>["lease"]) {
  return { workId: lease.workId, attempt: lease.attempt, leaseToken: lease.leaseToken };
}

/** The PM submits, the senior owns the session and the mapped junior claims and settles. */
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
    }));
    assert.deepEqual(await worker.request("x-ahp/work/get", { workId: job.id }),
      { version: 1, work: null });
    const { lease } = claimedLease.parse(await worker.request("x-ahp/work/claim", { session: { kind: "session", id: channel } }));
    assert.equal(lease.workId, job.id);
    assert.equal(await worker.request("x-ahp/work/complete", { ...execution(lease), result: { reviewed: true } }), null);
    assert.equal((await service.get(callerFor("senior"), job.id))?.status, "completed");
    assert.equal(demo.revokeJuniorWork(), true);
    assert.equal(await demo.juniorHasWorkGrant(), false);
    assert.equal(await worker.request("x-ahp/agents/unregister", {}), null);
    process.stdout.write("The project manager submitted work in the senior's session. The mapped junior claimed and completed the review before its execution grant was revoked.\n");
  } finally {
    await worker.client.shutdown();
  }
}

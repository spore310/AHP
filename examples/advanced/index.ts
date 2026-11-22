import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { connectToolClient, type ToolClient } from "@toolExecution/client";
import { channel, clientTool, createReviewHost, demoProof, selector, type Subject } from "./host";
import { showWorkLease } from "./work";

async function connect(url: string, subject: Subject): Promise<ToolClient> {
  const transport = await WebSocketTransport.connect(url, { protocols: "demo-" + subject });
  return connectToolClient({ transport, ownership: "owned" }, { clientId: "review-" + subject, protocolVersions: ["1.0.0"] });
}

async function inspect(client: ToolClient, ran: () => number): Promise<void> {
  const before = ran();
  const receipt = await client.dispatchTool(channel, selector(clientTool), {});
  assert.equal(receipt.status, "challenge-required");
  assert.equal(ran(), before, "The tool ran before the challenge was resolved");
  const outcome = await client.resumeTool(receipt.continuationId, demoProof);
  assert.equal(outcome.status, "accepted");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await client.statusTool(receipt.callId);
    if (status.status === "completed") {
      assert.deepEqual(status.output, { value: "Review notes inspected" });
      assert.equal(ran(), before + 1);
      return;
    }
    await setTimeout(15);
  }
  throw new Error("The review inspection did not complete.");
}

const mode = process.argv.includes("--direct") ? "direct" : "namespace";
const demo = createReviewHost(mode);
const clients: ToolClient[] = [];
try {
  await demo.provision();
  const address = await demo.host.start();
  const url = `ws://127.0.0.1:${String(address.port)}/`;
  const peer = async (subject: Subject): Promise<ToolClient> => {
    const client = await connect(url, subject);
    clients.push(client);
    return client;
  };
  const senior = await peer("senior"), junior = await peer("junior"), pm = await peer("pm"), observer = await peer("observer");
  demo.allowJuniorExecutor(clientTool);
  const projected = (await observer.client.subscribe(channel)).result.snapshot;
  assert.ok(projected && "lifecycle" in projected.state);
  assert.equal(projected.state.lifecycle, "ready");
  assert.ok(!JSON.stringify(projected).includes("review.inspect"));
  process.stdout.write(`Protected session is ready with ${mode} policy admission.\n`);

  let inspections = 0;
  await junior.joinSession(channel, [{ definition: clientTool, execute: () => {
    inspections += 1;
    return { value: "Review notes inspected" };
  } }]);
  await senior.client.subscribe(channel);
  await pm.client.subscribe(channel);
  await inspect(junior, () => inspections);
  await inspect(senior, () => inspections);
  process.stdout.write("The junior agent and senior caller both completed a challenged inspection on the assigned client executor.\n");

  const before = demo.host.sessions.getSessionSnapshot(channel);
  const observerBefore = (await observer.client.subscribe(channel)).result.snapshot;
  demo.consent(false);
  assert.deepEqual(await senior.dispatchTool(channel, selector(clientTool), {}), { version: 2, status: "denied", code: "unavailable" });
  assert.deepEqual(await pm.dispatchTool(channel, selector(clientTool), {}), { version: 2, status: "denied", code: "unavailable" });
  assert.equal(inspections, 2);
  assert.deepEqual(demo.host.sessions.getSessionSnapshot(channel), before);
  demo.consent(true);
  const observerAfter = (await observer.client.subscribe(channel)).result.snapshot;
  assert.deepEqual(observerAfter, observerBefore);
  process.stdout.write("A provider denial and the PM's missing invoke assignment left the host and observer snapshots unchanged.\n");

  assert.deepEqual(await senior.callTool(channel, selector(demo.serverTool.definition), { text: "Review ready" }), { value: "Review ready" });
  assert.equal(demo.host.sessions.getSessionSnapshot(channel)?.state.title, "Review ready");
  process.stdout.write("The host action returned a result and the authorized projector set the title to Review ready.\n");

  await showWorkLease(url);

  const proposed = { ...clientTool, id: "10000000-0000-4000-8000-000000000002", key: "review.summarize", name: "summarize" };
  const contract = selector(proposed);
  const proposal = await senior.proposeTool(channel, proposed);
  assert.equal(proposal.status, "proposed");
  assert.equal((await senior.approveTool(channel, proposal.proposalId, proposal.revision)).status, "unavailable");
  const approval = await pm.approveTool(channel, proposal.proposalId, proposal.revision);
  assert.equal(approval.status, "approved");
  const published = await senior.publishTool(channel, proposal.proposalId, approval.revision);
  assert.equal(published.status, "published");
  assert.ok(!demo.host.sessions.getSessionToolManifest(channel)?.toolContracts.some(({ id }) => id === contract.id));

  const descriptor = { artifactId: "sample-summary", publisherId: "demo-publisher", contractRevision: contract.version,
    implementationRevision: 2, runtime: "node", platform: "local", digest: createHash("sha256").update(demo.bytes).digest("hex"), verificationRef: "demo-approval" };
  demo.artifacts.register({ contract, descriptor, source: { id: proposal.proposalId, revision: 1 } });
  await junior.shutdown();
  const managed = demo.host.sessions.managedTools;
  assert.ok(managed);
  const { context } = demo.connection("senior");
  const current = (): boolean => demo.connection("senior").context === context;
  const activation = await managed.activate({ origin: demo.origin(), actor: context, expectedRevision: 0, proposalId: proposal.proposalId,
    signal: new AbortController().signal, current, fence: current });
  assert.equal(activation?.revision, 1);
  demo.allowTool("junior", proposed, ["discover", "advertise", "invoke"]);
  const artifactExecutor = await peer("junior");
  demo.allowJuniorExecutor(proposed, { location: "client", suppliedBy: "server", implementation: "approved-artifact", artifactRef: descriptor.artifactId }, 2);
  await artifactExecutor.loadApprovedTool(channel, contract, { runtime: "node", platform: "local",
    verify: ({ descriptor: candidate }, bytes) => candidate.publisherId === "demo-publisher" && Buffer.from(bytes).equals(Buffer.from(demo.bytes)),
    load: () => ({ definition: proposed, execute: () => ({ value: "Sample artifact summarized the review" }) }),
  });
  assert.deepEqual(await artifactExecutor.callTool(channel, contract, {}), { value: "Sample artifact summarized the review" });
  process.stdout.write("An independently approved proposal was activated and executed through the verified artifact loader.\n");
} finally {
  try {
    await Promise.all(clients.map((client) => client.shutdown()));
  } finally {
    await demo.stop();
  }
}

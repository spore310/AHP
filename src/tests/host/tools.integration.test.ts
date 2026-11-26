import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { describe, expect, it } from "vitest";
import { connectToolClient, type ToolClient } from "@tool/client";
import { channel, clientTool, demoProof, selector } from "../../../examples/advanced/host";
import { createCluster, eventually, onCleanup } from "./cluster";

describe("tools across hosts", () => {
  it("H8-06 H8-07 H6-11 runs a client-executed tool whose caller, executor and session owner are on different hosts", async () => {
    const cluster = await createCluster(["review-a", "review-b", "review-c"]);
    const owner = cluster.node("review-a");
    // The session, its policy and its tool assignments live on review-a only.
    await owner.provision();
    const connect = async (hostId: string, subject: string): Promise<ToolClient> => {
      const transport = await WebSocketTransport.connect(cluster.url(hostId), { protocols: `demo-${subject}` });
      const client = await connectToolClient({ transport, ownership: "owned" }, { clientId: `${subject}@${hostId}`, protocolVersions: ["1.0.0"] });
      onCleanup(() => client.shutdown());
      return client;
    };
    // The executor's only socket is on review-b and the caller's is on review-c.
    const executor = await connect("review-b", "junior");
    const caller = await connect("review-c", "senior");
    await executor.connection.protocol.subscribe(channel);
    // The owner authorizes the executor it authenticated on the relayed connection, by its own connection identity.
    owner.allowClientExecutor("junior", clientTool);
    let executions = 0;
    await executor.joinSession(channel, [{ definition: clientTool, execute: () => {
      executions += 1;
      return { value: "Inspected across hosts" };
    } }]);
    await caller.connection.protocol.subscribe(channel);

    const receipt = await caller.dispatchTool(channel, selector(clientTool), {});
    expect(receipt.status).toBe("challenge-required");
    if (receipt.status !== "challenge-required") throw new Error("expected a challenge");
    // Nothing ran before the challenge was resolved, and a wrong proof is refused by the owner.
    expect(executions).toBe(0);
    expect((await caller.resumeTool(receipt.continuationId, "wrong-proof")).status).not.toBe("accepted");
    expect(executions).toBe(0);
    const second = await caller.dispatchTool(channel, selector(clientTool), {});
    if (second.status !== "challenge-required") throw new Error("expected a challenge");
    expect((await caller.resumeTool(second.continuationId, demoProof)).status).toBe("accepted");
    const completed = await eventually(async () => {
      const status = await caller.statusTool(second.callId);
      return status.status === "completed" ? status : undefined;
    }, "tool completion");
    expect(completed.output).toEqual({ value: "Inspected across hosts" });
    expect(executions).toBe(1);
    // An observer on another host has no invoke assignment: the owner denies it and nothing runs.
    const observer = await connect("review-c", "observer");
    await observer.connection.protocol.subscribe(channel);
    expect((await observer.dispatchTool(channel, selector(clientTool), {})).status).toBe("denied");
    expect(executions).toBe(1);
    // The call was served by the owner alone; the other hosts only relayed frames.
    expect(owner.host.toolExecutionStats().active).toBe(0);
    expect(cluster.node("review-b").host.sessions.getSessionSnapshot(channel)).toBeUndefined();
    expect(cluster.node("review-c").host.sessions.getSessionSnapshot(channel)).toBeUndefined();
    // When the executor disconnects, its pending capacity on the owner is released.
    await executor.shutdown();
    await eventually(() => cluster.node("review-b").host.routingStats().connections === 0 ? true : undefined, "executor route released");
    const afterDisconnect = await caller.dispatchTool(channel, selector(clientTool), {});
    if (afterDisconnect.status === "challenge-required") {
      await caller.resumeTool(afterDisconnect.continuationId, demoProof);
      await eventually(async () => (await caller.statusTool(afterDisconnect.callId)).status !== "running" ? true : undefined, "call without an executor settles");
    }
    expect(executions).toBe(1);
  });
});

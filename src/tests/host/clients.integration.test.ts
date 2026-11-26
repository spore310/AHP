import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { connectClient, type Client } from "@client";
import { ACTION_TYPE_SESSION_TITLE_CHANGED } from "@sessions/constants";
import { connectToolClient, createToolClient, type ToolClient } from "@tool/client";
import { createWorkClient } from "@work/helpers/client";
import { channel, clientTool, demoProof, reviewWorkerKey, selector } from "../../../examples/advanced/host";
import { claimedLease } from "../../../examples/advanced/work";
import { createCluster, eventually, onCleanup, type Cluster } from "./cluster";

const TEST_TIMEOUT_MS = 20_000;
const idle = { connections: 0, links: 0, pending: 0, held: 0 };
const oneLink = { connections: 1, links: 1, pending: 0, held: 0 };
const lateOutput = "Completed after the call ended";
const freshOutput = "Inspected after the earlier call ended";
const submitted = z.object({ workId: z.uuid() });

const openTransport = (cluster: Cluster, hostId: string, subject: string) => WebSocketTransport.connect(cluster.url(hostId), { protocols: `demo-${subject}` });
const connectTools = async (cluster: Cluster, hostId: string, subject: string): Promise<ToolClient> => {
  const client = await connectToolClient({ transport: await openTransport(cluster, hostId, subject), ownership: "owned" }, { clientId: `${subject}@${hostId}`, protocolVersions: ["1.0.0"] });
  onCleanup(() => client.shutdown());
  return client;
};
const connect = async (cluster: Cluster, hostId: string, subject: string): Promise<Client> => {
  const client = await connectClient({ transport: await openTransport(cluster, hostId, subject), ownership: "owned" }, { clientId: `${subject}-client@${hostId}`, protocolVersions: ["1.0.0"] });
  onCleanup(() => client.shutdown());
  return client;
};

/** Dispatches the client tool, resolves the owner's challenge and returns the accepted call. */
const approve = async (caller: ToolClient): Promise<string> => {
  const receipt = await caller.dispatchTool(channel, selector(clientTool), {});
  if (receipt.status !== "challenge-required") throw new Error("expected a challenge");
  expect((await caller.resumeTool(receipt.continuationId, demoProof)).status).toBe("accepted");
  return receipt.callId;
};

/**
 * Owner review-a, executor (junior) on review-b and caller (senior) on review-c, with one accepted
 * call parked inside the executor. Only the first invocation waits for `barrier`.
 */
const parkCall = async () => {
  const cluster = await createCluster(["review-a", "review-b", "review-c"]);
  const owner = cluster.node("review-a");
  await owner.provision();
  const executor = await connectTools(cluster, "review-b", "junior");
  const caller = await connectTools(cluster, "review-c", "senior");
  // The owner authorizes the executor it authenticated on the relayed connection, so that connection must exist first.
  await executor.connection.protocol.subscribe(channel);
  owner.allowClientExecutor("junior", clientTool);
  const barrier = Promise.withResolvers<{ value: string }>();
  const invocations: { readonly callId: string; readonly signal: AbortSignal }[] = [];
  await executor.joinSession(channel, [{ definition: clientTool, execute: (_input, { callId, signal }) => {
    invocations.push({ callId, signal });
    return invocations.length === 1 ? barrier.promise : { value: freshOutput };
  } }]);
  await caller.connection.protocol.subscribe(channel);
  const callId = await approve(caller);
  await eventually(() => invocations.length === 1 ? true : undefined, "the executor to start the call");
  expect((await caller.statusTool(callId)).status).toBe("running");
  expect(owner.host.toolExecutionStats()).toMatchObject({ active: 1, draining: 0 });
  return { cluster, owner, executor, caller, barrier, invocations, callId };
};

describe("clients across hosts", () => {
  it("H8-07 cancels a cross-host tool call and ignores the executor's late completion", async () => {
    const { cluster, owner, caller, barrier, invocations, callId } = await parkCall();

    // The SDK reports cancellation in two steps. The caller's wait ends at once, but the executor has not
    // answered, so the reply is "draining" (never "running" or "completed") and the owner keeps the call's
    // slot. "cancelled" is the terminal status and is reached only through that exact call's completion.
    const cancelling = await caller.cancelTool(callId);
    expect(cancelling).toEqual({ version: 1, status: "draining", callId });
    expect(await caller.statusTool(callId)).toEqual(cancelling);
    expect(owner.host.toolExecutionStats()).toMatchObject({ active: 1, draining: 1 });
    // The owner's cooperative cancellation reaches the one executor that holds the call, two hosts away.
    await eventually(() => invocations[0]?.signal.aborted === true ? true : undefined, "the executor to be told about the cancellation");
    // Cancelling again while the call drains changes nothing and runs nothing.
    expect(await caller.cancelTool(callId)).toEqual(cancelling);

    // The executor ignored the signal and now completes late, with a value.
    barrier.resolve({ value: lateOutput });
    const cancelled = await eventually(async () => {
      const status = await caller.statusTool(callId);
      return status.status === "draining" ? undefined : status;
    }, "the cancelled call to settle");
    // The late value is discarded: the call ends cancelled and carries no output.
    expect(cancelled).toEqual({ version: 1, status: "cancelled", callId });
    // A further cancel of the finished call is harmless.
    expect(await caller.cancelTool(callId)).toEqual(cancelled);
    expect(await caller.statusTool(callId)).toEqual(cancelled);
    await eventually(() => owner.host.toolExecutionStats().active === 0 ? true : undefined, "the owner's tool capacity to be released");
    expect(owner.host.toolExecutionStats()).toMatchObject({ active: 0, draining: 0 });
    expect(invocations).toHaveLength(1);

    // No slot or assignment leaked: a new call runs end to end and is correlated to its own invocation.
    const next = await approve(caller);
    expect(next).not.toBe(callId);
    const completed = await eventually(async () => {
      const status = await caller.statusTool(next);
      return status.status === "completed" ? status : undefined;
    }, "the new call to complete");
    expect(completed).toEqual({ version: 1, status: "completed", callId: next, output: { value: freshOutput } });
    expect(invocations.map((invocation) => invocation.callId)).toEqual([callId, next]);
    // The earlier call stays cancelled and never adopts a later result.
    expect(await caller.statusTool(callId)).toEqual(cancelled);
    expect(owner.host.toolExecutionStats()).toMatchObject({ active: 0, draining: 0 });
    for (const hostId of ["review-b", "review-c"]) expect(cluster.node(hostId).host.routingStats()).toEqual(oneLink);
  }, TEST_TIMEOUT_MS);

  // src/websocket/README.md: "Disconnect and timeout cancel the caller's wait. Unsettled work occupies
  // dispatcher capacity until settlement." The owner cannot prove that a remote execution stopped, so it
  // keeps counting it as draining and never reports it as finished.
  it("H8-07 a disconnected executor ends the caller's wait and the owner reports the unresolved execution exactly as a single host does", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);
    onCleanup(() => Promise.resolve(process.off("unhandledRejection", record)));
    const { cluster, owner, executor, caller, barrier, invocations, callId } = await parkCall();
    const ingress = cluster.node("review-b");
    const unresolved = { active: 1, draining: 1 };

    // The executor's only connection ends while the call is still running.
    await executor.shutdown();
    const ended = await eventually(async () => {
      const status = await caller.statusTool(callId);
      return status.status === "running" ? undefined : status;
    }, "the caller's wait to end");
    // The owner cannot authorize a read against an executor that is gone, so it reports neither "failed" nor
    // "cancelled": the caller is told the call is "unavailable", which the tool client treats as terminal.
    expect(ended).toEqual({ version: 1, status: "unavailable" });
    expect(owner.host.toolExecutionStats()).toMatchObject(unresolved);
    await eventually(() => ingress.host.routingStats().connections === 0 ? true : undefined, "the executor's route to be released");
    expect(ingress.host.routingStats()).toEqual(idle);

    // The disconnected executor finishes late. Its result has nowhere to go and changes nothing.
    barrier.resolve({ value: lateOutput });
    expect(await caller.statusTool(callId)).toEqual(ended);
    expect(await caller.cancelTool(callId)).toEqual(ended);
    expect(owner.host.toolExecutionStats()).toMatchObject(unresolved);
    expect(ingress.host.routingStats()).toEqual(idle);
    expect(unhandled).toEqual([]);
    // The advertisement left with its connection, so nothing is assigned to the executor that is gone.
    expect(await caller.dispatchTool(channel, selector(clientTool), {})).toEqual({ version: 1, status: "denied", code: "unavailable" });

    // A new executor connection is authorized by its own identity and serves a new call end to end.
    const replacement = await connectTools(cluster, "review-b", "junior");
    await replacement.connection.protocol.subscribe(channel);
    owner.allowClientExecutor("junior", clientTool);
    const served: string[] = [];
    await replacement.joinSession(channel, [{ definition: clientTool, execute: (_input, context) => {
      served.push(context.callId);
      return { value: freshOutput };
    } }]);
    const next = await approve(caller);
    expect(next).not.toBe(callId);
    const completed = await eventually(async () => {
      const status = await caller.statusTool(next);
      return status.status === "completed" ? status : undefined;
    }, "the new call to complete");
    expect(completed).toEqual({ version: 1, status: "completed", callId: next, output: { value: freshOutput } });
    // Each call reached exactly one executor: the earlier one is neither replayed nor completed by the new result.
    expect(served).toEqual([next]);
    expect(invocations.map((invocation) => invocation.callId)).toEqual([callId]);
    expect(await caller.statusTool(callId)).toEqual(ended);
    expect(owner.host.toolExecutionStats()).toMatchObject(unresolved);
    expect(ingress.host.routingStats()).toEqual(oneLink);
    expect(cluster.node("review-c").host.routingStats()).toEqual(oneLink);
    expect(unhandled).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it("H8-10 one client connection keeps tool, work and native traffic on a single reader across hosts, and everything is disposed when the owner changes", async () => {
    // Registered first so the real timers are restored only after every host has stopped.
    const armed = vi.spyOn(globalThis, "setInterval");
    const disarmed = vi.spyOn(globalThis, "clearInterval");
    onCleanup(() => {
      armed.mockRestore();
      disarmed.mockRestore();
      return Promise.resolve();
    });
    const cluster = await createCluster(["review-a", "review-b"]);
    const previous = cluster.node("review-a");
    const ingress = cluster.node("review-b");
    await previous.provision();
    const session = { kind: "session", id: channel, instanceId: previous.origin().instanceId };

    // One socket to review-b. The session, its tools and its work live on review-a.
    const client = await connect(cluster, "review-b", "junior");
    expect(ingress.host.routingStats()).toEqual({ ...idle, connections: 1 });
    // Native traffic: the subscription is served by the owner through one link.
    const native = await client.protocol.subscribe(channel);
    expect(native.result.snapshot).toMatchObject({ resource: channel, state: { lifecycle: "ready" } });
    const nativeActions: string[] = [];
    let nativeEnded = false;
    void (async () => {
      try {
        for await (const event of native.subscription) if (event.type === "action") nativeActions.push(event.params.action.type);
      } finally {
        nativeEnded = true;
      }
    })().catch(() => undefined);
    // Tool traffic: negotiated, assigned and advertised on the same connection.
    previous.allowClientExecutor("junior", clientTool);
    const tools = await createToolClient(client);
    expect(tools.connection).toBe(client);
    let executions = 0;
    await tools.joinSession(channel, [{ definition: clientTool, execute: () => {
      executions += 1;
      return { value: "Inspected on the shared connection" };
    } }]);
    // Agent presence and a work view, again on the same connection.
    const { agentId } = z.object({ agentId: z.uuid() }).parse(await client.rpc.request("x-ahp/agents/register", { version: 1, agentKey: reviewWorkerKey }));
    const reconcileMs = 61_237;
    const view = createWorkClient(client, { reconcileIntervalMs: reconcileMs });
    /** The view's reconcile timers that were armed and not yet cleared. */
    const liveReconcileTimers = (): unknown[] => {
      const cleared = new Set<unknown>(disarmed.mock.calls.map(([timer]) => timer));
      return armed.mock.calls.flatMap(([, delay], index) => delay === reconcileMs ? [armed.mock.results[index]?.value as unknown] : []).filter((timer) => !cleared.has(timer));
    };
    expect(await view.subscribe({ resource: session })).toMatchObject({ status: "ready", items: [] });
    expect(liveReconcileTimers()).toHaveLength(1);
    // One public connection and one link carry all of it.
    expect(ingress.host.routingStats()).toMatchObject({ connections: 1, links: 1 });

    // A senior reviewer on the owning host drives each kind of traffic towards that one reader.
    const caller = await connectTools(cluster, "review-a", "senior");
    await caller.connection.protocol.subscribe(channel);
    caller.connection.protocol.dispatch(channel, { type: ACTION_TYPE_SESSION_TITLE_CHANGED, title: "Shared reader" });
    await eventually(() => nativeActions.includes(ACTION_TYPE_SESSION_TITLE_CHANGED) ? true : undefined, "a native action on the shared connection");
    const callId = await approve(caller);
    const completed = await eventually(async () => {
      const status = await caller.statusTool(callId);
      return status.status === "completed" ? status : undefined;
    }, "the tool call served by the shared connection");
    expect(completed.output).toEqual({ value: "Inspected on the shared connection" });
    expect(executions).toBe(1);
    const manager = await cluster.peer("review-a", "pm");
    const job = await manager.call<{ workId: string }>("x-ahp/work/submit", { version: 1, requestKey: "shared-connection-review", kind: "code.review", input: { topic: "release" },
      targetAgentId: agentId, scope: [{ resource: { kind: "session", id: channel }, include: true }] });
    const { lease } = claimedLease.parse(await client.rpc.request("x-ahp/work/claim", { version: 1, session: { kind: "session", id: channel } }));
    expect(lease.workId).toBe(job.workId);
    // The view is bounded by its caller's own authority. The junior executes the lease it claimed but holds
    // no read grant (and a project manager cannot announce work), so its view and its direct read reveal
    // nothing. The senior who owns the session reads the claimed item.
    expect(await view.refresh()).toMatchObject({ status: "ready", items: [] });
    expect(await client.rpc.request("x-ahp/work/get", { version: 1, workId: job.workId })).toEqual({ version: 1, work: null });
    const detail = await caller.connection.rpc.request("x-ahp/work/get", { version: 1, workId: job.workId });
    expect(detail).toMatchObject({ work: { id: job.workId, status: "leased", attemptCount: 1, session: { id: channel, instanceId: session.instanceId } } });
    expect(ingress.host.routingStats()).toMatchObject({ connections: 1, links: 1 });
    expect(liveReconcileTimers()).toHaveLength(1);

    const ran: string[] = [];
    for (const label of ["first", "second", "third"]) client.lifetime.addCleanup(() => {
      ran.push(label);
    });
    const withdraw = client.lifetime.addCleanup(() => {
      ran.push("withdrawn");
    });
    withdraw();

    // The session moves to review-b. The client's subscription ran through the previous owner's link,
    // so its connection is closed and it reconnects and reconciles.
    await previous.host.transferSession(channel, "review-b");
    await eventually(() => client.lifetime.signal.aborted ? true : undefined, "the client to be disconnected by the owner change");
    // Every handle that shared the connection ends with it, exactly once.
    expect([...ran].sort()).toEqual(["first", "second", "third"]);
    await eventually(() => nativeEnded ? true : undefined, "the native subscription to end");
    expect(view.snapshot()).toEqual({ status: "disconnected", items: [] });
    expect(liveReconcileTimers()).toEqual([]);
    expect(() => client.rpc.request("x-ahp/agents/renew", { version: 1 })).toThrow();
    await expect(tools.dispatchTool(channel, selector(clientTool), {})).rejects.toThrow();
    await expect(tools.joinSession(channel, [])).rejects.toThrow();
    // Disposal and shutdown after the fact are safe and idempotent.
    for (let round = 0; round < 2; round += 1) {
      await expect(view.dispose()).resolves.toBeUndefined();
      await expect(client.shutdown()).resolves.toBeUndefined();
      await expect(tools.shutdown()).resolves.toBeUndefined();
    }
    expect(view.snapshot()).toEqual({ status: "disposed", items: [] });
    expect(ran).toHaveLength(3);
    expect(liveReconcileTimers()).toEqual([]);
    await eventually(() => ingress.host.routingStats().connections === 0 ? true : undefined, "the ingress route to be released");
    expect(ingress.host.routingStats()).toEqual(idle);
    expect(previous.host.toolExecutionStats()).toMatchObject({ active: 0, draining: 0 });

    // review-b now serves the session itself, under the same identity. review-a no longer does.
    await eventually(() => ingress.host.sessions.getSessionSnapshot(channel), "the session to be restored on its new owner");
    expect(ingress.host.sessions.authorization?.getResource(channel)).toMatchObject(session);
    expect(previous.host.sessions.getSessionSnapshot(channel)).toBeUndefined();
    await manager.close();
    await caller.shutdown();
    await eventually(() => previous.host.routingStats().connections === 0 ? true : undefined, "the previous owner's public connections to end");

    // A fresh client through the other ingress, which is no longer the owner, reconciles from a snapshot.
    const fresh = await connect(cluster, "review-a", "junior");
    const reconnected = await fresh.protocol.subscribe(channel);
    expect(reconnected.result.snapshot).toMatchObject({ resource: channel, state: { lifecycle: "ready", title: "Shared reader" } });
    expect(previous.host.routingStats()).toEqual(oneLink);
    expect(ingress.host.routingStats()).toEqual(idle);
    // Its view is bounded as before: nothing is revealed to the junior, through a view or directly.
    const freshView = createWorkClient(fresh);
    onCleanup(() => freshView.dispose());
    expect(await freshView.subscribe({ resource: session })).toMatchObject({ status: "ready", items: [] });
    expect(await fresh.rpc.request("x-ahp/work/get", { version: 1, workId: job.workId })).toEqual({ version: 1, work: null });
    expect(previous.host.routingStats()).toEqual(oneLink);
    // The senior reads the claimed item through the new owner exactly as before the change.
    const reviewer = await connect(cluster, "review-a", "senior");
    expect(await reviewer.rpc.request("x-ahp/work/get", { version: 1, workId: job.workId })).toEqual(detail);
  }, TEST_TIMEOUT_MS);

  it("H8-10 a work view lists the same items after the owner changes", async () => {
    const cluster = await createCluster(["review-a", "review-b"]);
    const previous = cluster.node("review-a");
    await previous.provision();
    const session = { kind: "session", id: channel, instanceId: previous.origin().instanceId };
    // Only the session's senior may announce work to a view. The view runs through an ingress that is not the owner.
    const senior = await connect(cluster, "review-b", "senior");
    const { workId } = submitted.parse(await senior.rpc.request("x-ahp/work/submit", { version: 1, session, requestKey: "announced-review", kind: "code.review",
      input: { topic: "announced" }, scope: [{ resource: session, include: true }], announce: [{ resource: session, include: true }] }));
    const view = createWorkClient(senior);
    onCleanup(() => view.dispose());
    const before = await view.subscribe({ resource: session });
    expect(before).toMatchObject({ status: "ready", items: [{ id: workId, status: "queued" }] });

    await previous.host.transferSession(channel, "review-b");
    await eventually(() => cluster.node("review-b").host.sessions.getSessionSnapshot(channel), "the session to be restored on its new owner");
    // The same view reconnects through the other ingress and pages the work its new owner did not insert.
    const reviewer = await connect(cluster, "review-a", "senior");
    const after = await view.reconnect(reviewer);
    expect(after.status).toBe("ready");
    expect(after.items).toEqual(before.items);
    expect(await reviewer.rpc.request("x-ahp/work/get", { version: 1, workId })).toMatchObject({ work: { id: workId, status: "queued" } });
  }, TEST_TIMEOUT_MS);
});

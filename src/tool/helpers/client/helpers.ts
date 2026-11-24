import { executionSchema } from "@work/helpers/protocol/execution";
import { connectClient, type Client, type ClientConnection, type ClientOptions, type ExtensionRpcOptions } from "@client";
import { SESSION_URI_PREFIX } from "@sessions/constants";
import { canonicalJsonEqual, toAhpToolDefinition } from "@tool/helpers/protocol/helpers/descriptors";
import { loadVerifiedArtifact } from "../execution/helpers/artifacts";
import { captureValue } from "@jsonrpc/value";
import { ToolEndpoint } from "./helpers/transport";
import { identity, sameTool } from "./helpers/transport/helpers";
import { parseToolWire, toolCapabilitiesReplySchema, toolAssignedReplySchema, toolAdvertiseReplySchema,
  toolDispatchRequestSchema, toolDispatchReplySchema, toolStatusReplySchema, toolCallSelectorSchema, toolResumeRequestSchema,
  toolArtifactReplySchema, toolArtifactRequestSchema, toolExtensionsReplySchema, toolManagementReplySchema, toolManagementRequestSchema,
  ToolPendingError, ToolChallengeRequiredError, type AssignedTool, type ToolAssignedReply } from "../protocol";
import type { LocalToolImplementation, ToolClient } from "./types";

export async function connectToolClient(connection: ClientConnection, options: ClientOptions): Promise<ToolClient> {
  const client = await connectClient(connection, options);
  try {
    return await createToolClient(client);
  } catch (error) {
    await client.shutdown().catch(() => undefined);
    throw error;
  }
}

export async function createToolClient(connection: Client): Promise<ToolClient> {
  const transport = new ToolEndpoint(connection);
  const client = connection.protocol;
  const request = (method: string, params: unknown, options: ExtensionRpcOptions = {}) => connection.rpc.request(method, params, {
    ...options, signal: options.signal ? AbortSignal.any([options.signal, transport.signal]) : transport.signal,
  });
  try {
    parseToolWire(toolCapabilitiesReplySchema, await request("x-ahp/tools/capabilities", { version: 1 }));
    if (transport.signal.aborted) throw new Error("Tool client closed.");
  } catch (error) {
    transport.close();
    throw error;
  }
  const assertOpen = (): void => {
    if (transport.signal.aborted) throw new Error("Tool client closed.");
  };
  const extensions = async () => {
    assertOpen();
    return parseToolWire(toolExtensionsReplySchema, await request("x-ahp/tools/extensions", { version: 1 }));
  };
  const manage = async (input: unknown) => {
    const body = parseToolWire(toolManagementRequestSchema, input);
    if (!(await extensions()).management) throw new Error("Tool management unavailable.");
    return parseToolWire(toolManagementReplySchema, await request("x-ahp/tools/manage", body));
  };
  const joins = new Map<string, Promise<void>>();
  let joinCount = 0;
  let callCount = 0;
  const captureLocal = (implementations: readonly LocalToolImplementation[]): Map<string, LocalToolImplementation> => {
    assertOpen();
    if (implementations.length > 128) throw new TypeError("Invalid tool registration.");
    const local = new Map<string, LocalToolImplementation>();
    for (const implementation of implementations) {
      const definition = captureValue(implementation.definition, { maxBytes: 1024 * 1024, maxDepth: 64, maxKeys: 131072 }).value as LocalToolImplementation["definition"];
      const key = identity(definition);
      if (local.has(key)) throw new TypeError("Duplicate local tool implementation.");
      local.set(key, { definition, execute: implementation.execute.bind(implementation) });
    }
    return local;
  };
  const assigned = async (channel: string): Promise<ToolAssignedReply> => {
    if (!channel.startsWith(SESSION_URI_PREFIX)) throw new TypeError("Invalid tool registration.");
    const { subscription } = await client.subscribe(channel);
    // The server subscription supports assignment lookup. Its local event
    // reader belongs only to this join and never consumes native events.
    await subscription.close();
    assertOpen();
    const view = parseToolWire(toolAssignedReplySchema, await request("x-ahp/tools/assigned", { version: 1, channel }));
    if (view.channel !== channel) throw new Error("Server returned a different assignment.");
    return view;
  };
  const advertise = async (view: ToolAssignedReply, local: Map<string, LocalToolImplementation>, verifiedAssignment?: AssignedTool): Promise<void> => {
    const { channel } = view;
    const chosen = view.tools.filter((tool) => {
      const implementation = local.get(identity(tool.contract));
      if (implementation === undefined) return false;
      if (tool.execution === undefined || !tool.purposes.includes("advertise") || !tool.purposes.includes("execute")
        || !sameTool(toAhpToolDefinition(implementation.definition), tool.descriptor)) throw new Error("Local tool does not match its private assignment.");
      if (tool.execution.binding.implementation === "approved-artifact" && tool !== verifiedAssignment) throw new Error("Approved tool requires a verified loader.");
      return true;
    });
    if (chosen.length !== local.size) throw new Error("Local tool is not assigned.");
    const token = globalThis.crypto.randomUUID();
    transport.stage(channel, token, [...local.values()], { ...view, tools: chosen });
    try {
      const acknowledgement = parseToolWire(toolAdvertiseReplySchema, await request("x-ahp/tools/advertise", {
        version: 1, channel, viewRevision: view.viewRevision, contracts: chosen.map((tool) => tool.contract),
      }));
      transport.activate(channel, token, acknowledgement);
    } catch (error) {
      transport.discard(channel, token);
      throw error;
    }
  };
  const enqueueJoin = async (channel: string, work: () => Promise<void>): Promise<void> => {
    assertOpen();
    if (joinCount >= 64) throw new Error("Tool registration capacity unavailable.");
    joinCount += 1;
    const previous = joins.get(channel) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => {
      assertOpen();
      return work();
    }).finally(() => {
      joinCount -= 1;
      if (joins.get(channel) === current) joins.delete(channel);
    });
    joins.set(channel, current);
    const stopped = Promise.withResolvers<never>();
    const abort = () => {
      stopped.reject(new Error("Tool client closed."));
    };
    transport.signal.addEventListener("abort", abort, { once: true });
    try {
      // Retire the public waiter immediately. The actual job keeps its slot
      // and channel ordering until the application callback settles.
      await Promise.race([current, stopped.promise]);
    } finally {
      transport.signal.removeEventListener("abort", abort);
    }
  };
  const joinSession: ToolClient["joinSession"] = (channel, implementations) => enqueueJoin(channel, async () => {
    const local = captureLocal(implementations);
    await advertise(await assigned(channel), local);
  });
  const loadApprovedTool: ToolClient["loadApprovedTool"] = (channel, contract, loader) => enqueueJoin(channel, async () => {
    if (!(await extensions()).artifacts) throw new Error("Approved tools unavailable.");
    const view = await assigned(channel);
    const tool = view.tools.find((candidate) => canonicalJsonEqual(candidate.contract, contract));
    const execution = tool?.execution;
    if (tool === undefined || execution?.binding.implementation !== "approved-artifact") throw new Error("Approved tool unavailable.");
    const body = parseToolWire(toolArtifactRequestSchema, { version: 1, channel, viewRevision: view.viewRevision, contract });
    const current = transport.captureAssignmentFence();
    const reply = parseToolWire(toolArtifactReplySchema, await request("x-ahp/tools/artifact", body));
    if (reply.status !== "available" || !canonicalJsonEqual(reply.artifact.contract, tool.contract) || !canonicalJsonEqual(reply.artifact.source, execution.source)
      || reply.artifact.descriptor.artifactId !== execution.binding.artifactRef
      || reply.artifact.descriptor.implementationRevision !== execution.registrationRevision) throw new Error("Approved tool unavailable.");
    const implementation = await loadVerifiedArtifact(reply.artifact, reply.encoded, loader, current);
    if (implementation === undefined || !current()) throw new Error("Approved tool could not be verified.");
    await advertise(view, captureLocal([implementation]), tool);
  });
  const dispatchTool: ToolClient["dispatchTool"] = async (channel, contract, input, options) => {
    assertOpen();
    const work = options?.work;
    const body = parseToolWire(toolDispatchRequestSchema, { version: 1, channel, contract, input, ...(work === undefined ? {} : { work }) });
    return parseToolWire(toolDispatchReplySchema, await request("x-ahp/tools/dispatch", body, { timeoutMs: options?.timeoutMs, signal: options?.signal }));
  };
  const readStatus = async (method: "status" | "cancel", callId: string, timeoutMs = 5000, signal?: AbortSignal) => {
    assertOpen();
    const body = parseToolWire(toolCallSelectorSchema, { version: 1, callId });
    const status = parseToolWire(toolStatusReplySchema, await request(`x-ahp/tools/${method}`, body, { timeoutMs, signal }));
    if (status.status !== "unavailable" && status.callId !== callId) throw new Error("Server returned a different call.");
    return status;
  };
  const wait = (duration: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Tool call closed or cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, duration);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  return {
    connection, joinSession, dispatchTool, loadApprovedTool,
    proposeTool: (channel, definition) => manage({ version: 1, channel, operation: "propose", definition }),
    approveTool: (channel, proposalId, revision) => manage({ version: 1, channel, operation: "approve", proposalId, revision }),
    publishTool: (channel, proposalId, revision) => manage({ version: 1, channel, operation: "publish", proposalId, revision }),
    statusTool: (callId) => readStatus("status", callId),
    cancelTool: (callId) => readStatus("cancel", callId),
    resumeTool: async (continuationId, proofRef) => {
      assertOpen();
      const body = parseToolWire(toolResumeRequestSchema, { version: 1, continuationId, proofRef });
      return parseToolWire(toolDispatchReplySchema, await request("x-ahp/tools/resume", body));
    },
    callTool: async (channel, ref, input, options) => {
      assertOpen();
      if (callCount >= 64) throw new Error("Tool call capacity unavailable.");
      callCount += 1;
      try {
        const limit = options?.timeoutMs ?? 35000;
        if (!Number.isInteger(limit) || limit < 1 || limit > 35000) throw new RangeError("Invalid tool call timeout.");
        const deadline = performance.now() + limit;
        const signal = options?.signal ? AbortSignal.any([options.signal, transport.signal]) : transport.signal;
        const work = executionSchema.optional().parse(options?.work);
        const body = captureValue(input, { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxKeys: 131072 }).value;
        const { id, key, version } = ref;
        const budget = () => Math.min(5000, Math.ceil(deadline - performance.now()));
        const assigned = parseToolWire(toolAssignedReplySchema, await request("x-ahp/tools/assigned", { version: 1, channel }, { timeoutMs: budget(), signal }));
        if (assigned.channel !== channel) throw new Error("Server returned a different assignment.");
        const candidates = assigned.tools.filter((tool) => tool.contract.key === key && tool.contract.version === version
          && (id === undefined || tool.contract.id === id) && tool.purposes.includes("invoke"));
        const selected = candidates[0];
        if (selected === undefined || candidates.length !== 1) throw new Error("Tool contract unavailable.");
        const receipt = await dispatchTool(channel, selected.contract, body, { work, timeoutMs: budget(), signal });
        if (receipt.status === "challenge-required") throw new ToolChallengeRequiredError(receipt);
        if (receipt.status !== "accepted") throw new Error("Tool operation unavailable.");
        let interval = 25;
        for (;;) {
          const remaining = deadline - performance.now();
          if (remaining <= 0) throw new ToolPendingError(receipt.callId);
          let status;
          try {
            status = await readStatus("status", receipt.callId, Math.min(5000, Math.ceil(remaining)), signal);
          } catch (error) {
            if (signal.aborted) throw error;
            throw new ToolPendingError(receipt.callId);
          }
          if (status.status === "completed") return status.output;
          if (status.status === "unavailable" || status.status === "failed" || status.status === "cancelled") throw new Error("Tool operation unavailable.");
          const delay = Math.min(interval, deadline - performance.now());
          if (delay <= 0) throw new ToolPendingError(receipt.callId);
          await wait(delay, signal);
          interval = Math.min(interval * 2, 500);
        }
      } finally {
        callCount -= 1;
      }
    },
    shutdown: () => connection.shutdown(),
  };
}

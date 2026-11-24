import { executionSchema } from "@work/helpers/protocol/execution";
import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { SESSION_URI_PREFIX } from "@sessions/constants";
import { canonicalJsonEqual, toAhpToolDefinition } from "@tools/helpers/protocol";
import { loadVerifiedArtifact } from "../artifacts";
import { captureToolValue } from "../value";
import { ToolInvocationTransport } from "./helpers/transport";
import { identity, sameTool } from "./helpers/transport/helpers";
import { parseToolWire, toolCapabilitiesReplySchema, toolAssignedReplySchema, toolAdvertiseReplySchema,
  toolDispatchRequestSchema, toolDispatchReplySchema, toolStatusReplySchema, toolCallSelectorSchema, toolResumeRequestSchema,
  toolArtifactReplySchema, toolArtifactRequestSchema, toolExtensionsReplySchema, toolManagementReplySchema, toolManagementRequestSchema,
  ToolPendingError, ToolChallengeRequiredError, type AssignedTool, type ToolAssignedReply } from "./helpers/protocol";
import type { LocalToolImplementation, ToolClient, ToolClientConnection, ToolClientOptions } from "./types";

/** Connects one SDK endpoint and negotiates the project-owned private tool extension. */
export async function connectToolClient(connection: string | URL | ToolClientConnection, options: ToolClientOptions): Promise<ToolClient> {
  let transport: ToolInvocationTransport;
  if (typeof connection === "string" || connection instanceof URL) {
    const { WebSocketTransport } = await import("@microsoft/agent-host-protocol/ws");
    transport = new ToolInvocationTransport(await WebSocketTransport.connect(connection));
  } else {
    const inner = connection.transport;
    const release = connection.ownership === "borrowed" ? connection.detach.bind(connection) : inner.close.bind(inner);
    transport = new ToolInvocationTransport(inner, release);
  }
  const client = new AhpClient(transport);
  client.connect();
  let closed = false;
  const delays = new Map<ReturnType<typeof setTimeout>, () => void>();
  try {
    await client.initialize({ clientId: options.clientId, protocolVersions: [...options.protocolVersions], initialSubscriptions: [] });
    parseToolWire(toolCapabilitiesReplySchema, await transport.request("x-ahp/tools/capabilities", { version: 2 }));
  } catch (error) {
    try {
      await client.shutdown();
    } catch { /* Preserve the primary connection failure. */ }
    try {
      await transport.close();
    } catch { /* Preserve the primary connection failure. */ }
    throw error;
  }
  const assertOpen = (): void => {
    if (closed) throw new Error("Tool client closed.");
  };
  const extensions = async () => {
    assertOpen();
    return parseToolWire(toolExtensionsReplySchema, await transport.request("x-ahp/tools/extensions", { version: 2 }));
  };
  const manage = async (input: unknown) => {
    const request = parseToolWire(toolManagementRequestSchema, input);
    if (!(await extensions()).management) throw new Error("Tool management unavailable.");
    return parseToolWire(toolManagementReplySchema, await transport.request("x-ahp/tools/manage", request));
  };
  const joins = new Map<string, Promise<void>>();
  let joinCount = 0;
  let callCount = 0;
  const captureLocal = (implementations: readonly LocalToolImplementation[]): Map<string, LocalToolImplementation> => {
    assertOpen();
    if (implementations.length > 128) throw new TypeError("Invalid tool registration.");
    const local = new Map<string, LocalToolImplementation>();
    for (const implementation of implementations) {
      const definition = captureToolValue(implementation.definition, { maxBytes: 1024 * 1024, maxDepth: 64, maxKeys: 131072 }).value as LocalToolImplementation["definition"];
      const key = identity(definition);
      if (local.has(key)) throw new TypeError("Duplicate local tool implementation.");
      local.set(key, { definition, execute: implementation.execute.bind(implementation) });
    }
    return local;
  };
  const assigned = async (channel: string): Promise<ToolAssignedReply> => {
    if (!channel.startsWith(SESSION_URI_PREFIX)) throw new TypeError("Invalid tool registration.");
    await client.subscribe(channel);
    assertOpen();
    const view = parseToolWire(toolAssignedReplySchema, await transport.request("x-ahp/tools/assigned", { version: 2, channel }));
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
      const acknowledgement = parseToolWire(toolAdvertiseReplySchema, await transport.request("x-ahp/tools/advertise", {
        version: 2, channel, viewRevision: view.viewRevision, contracts: chosen.map((tool) => tool.contract),
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
    const current = previous.catch(() => undefined).then(work);
    joins.set(channel, current);
    try {
      await current;
    } finally {
      joinCount -= 1;
      if (joins.get(channel) === current) joins.delete(channel);
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
    const request = parseToolWire(toolArtifactRequestSchema, { version: 2, channel, viewRevision: view.viewRevision, contract });
    const current = transport.captureAssignmentFence();
    const reply = parseToolWire(toolArtifactReplySchema, await transport.request("x-ahp/tools/artifact", request));
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
    const request = parseToolWire(toolDispatchRequestSchema, { version: 2, channel, contract, input, ...(work === undefined ? {} : { work }) });
    return parseToolWire(toolDispatchReplySchema, await transport.request("x-ahp/tools/dispatch", request));
  };
  const readStatus = async (method: "status" | "cancel", callId: string, timeoutMs = 5000) => {
    assertOpen();
    const request = parseToolWire(toolCallSelectorSchema, { version: 2, callId });
    const status = parseToolWire(toolStatusReplySchema, await transport.request(`x-ahp/tools/${method}`, request, timeoutMs));
    if (status.status !== "unavailable" && status.callId !== callId) throw new Error("Server returned a different call.");
    return status;
  };
  const wait = (duration: number): Promise<void> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delays.delete(timer);
      resolve();
    }, duration);
    delays.set(timer, () => {
      reject(new Error("Tool client closed."));
    });
  });
  return {
    client, joinSession, dispatchTool, loadApprovedTool,
    proposeTool: (channel, definition) => manage({ version: 2, channel, operation: "propose", definition }),
    approveTool: (channel, proposalId, revision) => manage({ version: 2, channel, operation: "approve", proposalId, revision }),
    publishTool: (channel, proposalId, revision) => manage({ version: 2, channel, operation: "publish", proposalId, revision }),
    statusTool: (callId) => readStatus("status", callId),
    cancelTool: (callId) => readStatus("cancel", callId),
    resumeTool: async (continuationId, proofRef) => {
      assertOpen();
      const request = parseToolWire(toolResumeRequestSchema, { version: 2, continuationId, proofRef });
      return parseToolWire(toolDispatchReplySchema, await transport.request("x-ahp/tools/resume", request));
    },
    callTool: async (channel, ref, input, options) => {
      assertOpen();
      if (callCount >= 64) throw new Error("Tool call capacity unavailable.");
      callCount += 1;
      try {
        const work = executionSchema.optional().parse(options?.work);
        const started = performance.now();
        const assigned = parseToolWire(toolAssignedReplySchema, await transport.request("x-ahp/tools/assigned", { version: 2, channel }));
        if (assigned.channel !== channel) throw new Error("Server returned a different assignment.");
        const candidates = assigned.tools.filter((tool) => tool.contract.key === ref.key && tool.contract.version === ref.version
          && (ref.id === undefined || tool.contract.id === ref.id) && tool.purposes.includes("invoke"));
        const selected = candidates[0];
        if (selected === undefined || candidates.length !== 1) throw new Error("Tool contract unavailable.");
        const receipt = await dispatchTool(channel, selected.contract, input, { work });
        if (receipt.status === "challenge-required") throw new ToolChallengeRequiredError(receipt);
        if (receipt.status !== "accepted") throw new Error("Tool operation unavailable.");
        let interval = 25;
        for (;;) {
          const remaining = 35_000 - (performance.now() - started);
          if (remaining <= 0) throw new ToolPendingError(receipt.callId);
          let status;
          try {
            status = await readStatus("status", receipt.callId, Math.min(5000, remaining));
          } catch (error) {
            if (closed) throw error;
            throw new ToolPendingError(receipt.callId);
          }
          if (status.status === "completed") return status.output;
          if (status.status === "unavailable" || status.status === "failed" || status.status === "cancelled") throw new Error("Tool operation unavailable.");
          const delay = Math.min(interval, 35_000 - (performance.now() - started));
          if (delay <= 0) throw new ToolPendingError(receipt.callId);
          await wait(delay);
          interval = Math.min(interval * 2, 500);
        }
      } finally {
        callCount -= 1;
      }
    },
    shutdown: async () => {
      closed = true;
      for (const [timer, reject] of delays) {
        clearTimeout(timer);
        reject();
      }
      delays.clear();
      try {
        await client.shutdown();
      } finally {
        await transport.close();
      }
    },
  };
}

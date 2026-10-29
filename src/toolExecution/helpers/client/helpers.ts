import type { StateAction, ToolAnnotations, ToolDefinition } from "@microsoft/agent-host-protocol";
import { AhpClient } from "@microsoft/agent-host-protocol/client";

import { SESSION_URI_PREFIX, ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET } from "@sessions/constants";
import type { SessionToolManifest } from "@sessions";
import { TOOL_SCHEMA_DIALECT } from "@tools/constants";
import { canonicalJsonEqual, toAhpToolDefinition } from "@tools/helpers/protocol";

import { ToolInvocationTransport } from "./helpers/transport";
import type { LocalToolImplementation, ToolClient, ToolClientConnection, ToolClientOptions } from "./types";

/** Connects an SDK client with the opt-in local tool invocation extension. */
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
  try {
    await client.initialize({
      clientId: options.clientId,
      protocolVersions: [...options.protocolVersions],
      initialSubscriptions: ["ahp-root://"],
    });
  } catch (error) {
    try {
      await client.shutdown();
      await transport.close();
    } catch {
      // Preserve the initialization failure while releasing the transport.
    }
    throw error;
  }

  const joins = new Map<string, Promise<void>>();
  const joinSession = async (channel: string, implementations: readonly LocalToolImplementation[]): Promise<void> => {
    const previous = joins.get(channel) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => joinSessionOnce(channel, implementations));
    joins.set(channel, current);
    try {
      await current;
    } finally {
      if (joins.get(channel) === current) joins.delete(channel);
    }
  };

  const joinSessionOnce = async (channel: string, implementations: readonly LocalToolImplementation[]): Promise<void> => {
    if (!channel.startsWith(SESSION_URI_PREFIX)) throw new TypeError("Invalid session channel.");
    const { result } = await client.subscribe(channel);
    if (result.snapshot === undefined) throw new TypeError("Session snapshot is missing.");
    const manifest = readManifest(result.snapshot.state);
    if (manifest === undefined) throw new TypeError("Session has no application tool manifest.");
    const localImplementations = new Map<string, LocalToolImplementation>();
    for (const implementation of implementations) {
      const definition = implementation.definition;
      const identity = contractIdentity(definition.id, definition.key, definition.version);
      if (localImplementations.has(identity)) throw new TypeError("Duplicate local tool implementation.");
      localImplementations.set(identity, implementation);
    }
    const chosen = manifest.toolContracts.flatMap((contract) => {
      const identity = contractIdentity(contract.id, contract.key, contract.version);
      const implementation = localImplementations.get(identity);
      return implementation === undefined ? [] : [{ contract, implementation }];
    });
    const descriptors: ToolDefinition[] = chosen.map(({ contract }) => toAhpToolDefinition({
      id: contract.id,
      key: contract.key,
      version: contract.version,
      schemaDialect: contract.schemaDialect,
      ...contract.definition,
    }));
    const token = globalThis.crypto.randomUUID();
    transport.stage(channel, token, chosen.map(({ implementation }) => implementation));
    const events = client.events();
    const action: StateAction = {
      type: ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET,
      activeClient: {
        clientId: options.clientId,
        ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
        tools: descriptors,
      },
    };
    try {
      const { clientSeq } = client.dispatch(channel, action);
      await waitForDispatchAcknowledgement(events, channel, options.clientId, clientSeq, descriptors);
      transport.activate(channel, token);
    } catch (error) {
      transport.discard(channel, token);
      await events.return?.();
      throw error;
    }
  };

  return {
    client,
    joinSession,
    callTool: (channel, ref, input) => transport.requestCall({
      channel,
      key: ref.key,
      version: ref.version,
      input,
    }),
    shutdown: async () => {
      try {
        await client.shutdown();
      } finally {
        await transport.close();
      }
    },
  };
}

async function waitForDispatchAcknowledgement(
  events: AsyncIterableIterator<{ readonly channel: string; readonly event: { readonly type: string; readonly params?: unknown } }>,
  channel: string,
  clientId: string,
  clientSeq: number,
  expectedTools: readonly ToolDefinition[],
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Timed out waiting for tool advertisement acknowledgement."));
    }, 5_000);
  });
  try {
    for (;;) {
      const next = await Promise.race([events.next(), timeout]);
      if (next.done === true) throw new Error("Tool advertisement event stream closed.");
      if (next.value.channel !== channel || next.value.event.type !== "action"
        || !isRecord(next.value.event.params)) continue;
      const envelope = next.value.event.params;
      const origin = envelope.origin;
      if (!isRecord(origin) || origin.clientId !== clientId || origin.clientSeq !== clientSeq) continue;
      if (!isRecord(envelope.action) || envelope.action.type !== "session/activeClientSet") continue;
      if (typeof envelope.rejectionReason === "string") {
        throw new Error("Server rejected the tool advertisement.");
      }
      if (!isRecord(envelope.action.activeClient) || envelope.action.activeClient.clientId !== clientId
        || !Array.isArray(envelope.action.activeClient.tools)
        || !sameToolList(envelope.action.activeClient.tools, expectedTools)) {
        throw new Error("Server acknowledged a different tool advertisement.");
      }
      return;
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await events.return?.();
  }
}

// The manifest permits multiple individually bounded definitions. Comparing
// the entire list under a single-definition byte/depth budget falsely rejects
// valid large registrations. Compare each descriptor field under that budget.
function sameToolList(actual: unknown[], expected: readonly ToolDefinition[]): boolean {
  return actual.length === expected.length && expected.every((tool, index) => {
    const candidate = actual[index];
    if (!isRecord(candidate)) return false;
    const entries = Object.entries(tool);
    return Object.keys(candidate).length === entries.length && entries.every(([key, value]) => (
      Object.hasOwn(candidate, key) && canonicalJsonEqual(candidate[key], value)
    ));
  });
}

function readManifest(state: unknown): SessionToolManifest | undefined {
  if (!isRecord(state) || !isRecord(state._meta)) return undefined;
  const raw = state._meta["x-ahp-application"];
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.sessionType) || !Array.isArray(raw.toolContracts)) return undefined;
  const sessionType = raw.sessionType;
  if (typeof sessionType.id !== "string" || typeof sessionType.key !== "string"
    || typeof sessionType.version !== "number" || !Number.isSafeInteger(sessionType.version)) return undefined;
  const toolContracts: SessionToolManifest["toolContracts"][number][] = [];
  for (const candidate of raw.toolContracts) {
    if (!isRecord(candidate) || !isRecord(candidate.definition)) return undefined;
    const definition = candidate.definition;
    if (typeof candidate.id !== "string" || typeof candidate.key !== "string"
      || typeof candidate.version !== "number" || !Number.isSafeInteger(candidate.version)
      || candidate.schemaDialect !== TOOL_SCHEMA_DIALECT || typeof definition.name !== "string"
      || !isRecord(definition.inputSchema)
      || (definition.outputSchema !== undefined && !isRecord(definition.outputSchema))) return undefined;
    const annotations = readAnnotations(definition.annotations);
    if (definition.annotations !== undefined && annotations === undefined) return undefined;
    toolContracts.push({
      id: candidate.id,
      key: candidate.key,
      version: candidate.version,
      schemaDialect: TOOL_SCHEMA_DIALECT,
      definition: {
        name: definition.name,
        ...(typeof definition.title === "string" ? { title: definition.title } : {}),
        ...(typeof definition.description === "string" ? { description: definition.description } : {}),
        inputSchema: definition.inputSchema,
        ...(isRecord(definition.outputSchema) ? { outputSchema: definition.outputSchema } : {}),
        ...(annotations === undefined ? {} : { annotations }),
      },
    });
  }
  return {
    schemaVersion: 1,
    sessionType: { id: sessionType.id, key: sessionType.key, version: sessionType.version },
    toolContracts,
  };
}

function readAnnotations(value: unknown): ToolAnnotations | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  if (value.title !== undefined && typeof value.title !== "string") return undefined;
  for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return undefined;
  }
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.readOnlyHint === "boolean" ? { readOnlyHint: value.readOnlyHint } : {}),
    ...(typeof value.destructiveHint === "boolean" ? { destructiveHint: value.destructiveHint } : {}),
    ...(typeof value.idempotentHint === "boolean" ? { idempotentHint: value.idempotentHint } : {}),
    ...(typeof value.openWorldHint === "boolean" ? { openWorldHint: value.openWorldHint } : {}),
  };
}

function contractIdentity(id: string, key: string, version: number): string {
  return `${id}\u0000${key}\u0000${String(version)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

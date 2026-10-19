import type { ActionEnvelope, ToolDefinition } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";

import { createBaselineSessionApplication } from "@application";
import {
  createApplicationSession,
  createSessionConfig,
  createSessionTypeCatalogue,
  createSessionTypeToolMap,
  createSessionsFactory,
  defineApplicationSession,
  SESSION_URI_PREFIX,
  ToolAccessLevel,
} from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createToolCatalogue, defineToolContract, toAhpToolDefinition, TOOL_CONTRACT_META_KEY } from "@tools";
import { z } from "zod";

async function readySession(type = "code-review", application = createBaselineSessionApplication()) {
  const factory = createSessionsFactory({ providers: [mockProvider], application });
  const channel = `${SESSION_URI_PREFIX}admission`;
  await createApplicationSession(factory, { channel, type });
  const contracts = application.catalogue.resolveExisting({ key: "coding", version: 1 }).tools;
  const descriptors = contracts.map(toAhpToolDefinition);
  const read = descriptors.find((tool) => tool.name === "read_file");
  const write = descriptors.find((tool) => tool.name === "write_file");
  if (read === undefined || write === undefined) {
    throw new Error("Missing baseline contract");
  }
  const envelopes: ActionEnvelope[] = [];
  factory.onSessionEnvelope((envelope) => envelopes.push(envelope));
  const advertise = (tools: ToolDefinition[], nestedClientId = "owner") => factory.dispatchAction({
    channel,
    clientId: "owner",
    clientSeq: 1,
    action: {
      type: "session/activeClientSet",
      activeClient: { clientId: nestedClientId, tools },
    },
  });
  return { factory, channel, read, write, advertise, envelopes };
}

describe("typed tool advertisement", () => {
  it("accepts a subset, normalizes advisory text, and keeps detached descriptors", async () => {
    const { factory, channel, read, advertise, envelopes } = await readySession();
    try {
      const accepted = advertise([{ ...read, description: "untrusted", annotations: { destructiveHint: false } }]);
      expect(accepted.rejectionReason).toBeUndefined();
      expect(envelopes).toHaveLength(1);
      expect(factory.getSessionSnapshot(channel)?.state.activeClients).toEqual([
        { clientId: "owner", tools: [read] },
      ]);
      if (read.inputSchema?.required !== undefined) {
        read.inputSchema.required.push("spoofed");
      }
      expect(factory.getSessionSnapshot(channel)?.state.activeClients[0]?.tools[0]?.inputSchema?.required)
        .toEqual(["path"]);
      if ("activeClient" in accepted.action) {
        accepted.action.activeClient.tools.length = 0;
      }
      expect(factory.getSessionSnapshot(channel)?.state.activeClients[0]?.tools).toHaveLength(1);
    } finally {
      await factory.dispose();
    }
  });

  const denied: Array<[string, (read: ToolDefinition, write: ToolDefinition) => ToolDefinition[]]> = [
    ["unassigned tool", (_read, write) => [write]],
    ["mixed valid and invalid tools", (read, write) => [read, write]],
    ["duplicate tools", (read) => [read, read]],
    ["missing identity", (read) => [{ ...read, _meta: {} }]],
    ["wrong revision", (read) => [{ ...read, _meta: { [TOOL_CONTRACT_META_KEY]: {
      id: "11111111-1111-4111-8111-111111111111", key: "workspace.read-file", version: 2,
    } } }]],
    ["wrong name", (read) => [{ ...read, name: "other_name" }]],
    ["missing input", (read) => {
      const missingInput = { ...read };
      delete missingInput.inputSchema;
      return [missingInput];
    }],
    ["removed required", (read) => [{ ...read, inputSchema: { ...read.inputSchema, type: "object", required: [] } }]],
    ["changed nested type", (read) => [{ ...read, inputSchema: {
      ...read.inputSchema, type: "object", properties: { path: { type: "number" } },
    } }]],
    ["weakened additionalProperties", (read) => [{ ...read, inputSchema: {
      ...read.inputSchema, type: "object", ...{ additionalProperties: true },
    } }]],
    ["extra root keyword", (read) => [{ ...read, inputSchema: {
      ...read.inputSchema, type: "object", ...{ minProperties: 2 },
    } }]],
    ["undeclared output", (read) => [{ ...read, outputSchema: { type: "object" } }]],
  ];
  it.each(denied)("rejects %s atomically without accepted events or checkpoint changes", async (_label, mutate) => {
    const { factory, channel, read, write, advertise, envelopes } = await readySession();
    try {
      const before = factory.getSessionSnapshot(channel);
      const rejected = advertise(mutate(read, write));
      expect(rejected).toMatchObject({
        origin: { clientId: "owner", clientSeq: 1 },
        rejectionReason: "Tool advertisement is not permitted for this session.",
      });
      expect(factory.getSessionSnapshot(channel)).toEqual(before);
      expect(envelopes).toEqual([]);
    } finally {
      await factory.dispose();
    }
  });

  it("does not admit an admin-hidden contract even when it belongs to the type", async () => {
    const application = {
      ...createBaselineSessionApplication(),
      authorizedTools: createSessionTypeToolMap({
        coding: [
          { ref: { key: "workspace.read-file", version: 1 }, access: ToolAccessLevel.Standard },
          { ref: { key: "workspace.write-file", version: 1 }, access: ToolAccessLevel.Admin },
        ],
      }),
    };
    const { factory, channel, write, advertise, envelopes } = await readySession("coding", application);
    try {
      expect(factory.getSessionToolManifest(channel)?.toolContracts.map((tool) => tool.key))
        .toEqual(["workspace.read-file"]);
      expect(advertise([write]).rejectionReason).toBeDefined();
      expect(factory.getSessionSnapshot(channel)?.state.activeClients).toEqual([]);
      expect(envelopes).toEqual([]);
    } finally {
      await factory.dispose();
    }
  });

  it("requires a declared output schema", async () => {
    const { factory, channel, write, advertise, envelopes } = await readySession("coding");
    try {
      const missingOutput = { ...write };
      delete missingOutput.outputSchema;
      const before = factory.getSessionSnapshot(channel);
      expect(advertise([missingOutput]).rejectionReason).toBeDefined();
      expect(factory.getSessionSnapshot(channel)).toEqual(before);
      expect(envelopes).toEqual([]);
    } finally {
      await factory.dispose();
    }
  });

  it("rejects spoofed set/removal, permits an empty set and self removal", async () => {
    const { factory, channel, advertise, envelopes } = await readySession();
    try {
      expect(advertise([], "someone-else").rejectionReason).toBeDefined();
      expect(factory.getSessionSnapshot(channel)?.state.activeClients).toEqual([]);
      expect(envelopes).toEqual([]);
      expect(advertise([]).rejectionReason).toBeUndefined();
      const before = factory.getSessionSnapshot(channel);
      expect(factory.dispatchAction({
        channel, clientSeq: 2, clientId: "owner",
        action: { type: "session/activeClientRemoved", clientId: "someone-else" },
      }).rejectionReason).toBeDefined();
      expect(factory.getSessionSnapshot(channel)).toEqual(before);
      expect(factory.dispatchAction({
        channel, clientSeq: 3, clientId: "owner",
        action: { type: "session/activeClientRemoved", clientId: "owner" },
      }).rejectionReason).toBeUndefined();
      expect(factory.getSessionSnapshot(channel)?.state.activeClients).toEqual([]);
      expect(envelopes).toHaveLength(2);
    } finally {
      await factory.dispose();
    }
  });

  it("preserves a full catalogue schema through the real action parser", async () => {
    const tool = defineToolContract({
      id: "11111111-1111-4111-8111-111111111111", key: "test.rich-schema", version: 1,
      name: "rich_schema", schemaDialect: "draft-07",
      inputSchema: {
        type: "object", minProperties: 1, maxProperties: 2, additionalProperties: { type: "string" },
        properties: { path: { type: "string" } }, required: ["path"],
      },
    });
    const config = createSessionConfig({ schema: { type: "object", properties: {} }, parser: z.object({}).strict() });
    const type = defineApplicationSession({
      id: "22222222-2222-4222-8222-222222222222", key: "rich", version: 1, providerId: "mock",
      configSchema: config.schema, config,
      tools: [{ ref: tool, access: ToolAccessLevel.Standard }],
    });
    const factory = createSessionsFactory({
      providers: [mockProvider], application: {
        catalogue: createSessionTypeCatalogue({ tools: createToolCatalogue({ definitions: [tool] }), types: [type.registration] }),
      },
    });
    try {
      const channel = `${SESSION_URI_PREFIX}rich`;
      await createApplicationSession(factory, { channel, type: type.header });
      const descriptor = toAhpToolDefinition(tool);
      const accepted = factory.dispatchAction({
        channel, clientId: "owner", clientSeq: 1,
        action: { type: "session/activeClientSet", activeClient: { clientId: "owner", tools: [descriptor] } },
      });
      expect(accepted.rejectionReason).toBeUndefined();
      expect(factory.getSessionSnapshot(channel)?.state.activeClients[0]?.tools[0]).toEqual(descriptor);
    } finally {
      await factory.dispose();
    }
  });
});

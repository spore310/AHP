import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSessionConfig, createSessionTypeCatalogue, SessionTypeError } from "@sessions";
import type { ToolCatalogue, ToolContractDefinition, ToolContractRef } from "@tools";

const schema: SessionConfigSchema = {
  type: "object",
  properties: { language: { type: "string", title: "Language" } },
  required: ["language"],
};

const readFile: ToolContractDefinition = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "workspace.read-file",
  version: 1,
  name: "read_file",
  schemaDialect: "draft-07",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

function catalogue(tools: readonly ToolContractDefinition[]): ToolCatalogue {
  return {
    get: (ref: ToolContractRef) => tools.find((tool) => tool.key === ref.key && tool.version === ref.version),
    list: () => tools,
    validateInput: () => ({ status: "valid" }),
    validateOutput: () => ({ status: "schema-not-declared" }),
  };
}

function registration(enabledForCreation: boolean) {
  return {
    definition: {
      id: "22222222-2222-4222-8222-222222222222",
      key: "code.review",
      version: 1,
      providerId: "mock",
      configSchema: schema,
      tools: [{ key: "workspace.read-file", version: 1 }],
    },
    config: createSessionConfig({
      schema,
      parser: z.object({ language: z.string().min(1) }).strict(),
    }),
    enabledForCreation,
  };
}

describe("session type catalogue", () => {
  it("resolves an exact tool revision and keeps a disabled type for existing lookup", () => {
    const types = createSessionTypeCatalogue({
      tools: catalogue([readFile]),
      types: [registration(false)],
    });

    expect(types.resolveExisting({ key: "code.review", version: 1 }).tools).toEqual([readFile]);
    expect(() => types.resolveForCreation({ key: "code.review", version: 1 })).toThrow(SessionTypeError);
    expect(() => types.resolveForCreation({ key: "code.review", version: 2 })).toThrow(SessionTypeError);
  });

  it("rejects a missing tool contract before the catalogue is returned", () => {
    expect(() => createSessionTypeCatalogue({
      tools: catalogue([]),
      types: [registration(true)],
    })).toThrow(SessionTypeError);
  });
});

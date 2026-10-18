import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createSessionConfig,
  createSessionTypeCatalogue,
  createSessionsFactory,
  SESSION_URI_PREFIX,
} from "@sessions";
import { createApplicationSession } from "@sessions/helpers/application/host";
import { createMockProvider } from "@sessions/mock";
import type { ToolCatalogue, ToolContractDefinition } from "@tools";

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
  inputSchema: { type: "object" },
};

const tools: ToolCatalogue = {
  get: (ref) => readFile.key === ref.key && readFile.version === ref.version ? readFile : undefined,
  list: () => [readFile],
  validateInput: () => ({ status: "valid" }),
  validateOutput: () => ({ status: "schema-not-declared" }),
};

const catalogue = createSessionTypeCatalogue({
  tools,
  types: [{
    definition: {
      id: "22222222-2222-4222-8222-222222222222",
      key: "code.review",
      version: 1,
      providerId: "mock",
      configSchema: schema,
      tools: [{ key: readFile.key, version: readFile.version }],
    },
    config: createSessionConfig({
      schema,
      parser: z.object({ language: z.string().min(1).optional() }).strict(),
    }),
    enabledForCreation: true,
  }],
});

describe("createApplicationSession", () => {
  it("creates a typed session from a header enum string", async () => {
    const factory = createSessionsFactory({
      providers: [createMockProvider()],
      application: { catalogue },
    });
    const channel = `${SESSION_URI_PREFIX}app-host`;

    await createApplicationSession(factory, {
      channel,
      type: "code.review",
      config: { language: "typescript" },
    });

    expect(factory.getSessionSnapshot(channel)?.state._meta).toMatchObject({
      "x-ahp-application": { key: "code.review" },
    });
  });

  it("rejects an unknown header before a session is registered", async () => {
    const factory = createSessionsFactory({
      providers: [createMockProvider()],
      application: { catalogue },
    });
    const channel = `${SESSION_URI_PREFIX}unknown-header`;

    await expect(createApplicationSession(factory, { channel, type: "code.unknown" }))
      .rejects.toThrow(/Invalid session type/);
    expect(factory.getSessionSnapshot(channel)).toBeUndefined();
  });
});

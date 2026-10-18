import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createSessionConfig,
  createSessionTypeCatalogue,
  createSessionsFactory,
  SESSION_URI_PREFIX,
} from "@sessions";
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

describe("typed session creation", () => {
  it("binds the selected type before the session is ready and strips the selector from provider config", async () => {
    const factory = createSessionsFactory({
      providers: [createMockProvider()],
      application: { catalogue },
    });
    const channel = `${SESSION_URI_PREFIX}typed`;
    const callerConfig = { "x-ahp-session-type": "code.review" };

    await factory.createSession({ channel, config: callerConfig });

    expect(callerConfig["x-ahp-session-type"]).toBe("code.review");
    const snapshot = factory.getSessionSnapshot(channel);
    expect(snapshot?.state._meta).toMatchObject({
      "x-ahp-application": {
        typeId: "22222222-2222-4222-8222-222222222222",
        key: "code.review",
        version: 1,
      },
    });
  });

  it("rejects a selector on an untyped host before registration", async () => {
    const factory = createSessionsFactory({ providers: [createMockProvider()] });
    await expect(factory.createSession({
      channel: `${SESSION_URI_PREFIX}untyped`,
      config: { "x-ahp-session-type": { key: "code.review", version: 1 } },
    })).rejects.toThrow(/Invalid session type header/);
    await expect(factory.createSession({
      channel: `${SESSION_URI_PREFIX}untyped-string`,
      config: { "x-ahp-session-type": "code.review" },
    })).rejects.toThrow(/selector is not supported/);
    expect(factory.getSessionSnapshot(`${SESSION_URI_PREFIX}untyped`)).toBeUndefined();
    expect(factory.getSessionSnapshot(`${SESSION_URI_PREFIX}untyped-string`)).toBeUndefined();
  });
});

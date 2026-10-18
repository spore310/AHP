import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSessionConfig, SessionConfigError } from "@sessions";

const workspaceSchema: SessionConfigSchema = {
  type: "object",
  properties: {
    projectKey: { type: "string", title: "Project key" },
    mode: { type: "string", title: "Mode", enum: ["fast", "slow"] },
  },
  required: ["projectKey"],
};

const workspaceParser = z
  .object({
    projectKey: z.string().min(1),
    mode: z.enum(["fast", "slow"]).default("fast"),
  })
  .strict();

function createWorkspaceConfig() {
  return createSessionConfig({
    schema: workspaceSchema,
    parser: workspaceParser,
  });
}

describe("createSessionConfig", () => {
  it("clones and protects the supplied descriptor", () => {
    const schema: SessionConfigSchema = {
      type: "object",
      properties: {
        projectKey: { type: "string", title: "Project key" },
      },
      required: ["projectKey"],
    };
    const config = createSessionConfig({ schema, parser: workspaceParser });

    schema.properties.extra = { type: "string", title: "Extra" };
    schema.required?.push("extra");
    const suppliedProjectKey = schema.properties.projectKey;
    if (suppliedProjectKey === undefined) {
      throw new Error("projectKey descriptor missing");
    }
    suppliedProjectKey.title = "Tampered";

    const frozenProjectKey = config.schema.properties.projectKey;
    if (frozenProjectKey === undefined) {
      throw new Error("frozen projectKey descriptor missing");
    }
    expect(config.schema.properties.extra).toBeUndefined();
    expect(config.schema.required).toEqual(["projectKey"]);
    expect(frozenProjectKey.title).toBe("Project key");
    expect(() => {
      config.schema.properties.other = { type: "string", title: "Other" };
    }).toThrow();
  });

  it("preserves parser defaults on valid input", () => {
    const config = createWorkspaceConfig();

    expect(config.parse({ projectKey: "example-project" })).toEqual({
      projectKey: "example-project",
      mode: "fast",
    });
  });

  it("rejects a missing required field without leaking the input", () => {
    const config = createWorkspaceConfig();

    expect(() => config.parse({})).toThrow(SessionConfigError);
    try {
      config.parse({});
      throw new Error("expected SessionConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionConfigError);
      expect((error as SessionConfigError).message).toBe(
        "Invalid session configuration at projectKey.",
      );
      expect((error as SessionConfigError).stack).not.toContain("example-project");
    }
  });

  it("rejects a wrong type without leaking the received value", () => {
    const config = createWorkspaceConfig();

    try {
      config.parse({ projectKey: 5 });
      throw new Error("expected SessionConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionConfigError);
      const message = (error as SessionConfigError).message;
      expect(message).toBe("Invalid session configuration at projectKey.");
      expect(message).not.toContain("5");
      expect(JSON.stringify(error)).not.toContain("5");
    }
  });

  it("rejects a value outside the parser enum", () => {
    const config = createWorkspaceConfig();

    try {
      config.parse({ projectKey: "example-project", mode: "turbo" });
      throw new Error("expected SessionConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionConfigError);
      expect((error as SessionConfigError).message).toBe(
        "Invalid session configuration at mode.",
      );
      expect((error as SessionConfigError).message).not.toContain("turbo");
    }
  });

  it("rejects unknown keys according to the helper's parser", () => {
    const config = createWorkspaceConfig();

    try {
      config.parse({ projectKey: "example-project", surprise: true });
      throw new Error("expected SessionConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionConfigError);
      expect((error as SessionConfigError).message).toBe(
        "Invalid session configuration at surprise.",
      );
      expect((error as SessionConfigError).message).not.toContain("true");
    }
  });

  it("sanitizes unexpected parser throws so values and stacks do not leak", () => {
    const secret = "super-secret-token";
    const config = createSessionConfig({
      schema: workspaceSchema,
      parser: {
        safeParse: (): never => {
          throw new Error(`${secret}\n    at parser.ts:1:1`);
        },
      } as unknown as z.ZodType<Record<string, unknown>>,
    });

    try {
      config.parse({ projectKey: "example-project" });
      throw new Error("expected SessionConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionConfigError);
      expect((error as SessionConfigError).message).toBe("Invalid session configuration.");
      expect((error as SessionConfigError).message).not.toContain(secret);
      expect((error as SessionConfigError).stack).not.toContain(secret);
    }
  });
});

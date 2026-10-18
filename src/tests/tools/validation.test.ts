import { describe, expect, it } from "vitest";

import { createToolCatalogue, defineToolContract } from "@tools";

const ref = { key: "workspace.read-file", version: 1 };

const catalogueWithOutput = () => createToolCatalogue({
  definitions: [
    defineToolContract({
      id: "11111111-1111-4111-8111-111111111111",
      key: ref.key,
      version: 1,
      name: "read_file",
      schemaDialect: "draft-07",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string" },
          size: { type: "integer", minimum: 1, maximum: 8 },
          mode: { type: "string", enum: ["text", "binary"] },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: { content: { type: "string" } },
      },
    }),
  ],
});

describe("tool catalogue payload validation", () => {
  it("accepts valid input without executing a tool", () => {
    const catalogue = catalogueWithOutput();
    expect(catalogue.validateInput(ref, { path: "a.txt", size: 2, mode: "text" }))
      .toEqual({ status: "valid" });
  });

  it("returns invalid for missing required, wrong type, enum, and bounds", () => {
    const catalogue = catalogueWithOutput();
    expect(catalogue.validateInput(ref, {})).toEqual({ status: "invalid" });
    expect(catalogue.validateInput(ref, { path: 1 })).toEqual({ status: "invalid" });
    expect(catalogue.validateInput(ref, { path: "a", mode: "other" })).toEqual({ status: "invalid" });
    expect(catalogue.validateInput(ref, { path: "a", size: 99 })).toEqual({ status: "invalid" });
  });

  it("does not coerce types or mutate caller data", () => {
    const catalogue = catalogueWithOutput();
    const input = { path: "1", size: "2", extra: true };
    expect(catalogue.validateInput(ref, { path: "1", size: "2" })).toEqual({ status: "invalid" });
    expect(catalogue.validateInput(ref, input)).toEqual({ status: "invalid" });
    expect(input).toEqual({ path: "1", size: "2", extra: true });
  });

  it("validates declared output and reports schema-not-declared when omitted", () => {
    const catalogue = catalogueWithOutput();
    expect(catalogue.validateOutput(ref, { content: "ok" })).toEqual({ status: "valid" });
    expect(catalogue.validateOutput(ref, { content: 1 })).toEqual({ status: "invalid" });

    const inputOnly = createToolCatalogue({
      definitions: [
        defineToolContract({
          id: "22222222-2222-4222-8222-222222222222",
          key: "workspace.ping",
          version: 1,
          name: "ping",
          schemaDialect: "draft-07",
          inputSchema: { type: "object", properties: {} },
        }),
      ],
    });
    expect(inputOnly.validateOutput({ key: "workspace.ping", version: 1 }, { ok: true }))
      .toEqual({ status: "schema-not-declared" });
  });

  it("does not leak secrets, schemas, or stacks in validation results", () => {
    const catalogue = catalogueWithOutput();
    const result = catalogue.validateInput(ref, { path: "secret-token", size: 99 });
    expect(result).toEqual({ status: "invalid" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("inputSchema");
    expect(JSON.stringify(result)).not.toContain("at ");
  });
});

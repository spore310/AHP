import { describe, expect, it } from "vitest";

import { defineToolContract, ToolContractError } from "@tool";
import { assertTrustedSchema } from "@tool/helpers/validation";

const base = (): Record<string, unknown> => ({
  id: "11111111-1111-4111-8111-111111111111",
  key: "workspace.read-file",
  version: 1,
  name: "read_file",
  schemaDialect: "draft-07",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
});

describe("tool schema admission", () => {
  const forbidden = { type: "string", format: "uri" };
  it.each([
    ["property map", { properties: { value: forbidden } }],
    ["definition map", { definitions: { value: forbidden } }],
    ["definition aliases", { $defs: { value: forbidden } }],
    ["extra property", { additionalProperties: forbidden }],
    ["property name", { propertyNames: forbidden }],
    ["item schema", { properties: { values: { items: forbidden } } }],
    ["tuple item", { properties: { values: { items: [forbidden] } } }],
    ["contains", { properties: { values: { contains: forbidden } } }],
    ["negation", { not: forbidden }],
    ["conjunction", { allOf: [forbidden] }],
    ["disjunction", { anyOf: [forbidden] }],
    ["exclusive disjunction", { oneOf: [forbidden] }],
    ["condition", { if: forbidden }],
    ["conditional branch", { then: forbidden }],
    ["alternative branch", { else: forbidden }],
    ["schema dependency", { dependencies: { value: forbidden } }],
  ] as const)("applies the profile inside a %s", (_name, schema) => {
    expect(() => {
      assertTrustedSchema({ type: "object", ...schema }, "input");
    }).toThrow(
      expect.objectContaining({ code: "unsupported-schema-feature" }),
    );
  });

  it.each(["inputSchema", "outputSchema"])("applies the schema profile to tuple extensions in %s", (role) => {
    const schema = {
      type: "object",
      properties: {
        labels: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: [{ type: "string" }],
          additionalItems: { type: "string", format: "uri" },
        },
      },
    };
    expect(() => defineToolContract({ ...base(), [role]: schema })).toThrow(
      expect.objectContaining({ code: "unsupported-schema-feature" }),
    );
  });

  it("allows schema keyword names as property names and literal data", () => {
    const inputSchema = {
      type: "object",
      properties: { pattern: { type: "string" }, type: { const: { $ref: "literal" } } },
      additionalProperties: false,
    };
    expect(defineToolContract({ ...base(), inputSchema }).inputSchema).toEqual(inputSchema);
  });

  it("rejects non-object roots", () => {
    expect(() => defineToolContract({ ...base(), inputSchema: true })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...base(), inputSchema: [] })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...base(), inputSchema: { type: "array", items: { type: "string" } } }))
      .toThrow(ToolContractError);
    expect(() => defineToolContract({ ...base(), inputSchema: null })).toThrow(ToolContractError);
  });

  it("rejects invalid nested required and enum shapes", () => {
    expect(() => defineToolContract({
      ...base(),
      inputSchema: { type: "object", required: ["path", 1], properties: { path: { type: "string" } } },
    })).toThrow(ToolContractError);
    expect(() => defineToolContract({
      ...base(),
      inputSchema: { type: "object", properties: { mode: { type: "string", enum: "text" } } },
    })).toThrow(ToolContractError);
  });

  it("rejects unknown or misspelled keywords", () => {
    expect(() => defineToolContract({
      ...base(),
      inputSchema: { type: "object", typoKeyword: true, properties: {} },
    })).toThrow(ToolContractError);
  });

  it("rejects refs, regex, format, async, and data keywords without fetching", () => {
    const unsupported = [
      { $ref: "#/definitions/path" },
      { $ref: "https://example.invalid/schema.json" },
      { type: "object", properties: { path: { type: "string", pattern: "^/" } } },
      { type: "object", patternProperties: { "^x": { type: "string" } } },
      { type: "object", properties: { path: { type: "string", format: "uri" } } },
      { type: "object", $async: true, properties: {} },
      { type: "object", properties: { n: { type: "number", minimum: { $data: "1/max" } } } },
    ];
    for (const inputSchema of unsupported) {
      expect(() => defineToolContract({ ...base(), inputSchema })).toThrow(ToolContractError);
    }
  });

  it("accepts nested objects, arrays, enums, and numeric bounds", () => {
    const definition = defineToolContract({
      ...base(),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["path"],
              properties: {
                path: { type: "string" },
                size: { type: "integer", minimum: 0, maximum: 10 },
                kind: { type: "string", enum: ["file", "dir"] },
              },
            },
          },
        },
      },
    });
    expect(definition.inputSchema.required).toEqual(["items"]);
  });
});

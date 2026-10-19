import { describe, expect, it } from "vitest";

import { defineToolContract, ToolContractError } from "@tools";

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

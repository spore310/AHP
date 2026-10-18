import { describe, expect, it } from "vitest";

import { createToolCatalogue, defineToolContract, TOOL_CONTRACT_META_KEY } from "@tools";
import { canonicalJsonEqual, toAhpToolDefinition } from "@tools/helpers/protocol";

const definition = defineToolContract({
  id: "11111111-1111-4111-8111-111111111111",
  key: "workspace.read-file",
  version: 1,
  name: "read_file",
  schemaDialect: "draft-07",
  title: "Read file",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: { path: { type: "string" } },
  },
});

describe("tool protocol projection", () => {
  it("treats reordered object keys as equal and changed values as different", () => {
    expect(canonicalJsonEqual({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
    expect(canonicalJsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(canonicalJsonEqual({ required: ["path"] }, { required: ["path"], additionalProperties: false }))
      .toBe(false);
  });

  it("treats array order as significant", () => {
    expect(canonicalJsonEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(canonicalJsonEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("projects an AHP descriptor with authoritative revision metadata", () => {
    const descriptor = toAhpToolDefinition(definition);
    expect(descriptor.name).toBe("read_file");
    expect(descriptor.inputSchema?.type).toBe("object");
    expect(descriptor._meta?.[TOOL_CONTRACT_META_KEY]).toEqual({
      id: definition.id,
      key: definition.key,
      version: definition.version,
    });
  });

  it("does not let a mutated descriptor change the catalogue contract", () => {
    const catalogue = createToolCatalogue({ definitions: [definition] });
    const descriptor = toAhpToolDefinition(definition);
    if (descriptor.inputSchema?.required !== undefined) {
      descriptor.inputSchema.required.push("forged");
    }
    if (descriptor._meta !== undefined) {
      descriptor._meta[TOOL_CONTRACT_META_KEY] = { key: "forged" };
    }
    expect(catalogue.get({ key: "workspace.read-file", version: 1 })?.inputSchema.required)
      .toEqual(["path"]);
  });
});

import { describe, expect, it } from "vitest";

import { parseUnknownJson } from "@jsonrpc";

import {
  defineToolContract,
  MAX_TOOL_DEFINITION_BYTES,
  MAX_TOOL_DEFINITION_DEPTH,
  TOOL_CONTRACT_META_KEY,
  ToolContractError,
} from "@tools";

const READ_FILE_ID = "11111111-1111-4111-8111-111111111111";

const readFileSeed = (): Record<string, unknown> => ({
  id: READ_FILE_ID,
  key: "workspace.read-file",
  version: 1,
  name: "read_file",
  schemaDialect: "draft-07",
  title: "Read file",
  description: "Read a workspace file.",
  annotations: { readOnlyHint: true },
  metadata: { owner: "workspace" },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1 },
      maxBytes: { type: "integer", minimum: 1, maximum: 1024 },
      mode: { type: "string", enum: ["text", "binary"] },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
      content: { type: "string" },
    },
  },
});

describe("defineToolContract", () => {
  it("accepts a bounded read-file contract and keeps exact identity", () => {
    const seed = readFileSeed();
    const first = defineToolContract(seed);
    const second = defineToolContract(seed);
    expect(first.id).toBe(READ_FILE_ID);
    expect(first.key).toBe("workspace.read-file");
    expect(first.version).toBe(1);
    expect(first.name).toBe("read_file");
    expect(second.id).toBe(first.id);
    expect(first.inputSchema.required).toEqual(["path"]);
    expect(first.outputSchema).toMatchObject({ type: "object" });
  });

  it("accepts a no-argument object input and omitted output schema", () => {
    const definition = defineToolContract({
      id: READ_FILE_ID,
      key: "workspace.ping",
      version: 1,
      name: "ping",
      schemaDialect: "draft-07",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    });
    expect(definition.outputSchema).toBeUndefined();
    expect(definition.inputSchema.properties).toEqual({});
  });

  it("rejects blank or malformed identity", () => {
    const seed = readFileSeed();
    expect(() => defineToolContract({ ...seed, key: "" })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, key: "ReadFile" })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, name: "" })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, name: "read file" })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, id: "not-a-uuid" })).toThrow(ToolContractError);
  });

  it("rejects missing, coerced, and out-of-range versions", () => {
    const seed = readFileSeed();
    for (const version of [undefined, "1", true, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, MAX_TOOL_DEFINITION_BYTES]) {
      if (version === MAX_TOOL_DEFINITION_BYTES) {
        continue;
      }
      expect(() => defineToolContract({ ...seed, version })).toThrow(ToolContractError);
    }
    expect(() => defineToolContract({ ...seed, version: 2_147_483_648 })).toThrow(ToolContractError);
  });

  it("rejects non-JSON values, holes, class instances, and cycles", () => {
    const seed = readFileSeed();
    expect(() => defineToolContract({ ...seed, title: () => "x" })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, metadata: { n: 1n } })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, metadata: { n: Number.NaN } })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, metadata: { n: Number.POSITIVE_INFINITY } })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, metadata: { n: undefined } })).toThrow(ToolContractError);
    expect(() => defineToolContract({ ...seed, metadata: { when: new Date() } })).toThrow(ToolContractError);
    const hole: unknown[] = [];
    hole[1] = "x";
    expect(() => defineToolContract({ ...seed, metadata: { hole } })).toThrow(ToolContractError);
    const cyclic: Record<string, unknown> = { ...seed };
    cyclic.self = cyclic;
    expect(() => defineToolContract(cyclic)).toThrow(ToolContractError);
  });

  it("rejects accessor definitions instead of invoking them", () => {
    const seed = readFileSeed();
    const sneaky = {
      ...seed,
      get name(): string {
        throw new Error("getter-ran");
      },
    };
    expect(() => defineToolContract(sneaky)).toThrow(ToolContractError);
  });

  it("rejects oversized and over-deep definitions", () => {
    const seed = readFileSeed();
    expect(() => defineToolContract({
      ...seed,
      description: "x".repeat(MAX_TOOL_DEFINITION_BYTES),
    })).toThrow(ToolContractError);

    let nested: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < MAX_TOOL_DEFINITION_DEPTH + 2; index += 1) {
      nested = { type: "object", properties: { child: nested } };
    }
    expect(() => defineToolContract({
      ...seed,
      inputSchema: nested,
    })).toThrow(ToolContractError);
  });

  it("rejects reserved metadata overwrite", () => {
    const seed = readFileSeed();
    expect(() => defineToolContract({
      ...seed,
      metadata: { [TOOL_CONTRACT_META_KEY]: { key: "forged" } },
    })).toThrow(ToolContractError);
  });

  it("does not let later mutation of the seed change the captured definition", () => {
    const seed = readFileSeed();
    const required = seed.inputSchema as { required: string[] };
    const definition = defineToolContract(seed);
    required.required.push("forged");
    (seed.inputSchema as { properties: Record<string, unknown> }).properties.path = { type: "number" };
    seed.key = "workspace.other";
    expect(definition.key).toBe("workspace.read-file");
    expect(definition.inputSchema.required).toEqual(["path"]);
    expect((definition.inputSchema.properties as { path: { type: string } }).path.type).toBe("string");
  });

  it("round-trips through JSON without functions or library objects", () => {
    const definition = defineToolContract(readFileSeed());
    const restored = parseUnknownJson(JSON.stringify(definition));
    if (typeof restored !== "object" || restored === null || !("id" in restored) || !("key" in restored)) {
      throw new Error("expected a JSON object");
    }
    expect(restored.id).toBe(READ_FILE_ID);
    expect(restored.key).toBe("workspace.read-file");
    expect(JSON.stringify(restored)).not.toContain("validate");
    expect(typeof definition.inputSchema).toBe("object");
  });
});

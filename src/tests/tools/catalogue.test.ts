import { describe, expect, it } from "vitest";

import { createToolCatalogue, defineToolContract, ToolContractError } from "@tools";

const idOne = "11111111-1111-4111-8111-111111111111";
const idTwo = "22222222-2222-4222-8222-222222222222";

const contract = (overrides: Record<string, unknown> = {}): ReturnType<typeof defineToolContract> =>
  defineToolContract({
    id: idOne,
    key: "workspace.read-file",
    version: 1,
    name: "read_file",
    schemaDialect: "draft-07",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: { path: { type: "string" } },
    },
    ...overrides,
  });

describe("createToolCatalogue", () => {
  it("looks up exact revisions and does not fall back to latest", () => {
    const v1 = contract();
    const v2 = contract({
      id: idTwo,
      version: 2,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" }, extra: { type: "boolean" } },
      },
    });
    const catalogue = createToolCatalogue({ definitions: [v1, v2] });
    expect(catalogue.get({ key: "workspace.read-file", version: 1 })?.id).toBe(idOne);
    expect(catalogue.get({ key: "workspace.read-file", version: 2 })?.id).toBe(idTwo);
    expect(catalogue.get({ key: "workspace.read-file", version: 3 })).toBeUndefined();
    expect(catalogue.validateInput({ key: "workspace.read-file", version: 3 }, { path: "a" }))
      .toEqual({ status: "missing-contract" });
    expect(catalogue.list().map((entry) => entry.version)).toEqual([1, 2]);
  });

  it("rejects duplicate key/version and duplicate UUID atomically", () => {
    const first = contract();
    expect(() => createToolCatalogue({
      definitions: [first, contract({ id: idTwo })],
    })).toThrow(ToolContractError);
    expect(() => createToolCatalogue({
      definitions: [first, contract({ key: "workspace.other" })],
    })).toThrow(ToolContractError);
  });

  it("does not expose a catalogue when a later seed is invalid", () => {
    expect(() => createToolCatalogue({
      definitions: [contract(), { key: "bad" } as never],
    })).toThrow(ToolContractError);
  });

  it("returns detached copies from get and list", () => {
    const catalogue = createToolCatalogue({ definitions: [contract()] });
    const first = catalogue.get({ key: "workspace.read-file", version: 1 });
    const listed = catalogue.list()[0];
    if (first === undefined || listed === undefined) {
      throw new Error("expected definitions");
    }
    (first.inputSchema as { properties: { path: { type: string } } }).properties.path.type = "number";
    (listed.inputSchema.required as string[]).push("forged");
    expect(catalogue.get({ key: "workspace.read-file", version: 1 })?.inputSchema)
      .toMatchObject({ properties: { path: { type: "string" } }, required: ["path"] });
    expect(catalogue.validateInput({ key: "workspace.read-file", version: 1 }, { path: "a.txt" }))
      .toEqual({ status: "valid" });
  });

  it("keeps separate catalogues isolated when built from shared seeds", () => {
    const seed = contract();
    const first = createToolCatalogue({ definitions: [seed] });
    const second = createToolCatalogue({ definitions: [seed] });
    const got = first.get({ key: "workspace.read-file", version: 1 });
    if (got === undefined) {
      throw new Error("expected definition");
    }
    (got.inputSchema as { properties: { path: { type: string } } }).properties.path.type = "number";
    expect(second.get({ key: "workspace.read-file", version: 1 })?.inputSchema)
      .toMatchObject({ properties: { path: { type: "string" } } });
  });
});

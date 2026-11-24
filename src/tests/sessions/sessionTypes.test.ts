import type { SessionConfigSchema } from "@microsoft/agent-host-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSessionConfig, createSessionTypeCatalogue, defineApplicationSession, SessionTypeError } from "@sessions";
import { captureSessionApplication } from "@sessions/helpers/application/helpers";
import { resolveWorkKind } from "@work/helpers/definitions";
import type { SessionWorkPolicyRegistration } from "@work/helpers/authorization";
import assert from "node:assert/strict";
import type { ToolCatalogue, ToolContractDefinition, ToolContractRef } from "@tool";

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
  it("pins work and restoration callbacks at application definition and through protected factory capture", async () => {
    const base = registration(true);
    const ref = { id: "work.inspect", revision: 1 };
    const refs = [ref];
    const work = { operations: { read: { purpose: "discover" as const, policies: refs } },
      prepare: () => Promise.resolve({ effect: "deny" as const, release() {} }) } satisfies SessionWorkPolicyRegistration;
    const restoration = { prepare: () => Promise.resolve(undefined) };
    const rules = { admitted: { policies: [ref], namespaces: [] }, mandatory: [] };
    const app = defineApplicationSession({ ...base.definition, config: base.config, tools: [], work: [{ kind: "review" }],
      policy: { work, rules, restoration, creation: { capability: { key: "create", revision: 1 }, prepare: work.prepare } } });
    refs.length = 0;
    work.prepare = () => {
      throw new Error("Replaced work callback");
    };
    restoration.prepare = () => {
      throw new Error("Replaced restoration callback");
    };
    const definitions = createSessionTypeCatalogue({ tools: catalogue([]), types: [app.registration] });
    const factory = captureSessionApplication({ catalogue: definitions }, true);
    const policy = factory?.catalogue.resolveExisting(base.definition).policy;
    expect(policy?.work?.operations.read?.policies).toEqual([ref]);
    expect(Object.isFrozen(policy?.work?.operations.read?.policies)).toBe(true);
    assert.ok(policy?.work?.prepare && policy.restoration);
    const session = { domainId: "d", kind: "session" as const, id: "session", instanceId: "instance" };
    const actor = { kind: "user" as const, principal: { domainId: "d", subject: "s" } };
    const signal = new AbortController().signal;
    await expect(policy.work.prepare({ caller: { actor, authRevision: "1", connectionId: "test" }, operation: "read", session,
      entities: { owner: actor.principal, submitter: actor }, kind: "review", input: {}, data: {}, scope: [], announce: [] }, signal)).resolves.toMatchObject({ effect: "deny" });
    await expect(policy.restoration.prepare({ signal, session: { ref: session, type: base.definition, owner: "s", providerId: "mock", state: {},
      stateRevision: "1", graphRevision: "1", lifecycle: "active", lastServerSeq: 0, createdAt: "", modifiedAt: "" } })).resolves.toBeUndefined();
    expect(definitions.list()[0]).not.toHaveProperty("policy");
  });
  it("preserves work descriptors without runtime code throughout application and protected catalogue capture", () => {
    const base = registration(true);
    const saved = { tags: ["snow"] };
    const contract = { parse() {
      return saved;
    } };
    const review = { kind: "review", inputSchema: { type: "object" }, maxAttempts: 7, input: contract, result: contract, data: contract };
    const work = [review];
    const app = defineApplicationSession({ ...base.definition, config: base.config, tools: [], work });
    const definitions = createSessionTypeCatalogue({ tools: catalogue([]), types: [app.registration] });
    const captured = captureSessionApplication({ catalogue: definitions }, true);
    const expected = [{ kind: "review", inputSchema: { type: "object" }, maxAttempts: 7 }];
    review.maxAttempts = 1;
    contract.parse = () => {
      throw new Error("Replaced parser");
    };
    expect(definitions.list()[0]).toHaveProperty("work", expected);
    expect(captured?.catalogue.list()[0]).toHaveProperty("work", expected);
    assert.ok(captured);
    const pinned = resolveWorkKind(captured.catalogue.resolveExisting(base.definition), "review");
    const normalized = [pinned.parseInput({}), pinned.parseData({}), pinned.parseResult({})];
    saved.tags.length = 0;
    for (const value of normalized) expect(value).toEqual({ tags: ["snow"] });
    expect(() => pinned.parseInput({ data: "x".repeat(65536) })).toThrow();
    expect(() => resolveWorkKind(captured.catalogue.resolveExisting(base.definition), "other")).toThrow();
  });
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

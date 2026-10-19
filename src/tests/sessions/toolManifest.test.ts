import { describe, expect, it } from "vitest";

import { createBaselineSessionApplication } from "@application";
import {
  createApplicationSession,
  createSessionTypeToolMap,
  createSessionsFactory,
  SESSION_URI_PREFIX,
  ToolAccessLevel,
} from "@sessions";
import { mockProvider } from "@sessions/mock";

describe("typed session tool manifest", () => {
  it("lists the visible tool schemas and does not allocate a sequence to read them", async () => {
    const factory = createSessionsFactory({
      providers: [mockProvider],
      application: createBaselineSessionApplication(),
    });
    const channel = `${SESSION_URI_PREFIX}manifest-review`;

    await createApplicationSession(factory, { channel, type: "code-review" });
    const before = factory.getCurrentServerSeq();
    const manifest = factory.getSessionToolManifest(channel);
    const snapshot = factory.getSessionSnapshot(channel);

    expect(manifest?.sessionType).toMatchObject({ key: "code-review", version: 1 });
    expect(manifest?.toolContracts.map((tool) => tool.key)).toEqual([
      "workspace.read-file",
      "workspace.search",
    ]);
    expect(manifest?.toolContracts[0]?.definition.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(snapshot?.state._meta).toMatchObject({ "x-ahp-application": manifest });
    expect(snapshot?.state.serverTools).toBeUndefined();
    expect(snapshot?.state.activeClients).toEqual([]);
    expect(factory.getCurrentServerSeq()).toBe(before);
    expect(factory.getSessionToolManifest(`${SESSION_URI_PREFIX}missing`)).toBeUndefined();

    await factory.dispose();
  });

  it("returns detached manifests and pins factory policy against caller mutation", async () => {
    const application = createBaselineSessionApplication();
    const externalGrants = createSessionTypeToolMap({
      "code-review": [{ ref: { key: "workspace.read-file", version: 1 }, access: ToolAccessLevel.Standard }],
    });
    const mutableOptions = { ...application, authorizedTools: externalGrants };
    const factory = createSessionsFactory({ providers: [mockProvider], application: mutableOptions });
    try {
      const first = `${SESSION_URI_PREFIX}pinned-first`;
      const second = `${SESSION_URI_PREFIX}pinned-second`;
      await createApplicationSession(factory, { channel: first, type: "code-review" });
      const manifest = factory.getSessionToolManifest(first);
      const original = structuredClone(manifest);
      const schema = manifest?.toolContracts[0]?.definition.inputSchema;
      if (schema === undefined) {
        throw new Error("Missing schema");
      }
      Object.assign(schema, { additionalProperties: true });
      mutableOptions.authorizedTools = createSessionTypeToolMap({ "code-review": [] });
      await createApplicationSession(factory, { channel: second, type: "code-review" });
      expect(factory.getSessionToolManifest(first)).toEqual(original);
      expect(factory.getSessionToolManifest(second)).toEqual(original);
      expect(factory.getSessionSnapshot(first)?.state._meta?.["x-ahp-application"]).toEqual(original);
    } finally {
      await factory.dispose();
    }
  });

  it("rejects eager typed advertisements before registration or publication", async () => {
    const factory = createSessionsFactory({
      providers: [mockProvider], application: createBaselineSessionApplication(),
    });
    const notifications: unknown[] = [];
    factory.onCatalogueNotification((notification) => notifications.push(notification));
    try {
      const channel = `${SESSION_URI_PREFIX}eager-denied`;
      const before = factory.getCurrentServerSeq();
      await expect(factory.createSession({
        channel, activeClient: { clientId: "forged", tools: [] },
      })).rejects.toMatchObject({ name: "SessionsError", code: -32602 });
      expect(factory.getSessionSnapshot(channel)).toBeUndefined();
      expect(factory.getSessionToolManifest(channel)).toBeUndefined();
      expect(factory.getCurrentServerSeq()).toBe(before);
      expect(notifications).toEqual([]);
    } finally {
      await factory.dispose();
    }
  });

  it("ignores caller metadata in the server-authored manifest and does not expose config", async () => {
    const factory = createSessionsFactory({
      providers: [mockProvider], application: createBaselineSessionApplication(),
    });
    try {
      const channel = `${SESSION_URI_PREFIX}server-manifest`;
      await factory.createSession({
        channel,
        config: { language: "private-language-value" },
        _meta: { "x-ahp-application": { schemaVersion: 999, toolContracts: ["forged"] } },
      });
      const manifest = factory.getSessionToolManifest(channel);
      expect(manifest?.schemaVersion).toBe(1);
      expect(manifest?.toolContracts).toHaveLength(2);
      expect(JSON.stringify(manifest)).not.toContain("private-language-value");
      expect(factory.getSessionSnapshot(channel)?.state._meta?.["x-ahp-application"]).toEqual(manifest);
    } finally {
      await factory.dispose();
    }
  });

  it("returns undefined for untyped sessions without a fabricated manifest", async () => {
    const factory = createSessionsFactory({ providers: [mockProvider] });
    try {
      const channel = `${SESSION_URI_PREFIX}legacy`;
      await factory.createSession({ channel });
      expect(factory.getSessionToolManifest(channel)).toBeUndefined();
      expect(factory.getSessionSnapshot(channel)?.state._meta).toBeUndefined();
    } finally {
      await factory.dispose();
    }
  });

  it("lists the larger coding set without changing an existing review session", async () => {
    const factory = createSessionsFactory({
      providers: [mockProvider],
      application: createBaselineSessionApplication(),
    });
    const review = `${SESSION_URI_PREFIX}manifest-review-2`;
    const coding = `${SESSION_URI_PREFIX}manifest-coding`;

    await createApplicationSession(factory, { channel: review, type: "code-review" });
    await createApplicationSession(factory, { channel: coding, type: "coding" });

    expect(factory.getSessionToolManifest(review)?.toolContracts).toHaveLength(2);
    expect(factory.getSessionToolManifest(coding)?.toolContracts.map((tool) => tool.key)).toEqual([
      "workspace.read-file",
      "workspace.search",
      "workspace.write-file",
    ]);

    await factory.dispose();
  });
});

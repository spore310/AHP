import { beforeEach, describe, expect, it, vi } from "vitest";

const loadProvider = vi.fn(async () => ({
  registrations: {},
  sessions: {},
  work: {},
  dispose: async () => undefined,
}));

vi.mock("@persistence/helpers/adapters/postgres", () => ({
  createPostgresPersistenceProvider: loadProvider,
}));

describe("configured persistence provider selection", () => {
  beforeEach(() => loadProvider.mockClear());

  it("loads the default PostgreSQL provider lazily and translates neutral options", async () => {
    const { createConfiguredPersistenceProvider } = await import("@persistence/helpers/adapters");
    await createConfiguredPersistenceProvider({
      options: { url: "postgres://example", workLeaseSeconds: 45, maxConnections: 3 },
    });
    expect(loadProvider).toHaveBeenCalledWith({
      connectionString: "postgres://example",
      maxConnections: 3,
      leaseTtlSeconds: 45,
    });
  });

  it("rejects unsupported selectors without loading PostgreSQL", async () => {
    const { createConfiguredPersistenceProvider } = await import("@persistence/helpers/adapters");
    await expect(createConfiguredPersistenceProvider({ provider: "unknown", options: {} }))
      .rejects.toThrow("not supported");
    expect(loadProvider).not.toHaveBeenCalled();
  });

  it("validates adapter options before constructing its provider", async () => {
    const { createConfiguredPersistenceProvider } = await import("@persistence/helpers/adapters");
    await expect(createConfiguredPersistenceProvider({ options: { url: "", workLeaseSeconds: 0 } }))
      .rejects.toThrow("Invalid PostgreSQL persistence configuration");
    expect(loadProvider).not.toHaveBeenCalled();
  });
});

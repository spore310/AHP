import { describe, expect, it, vi } from "vitest";

describe("PostgreSQL provider partial construction", () => {
  it("awaits one pool cleanup when a repository factory fails", async () => {
    vi.resetModules();
    const end = vi.fn(() => Promise.resolve());
    vi.doMock("@persistence/helpers/adapters/postgres/helpers/connection", () => ({
      createPostgresPool: () => ({ end }),
    }));
    vi.doMock("@persistence/helpers/adapters/postgres/helpers/agentRegistrations", () => ({
      createPostgresAgentRegistrationRepository: () => {
        throw new Error("safe construction failure");
      },
    }));
    const { createPostgresPersistenceProvider } = await import("@persistence/helpers/adapters/postgres");
    await expect(createPostgresPersistenceProvider({ connectionString: "postgres://localhost/unused" }))
      .rejects.toThrow("safe construction failure");
    expect(end).toHaveBeenCalledOnce();
    vi.doUnmock("@persistence/helpers/adapters/postgres/helpers/connection");
    vi.doUnmock("@persistence/helpers/adapters/postgres/helpers/agentRegistrations");
  });
});

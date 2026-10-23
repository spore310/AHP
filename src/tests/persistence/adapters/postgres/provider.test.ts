import { describe, expect, it } from "vitest";

import { createPostgresPersistenceProvider } from "@persistence/helpers/adapters/postgres";

describe("PostgreSQL persistence provider", () => {
  it("exposes all repository namespaces and disposes its owned pool idempotently", async () => {
    const provider = createPostgresPersistenceProvider({ connectionString: "postgres://localhost/unused" });
    expect(provider.registrations).toBeDefined();
    expect(provider.sessions).toBeDefined();
    expect(provider.work).toBeDefined();
    const first = provider.dispose();
    expect(provider.dispose()).toBe(first);
    await first;
  });

  it("validates options before allocating a pool", () => {
    expect(() => createPostgresPersistenceProvider({ connectionString: "", leaseTtlSeconds: 0 }))
      .toThrow("Invalid PostgreSQL persistence options");
  });
});

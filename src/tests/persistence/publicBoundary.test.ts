import { describe, expect, it, vi } from "vitest";

describe("@persistence public boundary", () => {
  it("exports the neutral contract without evaluating PostgreSQL", async () => {
    vi.resetModules();
    vi.doMock("pg", () => {
      throw new Error("The neutral persistence root evaluated pg.");
    });
    const persistence = await import("@persistence");
    expect(persistence.RepositoryError).toBeDefined();
    expect(persistence.createPersistence).toBeDefined();
    expect(persistence.isPortableText).toBeDefined();
    vi.doUnmock("pg");
  });
});

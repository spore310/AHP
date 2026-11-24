import { EventEmitter } from "node:events";
import { DatabaseError } from "pg";
import { expect, it, vi } from "vitest";
import { createPostgresDurableStorage } from "@persistence/helpers/adapters/postgres";

const query = vi.fn<(sql: string) => Promise<{ rows: unknown[]; rowCount: number }>>();
const release = vi.fn();
const pools: EventEmitter[] = [];
vi.mock("pg", async (original) => ({
  ...await original<typeof import("pg")>(),
  Pool: class extends EventEmitter {
    constructor() {
      super();
      pools.push(this);
    }

    connect() { return Promise.resolve({ query, release }); }
    end() { return Promise.resolve(); }
  },
}));
vi.mock("@persistence/helpers/adapters/postgres/helpers/ownership", () => ({
  acquirePostgresOwnership: () => Promise.resolve({ epoch: "1", serverSeq: 0, isOpen: () => true,
    lock: () => Promise.resolve(), release: () => Promise.resolve() }),
}));

const store = createPostgresDurableStorage({ connectionString: "postgresql://localhost/unused" });
const ref = { kind: "session" as const, domainId: "test", id: "test", instanceId: crypto.randomUUID() };
const serverRefusal = Object.assign(new DatabaseError("constraint violation", 0, "error"), { code: "23514", severity: "ERROR" });
it.each([
  { failure: Object.assign(new Error("write failed"), { code: "EPIPE" }), uncertain: true },
  { failure: serverRefusal, uncertain: false },
])("distinguishes the outcome of a rejected COMMIT ($failure.code)", async ({ failure, uncertain }) => {
  const host = await store.acquire("test", () => undefined);
  query.mockReset().mockImplementation((sql) => sql === "COMMIT" ? Promise.reject(failure) : Promise.resolve({ rows: [], rowCount: 0 }));
  release.mockClear();
  try {
    const purge = host.sessions.purge(ref, "2026-01-01");
    await expect(purge).rejects.toMatchObject(uncertain ? { name: "DurableCommitUncertain" } : { code: "database" });
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(!uncertain);
    expect(release).toHaveBeenCalledExactlyOnceWith(uncertain);
  } finally {
    await host.release();
  }
});

it("keeps the durable owner open when an idle transaction client disconnects", async () => {
  const host = await store.acquire("test", () => undefined);
  try {
    const pool = pools.at(-1);
    if (!pool) throw new Error("Durable host did not create a pool.");
    expect(() => pool.emit("error", new Error("idle transaction client lost"))).not.toThrow();
    expect(host.isOpen()).toBe(true);
  } finally {
    await host.release();
  }
});

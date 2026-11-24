import assert from "node:assert/strict";
import { createMemoryDurableStorage, type DurableStorage } from "@persistence";
import type { ProviderSessionInput, RuntimeResourceDriver } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { channel, createReviewHost } from "./advanced/host";

const url = process.env.AHP_TEST_DATABASE_URL;
let storage: DurableStorage = createMemoryDurableStorage();
if (url !== undefined) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Supply a disposable loopback PostgreSQL database.");
  const { createPostgresDurableStorage } = await import("@persistence/helpers/adapters/postgres");
  storage = createPostgresDurableStorage({ connectionString: url });
}
const backing = new Set<string>();
const driver: RuntimeResourceDriver = {
  kind: "chat", key: "example.chat", version: 1,
  captureRecoveryInput: () => ({}),
  ensure({ operationId }) {
    backing.add(operationId);
    return Promise.resolve({ metadata: { operationId }, release() {} });
  },
  restore({ operationId }) {
    assert.ok(backing.has(operationId));
    return Promise.resolve({ metadata: { operationId }, release() {} });
  },
  destroy({ operationId }) {
    backing.delete(operationId);
    return Promise.resolve();
  },
};
let input: ProviderSessionInput | undefined;
const provider = { ...mockProvider, drivers: [driver],
  startSession(value: ProviderSessionInput) {
    input = value;
    return Promise.resolve({ dispose() {} });
  },
  restoreSession(value: ProviderSessionInput) {
    input = value;
    return Promise.resolve({ dispose() {} });
  },
};
const start = () => createReviewHost("direct", { durability: { storage, hostId: "durable-lifecycle" }, provider,
  restoration: { prepare() { return Promise.resolve({ bindings: [], isCurrent: () => true }); } } });
const first = start();
try {
  await first.host.start();
  await first.provision(["file:///approved"]);
  assert.ok(input?.resources && input.session);
  const original = input.session;
  const child = await input.resources.create({ kind: "chat", id: "chat:/durable", parent: original, driver });
  assert.deepEqual(await input.resources.replaceData(child, { expectedDataRevision: "1", data: { labels: ["雪", {}] } }),
    { status: "updated", value: { dataRevision: "2", data: { labels: ["雪", {}] } } });
  await first.host.sessions.dispatchAction({ channel, clientId: "local", clientSeq: 1, action: { type: "session/titleChanged", title: "Restored title" } });
  await first.stop();
  const second = start();
  try {
    await second.host.start();
    assert.deepEqual(second.host.sessions.authorization?.getResource(channel), original);
    assert.equal(second.host.sessions.getSessionSnapshot(channel)?.state.title, "Restored title");
    assert.deepEqual(await input.resources.readData(child), { dataRevision: "2", data: { labels: ["雪", {}] } });
    assert.equal(backing.size, 1);
    assert.ok(await second.host.sessions.authorization.disposeSession(original));
    assert.equal(backing.size, 0);
    assert.ok(await second.host.sessions.durability?.purge(original, "2100-01-01T00:00:00Z"));
  } finally { await second.stop(); }
} finally { await first.stop(); }
process.stdout.write(`Durable lifecycle passed (${url ? "PostgreSQL" : "memory"}).\n`);

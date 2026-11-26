/**
 * Scenario A: one host, one derived namespace, no distributed dependency.
 *
 *   pnpm exec vite-node examples/host-single.ts
 */
import assert from "node:assert/strict";
import { createAHPServer } from "@host";
import { mockProvider } from "@sessions/mock";

const server = createAHPServer({
  // Network interface. Unrelated to the logical host name below.
  host: "127.0.0.1",
  port: 0,
  sessions: { providers: [mockProvider] },
  // The stable, app-style host name. Mode defaults to `single` and the
  // namespace is derived from the name.
  topology: { hostId: "support-app" },
});
try {
  const address = await server.start();
  const status = server.status();
  assert.deepEqual([status.mode, status.phase, status.ready, status.namespaceId], ["single", "active", true, "ahp-namespace:support-app/default"]);
  const ready = await fetch(`http://127.0.0.1:${String(address.port)}/readyz`);
  assert.equal(ready.status, 200);
  process.stdout.write(`Single host ${String(status.hostId)} is ready in ${String(status.namespaceId)} on port ${String(address.port)}.\n`);
} finally {
  await server.stop();
}

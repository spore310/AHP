import assert from "node:assert/strict";
import { createBaselineSessionApplication } from "@application";
import { createApplicationSession } from "@sessions";
import { mockProvider } from "@sessions/mock";
import { createAHPServer } from "@websocket";

const channel = "ahp-session:/first-review";
const host = createAHPServer({ host: "127.0.0.1", port: 0, sessions: {
  providers: [mockProvider], application: createBaselineSessionApplication(),
} });

try {
  const address = await host.start();
  // A trusted application call. Remote connections have separate authentication and read gates.
  await createApplicationSession(host.sessions, { channel, type: "code-review" });
  const snapshot = host.sessions.getSessionSnapshot(channel);
  assert.equal(snapshot?.state.lifecycle, "ready");
  process.stdout.write(`Host listening on ${address.address}:${String(address.port)}\nSession ${channel} is ready\n`);
} finally {
  await host.stop();
}

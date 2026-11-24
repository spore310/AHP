import assert from "node:assert/strict";
import { Client } from "pg";

/** Drop a single acknowledgement after the real PostgreSQL transaction has committed. */
export async function loseCommitAcknowledgement(prefix: string, marker: string, operation: () => Promise<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply preserves each client as receiver.
  const query = Client.prototype.query;
  let writer: unknown;
  let injected = false;
  Client.prototype.query = new Proxy(query, {
    apply(original, client: unknown, args: unknown[]) {
      const result: unknown = Reflect.apply(original, client, args);
      if (typeof args[0] === "string" && args[0].startsWith(prefix) && Array.isArray(args[1]) && args[1].includes(marker)) writer = client;
      if (!injected && writer === client && args[0] === "COMMIT" && result instanceof Promise) {
        return result.then(() => {
          injected = true;
          throw Object.assign(new Error("Injected lost COMMIT acknowledgement"), { code: "EPIPE" });
        });
      }
      return result;
    },
  });
  try {
    await assert.rejects(operation(), { name: "DurableCommitUncertain" });
  } finally {
    Client.prototype.query = query;
  }
  assert.equal(injected, true);
}

import { expect, it } from "vitest";

import { JSONRPC_INVALID_PARAMS, RpcError } from "@jsonrpc";
import { connectToolClient } from "@toolClient";
import { createWebSocketServer } from "@websocket";

it("closes the actual client socket when initialization fails", async () => {
  const closed = Promise.withResolvers<undefined>();
  const server = createWebSocketServer({
    host: "127.0.0.1", port: 0,
    onConnection: (context) => {
      context.onClose(() => {
        closed.resolve(undefined);
      });
    },
    handlers: {
      initialize: () => {
        throw new RpcError(JSONRPC_INVALID_PARAMS, "Initialization rejected");
      },
    },
  });
  const address = await server.start();
  try {
    await expect(connectToolClient(`ws://127.0.0.1:${String(address.port)}/`, {
      clientId: "rejected", protocolVersions: ["1.0.0"],
    })).rejects.toThrow();
    // Must close before server.stop(), not as a side effect of test cleanup.
    await closed.promise;
  } finally {
    await server.stop();
  }
});

import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { ClientTransport } from "./helpers/transport";
import type { Client, ClientConnection, ClientOptions } from "./types";

export async function connectClient(connection: ClientConnection, options: ClientOptions): Promise<Client> {
  const inner = connection.transport;
  const release = connection.ownership === "borrowed" ? connection.detach.bind(connection) : inner.close.bind(inner);
  const transport = new ClientTransport(inner, release);
  const protocol = new AhpClient(transport);
  const shutdownNative = protocol.shutdown.bind(protocol);
  let closing: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    if (!closing) {
      const ended = Promise.withResolvers<undefined>();
      closing = ended.promise;
      const release = transport.close();
      void Promise.all([shutdownNative(), release]).then(() => {
        ended.resolve(undefined);
      }, ended.reject);
    }
    return closing;
  }
  // Native, tool and general callers share the release receipt even if the
  // native SDK has already observed EOF and would otherwise return early.
  protocol.shutdown = shutdown;
  try {
    const states = protocol.stateChanges();
    async function observeNativeEnd(): Promise<void> {
      try {
        for (;;) {
          const next = await states.next();
          if (next.done || next.value.status === "closed") return;
        }
      } finally {
        // The SDK can finish its receive loop without closing the supplied
        // transport. Its state iterator also needs an explicit cursor release.
        const retiring = shutdown();
        await Promise.all([retiring, Promise.resolve().then(() => states.return?.())]);
      }
    }
    void observeNativeEnd().catch(() => undefined);
    protocol.connect();
    await protocol.initialize({ clientId: options.clientId, protocolVersions: [...options.protocolVersions], initialSubscriptions: [] });
    if (transport.signal.aborted) throw new Error("Client closed during initialization.");
    return { protocol, rpc: transport, lifetime: transport, shutdown };
  } catch (error) {
    await shutdown().catch(() => undefined);
    throw error;
  }
}

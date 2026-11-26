import { afterEach } from "vitest";
import type { DurableStorage, PersistenceProvider } from "@persistence";
import { createExamplePersistence } from "../../../examples/advanced/persistence";
import { createExampleMembership, createExampleNode, ExamplePeer, freePort, sharePersistence, type ExampleMembership, type ExampleNodeOptions } from "../../../examples/host/support";

export const sharedNamespace = "ahp-namespace:review/shared";
export type ExampleNode = ReturnType<typeof createExampleNode>;
const cleanup: (() => Promise<unknown>)[] = [];
export const onCleanup = (release: () => Promise<unknown>): void => {
  cleanup.push(release);
};
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) await release().catch(() => undefined);
});

export interface Cluster {
  readonly membership: ExampleMembership;
  readonly storage: DurableStorage;
  readonly persistence: PersistenceProvider;
  readonly endpoints: ReadonlyMap<string, string>;
  node(hostId: string): ExampleNode;
  url(hostId: string): string;
  /** Starts (or restarts) one logical host of the cluster. */
  start(hostId: string, overrides?: Partial<ExampleNodeOptions>): Promise<ExampleNode>;
  peer(hostId: string, subject: string, clientId?: string, subscriptions?: readonly string[]): Promise<ExamplePeer & { initialized: Awaited<ReturnType<ExamplePeer["initialize"]>> }>;
}

/** Several distributed example hosts in one process, sharing one in-memory namespace store. */
export async function createCluster(hostIds: readonly string[], overrides: Partial<ExampleNodeOptions> = {}, startAll = true): Promise<Cluster> {
  const ports = new Map<string, number>();
  for (const hostId of hostIds) ports.set(hostId, await freePort());
  const endpoints = new Map(hostIds.map((hostId) => [hostId, `ws://127.0.0.1:${String(ports.get(hostId))}/`]));
  const membership = createExampleMembership(sharedNamespace, hostIds.map((hostId) => ({ hostId, endpoint: endpoints.get(hostId) })));
  const { provider } = createExamplePersistence();
  const storage = provider.durability;
  if (!storage) throw new Error("The example persistence has no durable storage.");
  const nodes = new Map<string, { node: ExampleNode; url: string }>();
  const cluster: Cluster = {
    membership, storage, persistence: provider, endpoints,
    node: (hostId) => nodes.get(hostId)?.node ?? (() => {
      throw new Error(`No node ${hostId}`);
    })(),
    url: (hostId) => nodes.get(hostId)?.url ?? "",
    async start(hostId, extra = {}) {
      const node = createExampleNode({ hostId, mode: "distributed", namespaceId: sharedNamespace, membership, storage, persistence: sharePersistence(provider),
        routing: { host: "127.0.0.1", port: ports.get(hostId) ?? 0, endpoint: endpoints.get(hostId) ?? "" }, ...overrides, ...extra });
      onCleanup(() => node.stop());
      const address = await node.host.start();
      nodes.set(hostId, { node, url: `ws://127.0.0.1:${String(address.port)}/` });
      return node;
    },
    async peer(hostId, subject, clientId = `${subject}@${hostId}`, subscriptions = []) {
      const connected = await ExamplePeer.connect(cluster.url(hostId), subject);
      onCleanup(() => connected.close());
      const initialized = await connected.initialize(clientId, subscriptions);
      return Object.assign(connected, { initialized });
    },
  };
  if (startAll) for (const hostId of hostIds) await cluster.start(hostId);
  return cluster;
}

/** Polls a condition that depends on asynchronous event delivery. */
export async function eventually<T>(read: () => T | undefined | Promise<T | undefined>, label: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

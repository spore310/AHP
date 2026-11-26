import { createServer } from "node:net";
import WebSocket from "ws";
import { generateHostCredential, type HostCredential, type HostRoutingOptions, type HostTopologyMode, type NamespacePolicy } from "@host";
import { parseUnknownJson } from "@jsonrpc";
import type { DurableStorage, PersistenceProvider } from "@persistence";
import { mockProvider } from "@sessions/mock";
import { createReviewHost } from "../advanced/host";

/** Synthetic example credentials. A deployment supplies each host's secret from its own secret provider. */
export interface ExampleMembership {
  readonly policy: NamespacePolicy;
  readonly credentials: ReadonlyMap<string, HostCredential>;
}

/**
 * Builds trusted membership policy for a set of logical hosts. Every member is
 * configured with the same policy; each host receives only its own secret.
 */
export const createExampleMembership = (namespaceId: string, hosts: readonly { readonly hostId: string; readonly endpoint?: string; readonly maxInstances?: number }[],
  revision = 1): ExampleMembership => {
  const credentials = new Map<string, HostCredential>();
  const policy: NamespacePolicy = { namespaceId, revision, members: hosts.map(({ hostId, endpoint, maxInstances }) => {
    const { credential, verifier } = generateHostCredential(`${hostId}-key-${String(revision)}`);
    credentials.set(hostId, credential);
    return { hostId, credentials: [verifier], ...(endpoint === undefined ? {} : { endpoints: [endpoint] }), ...(maxInstances === undefined ? {} : { maxInstances }) };
  }) };
  return { policy, credentials };
};

/** Asks the operating system for a currently free loopback port. */
export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => {
      if (address === null || typeof address === "string") reject(new Error("No free port."));
      else resolve(address.port);
    });
  });
});

export interface ExampleNodeOptions {
  readonly hostId: string;
  readonly mode: HostTopologyMode;
  readonly namespaceId: string;
  /** Omit for a single host with no membership policy. */
  readonly membership?: ExampleMembership;
  readonly storage: DurableStorage;
  readonly persistence: PersistenceProvider;
  readonly publicPort?: number;
  readonly publicHost?: string;
  /** Distributed mode only: where this host serves connections relayed by other members. */
  readonly routing?: HostRoutingOptions;
  /** Per-connection initial authority, for example to withhold sequence consent from one subject. */
  readonly initialAuthority?: import("@websocket/helpers/security").InitialAuthoritySource;
  /** Longest wait for one provider lifecycle callback. */
  readonly callbackDeadlineMs?: number;
  /** Requires TLS endpoints in the membership policy and on the internal listener. */
  readonly requireTls?: boolean;
  readonly instanceId?: string;
  readonly leaseMs?: number;
  readonly standbyRetryMs?: number;
  readonly adoption?: "manual" | "automatic";
  readonly provider?: import("@sessions").SessionProvider;
  readonly onDiagnostic?: (event: string) => void;
}

/** One example review host configured for a multi-host topology. */
export const createExampleNode = (options: ExampleNodeOptions) => {
  const credential = options.membership?.credentials.get(options.hostId);
  if (options.membership !== undefined && credential === undefined) throw new Error("No example credential for that host.");
  return createReviewHost("direct", {
    durability: { storage: options.storage, hostId: options.hostId, ...(options.callbackDeadlineMs === undefined ? {} : { callbackDeadlineMs: options.callbackDeadlineMs }) },
    ...(options.initialAuthority === undefined ? {} : { initialAuthority: options.initialAuthority }),
    provider: options.provider ?? mockProvider,
    persistence: options.persistence,
    autoGrant: true,
    // Durable native title, read and archive changes are admitted for the session's senior reviewer only.
    nativeWrites: { admit: ({ context }) => context.actor.principal.subject === "senior" },
    listen: { host: options.publicHost ?? "127.0.0.1", port: options.publicPort ?? 0 },
    topology: {
      hostId: options.hostId, namespaceId: options.namespaceId, mode: options.mode,
      ...(options.instanceId === undefined ? {} : { instanceId: options.instanceId }),
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
      ...(options.standbyRetryMs === undefined ? {} : { standbyRetryMs: options.standbyRetryMs }),
      ...(options.adoption === undefined ? {} : { adoption: options.adoption }),
      ...(options.membership === undefined || credential === undefined ? {} : { admission: { policy: options.membership.policy, credential, ...(options.requireTls === undefined ? {} : { requireTls: options.requireTls }) } }),
      ...(options.routing === undefined ? {} : { routing: options.routing }),
    },
  });
};

interface Frame { readonly id?: number; readonly method?: string; readonly params?: Record<string, unknown>; readonly result?: unknown; readonly error?: { readonly code: number; readonly message: string } }

const frameToText = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
};

/** Minimal JSON-RPC peer that keeps every received frame in arrival order. */
export class ExamplePeer {
  readonly frames: Frame[] = [];
  private nextId = 1;
  private readonly waiters = new Set<() => void>();
  private constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.frames.push(parseUnknownJson(frameToText(data)) as Frame);
      for (const wake of [...this.waiters]) wake();
    });
    socket.on("close", () => {
      for (const wake of [...this.waiters]) wake();
    });
  }

  /** The example authenticator reads the subject from the offered subprotocol. */
  static connect(url: string, subject: string): Promise<ExamplePeer> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, `demo-${subject}`);
      socket.once("open", () => {
        resolve(new ExamplePeer(socket));
      });
      socket.once("error", reject);
      socket.once("unexpected-response", (_request, response) => {
        reject(new Error(`Upgrade refused with status ${String(response.statusCode)}`));
      });
    });
  }

  get closed(): boolean {
    return this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING;
  }

  wait<T>(find: () => T | undefined, timeoutMs = 5_000, label = "frame"): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = (): void => {
        const found = find();
        if (found === undefined) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(found);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Timed out waiting for ${label}.`));
      }, timeoutMs);
      this.waiters.add(check);
      check();
    });
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs = 5_000): Promise<Frame> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return this.wait(() => this.frames.find((frame) => frame.id === id && frame.method === undefined) ?? (this.closed ? { id, error: { code: -1, message: "closed" } } : undefined), timeoutMs, method);
  }

  async call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>, timeoutMs = 5_000): Promise<T> {
    const reply = await this.request(method, params, timeoutMs);
    if (reply.error !== undefined) throw new Error(`${method} failed: ${String(reply.error.code)} ${reply.error.message}`);
    return reply.result as T;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  initialize(clientId: string, initialSubscriptions: readonly string[] = []): Promise<{ serverSeq: number; snapshots: { resource: string; fromSeq: number; state: Record<string, unknown> }[] }> {
    return this.call("initialize", { channel: "ahp-root://", clientId, protocolVersions: ["1.0.0"], initialSubscriptions });
  }

  /** Native action envelopes in the order this connection received them. */
  actions(channel?: string): { channel: string; serverSeq: number; action: Record<string, unknown> }[] {
    return this.frames.filter((frame) => frame.method === "action" && (channel === undefined || frame.params?.channel === channel))
      .map((frame) => frame.params as { channel: string; serverSeq: number; action: Record<string, unknown> });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.socket.once("close", () => {
        resolve();
      });
      this.socket.terminate();
    });
  }
}

/** A persistence view that several example hosts can share without one disposing it for the others. */
export const sharePersistence = (provider: PersistenceProvider): PersistenceProvider => ({ ...provider, dispose: () => Promise.resolve() });

export const sessionUri = (name: string): string => `ahp-session:/${name}`;

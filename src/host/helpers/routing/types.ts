import type { TrustedHandshakeContext } from "@agents/types";
import type { JsonRpcMessage } from "@jsonrpc";
import type { HostCoordination } from "@persistence/helpers/durability/types";
import type { JsonRpcHandlers, WebSocketConnectionContext } from "@websocket/types";
import type { ConnectionSetupAdapter } from "@websocket/helpers/security/types";
import type { HostAdmission } from "../admission";

/** Replaceable request/reply capability between hosts. The first adapter is WebSocket. */
export type HostLinkFactory = (options: HostLinkOptions) => Promise<HostLink>;

export interface HostLinkOptions {
  readonly hostId: string;
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maxPending: number;
  readonly tls?: { readonly ca?: string | Buffer | readonly (string | Buffer)[]; readonly rejectUnauthorized?: boolean };
  onNotification(message: JsonRpcMessage): void;
}

export interface HostLink {
  readonly hostId: string;
  isOpen(): boolean;
  pending(): number;
  /**
   * `after` delays what this peer sent after the reply until it resolves, so a
   * reply forwarded to the caller is enqueued before the notifications that
   * followed it. An `ordered` request's own reply also waits behind such a
   * hold: it confirms that everything earlier has been handed over.
   */
  request(method: string, params: unknown, after?: Promise<void>, ordered?: boolean): Promise<unknown>;
  notify(method: string, params: unknown): boolean;
  onClose(handler: () => void): void;
  close(): void;
}

/** Content the ingress forwards so the owner can authenticate the original caller itself. */
export interface ForwardedHandshake {
  readonly v: 1;
  /** Relayed connections are never relayed again. */
  readonly hop: 1;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly remoteAddress?: string;
}

export interface HostRouterOptions {
  readonly admission: HostAdmission;
  readonly coordination: () => HostCoordination | undefined;
  /** True when this process currently serves that session itself. */
  readonly isLocal: (sessionUri: string) => boolean;
  /** Resolves once this host has sent everything it already committed for that connection. */
  readonly settleLocal: (connectionId: string) => Promise<void>;
  readonly connect?: HostLinkFactory;
  readonly tls?: HostLinkOptions["tls"];
  readonly requestTimeoutMs: number;
  readonly maxPending: number;
  readonly maxLinksPerConnection: number;
  readonly orderTimeoutMs: number;
}

export interface HostRouter {
  /** Wraps the public method table so a request for a session owned elsewhere reaches its owner. */
  wrapHandlers(handlers: JsonRpcHandlers): JsonRpcHandlers;
  /** Captures each public handshake so the owner can verify the same credential again. */
  wrapSetup(adapter: ConnectionSetupAdapter): ConnectionSetupAdapter;
  attach(context: WebSocketConnectionContext): void;
  stats(): { readonly connections: number; readonly links: number; readonly pending: number; readonly held: number };
  /** Ownership or membership changed: cached locations are forgotten. */
  invalidate(): void;
  close(): void;
}

export interface CapturedHandshake {
  readonly handshake: TrustedHandshakeContext;
}

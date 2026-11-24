import type { AhpClient, AhpTransport } from "@microsoft/agent-host-protocol/client";

export type ClientConnection
  = | { readonly transport: AhpTransport; readonly ownership: "owned" }
    | { readonly transport: AhpTransport; readonly ownership: "borrowed"; readonly detach: () => void | Promise<void> };
export interface ClientOptions {
  readonly clientId: string;
  readonly displayName?: string;
  readonly protocolVersions: readonly string[];
}
export interface ExtensionRpcOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Release a remote resource when its creation is acknowledged after cancellation. */
  readonly releaseLate?: (response: unknown) => unknown;
}
export interface ExtensionRpcClient {
  request(method: string, params: unknown, options?: ExtensionRpcOptions): Promise<unknown>;
  notify(method: string, params: unknown, options?: ExtensionRpcOptions): Promise<void>;
  onNotification(method: string, receive: (params: unknown) => unknown): () => void;
}
export interface ClientLifetime {
  readonly signal: AbortSignal;
  addCleanup(cleanup: () => void): () => void;
}
export interface Client {
  readonly protocol: AhpClient;
  readonly rpc: ExtensionRpcClient;
  readonly lifetime: ClientLifetime;
  shutdown(): Promise<void>;
}

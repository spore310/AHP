import type { ErrorInfo } from "@microsoft/agent-host-protocol";

import { RpcError } from "@/jsonrpc";

/**
 * A session-capability failure carrying the JSON-RPC/AHP error code the
 * transport must surface.
 *
 * Extending the owned {@link RpcError} lets the WebSocket dispatcher preserve
 * these codes without importing this module. Codes come from the Microsoft
 * package's `JsonRpcErrorCodes` / `AhpErrorCodes`, so the wire contract stays
 * single-sourced.
 */
export class SessionsError extends RpcError {
  constructor(code: number, message: string) {
    super(code, message);
    this.name = "SessionsError";
  }
}

/**
 * Raised by a provider's {@link SessionConfigContract.parse} when the supplied
 * configuration is invalid. The message is deliberately public and becomes the
 * `InvalidParams` error surfaced for a bad `createSession.config`.
 */
export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigError";
  }
}

/**
 * Raised by a {@link SessionProvider} when it cannot start a session. The
 * carried {@link ErrorInfo} becomes the `session/creationFailed` action payload,
 * so providers report structured creation failures instead of opaque rejections.
 *
 * This is an intentional public-error boundary: only `errorType` and `message`
 * are forwarded; `stack` and `_meta` stay internal.
 */
export class SessionStartError extends Error {
  /** Details surfaced on `session/creationFailed`. */
  readonly info: ErrorInfo;

  constructor(info: ErrorInfo) {
    super(info.message);
    this.name = "SessionStartError";
    this.info = info;
  }
}

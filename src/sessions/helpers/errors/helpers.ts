import type { ErrorInfo } from "@microsoft/agent-host-protocol";

/**
 * A session-capability failure carrying the JSON-RPC/AHP error code the
 * transport layer must surface. Codes come from the Microsoft package's
 * `JsonRpcErrorCodes` / `AhpErrorCodes`, so the wire contract stays single-sourced.
 */
export class SessionsError extends Error {
  /** JSON-RPC/AHP error code (e.g. `AhpErrorCodes.SessionAlreadyExists`). */
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "SessionsError";
    this.code = code;
  }
}

/**
 * Raised by a {@link SessionProvider} when it cannot start a session. The
 * carried {@link ErrorInfo} becomes the `session/creationFailed` action payload,
 * so providers report structured creation failures instead of opaque rejections.
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

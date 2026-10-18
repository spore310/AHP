import { AhpErrorCodes, JsonRpcErrorCodes } from "@microsoft/agent-host-protocol";

/**
 * An RPC error a capability raises for the transport to surface to a client.
 *
 * This is the single owned error type the WebSocket dispatcher recognises, so a
 * capability can report an expected wire error without the transport importing
 * that capability's error class. Because recognition is by `instanceof`, an
 * arbitrary thrown object that merely carries a numeric `code` is not trusted.
 */
export class RpcError extends Error {
  /** JSON-RPC/AHP error code, e.g. `AhpErrorCodes.SessionAlreadyExists`. */
  readonly code: number;
  /** Optional structured payload for codes that define one. */
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

/** Narrows an unknown thrown value to an owned {@link RpcError}. */
export const isRpcError = (value: unknown): value is RpcError => value instanceof RpcError;

/**
 * Error codes the transport is willing to surface to clients.
 *
 * Codes come only from the protocol's own code sets, so a capability cannot
 * surface an arbitrary numeric code even through the owned error type. Anything
 * outside this set is reported as a generic internal error.
 */
export const JSONRPC_PUBLIC_ERROR_CODES: ReadonlySet<number> = new Set([
  ...Object.values(JsonRpcErrorCodes),
  ...Object.values(AhpErrorCodes),
]);

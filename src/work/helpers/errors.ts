import type { WorkErrorCode } from "../types";

/** A sanitized domain failure that the wire adapter may map to JSON-RPC. */
export class WorkError extends Error {
  constructor(
    readonly code: WorkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkError";
  }
}

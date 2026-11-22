/** Sanitized agent-directory failure codes. */
export type AgentDirectoryErrorCode = "invalid" | "not_found" | "unauthorized" | "conflict";

/**
 * A domain failure raised by the agent directory.
 *
 * Messages are generic and safe to surface through the transport adapter; they
 * never contain credentials, connection identifiers, or another principal's
 * registration details.
 */
export class AgentDirectoryError extends Error {
  constructor(
    readonly code: AgentDirectoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentDirectoryError";
  }
}

import type { ErrorInfo } from "@microsoft/agent-host-protocol";

/** Options for the deterministic mock session type. */
export interface MockProviderOptions {
  /**
   * When set, every `startSession` rejects with this {@link ErrorInfo},
   * exercising the `session/creationFailed` lifecycle.
   */
  readonly failCreation?: ErrorInfo;
}

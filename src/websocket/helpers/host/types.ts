import type { AddressInfo } from "node:net";

import type { SessionsFactory, SessionsFactoryOptions } from "@sessions/types";

/** Options for a composed Agent Hosting Protocol host. */
export interface AHPServerOptions {
  readonly host: string;
  readonly port: number;
  readonly path?: string;
  /** Session factory options. The host creates and owns the factory. */
  readonly sessions: SessionsFactoryOptions;
}

/**
 * A host that owns its transport, AHP binding, and session factory.
 * `sessions` is not usable to revive the host after `stop()`.
 */
export interface AHPServerHandle {
  start(): Promise<AddressInfo>;
  stop(): Promise<void>;
  readonly sessions: SessionsFactory;
}

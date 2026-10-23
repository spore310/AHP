import type { AddressInfo } from "node:net";

import type { ConnectionAuthenticator } from "@agents";
import type { AgentRegistrationRepository, WorkRepository } from "@persistence/types";
import type { SessionsFactory, SessionsFactoryOptions } from "@sessions/types";

/**
 * Optional durable agent and work-leasing wiring.
 *
 * When present, the host creates the in-memory agent directory and work
 * service; the transport authenticates the upgrade before any AHP frame is
 * dispatched. When absent, the baseline host is unchanged and the extension
 * methods are not registered.
 */
export interface AHPServerAgentWorkOptions {
  readonly authenticator: ConnectionAuthenticator;
  readonly registrations: AgentRegistrationRepository;
  readonly work: WorkRepository;
  /** Work kinds that may be submitted or claimed. */
  readonly allowedKinds: ReadonlySet<string>;
  /** Presence lifetime; defaults to the agent directory default. */
  readonly presenceTtlMs?: number;
  /** Clock used for presence deadlines and work-service validation. */
  readonly now?: () => number;
  /** Releases host-owned resources (for example, a database pool). */
  readonly dispose?: () => Promise<void>;
}

/** Options for a composed Agent Hosting Protocol host. */
export interface AHPServerOptions {
  readonly host: string;
  readonly port: number;
  readonly path?: string;
  /** Session factory options. The host creates and owns the factory. */
  readonly sessions: SessionsFactoryOptions;
  /** Optional authenticated agent identity and durable work leasing. */
  readonly agentWork?: AHPServerAgentWorkOptions;
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

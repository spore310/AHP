import type {
  ActionEnvelope,
  AgentInfo,
  SessionAddedParams,
  SessionConfigSchema,
  SessionState,
  SessionSummaryChangedParams,
} from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { SESSION_URI_PREFIX } from "./constants";

/**
 * Schema for a session channel URI (`ahp-session:/<id>`). The identifier is
 * client-chosen and server-unique, so only the scheme and a non-empty
 * identifier are constrained here.
 */
export const sessionUriSchema = z
  .string()
  .startsWith(SESSION_URI_PREFIX)
  .refine((uri): boolean => uri.length > SESSION_URI_PREFIX.length, {
    message: `A session URI must carry an identifier after "${SESSION_URI_PREFIX}".`,
  });

/** Everything a {@link SessionProvider} needs to bring up one session backend. */
export interface ProviderSessionInput {
  /** The session channel URI being created. */
  readonly sessionUri: string;
  /** Working directories granted to the session's agent. */
  readonly workingDirectories: readonly string[];
  /**
   * Configuration normalized by the provider's own
   * {@link SessionConfigContract.parse}, which the factory invokes before any
   * session is registered or started.
   */
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * A provider's session configuration contract: the descriptor clients see and
 * the single runtime parser the factory invokes.
 *
 * The provider owns both halves so the advertised schema and the accepted
 * values cannot drift, and so unknown-key/required/default policy is decided by
 * the session type rather than assumed from an empty JSON Schema.
 */
export interface SessionConfigContract {
  /** Descriptor advertised to clients for this session type's configuration. */
  readonly schema: SessionConfigSchema;
  /**
   * Validates and normalizes a candidate configuration. Runs before session
   * registration and startup; throw {@link SessionConfigError} for input the
   * provider rejects. The returned object is what `startSession` receives.
   */
  parse(config: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

/** The live backend a provider returns for a created session. */
export interface SessionBackend {
  /** Releases whatever the backend holds. Called at factory shutdown. */
  dispose(): Promise<void> | void;
}

/**
 * Contract every session type implements.
 *
 * A provider owns one agent backend and never touches the wire protocol: it
 * receives validated, normalized session inputs and either resolves with a
 * backend or throws {@link SessionStartError} to surface `session/creationFailed`.
 */
export interface SessionProvider {
  /** Stable provider id clients pass in `createSession.provider`. */
  readonly providerId: string;
  /** Agent descriptor advertised on the root channel. */
  readonly agentInfo: AgentInfo;
  /**
   * Optional session configuration contract. When absent the provider accepts no
   * session configuration, and non-empty `createSession.config` is rejected.
   */
  readonly config?: SessionConfigContract;
  /** Initialises the backend for a new session. Resolves ready, rejects failed. */
  startSession(input: ProviderSessionInput): Promise<SessionBackend>;
}

/** Root-channel catalogue events the factory emits for the sessions it owns. */
export interface SessionAddedCatalogueNotification {
  readonly method: "root/sessionAdded";
  readonly params: SessionAddedParams;
}

export interface SessionSummaryChangedCatalogueNotification {
  readonly method: "root/sessionSummaryChanged";
  readonly params: SessionSummaryChangedParams;
}

export type CatalogueNotification
  = SessionAddedCatalogueNotification | SessionSummaryChangedCatalogueNotification;

/** One live session owned by the factory. */
export interface SessionRecord {
  readonly sessionUri: string;
  readonly provider: SessionProvider;
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string;
  /** Last modification timestamp (ISO 8601); advances with every applied action. */
  modifiedAt: string;
  /** Authoritative session state, advanced only through the session reducer. */
  state: SessionState;
  /**
   * Latest sequence assigned from the host's shared allocator; `0` before any
   * action. The record never mints wire-level sequence numbers itself.
   */
  serverSeq: number;
  /** Backend handle once the provider has started; absent while `creating`. */
  backend?: SessionBackend;
}

/**
 * Storage seam for live sessions.
 *
 * The only implementation is in-memory, since no persistence exists yet; a
 * durable store replaces this contract's implementation without touching the
 * session methods.
 */
export interface SessionRegistry {
  readonly size: number;
  has(sessionUri: string): boolean;
  add(record: SessionRecord): void;
  get(sessionUri: string): SessionRecord | undefined;
  delete(sessionUri: string): boolean;
  records(): SessionRecord[];
  clear(): void;
}

/**
 * Internal wiring shared by the session methods. Not part of the public surface
 * exported from `@/sessions`.
 */
export interface SessionsDependencies {
  readonly providers: ReadonlyMap<string, SessionProvider>;
  readonly defaultProviderId: string;
  readonly sessions: SessionRegistry;
  readonly now: () => Date;
  /** Host-owned allocator for the connection-wide action sequence. */
  readonly nextServerSeq: () => number;
  emitCatalogueNotification(notification: CatalogueNotification): void;
  emitSessionEnvelope(envelope: ActionEnvelope): void;
}

/**
 * A session snapshot whose `state` is narrowed to {@link SessionState}.
 *
 * Structurally assignable to the protocol `Snapshot`, so it still flows through
 * the connection layer, while giving in-process callers a typed session state.
 */
export interface SessionSnapshot {
  readonly resource: string;
  readonly state: SessionState;
  readonly fromSeq: number;
}

/** Construction options for {@link SessionsFactory}. */
export interface SessionsFactoryOptions {
  /** Session types this host can create sessions with. At least one is required. */
  readonly providers: readonly SessionProvider[];
  /** Provider used when `createSession.provider` is omitted. Defaults to the first registered. */
  readonly defaultProviderId?: string;
  /** Clock used for session timestamps. Defaults to the system clock. */
  readonly now?: () => Date;
  /**
   * Host-owned allocator for the one connection-wide action sequence. Inject a
   * shared allocator when the host publishes other channels' actions onto the
   * same stream. Defaults to a fresh monotonic allocator for this factory.
   */
  readonly nextServerSeq?: () => number;
}

/** Transport-agnostic session factory: the host's only way to create sessions. */
export interface SessionsFactory {
  /**
   * Creates a session at the client-chosen URI. Validates params, enforces the
   * create-session contract, registers the session, emits `root/sessionAdded`,
   * then settles its lifecycle with `session/ready` or `session/creationFailed`.
   *
   * Rejects with a {@link SessionsError} carrying the AHP/JSON-RPC error code.
   */
  createSession(params: unknown): Promise<void>;
  /** Current snapshot for a session, or `undefined` when no such session exists. */
  getSessionSnapshot(sessionUri: string): SessionSnapshot | undefined;
  /** Agent descriptors for every registered provider, for the root channel catalogue. */
  listAgents(): AgentInfo[];
  /** Subscribes to root catalogue events. Returns an unsubscribe function. */
  onCatalogueNotification(listener: (notification: CatalogueNotification) => void): () => void;
  /** Subscribes to session action envelopes. Returns an unsubscribe function. */
  onSessionEnvelope(listener: (envelope: ActionEnvelope) => void): () => void;
  /** Disposes every live backend and drops all sessions and listeners. */
  dispose(): Promise<void>;
}

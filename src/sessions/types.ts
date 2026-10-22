import type {
  ActionEnvelope,
  AgentInfo,
  SessionAddedParams,
  SessionConfigSchema,
  SessionRemovedParams,
  SessionState,
  SessionSummary,
  SessionSummaryChangedParams,
} from "@microsoft/agent-host-protocol";
import { z } from "zod";

import { SESSION_URI_PREFIX } from "./constants";
import type { SessionApplicationBinding, SessionApplicationOptions } from "./helpers/application";
import type { SessionToolManifest } from "./helpers/application/manifest";
import type { ActionSequence } from "./helpers/sequence";

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
 * The provider owns both halves and is responsible for keeping them in step:
 * the advertised schema must describe what `parse` accepts. Co-locating them
 * (or deriving one from the other) makes that easier; per-provider conformance
 * tests are the enforcement point. Unknown-key, required, and default policy is
 * decided by the session type rather than assumed from an empty JSON Schema.
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

export interface SessionRemovedCatalogueNotification {
  readonly method: "root/sessionRemoved";
  readonly params: SessionRemovedParams;
}

export type CatalogueNotification
  = SessionAddedCatalogueNotification
    | SessionSummaryChangedCatalogueNotification
    | SessionRemovedCatalogueNotification;

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
  /** Exact session-type binding for a typed host. Absent for untyped sessions. */
  application?: SessionApplicationBinding;
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
 * Sanitized lifecycle diagnostic for a failure no caller can observe.
 *
 * Late backend cleanup happens detached from any request, so failures are
 * reported to the host's diagnostic sink instead of being published or thrown.
 * The payload carries stable identifiers only: never exception text or stacks.
 */
export interface SessionsDiagnostic {
  /** Stable machine-readable event name. */
  readonly event: "lateBackendDisposeFailed";
  /** Session whose detached backend could not be released. */
  readonly sessionUri: string;
  /** Error constructor name, or `"unknown"` for non-`Error` throwables. */
  readonly errorType: string;
}

/**
 * Internal wiring shared by the session methods. Not part of the public surface
 * exported from `@/sessions`.
 */
export interface SessionsDependencies {
  readonly providers: ReadonlyMap<string, SessionProvider>;
  readonly defaultProviderId: string;
  readonly sessions: SessionRegistry;
  readonly application?: SessionApplicationOptions;
  readonly now: () => Date;
  /** Host-owned allocator for the connection-wide action sequence. */
  readonly nextServerSeq: () => number;
  emitCatalogueNotification(notification: CatalogueNotification): void;
  emitSessionEnvelope(envelope: ActionEnvelope): void;
  /** Reports a sanitized lifecycle diagnostic to the host-owned sink. */
  reportDiagnostic(diagnostic: SessionsDiagnostic): void;
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
   * Shared action-sequence port. The same instance may be injected into other
   * producers so envelopes stay on one cursor. When omitted, the factory creates
   * its own. `getCurrentServerSeq()` reads `current()` and never allocates.
   */
  readonly sequence?: ActionSequence;
  /**
   * Legacy allocator adapter. Used only when {@link sequence} is omitted. The
   * adapter's `current()` tracks calls this factory makes, not other producers
   * that invoke the same function directly. Prefer {@link sequence}.
   */
  readonly nextServerSeq?: () => number;
  /**
   * Creates the live-session registry for this factory. Invoked once at
   * construction. Defaults to the in-memory registry. This is a synchronous
   * live-state port, not a database.
   */
  readonly registryFactory?: () => SessionRegistry;
  /**
   * Receives sanitized lifecycle diagnostics, such as a detached late backend
   * cleanup failure. Never receives exception text or stacks. Defaults to
   * dropping diagnostics; the composition root can route them to its logger.
   */
  readonly onDiagnostic?: (diagnostic: SessionsDiagnostic) => void;
  /**
   * When present, session creation requires an exact session type. Untyped hosts
   * omit this and reject a session-type selector instead of ignoring it.
   */
  readonly application?: SessionApplicationOptions;
}

/** Transport-agnostic session factory: the host's only way to create sessions. */
export interface SessionsFactory {
  /**
   * Creates a session at the client-chosen URI. Validates params, enforces the
   * create-session contract, registers the session, emits `root/sessionAdded`,
   * then settles its lifecycle with `session/ready` or `session/creationFailed`.
   *
   * `onRecordCreated` is invoked synchronously at the moment this call attaches
   * its session record — before the backend is started and before the record
   * can be removed again — so identity-scoped installers (for example owner
   * bindings) can never outlive their own record: a create whose record is
   * disposed while its backend is still starting resolves without re-binding.
   *
   * Rejects with a {@link SessionsError} carrying the AHP/JSON-RPC error code.
   * While {@link dispose} is in flight, creation is rejected with
   * `SessionsDisposingError` rather than registered after the disposal boundary.
   */
  createSession(
    params: unknown,
    onRecordCreated?: (sessionUri: string) => void,
  ): Promise<void>;
  /** Current snapshot for a session, or `undefined` when no such session exists. */
  getSessionSnapshot(sessionUri: string): SessionSnapshot | undefined;
  /**
   * Allowed tool contracts for a typed session, or `undefined` when the session
   * is missing or untyped. Does not create a session or allocate a sequence number.
   */
  getSessionToolManifest(sessionUri: string): SessionToolManifest | undefined;
  /** Root-state snapshot of all sessions, or the current server-sequence cursor. */
  listSessionSnapshots(): SessionSnapshot[];
  /**
   * Lists non-disposed session summaries, most recently modified first.
   * Omitting `limit` returns the whole catalogue. An unrecognized cursor rejects.
   */
  listSessions(params: unknown): { items: SessionSummary[]; nextCursor?: string };
  /**
   * Removes one live session, emits `root/sessionRemoved`, and releases its backend.
   * A missing session rejects with `SessionNotFound` and emits nothing.
   */
  disposeSession(params: unknown): Promise<void>;
  /** Current host-owned action sequence value. */
  getCurrentServerSeq(): number;
  /** Agent descriptors for every registered provider, for the root channel catalogue. */
  listAgents(): AgentInfo[];
  /**
   * Dispatch a client action against a live session.
   *
   * Validates `clientSeq` and the action payload before looking up the target.
   * Supported baseline actions are reduced once and emitted as an accepted
   * envelope. Valid-but-unsupported pinned actions are not reduced and do not
   * emit an accepted envelope.
   */
  dispatchAction(params: {
    readonly channel: string;
    readonly clientSeq: unknown;
    readonly action: unknown;
    readonly clientId: string;
  }): ActionEnvelope;
  /** Subscribes to root catalogue events. Returns an unsubscribe function. */
  onCatalogueNotification(listener: (notification: CatalogueNotification) => void): () => void;
  /** Subscribes to session action envelopes. Returns an unsubscribe function. */
  onSessionEnvelope(listener: (envelope: ActionEnvelope) => void): () => void;
  /**
   * Disposes the factory: rejects new sessions while in flight, drops the
   * registry and all listeners, and releases every backend attached before
   * disposal began. Concurrent calls in flight share one completion; the
   * factory accepts sessions again once disposal settles.
   *
   * A backend that is still starting when disposal begins is not awaited (a
   * non-cooperative provider cannot be cancelled). When it eventually
   * resolves, it is released detached, its disposal failure is reported
   * through {@link SessionsFactoryOptions.onDiagnostic}, and nothing is
   * published. Rejects with an `AggregateError` when one or more attached
   * backends fail to release; every backend is still attempted.
   */
  dispose(): Promise<void>;
}

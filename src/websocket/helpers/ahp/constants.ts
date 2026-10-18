/** AHP methods that must arrive as JSON-RPC requests. */
export const AHP_REQUEST_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "ping",
  "subscribe",
  "createSession",
  "disposeSession",
  "listSessions",
]);

/** AHP methods that must arrive as JSON-RPC notifications. */
export const AHP_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "unsubscribe",
  "dispatchAction",
]);

/**
 * Client-dispatchable session action names inventoried from the pinned SDK.
 * Only the baseline profile is applied; the rest are valid-but-unsupported.
 */
export const CLIENT_SESSION_ACTION_NAMES: ReadonlySet<string> = new Set([
  "session/titleChanged",
  "session/activeClientSet",
  "session/activeClientRemoved",
  "session/workingDirectorySet",
  "session/workingDirectoryRemoved",
  "session/workingDirectoryReplaced",
  "session/customizationToggled",
  "session/mcpServerStartRequested",
  "session/mcpServerStopRequested",
  "session/mcpServerBackgroundRequested",
  "session/isReadChanged",
  "session/isArchivedChanged",
  "session/configChanged",
]);

/** Actions this baseline applies through the session reducer. */
export const BASELINE_SUPPORTED_ACTIONS: ReadonlySet<string> = new Set([
  "session/titleChanged",
  "session/isReadChanged",
  "session/isArchivedChanged",
  "session/activeClientSet",
  "session/activeClientRemoved",
]);

/** Cap on events buffered while a snapshot reply is still unsettled. */
export const PENDING_DELIVERY_LIMIT = 256;

export const ROOT_SCHEME = "ahp-root://";
export const SESSION_SCHEME = "ahp-session:";

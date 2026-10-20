export const AGENT_REGISTER_METHOD = "x-ahp/agents/register";
export const AGENT_RENEW_METHOD = "x-ahp/agents/renew";
export const AGENT_UNREGISTER_METHOD = "x-ahp/agents/unregister";
export const WORK_SUBMIT_METHOD = "x-ahp/work/submit";
export const WORK_CLAIM_METHOD = "x-ahp/work/claim";
export const WORK_RENEW_METHOD = "x-ahp/work/renew";
export const WORK_COMPLETE_METHOD = "x-ahp/work/complete";
export const WORK_FAIL_METHOD = "x-ahp/work/fail";
export const WORK_CANCEL_METHOD = "x-ahp/work/cancel";
export const WORK_GET_METHOD = "x-ahp/work/get";

/** Versioned agent/work extension methods; requests only, never notifications. */
export const AGENT_WORK_REQUEST_METHODS: ReadonlySet<string> = new Set([
  AGENT_REGISTER_METHOD,
  AGENT_RENEW_METHOD,
  AGENT_UNREGISTER_METHOD,
  WORK_SUBMIT_METHOD,
  WORK_CLAIM_METHOD,
  WORK_RENEW_METHOD,
  WORK_COMPLETE_METHOD,
  WORK_FAIL_METHOD,
  WORK_CANCEL_METHOD,
  WORK_GET_METHOD,
]);

/** AHP methods that must arrive as JSON-RPC requests. */
export const AHP_REQUEST_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "ping",
  "subscribe",
  "createSession",
  "disposeSession",
  "listSessions",
  "x-ahp/tools/call",
  ...AGENT_WORK_REQUEST_METHODS,
]);

/** AHP methods that must arrive as JSON-RPC notifications. */
export const AHP_NOTIFICATION_METHODS: ReadonlySet<string> = new Set([
  "unsubscribe",
  "dispatchAction",
  "x-ahp/tools/complete",
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
export const TOOL_CALL_METHOD = "x-ahp/tools/call";
export const TOOL_COMPLETE_METHOD = "x-ahp/tools/complete";
export const TOOL_INVOCATION_METHOD = "x-ahp/tools/invoke";
export const MAX_TOOL_PAYLOAD_BYTES = 1_048_576;

/** Cap on one agent/work extension JSON payload (submission input or result). */
export const MAX_AGENT_WORK_PAYLOAD_BYTES = 1_048_576;

export const ROOT_SCHEME = "ahp-root://";
export const SESSION_SCHEME = "ahp-session:";

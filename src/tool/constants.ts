/** Metadata key stamped on an issued session manifest. */
export const APPLICATION_META_KEY = "x-ahp-application";

/** Namespaced selector inside createSession config. */
export const SESSION_TYPE_SELECTOR_KEY = "x-ahp-session-type";

/** Namespaced identity stamped on an admitted client tool. */
export const TOOL_CONTRACT_META_KEY = "x-ahp-tool-contract";

/** Only schema dialect accepted for catalogue tool contracts. */
export const TOOL_SCHEMA_DIALECT = "draft-07";

/** Inclusive upper bound for a tool or session-type version. */
export const MAX_CONTRACT_VERSION = 2_147_483_647;

/** Serialized tool definition limit. */
export const MAX_TOOL_DEFINITION_BYTES = 64 * 1024;

/** Maximum JSON nesting depth for a tool definition. */
export const MAX_TOOL_DEFINITION_DEPTH = 32;

/** Maximum resolved tools on one session type. */
export const MAX_TOOLS_PER_TYPE = 64;

/** Serialized issued-manifest limit. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/** Machine-readable logical key, for example `workspace.read-file`. */
export const CONTRACT_KEY_PATTERN = /^[a-z][a-z0-9]*([.-][a-z0-9]+)+$/;

/** Case-sensitive wire tool name. */
export const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

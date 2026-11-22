import type {
  ActionType,
  CustomizationEnablementKind,
  CustomizationType,
  ErrorInfo,
  SessionState,
} from "@microsoft/agent-host-protocol";

/* eslint-disable @typescript-eslint/no-unsafe-enum-assignment --
 * The mirrored literals below must be asserted to the Microsoft enum types
 * because `verbatimModuleSyntax` forbids reading ambient const enum members
 * (TS2748). The disable is scoped to this file; the rule stays on elsewhere. */

/** The root channel URI. Connection-level commands and catalogue notifications target it. */
export const ROOT_CHANNEL_URI = "ahp-root://";

/** Scheme prefix every session channel URI starts with (`ahp-session:/<id>`). */
export const SESSION_URI_PREFIX = "ahp-session:/";

/**
 * Session-type header key.
 *
 * A single segment such as `coding` is allowed. Tool keys stay on the stricter
 * catalogue pattern.
 */
export const SESSION_TYPE_KEY_PATTERN = /^[a-z][a-z0-9]*([.-][a-z0-9]+)*$/;

/** Title a session carries until the host generates a real one. */
export const DEFAULT_SESSION_TITLE = "New Session";

/**
 * Mirrored protocol literals.
 *
 * The Microsoft package declares its discriminants as ambient `const enum`s
 * (`SessionLifecycle`, `SessionStatus`, `ActionType`, ...). Under this project's
 * `verbatimModuleSyntax`, ambient const enum members cannot be read as values
 * (TS2748), so the values the server assigns are mirrored here. Each mirror is
 * pinned to the Microsoft type, so a renamed member fails type checking, and
 * `src/tests/sessions/compliance.test.ts` compares every mirror against the
 * package's runtime enum objects to catch value drift.
 */

/** `SessionLifecycle.Creating` — the lifecycle a session starts in. */
export const SESSION_LIFECYCLE_CREATING: SessionState["lifecycle"] = "creating" as SessionState["lifecycle"];

/** `SessionStatus.Idle` — set while no turn is active. */
export const SESSION_STATUS_IDLE: SessionState["status"] = 1;

/** `ActionType.SessionReady` — backend initialised successfully. */
export const ACTION_TYPE_SESSION_READY = "session/ready" as ActionType.SessionReady;
/** Native metadata replacement, projected by protected resource views. */
export const ACTION_TYPE_SESSION_META_CHANGED = "session/metaChanged" as ActionType.SessionMetaChanged;
/** Native server tool replacement, projected by protected resource views. */
export const ACTION_TYPE_SESSION_SERVER_TOOLS_CHANGED = "session/serverToolsChanged" as ActionType.SessionServerToolsChanged;

/** `ActionType.SessionCreationFailed` — backend failed to initialise. */
export const ACTION_TYPE_SESSION_CREATION_FAILED = "session/creationFailed" as ActionType.SessionCreationFailed;

/** `ActionType.SessionTitleChanged` — a user-facing session title was changed. */
export const ACTION_TYPE_SESSION_TITLE_CHANGED = "session/titleChanged" as ActionType.SessionTitleChanged;

/** `ActionType.SessionActiveClientSet` — a client became the active actor for a session. */
export const ACTION_TYPE_SESSION_ACTIVE_CLIENT_SET = "session/activeClientSet" as ActionType.SessionActiveClientSet;

/** `ActionType.SessionActiveClientRemoved` — a client was removed from the active set. */
export const ACTION_TYPE_SESSION_ACTIVE_CLIENT_REMOVED = "session/activeClientRemoved" as ActionType.SessionActiveClientRemoved;

/** `ActionType.SessionWorkingDirectorySet` — a session working directory was set. */
export const ACTION_TYPE_SESSION_WORKING_DIRECTORY_SET = "session/workingDirectorySet" as ActionType.SessionWorkingDirectorySet;

/** `ActionType.SessionWorkingDirectoryRemoved` — a session working directory entry was removed. */
export const ACTION_TYPE_SESSION_WORKING_DIRECTORY_REMOVED = "session/workingDirectoryRemoved" as ActionType.SessionWorkingDirectoryRemoved;

/** `ActionType.SessionWorkingDirectoryReplaced` — a session working directory set replaced an existing one. */
export const ACTION_TYPE_SESSION_WORKING_DIRECTORY_REPLACED = "session/workingDirectoryReplaced" as ActionType.SessionWorkingDirectoryReplaced;

/** `ActionType.SessionCustomizationToggled` — a customization toggle changed. */
export const ACTION_TYPE_SESSION_CUSTOMIZATION_TOGGLED = "session/customizationToggled" as ActionType.SessionCustomizationToggled;

/** `ActionType.SessionMcpServerStartRequested` — a server start was requested. */
export const ACTION_TYPE_SESSION_MCP_SERVER_START_REQUESTED = "session/mcpServerStartRequested" as ActionType.SessionMcpServerStartRequested;

/** `ActionType.SessionMcpServerStopRequested` — a server stop was requested. */
export const ACTION_TYPE_SESSION_MCP_SERVER_STOP_REQUESTED = "session/mcpServerStopRequested" as ActionType.SessionMcpServerStopRequested;

/** `ActionType.SessionMcpServerBackgroundRequested` — a background MCP server request was issued. */
export const ACTION_TYPE_SESSION_MCP_SERVER_BACKGROUND_REQUESTED = "session/mcpServerBackgroundRequested" as ActionType.SessionMcpServerBackgroundRequested;

/** `ActionType.SessionIsReadChanged` — the read/unread session flag changed. */
export const ACTION_TYPE_SESSION_IS_READ_CHANGED = "session/isReadChanged" as ActionType.SessionIsReadChanged;

/** `ActionType.SessionIsArchivedChanged` — the archived flag changed. */
export const ACTION_TYPE_SESSION_IS_ARCHIVED_CHANGED = "session/isArchivedChanged" as ActionType.SessionIsArchivedChanged;

/** `ActionType.SessionConfigChanged` — session configuration changed. */
export const ACTION_TYPE_SESSION_CONFIG_CHANGED = "session/configChanged" as ActionType.SessionConfigChanged;

/** `ActionType.RootActiveSessionsChanged` — the non-disposed session count changed. */
export const ACTION_TYPE_ROOT_ACTIVE_SESSIONS_CHANGED
  = "root/activeSessionsChanged" as ActionType.RootActiveSessionsChanged;

/** `CustomizationType.Plugin` — a client-published plugin customization. */
export const CUSTOMIZATION_TYPE_PLUGIN = "plugin" as CustomizationType.Plugin;

/** `CustomizationEnablementKind.Global`. */
export const CUSTOMIZATION_ENABLEMENT_GLOBAL = "global" as CustomizationEnablementKind.Global;

/** `CustomizationEnablementKind.Workspace`. */
export const CUSTOMIZATION_ENABLEMENT_WORKSPACE = "workspace" as CustomizationEnablementKind.Workspace;

/** `CustomizationEnablementKind.Session`. */
export const CUSTOMIZATION_ENABLEMENT_SESSION = "session" as CustomizationEnablementKind.Session;

/**
 * Stable public error for an unexpected backend startup failure.
 *
 * Only a provider's deliberate {@link SessionStartError} maps to a descriptive
 * payload; any other thrown value collapses to this generic category so
 * credentials, paths, headers, or service details in an arbitrary exception
 * never reach a session snapshot or the wire.
 */
export const SESSION_START_FAILURE_INFO: ErrorInfo = {
  errorType: "sessionStartFailed",
  message: "Session backend failed to start.",
};

import type { ActionType, SessionState } from "@microsoft/agent-host-protocol";

/* eslint-disable @typescript-eslint/no-unsafe-enum-assignment --
 * The mirrored literals below must be asserted to the Microsoft enum types
 * because `verbatimModuleSyntax` forbids reading ambient const enum members
 * (TS2748). The disable is scoped to this file; the rule stays on elsewhere. */

/** The root channel URI. Connection-level commands and catalogue notifications target it. */
export const ROOT_CHANNEL_URI = "ahp-root://";

/** Scheme prefix every session channel URI starts with (`ahp-session:/<id>`). */
export const SESSION_URI_PREFIX = "ahp-session:/";

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

/** `ActionType.SessionCreationFailed` — backend failed to initialise. */
export const ACTION_TYPE_SESSION_CREATION_FAILED = "session/creationFailed" as ActionType.SessionCreationFailed;

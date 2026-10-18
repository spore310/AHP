/** Access required before a tool may be shown to a client. */
export const ToolAccessLevel = {
  Standard: "standard",
  Admin: "admin",
} as const;

export type ToolAccessLevel = (typeof ToolAccessLevel)[keyof typeof ToolAccessLevel];

/**
 * Server-derived role. A client payload must never set this.
 * Anonymous is the only role the wire path can use until authentication exists.
 */
export const ClientAccessRole = {
  Anonymous: "anonymous",
  Admin: "admin",
} as const;

export type ClientAccessRole = (typeof ClientAccessRole)[keyof typeof ClientAccessRole];

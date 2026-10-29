/** Operations a tool policy may name. None of these is an application role. */
export const TOOL_OPERATIONS = [
  "discover",
  "propose",
  "approve",
  "advertise",
  "publish",
  "invoke",
  "execute",
] as const;

export type ToolOperation = (typeof TOOL_OPERATIONS)[number];

/** Actor kinds that a direct-grant rule may name. Empty means nobody. */
export const DIRECT_GRANT_ACTOR_KINDS = ["user", "agent"] as const;

export type DirectGrantActorKind = (typeof DIRECT_GRANT_ACTOR_KINDS)[number];

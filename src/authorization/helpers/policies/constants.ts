/** Closed operation vocabulary for compiled policies. */
export const POLICY_OPERATIONS = [
  "discover",
  "propose",
  "approve",
  "advertise",
  "publish",
  "invoke",
  "execute",
] as const;

export type PolicyOperation = (typeof POLICY_OPERATIONS)[number];

/** Actor kinds that a direct-grant rule may name. Empty means nobody. */
export const DIRECT_GRANT_ACTOR_KINDS = ["user", "agent"] as const;

export type DirectGrantActorKind = (typeof DIRECT_GRANT_ACTOR_KINDS)[number];

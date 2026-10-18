import type { SessionTypeCatalogue, SessionTypeRef } from "@sessions/helpers/sessionTypes";
import type { ToolContractRef } from "@tools";

import type { ClientAccessRole, ToolAccessLevel } from "./constants";

/** One catalogue tool and the role required before a client may see it. */
export interface AuthorizedToolGrant {
  readonly ref: ToolContractRef;
  readonly access: ToolAccessLevel;
}

/**
 * Header enum value to the tools that type authorizes.
 * The enum is the set of registered session-type keys, not a client-invented string.
 */
export type SessionTypeToolMap = ReadonlyMap<string, readonly AuthorizedToolGrant[]>;

/** Optional typed-session policy for one host. Absent means untyped creation. */
export interface SessionApplicationOptions {
  readonly catalogue: SessionTypeCatalogue;
  readonly defaultType?: SessionTypeRef;
  /** When omitted, every resolved tool is standard and visible. */
  readonly authorizedTools?: SessionTypeToolMap;
  /**
   * Server-derived role. Defaults to anonymous. Never read this from createSession params.
   */
  readonly role?: ClientAccessRole;
}

/** Exact type binding stored on the live session record. */
export interface SessionApplicationBinding {
  readonly typeId: string;
  readonly key: string;
  readonly version: number;
  readonly config: Readonly<Record<string, unknown>>;
}

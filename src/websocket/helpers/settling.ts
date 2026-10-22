import type { SessionsFactory } from "@sessions/types";
import type { SessionOwnerRegistry } from "@work";

/**
 * Single source of the settle-window probe, shared by the AHP create handler
 * and the host facade: an owner binding without a live record marks a disposal
 * still settling. Any create inside that window would either be stripped by
 * the settlement's unconditional binding release (stranding an ownerless live
 * record) or leave a binding behind with nothing to release it, so every
 * principal stays fail-closed until the settlement releases the binding.
 */
export const isSettlingSession = (
  sessionOwners: SessionOwnerRegistry,
  sessions: SessionsFactory,
  channel: string,
): boolean => (
  sessionOwners.owner(channel) !== undefined
  && sessions.getSessionSnapshot(channel) === undefined
);

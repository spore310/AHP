/** Fixed scheme of every canonical host namespace identifier. Distinct from `ahp-session:` and `ahp-root:`. */
export const HOST_NAMESPACE_SCHEME = "ahp-namespace:";
export const HOST_SLUG_MAX_LENGTH = 63;

/** Version of the authenticated host-to-host protocol. Independent of native AHP and the private extensions. */
export const HOST_PROTOCOL_VERSION = 1;
export const HOST_PROOF_HEADER = "x-ahp-host-proof";
export const HOST_FORWARDED_HEADER = "x-ahp-host-forwarded";
/** Largest accepted difference between a proof's issue time and the verifier's clock. */
export const HOST_PROOF_MAX_SKEW_MS = 30_000;
export const HOST_PROOF_MAX_BYTES = 4_096;
/** Well below the 16 KiB a Node HTTP server accepts for one whole header block. */
export const HOST_FORWARDED_MAX_BYTES = 8_192;
export const HOST_REPLAY_CACHE_SIZE = 4_096;

export const HOST_HEALTH_LIVE_PATH = "/livez";
export const HOST_HEALTH_READY_PATH = "/readyz";
export const HOST_HEALTH_STARTUP_PATH = "/startupz";

export const HOST_DEFAULT_LEASE_MS = 15_000;
export const HOST_DEFAULT_STANDBY_RETRY_MS = 1_000;
export const HOST_DEFAULT_ROUTE_TIMEOUT_MS = 30_000;
export const HOST_DEFAULT_ROUTE_MAX_PENDING = 256;
export const HOST_DEFAULT_ROUTE_MAX_LINKS = 8;
/**
 * Longest wait for another owner to confirm it has nothing older to deliver. A
 * confirmation queues behind that owner's in-flight relayed request and its
 * ordered writes, so this exceeds the 5 s write-queue deadline.
 */
export const HOST_DEFAULT_ORDER_TIMEOUT_MS = 10_000;
export const HOST_MAX_ROUTE_HOPS = 1;

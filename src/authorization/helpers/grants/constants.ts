export const DEFAULT_GRANT_RESOURCE_DEPTH = 8;
export const MAX_GRANT_RESOURCE_DEPTH = 32;
export const DEFAULT_INVALIDATION_LISTENERS = 16;
export const MAX_INVALIDATION_LISTENERS = 64;

export const DEFAULT_GRANT_LIMITS = Object.freeze({
  maxRegisteredRules: 32,
  maxMutationInputBytes: 64 * 1024,
  maxPendingMutations: 64,
  maxPendingPerActor: 8,
  maxBindingsPerActor: 32,
  maxChildrenPerParent: 32,
  maxGrantLifetimeMs: 60 * 60 * 1000,
  prepareDeadlineMs: 5000,
  maxCleanupRoots: 32,
});
export const MAX_GRANT_LIMITS = Object.freeze({
  maxRegisteredRules: 128,
  maxMutationInputBytes: 1024 * 1024,
  maxPendingMutations: 1024,
  maxPendingPerActor: 64,
  maxBindingsPerActor: 256,
  maxChildrenPerParent: 256,
  maxGrantLifetimeMs: 24 * 60 * 60 * 1000,
  prepareDeadlineMs: 60000,
  maxCleanupRoots: 128,
});

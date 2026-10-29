/**
 * Finite safety budgets for untrusted policy configuration.
 *
 * These are limits, not roles or grants. A later factory may apply a validated
 * custom budget. It must not treat a missing limit as permission.
 */
export interface PolicyLimits {
  readonly namespaceIncludeDepth: number;
  /** Include-list length. This is not `namespaceIncludeDepth`. */
  readonly maxNamespaceIncludes: number;
  readonly expandedPoliciesPerNamespace: number;
  readonly maxResourceIdLength: number;
  readonly delegationDepth: number;
  readonly pendingChallengesPerActor: number;
  readonly pendingChallengesPerHost: number;
  readonly challengeLifetimeSeconds: number;
  readonly retainedCompletedCallsPerHost: number;
  readonly aggregateResultBudgetBytes: number;
  readonly completedCallRetentionSeconds: number;
  readonly maxRoles: number;
  readonly maxPolicyRefs: number;
  readonly maxMetadataStringLength: number;
  readonly asyncHookDeadlineMs: number;
  readonly extensionDepth: number;
  readonly extensionBytes: number;
  readonly extensionKeys: number;
  readonly maxIdentifierLength: number;
}

const freezeLimits = (limits: PolicyLimits): PolicyLimits => Object.freeze({ ...limits });

/** Suggested library fallback. Empty role and grant arrays are a separate deny. */
export const POLICY_LIMIT_DEFAULTS: PolicyLimits = freezeLimits({
  namespaceIncludeDepth: 16,
  maxNamespaceIncludes: 32,
  expandedPoliciesPerNamespace: 256,
  maxResourceIdLength: 512,
  delegationDepth: 8,
  pendingChallengesPerActor: 8,
  pendingChallengesPerHost: 64,
  challengeLifetimeSeconds: 300,
  retainedCompletedCallsPerHost: 256,
  aggregateResultBudgetBytes: 16 * 1024 * 1024,
  completedCallRetentionSeconds: 60,
  maxRoles: 32,
  maxPolicyRefs: 64,
  maxMetadataStringLength: 256,
  asyncHookDeadlineMs: 5_000,
  extensionDepth: 8,
  extensionBytes: 16 * 1024,
  extensionKeys: 32,
  maxIdentifierLength: 128,
});

/** Hard ceiling. Values above this are unbounded for this contract and rejected. */
export const POLICY_LIMIT_ABSOLUTE: PolicyLimits = freezeLimits({
  namespaceIncludeDepth: 64,
  maxNamespaceIncludes: 256,
  expandedPoliciesPerNamespace: 4_096,
  maxResourceIdLength: 4_096,
  delegationDepth: 32,
  pendingChallengesPerActor: 64,
  pendingChallengesPerHost: 1_024,
  challengeLifetimeSeconds: 86_400,
  retainedCompletedCallsPerHost: 4_096,
  aggregateResultBudgetBytes: 256 * 1024 * 1024,
  completedCallRetentionSeconds: 3_600,
  maxRoles: 256,
  maxPolicyRefs: 512,
  maxMetadataStringLength: 4_096,
  asyncHookDeadlineMs: 60_000,
  extensionDepth: 16,
  extensionBytes: 256 * 1024,
  extensionKeys: 128,
  maxIdentifierLength: 256,
});

/** Own keys that must never select or extend a policy object. */
export const RESERVED_OBJECT_KEYS: readonly string[] = Object.freeze(["__proto__", "constructor", "prototype"]);

/** Positive revision ceiling shared with existing contract versions. */
export const MAX_POLICY_REVISION = 2_147_483_647;

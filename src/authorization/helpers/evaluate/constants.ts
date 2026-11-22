import type { ReferenceInputLimits, ReferenceRegistryCaps } from "./types";

export const DEFAULT_DECISION_TTL_MS = 60_000;
export const MAX_REFERENCE_CAP = 1_024;

export const DEFAULT_REFERENCE_CAPS: ReferenceRegistryCaps = Object.freeze({
  maxResources: 128,
  maxBindings: 128,
  maxTools: 128,
  maxExecutors: 128,
  maxAdmissions: 128,
  maxToolAssignments: 128,
  maxPermissionEvaluators: 128,
  maxExtensionEvaluators: 128,
  maxExternalInvalidations: 128,
});

export const MAX_REFERENCE_INPUT_LIMIT = 1_024;

export const DEFAULT_REFERENCE_INPUT_LIMITS: ReferenceInputLimits = Object.freeze({
  maxAdmissionInstalls: 128,
  maxRouteTargets: 128,
  maxProofs: 128,
  maxMandatorySelectors: 128,
  maxProjectionTools: 128,
});

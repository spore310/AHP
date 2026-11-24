export type {
  ArtifactDescriptor,
  Awaitable,
  ChallengeAdapter,
  ChallengeContext,
  ChallengeContinuation,
  ChallengePresentation,
  ChallengeProof,
  ChallengeStatus,
  ChallengeVerification,
  ToolActionContext,
  ToolPreparationHooks,
  ValidationResult,
} from "./types";

export { ToolAction, challengePresentationSchema, createChallengePresentationSchema } from "./types";
export { createResourceViews } from "./helpers/views";
export type { ResourceViewOptions, ResourceViewSource, ResourceViewRecord, ResourceViewRow, ResourceViewCatalogue, ResourceViewRecipient, ResourceViewProof } from "./helpers/views";
export { createToolActionRegistration } from "./helpers/action";
export type { ToolActionRegistration, ToolActionRegistrationOptions } from "./helpers/action";
export { createToolDispatcher } from "./helpers/dispatcher";
export type {
  ToolDispatchAdmission, ToolDispatchFacts, ToolDispatchPorts, ToolDispatchLimits, ToolDispatchPhase,
  ToolDispatchFailureCode, ToolDispatchOutcome, ToolDispatchHandle,
  ToolDispatchRequest, ToolDispatcherOptions, ToolDispatcher,
} from "./helpers/dispatcher";

export type { WorkOperationGuard as ToolWorkGuard, PrepareWorkOperation as ToolWorkPreparation } from "@authorization/helpers/resources/types";
export type { ToolChallengeOptions, ToolChallengeLimits } from "./helpers/challenge";

export { createToolResultProjection } from "./helpers/projection";
export type { ToolProjectionRequest, ToolProjectionOptions, ToolResultProjection } from "./helpers/projection";

export { createApprovedArtifactSource } from "./helpers/artifacts";
export type { ApprovedArtifact, ApprovedArtifactLoader, ApprovedArtifactSource, ArtifactSourceOptions } from "./helpers/artifacts";

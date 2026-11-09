import { z } from "zod";
import { challengePresentationSchema } from "@toolExecution/types";
import type { ChallengeAdapter, ChallengeContext, ChallengeContinuation, ChallengePresentation } from "@toolExecution/types";

export interface ToolChallengeLimits {
  readonly maxPending: number;
  readonly maxPerActor: number;
  readonly maxMetadataBytes: number;
  readonly maxProofBytes: number;
  readonly ttlMs: number;
  readonly hookTimeoutMs: number;
}
export interface ToolChallengeOptions {
  readonly adapter: ChallengeAdapter;
  readonly limits?: Partial<ToolChallengeLimits>;
  /** Required for any display text or redirect. Default is bare wait only. */
  approvePresentation?(presentation: ChallengePresentation): boolean;
}
export interface ToolChallengeRequest {
  readonly context: ChallengeContext;
  readonly deadline: number;
  current(): boolean;
}
export interface ToolChallengeHandle {
  readonly ready: Promise<ChallengeContinuation | undefined>;
  readonly verified: Promise<boolean>;
  /** Includes actual settlement of all adapter work, including optional cancel. */
  readonly settled: Promise<void>;
  resume(proofRef: string): Promise<boolean>;
  cancel(): void;
  /** Callback-free deadline fence after verification and fresh authorization. */
  fence(): boolean;
  /** Pure initial-receipt publication fence; a consumed challenge is not pending. */
  pendingFence(): boolean;
}
export interface ToolChallenges {
  open(request: ToolChallengeRequest): ToolChallengeHandle | undefined;
  invalidate(): void;
  dispose(): void;
  stats(): { readonly pending: number };
}
export const challengeContinuationSchema = z.strictObject({
  continuationId: z.string().min(1).max(128), expiresAt: z.iso.datetime(), presentation: challengePresentationSchema,
});
export const challengeVerificationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("verified"), continuationId: z.string().min(1).max(128) }),
  z.strictObject({ status: z.literal("denied"), code: z.string().min(1).max(128) }),
]);

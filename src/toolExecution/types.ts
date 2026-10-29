import { z } from "zod";

import {
  POLICY_LIMIT_DEFAULTS,
  policyLimitsSchema,
  type AuthorityRevisionStamp,
  type ExecutorRevision,
  type PolicyLimits,
  type ResourceRef,
  type TrustedRequestContext,
} from "@authorization";
import type { ToolExecutionBinding } from "@toolPolicy";

/** Synchronous or promised adapter result. This is not a scheduler. */
export type Awaitable<T> = T | Promise<T>;

/**
 * Optional validation result. Normalization replaces the one canonical input.
 * It does not add a second validated argument and it does not grant authority.
 */
export type ValidationResult<TInput>
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- frozen contract: unchanged input is void, not a second argument
  = | void
    | { readonly kind: "normalized"; readonly input: TInput };

/** Local cleanup registration. Callbacks are memory, not manifest data. */
export interface ToolPreparationHooks {
  onCleanup(callback: () => Awaitable<void>): void;
}

/**
 * Trusted action context. Caller and executor are different facts.
 * No socket, framework request, mutable grant map, or session record.
 */
export interface ToolActionContext {
  readonly caller: TrustedRequestContext;
  readonly executor: ExecutorRevision;
  readonly resources: {
    readonly origin: ResourceRef;
    readonly targets: readonly ResourceRef[];
  };
  readonly contract: { readonly id: string; readonly revision: number };
  readonly implementation: ToolExecutionBinding;
  readonly callId: string;
  readonly signal: AbortSignal;
  readonly authority: AuthorityRevisionStamp;
}

/**
 * Portable action contract. Optional `prepare` leaves `prepared` undefined.
 * Do not narrow that value with a cast. No dispatcher is implemented here.
 */
export abstract class ToolAction<TInput, TOutput, TPrepared = void> {
  authenticate?(context: ToolActionContext, input: TInput): Awaitable<void>;
  validate?(input: TInput, context: ToolActionContext): Awaitable<ValidationResult<TInput>>;
  prepare?(
    input: TInput,
    context: ToolActionContext,
    hooks: ToolPreparationHooks,
  ): Awaitable<TPrepared>;
  abstract execute(
    input: TInput,
    context: ToolActionContext,
    prepared: TPrepared | undefined,
  ): Awaitable<TOutput>;
  cleanup?(context: ToolActionContext, prepared: TPrepared | undefined): Awaitable<void>;
}

export type ChallengePresentation
  = | { readonly kind: "wait"; readonly message?: string }
    | { readonly kind: "redirect"; readonly url: string; readonly message?: string };

/** Opaque continuation. It cannot replace input, executor, or policy. */
export interface ChallengeContinuation {
  readonly continuationId: string;
  readonly expiresAt: string;
  readonly presentation: ChallengePresentation;
}

export interface ChallengeProof {
  readonly continuationId: string;
  readonly proofRef: string;
}

export type ChallengeVerification
  = | { readonly status: "verified"; readonly continuationId: string }
    | { readonly status: "denied"; readonly code: string };

export type ChallengeStatus
  = | { readonly status: "pending" | "consumed" | "expired" | "absent" };

/**
 * Application challenge port. A policy boolean means verification is mandatory.
 * This type does not implement MFA or consent.
 */
export interface ChallengeAdapter {
  begin(context: ToolActionContext): Awaitable<ChallengeContinuation>;
  verify(proof: ChallengeProof): Awaitable<ChallengeVerification>;
  cancel?(continuationId: string): Awaitable<void>;
  status?(continuationId: string): Awaitable<ChallengeStatus>;
}

/** Approved artifact metadata. A self-reported hash is not proof of execution. */
export interface ArtifactDescriptor {
  readonly artifactId: string;
  readonly publisherId: string;
  readonly contractRevision: number;
  readonly implementationRevision: number;
  readonly runtime: string;
  readonly platform: string;
  readonly digest: string;
  readonly verificationRef: string;
}

/** Bounds display metadata. Scheme text is not redirect approval. */
export const createChallengePresentationSchema = (input: PolicyLimits): z.ZodType<ChallengePresentation> => {
  const limits = policyLimitsSchema.parse(input);
  const messageSchema = z.string().min(1).max(limits.maxMetadataStringLength);
  const urlSchema = z.string().min(1).max(limits.maxMetadataStringLength).pipe(z.httpUrl());
  return z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("wait"),
      message: messageSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("redirect"),
      url: urlSchema,
      message: messageSchema.optional(),
    }),
  ]);
};

export const challengePresentationSchema = createChallengePresentationSchema(POLICY_LIMIT_DEFAULTS);

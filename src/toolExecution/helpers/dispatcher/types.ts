import type { AuthorityRevisionStamp, PolicyDecision } from "@authorization/types";
import type { Awaitable, ToolActionContext } from "../../types";
import type { ToolActionRegistration } from "../action/types";
import { z } from "zod";
import { POLICY_LIMIT_ABSOLUTE } from "@authorization/constants";
import { createAuthorizationSchemas } from "@authorization/helpers/validation";
import { createToolPolicySchemas } from "@toolPolicy/helpers/validation";

/** Initial authority is provisional; only full authorization admits preparation. */
export type ToolDispatchFacts = Omit<ToolActionContext, "signal">;

/** Per-invocation trusted host wiring; never client-supplied proof or callbacks. */
export interface ToolDispatchPorts {
  resolve(input: unknown, signal: AbortSignal): Awaitable<ToolDispatchFacts>;
  coarse(context: ToolActionContext, input: unknown): Awaitable<boolean>;
  authorize(context: ToolActionContext, input: unknown): Awaitable<{
    readonly decision: PolicyDecision;
    readonly authority: AuthorityRevisionStamp;
  }>;
  /** Must retain the complete invocation-specific freshness evidence privately. */
  current(context: ToolActionContext): boolean;
}

export interface ToolDispatchLimits {
  readonly maxInFlight: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonKeys: number;
  readonly maxRetainedOutputBytes: number;
  readonly timeoutMs: number;
  readonly hookTimeoutMs: number;
  readonly shutdownWaitMs: number;
}

export const TOOL_DISPATCH_DEFAULTS: Readonly<ToolDispatchLimits> = Object.freeze({
  maxInFlight: 64, maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024,
  maxJsonDepth: 64, maxJsonKeys: 131_072, maxRetainedOutputBytes: 16 * 1024 * 1024,
  timeoutMs: 30_000, hookTimeoutMs: 5_000, shutdownWaitMs: 5_000,
});

export const TOOL_DISPATCH_ABSOLUTE: Readonly<ToolDispatchLimits> = Object.freeze({
  maxInFlight: 1024, maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024,
  maxJsonDepth: 128, maxJsonKeys: 1_048_576, maxRetainedOutputBytes: 256 * 1024 * 1024,
  timeoutMs: 120_000, hookTimeoutMs: 60_000, shutdownWaitMs: 60_000,
});

export type ToolDispatchPhase = "admission" | "context" | "coarse" | "authenticate" | "validate"
  | "authorize" | "prepare" | "execute" | "output" | "cleanup" | "delivery";
export type ToolDispatchFailureCode = "closed" | "capacity" | "duplicate-call" | "invalid-input"
  | "invalid-context" | "denied" | "challenge-required" | "stale" | "invalid-clock"
  | "action-reused" | "action-failed" | "invalid-output" | "result-capacity" | "cleanup-failed"
  | "cancelled" | "timeout";

export type ToolDispatchOutcome<TOutput>
  = | { readonly status: "succeeded"; readonly output: TOutput; readonly cleanupFailures: 0 }
    | { readonly status: "failed"; readonly code: ToolDispatchFailureCode; readonly phase: ToolDispatchPhase;
      readonly effectPossible: boolean; readonly cleanupFailures: number; };

export interface ToolDispatchHandle<TOutput> {
  /** May settle before the action does on cancellation/deadline. */
  readonly result: Promise<ToolDispatchOutcome<TOutput>>;
  /** Settles only after owned work and all cleanup settle. */
  readonly settled: Promise<ToolDispatchOutcome<TOutput>>;
  cancel(): void;
}

export interface ToolDispatchRequest<TInput, TOutput, TPrepared = void> {
  readonly callId: string;
  readonly input: unknown;
  readonly registration: ToolActionRegistration<TInput, TOutput, TPrepared>;
  readonly ports: ToolDispatchPorts;
  readonly signal?: AbortSignal;
}

export interface ToolDispatcherOptions {
  readonly limits?: Partial<ToolDispatchLimits>;
  readonly now?: () => number;
}

export interface ToolDispatcher {
  dispatch<TInput, TOutput, TPrepared = void>(request: ToolDispatchRequest<TInput, TOutput, TPrepared>): ToolDispatchHandle<TOutput>;
  shutdown(): Promise<{ readonly draining: number }>;
  stats(): { readonly active: number; readonly draining: number; readonly retainedOutputBytes: number };
}

const authoritySchemas = createAuthorizationSchemas(POLICY_LIMIT_ABSOLUTE);
export const toolDispatchFactsSchema: z.ZodType<ToolDispatchFacts> = z.strictObject({
  caller: authoritySchemas.trustedRequestContextSchema,
  executor: authoritySchemas.executorRevisionSchema,
  resources: z.strictObject({
    origin: authoritySchemas.resourceRefSchema,
    targets: z.array(authoritySchemas.resourceRefSchema).max(POLICY_LIMIT_ABSOLUTE.maxPolicyRefs),
  }),
  contract: z.strictObject({ id: authoritySchemas.identifierSchema, revision: z.int().positive() }),
  implementation: createToolPolicySchemas(POLICY_LIMIT_ABSOLUTE).toolExecutionBindingSchema,
  callId: authoritySchemas.identifierSchema,
  authority: authoritySchemas.authorityRevisionStampSchema,
});

export const toolDispatchDecisionSchema = authoritySchemas.policyDecisionSchema;
export const toolDispatchAuthorizationSchema = z.strictObject({
  decision: toolDispatchDecisionSchema,
  authority: authoritySchemas.authorityRevisionStampSchema,
});

export interface ActiveToolDispatch {
  cancel(): void;
  readonly settled: Promise<unknown>;
  draining(): boolean;
}

export class ToolDispatchFailure extends Error {
  constructor(readonly code: ToolDispatchFailureCode) {
    super(code);
  }
}
